// textToGcode.js — конвертация текста / Markdown в G-code для плоттера.
// Текст -> контуры глифов (opentype.js, TrueType) -> SVG-пути -> полилинии -> G-code (svgToGcode).
import opentype from 'opentype.js';
import { marked } from 'marked';
import { svgToGcode } from './svgToGcode.js';
import { buildFillPolylines, buildHandwritePolylines, polylinesToPathD } from './glyphFill.js';

const MM_PER_PT = 0.35278; // 1pt = 0.35278mm

export const PAGE_FORMATS = {
  A4: [210, 297],
  A5: [148, 210],
  A3: [297, 420],
  Letter: [215.9, 279.4],
};

// ---- Загрузка и кэширование шрифтов (URL Google Fonts / любой .ttf) ----
const fontCache = new Map(); // url -> Promise<Font>

// Разрешение ссылки Google Fonts -> ПРЯМОЙ URL полного TTF со всей кириллицей.
// Без старого User-Agent и subset=cyrillic Google отдаёт woff2-подмножества или
// latin-TTF, в котором русских букв нет (все глифы = .notdef).
const resolveCache = new Map(); // cssUrl -> Promise<{url, family}>

export async function resolveGoogleFontUrl(cssUrl) {
  if (/\.(ttf|otf)(\?|$)/i.test(cssUrl)) return { url: cssUrl, family: null };
  if (!resolveCache.has(cssUrl)) {
    const p = (async () => {
      let u = cssUrl;
      if (!/format=/.test(u)) u += (u.includes('?') ? '&' : '?') + 'format=ttf';
      if (!/subset=/i.test(u)) u += '&subset=cyrillic,latin';
      const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64)' } });
      if (!res.ok) throw new Error('Google Fonts недоступен: HTTP ' + res.status);
      const css = await res.text();
      const fam = (css.match(/font-family:\s*'([^']+)'/) || [])[1] || null;
      const urls = [...css.matchAll(/src:\s*url\(([^)]+)\)/g)].map((m) => m[1].replace(/["']/g, ''));
      if (!urls.length) throw new Error('В CSS шрифта не найден src(url) — проверьте ссылку на fonts.google.com');
      const ttf = urls.find((x) => x.includes('.ttf')) || urls[urls.length - 1];
      return { url: ttf, family: fam };
    })().catch((e) => { resolveCache.delete(cssUrl); throw e; });
    resolveCache.set(cssUrl, p);
  }
  return resolveCache.get(cssUrl);
}

export async function loadFont(url) {
  // Если вместо TTF пришла ссылка на CSS/страницу Google Fonts или woff2 — разрешаем в полный TTF
  if (/^https?:\/\//i.test(url) && !/\.(ttf|otf)(\?|$)/i.test(url)) {
    const r = await resolveGoogleFontUrl(url);
    url = r.url;
  }
  if (!fontCache.has(url)) {
    const p = (async () => {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64)' } });
      if (!res.ok) throw new Error('Не удалось скачать шрифт: HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      let font;
      try {
        font = opentype.parse(buf);
      } catch (e) {
        throw new Error('Не удалось разобрать шрифт (' + e.message + '). Используйте TTF/OTF (кнопка «TTF» на fonts.google.com).');
      }
      if (!font || !font.supported) throw new Error('Файл не является поддерживаемым TrueType/OpenType шрифтом');
      return font;
    })().catch((e) => { fontCache.delete(url); throw e; });
    fontCache.set(url, p);
  }
  return fontCache.get(url);
}

export function fontName(font) {
  try {
    const n = font && font.getEnglishName && font.getEnglishName('fontFamily');
    if (n) return n;
  } catch (e) { /* old opentype.js */ }
  const names = font && font.names;
  if (!names) return 'unknown';
  const win = names.windows || {};
  return (names.fontFamily && (names.fontFamily.en || Object.values(names.fontFamily)[0]))
    || (win.fontFamily && (win.fontFamily.en || Object.values(win.fontFamily)[0]))
    || (names.legacy && names.legacy.fontFamily && (names.legacy.fontFamily.en || Object.values(names.legacy.fontFamily)[0]))
    || 'unknown';
}

// Проверка покрытия шрифтом символов текста (для предупреждения о кириллице и т.п.)
export function missingGlyphs(font, text) {
  const miss = new Set();
  for (const ch of new Set(text)) {
    if (ch === '\n' || ch === ' ') continue;
    try {
      const g = font.charToGlyph(ch);
      if (!g || g.index === 0) miss.add(ch);
    } catch (e) { /* считаем символ поддерживаемым, если проверка упала */ }
  }
  return [...miss];
}

// stringToGlyphs с фичами может падать на некоторых шрифтах — откатываемся на посимвольный разбор
function safeStringToGlyphs(font, s) {
  try {
    return font.stringToGlyphs(s);
  } catch (e) {
    const out = [];
    for (const ch of s) {
      try { out.push(font.charToGlyph(ch)); } catch (_) { out.push(font.charToGlyph(' ')); }
    }
    return out;
  }
}

// ---- Markdown -> блоки с размерами ----
const HEADING_SIZES_PT = { h1: 26, h2: 19, h3: 15, h4: 13, h5: 11, h6: 10 };

export function mdToBlocks(mdText, baseSizePt) {
  const tokens = marked.lexer(mdText || '');
  const blocks = [];

  const extractText = (inlineTokens) => {
    if (!inlineTokens) return '';
    let out = '';
    for (const t of inlineTokens) {
      if (t.type === 'br') out += '\n';
      else if (t.tokens) out += extractText(t.tokens);
      else if (typeof t.text === 'string') out += t.text;
      else if (typeof t.raw === 'string') out += t.raw;
    }
    return out;
  };

  const walk = (toks, indentLevel) => {
    for (const t of toks) {
      switch (t.type) {
        case 'heading':
          blocks.push({ size: HEADING_SIZES_PT[t.depth] || baseSizePt, gapAfter: 6, indent: indentLevel, text: extractText(t.tokens) });
          break;
        case 'paragraph':
          blocks.push({ size: baseSizePt, gapAfter: 5, indent: indentLevel, text: extractText(t.tokens) });
          break;
        case 'text':
          blocks.push({ size: baseSizePt, gapAfter: 1, indent: indentLevel, text: extractText(t.tokens) || t.raw });
          break;
        case 'list':
          for (const item of t.items || []) {
            blocks.push({ size: baseSizePt, gapAfter: 0, indent: indentLevel, marker: true, text: '' });
            walk(item.tokens || [], indentLevel + 1);
          }
          blocks.push({ size: baseSizePt, gapAfter: 3, indent: indentLevel, text: '' });
          break;
        case 'code':
          for (const line of String(t.text || '').split('\n')) {
            blocks.push({ size: Math.max(baseSizePt - 2, 6), mono: true, gapAfter: 0, indent: indentLevel + 1, text: line.length ? line : ' ' });
          }
          blocks.push({ size: baseSizePt, gapAfter: 4, indent: indentLevel, text: '' });
          break;
        case 'hr':
          blocks.push({ type: 'rule', gapAfter: 5 });
          break;
        case 'blockquote':
          walk(t.tokens || [], indentLevel + 1);
          break;
        case 'space':
          break;
        default:
          if (t.tokens) walk(t.tokens, indentLevel);
      }
    }
  };
  walk(tokens, 0);

  // вставляем маркер «•» перед первым текстовым блоком каждого list item
  const merged = [];
  let pendingMarker = null;
  for (const b of blocks) {
    if (b.marker) { pendingMarker = b.indent; continue; }
    if (pendingMarker != null && b.text && b.text.trim()) {
      merged.push({ ...b, text: '•  ' + b.text, indent: pendingMarker });
      pendingMarker = null;
    } else {
      pendingMarker = null;
      merged.push(b);
    }
  }
  return merged;
}

// ---- Word wrap по метрикам шрифта ----
// opentype.js getAdvanceWidth возвращает значение в unitsPerEm при передаваемом size (см. исходники),
// поэтому нормализуем сами: сумма advance глифов / unitsPerEm * sizePt -> pt, затем в мм.
function widthMm(font, s, sizePt) {
  let adv = 0;
  try {
    for (const g of safeStringToGlyphs(font, s)) adv += g.advanceWidth || 0;
  } catch (e) { adv = s.length * font.unitsPerEm * 0.5; }
  return (adv / font.unitsPerEm) * sizePt * MM_PER_PT;
}

function wrapLine(font, text, sizePt, maxWidthMm) {
  if (!text.trim()) return [''];
  if (maxWidthMm <= 0) return [text];
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? cur + ' ' + w : w;
    if (widthMm(font, cand, sizePt) > maxWidthMm && cur) { lines.push(cur); cur = w; }
    else cur = cand;
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---- Трансляция SVG-пути (абсолютные команды M L C Q Z) ----
function translatePath(d, dx, dy) {
  return d.replace(/([MLCQZmlcqz])([^MLCQZmlcqz]*)/g, (m0, cmd, args) => {
    if (cmd.toUpperCase() === 'Z') return cmd;
    const nums = args.trim().split(/[\s,]+/).filter(Boolean).map(parseFloat);
    const shifted = nums.map((v, i) => Math.round((i % 2 === 0 ? v + dx : v + dy) * 100) / 100);
    return cmd + shifted.join(' ');
  });
}

// Сдвиг X/Y во всех командных строках G-code (G0/G1 с координатами)
function shiftGcode(gcode, dx, dy) {
  return gcode.split('\n').map((line) => {
    if (!/^(G0|G1)\b/.test(line)) return line;
    let out = line.replace(/X(-?\d*\.?\d+)/, (m, v) => 'X' + (parseFloat(v) + dx).toFixed(3));
    out = out.replace(/Y(-?\d*\.?\d+)/, (m, v) => 'Y' + (parseFloat(v) + dy).toFixed(3));
    return out;
  }).join('\n');
}

/**
 * Рендер текста/Markdown в G-code.
 * @param {string} content текст или markdown
 * @param {object} opts {
 *   font: opentype.Font, markdown: bool, fontSize(pt), lineHeight, align,
 *   pageFormat|pageW|pageH, orientation, margin(mm),
 *   plotWidth, plotHeight (рабочая область стола мм), penUpZ, feedDraw, feedTravel, scaleToFit
 * }
 */
export function renderText(content, opts) {
  const o = {
    markdown: false,
    fontSize: 12,
    lineHeight: 1.4,
    align: 'left',
    pageFormat: 'A4',
    orientation: 'portrait',
    margin: 12,
    plotWidth: 210,
    plotHeight: 297,
    penUpZ: 5,
    feedDraw: 1500,
    feedTravel: 3000,
    scaleToFit: true,
    renderMode: 'outline', // 'outline' | 'solid' | 'hatch' | 'handwrite'
    ...opts,
  };
  const font = o.font;
  if (!font) throw new Error('Шрифт не загружен');
  const renderMode = ['outline', 'solid', 'hatch', 'handwrite'].includes(o.renderMode) ? o.renderMode : 'outline';

  // Размер бумаги в мм
  let pw = o.pageW, ph = o.pageH;
  if (!pw || !ph) {
    const f = PAGE_FORMATS[o.pageFormat] || PAGE_FORMATS.A4;
    pw = f[0]; ph = f[1];
  }
  if (o.orientation === 'landscape') [pw, ph] = [ph, pw];

  const marginMm = o.margin;
  const availW = pw - 2 * marginMm;

  let blocks;
  if (o.markdown) {
    blocks = mdToBlocks(String(content || ''), o.fontSize);
    // Построчные размеры (извлечены из PDF): sizePt[i] задаёт кегль i-й строки исходника.
    if (Array.isArray(o.lineSizesPt) && o.lineSizesPt.length) {
      const sizes = o.lineSizesPt;
      let li = 0;
      for (const b of blocks) {
        if (!b.text) continue;
        for (const _p of String(b.text).split(/\r?\n/)) {
          if (li < sizes.length && sizes[li] > 0) b.size = sizes[li];
          li++;
        }
      }
    }
  } else {
    blocks = String(content || '').split(/\r?\n/).map((line) => ({ size: o.fontSize, text: line, gapAfter: 0 }));
  }

  // Разворачиваем блоки в строки
  const lines = [];
  for (const b of blocks) {
    if (b.type === 'rule') { lines.push({ rule: true, sizePt: o.fontSize }); continue; }
    const sizePt = b.size || o.fontSize;
    const indentMm = (b.indent || 0) * 5;
    const maxW = Math.max(availW - indentMm, 10);
    for (const para of String(b.text ?? '').split('\n')) {
      const wrapped = wrapLine(font, para, sizePt, maxW);
      wrapped.forEach((txt, i, arr) => {
        lines.push({
          text: txt, sizePt, indentMm,
          gapAfter: i === arr.length - 1 ? (b.gapAfter || 0) : 0,
        });
      });
    }
  }

  // Раскладка: координаты в мм страницы, Y вниз (как в SVG)
  const paths = [];
  const glyphCmdsList = []; // команды глифов для solid/hatch-режимов
  let y = marginMm;
  let overflowY = false;
  for (const ln of lines) {
    const lineH = ln.sizePt * MM_PER_PT * o.lineHeight;
    if (ln.rule) {
      const yy = y + lineH / 2;
      paths.push(`M ${marginMm.toFixed(2)} ${yy.toFixed(2)} L ${(pw - marginMm).toFixed(2)} ${yy.toFixed(2)}`);
      y += lineH;
      continue;
    }
    if (!ln.text.trim()) { y += lineH + ln.gapAfter; continue; }
    const wTxt = widthMm(font, ln.text, ln.sizePt);
    let x = marginMm + ln.indentMm;
    if (o.align === 'center') x = marginMm + (availW - wTxt) / 2;
    if (o.align === 'right') x = marginMm + availW - wTxt;
    const baseline = y + ln.sizePt * MM_PER_PT;
    try {
      // Собираем путь посимвольно (font.getPath может падать на неподдерживаемых GSUB-фичах)
      let d = '';
      let penX = x;
      for (const g of safeStringToGlyphs(font, ln.text)) {
        try {
          const cmds = g.getPath(penX, baseline, ln.sizePt).commands;
          if (renderMode !== 'outline' && cmds && cmds.length) glyphCmdsList.push(cmds);
          d += cmds
            .map((c) => {
              if (c.type === 'Z') return 'Z';
              if (c.type === 'L') return `L ${c.x.toFixed(2)} ${c.y.toFixed(2)}`;
              if (c.type === 'M') return `M ${c.x.toFixed(2)} ${c.y.toFixed(2)}`;
              if (c.type === 'C') return `C ${c.x1.toFixed(2)} ${c.y1.toFixed(2)} ${c.x2.toFixed(2)} ${c.y2.toFixed(2)} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`;
              if (c.type === 'Q') return `Q ${c.x1.toFixed(2)} ${c.y1.toFixed(2)} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`;
              return '';
            })
            .join(' ') + ' ';
        } catch (e) { /* глиф без пути — пропускаем */ }
        penX += ((g.advanceWidth || font.unitsPerEm * 0.5) / font.unitsPerEm) * ln.sizePt * MM_PER_PT;
      }
      if (d.trim()) paths.push(d.trim());
    } catch (e) { /* пропускаем строку */ }
    y += lineH + ln.gapAfter;
    if (y > ph + 100) { overflowY = true; break; } // защита от очень длинного текста
  }

  if (renderMode === 'handwrite') {
    // «ручка»: одна линия по средней линии штрихов, без обводки контура.
    const hwPolys = buildHandwritePolylines(glyphCmdsList);
    if (!hwPolys.length && !paths.length) throw new Error('Нечего рисовать — пустой текст или шрифт не содержит нужных глифов');
    if (hwPolys.length) {
      paths.length = 0;
      paths.push(...polylinesToPathD(hwPolys));
    }
  } else if (renderMode !== 'outline') {
    // solid/hatch: заменяем контурные пути штрихованными полилиниями глифов.
    // Правила (hr) и подчёркивания остаются как есть — их не заливаем.
    const fillPolys = buildFillPolylines(glyphCmdsList, renderMode);
    if (!fillPolys.length && !paths.length) throw new Error('Нечего рисовать — пустой текст или шрифт не содержит нужных глифов');
    paths.length = 0;
    paths.push(...polylinesToPathD(fillPolys));
  }

  if (!paths.length) throw new Error('Нечего рисовать — пустой текст или шрифт не содержит нужных глифов');

  // Границы содержимого (по всем числам путей: чётные X, нечётные Y)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const numRe = /(-?\d*\.?\d+)/g;
  for (const d of paths) {
    let m, i = 0;
    while ((m = numRe.exec(d))) {
      const v = parseFloat(m[1]);
      if (i % 2 === 0) { minX = Math.min(minX, v); maxX = Math.max(maxX, v); }
      else { minY = Math.min(minY, v); maxY = Math.max(maxY, v); }
      i++;
    }
  }
  if (!isFinite(minX)) throw new Error('Не удалось определить границы рисунка');

  const tx = -minX, ty = -minY;
  const shifted = paths.map((d) => translatePath(d, tx, ty));
  const contentW = maxX - minX, contentH = maxY - minY;

  const svgText =
    `<svg viewBox="0 0 ${contentW.toFixed(2)} ${contentH.toFixed(2)}" width="${contentW}" height="${contentH}">` +
    shifted.map((d) => `<path d="${d}"/>`).join('') +
    '</svg>';

  // Позиция по умолчанию: левый ВЕРХНИЙ угол листа с отступом margin (требование пользователя).
  const drawW = contentW, drawH = contentH; // svgToGcode при scaleToFit=false использует s=1
  const hasPos = Number.isFinite(Number(o.offsetX)) && Number.isFinite(Number(o.offsetY));

  // Если содержимое больше рабочего поля — уменьшаем его целиком, чтобы гарантированно
  // осталось на листе (иначе часть текста печаталась «за границей листа»).
  let fitScale = 1;
  if (drawW > o.plotWidth || drawH > o.plotHeight) {
    fitScale = Math.min(o.plotWidth / drawW, o.plotHeight / drawH);
  }
  const scaledW = drawW * fitScale, scaledH = drawH * fitScale;

  // posX/posY — ЛЕВЫЙ и ВЕРХНИЙ край содержимого в мм стола (Y вверх).
  const clampF = (v, lo, hi) => (hi >= lo ? Math.min(Math.max(v, lo), hi) : lo);
  const defX = marginMm;
  const defY = o.plotHeight - marginMm; // верхний край листа на столе
  const posX = hasPos ? clampF(Number(o.offsetX), 0, Math.max(0, o.plotWidth - scaledW)) : defX;
  const posY = hasPos ? clampF(Number(o.offsetY), scaledH, o.plotHeight) : defY;

  let gcodeSvg = svgText;
  if (fitScale < 1) {
    // пересобираем SVG с масштабом относительно левого-верхнего угла содержимого
    const k = fitScale;
    const scaledPaths = shifted.map((d) => d.replace(/(-?\d*\.?\d+)/g, (m) => {
      const v = parseFloat(m);
      return Number.isFinite(v) ? (v * k).toFixed(2) : m;
    }));
    gcodeSvg =
      `<svg viewBox="0 0 ${(contentW * k).toFixed(2)} ${(contentH * k).toFixed(2)}" ` +
      `width="${(contentW * k).toFixed(2)}" height="${(contentH * k).toFixed(2)}">` +
      scaledPaths.map((d) => `<path d="${d}"/>`).join('') +
      '</svg>';
  }

  const out = svgToGcode(gcodeSvg, {
    plotWidth: o.plotWidth,
    plotHeight: o.plotHeight,
    penUpZ: o.penUpZ,
    feedDraw: o.feedDraw,
    feedTravel: o.feedTravel,
    margin: 5,
    scaleToFit: false, // размер текста в мм должен быть точным; позиция — через offsetX/offsetY
    offsetX: posX,
    offsetY: posY, // svgToGcode трактует offsetY как верхний край блока (мм стола, Y вверх)
  });

  // Нормализуем координаты: левый-верхний угол содержимого = ровно posX/posY.
  // (inkscape-границы путей могут на доли мм отличаться от ink-font границ макета)
  let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
  for (const pl of out.preview) {
    for (const p of pl) {
      if (p.x < bMinX) bMinX = p.x;
      if (p.x > bMaxX) bMaxX = p.x;
      if (p.y < bMinY) bMinY = p.y;
      if (p.y > bMaxY) bMaxY = p.y;
    }
  }
  const shX = posX - bMinX, shY = posY - bMaxY;
  if (Math.abs(shX) > 1e-6 || Math.abs(shY) > 1e-6) {
    out.preview = out.preview.map((pl) => pl.map((p) => ({ x: p.x + shX, y: p.y + shY })));
    out.gcode = shiftGcode(out.gcode, shX, shY);
  }

  out.stats.content = { w: bMaxX - bMinX, h: bMaxY - bMinY };
  out.stats.position = { x: posX, y: posY, default: !hasPos };
  if (fitScale < 1) out.stats.fitScale = fitScale;

  const fitsPaper = contentW <= pw && contentH <= ph;
  out.stats.paper = {
    format: o.pageFormat,
    orientation: o.orientation,
    pageW: pw,
    pageH: ph,
    contentW,
    contentH,
    fitsPaper,
    overflowY,
  };
  return out;
}
