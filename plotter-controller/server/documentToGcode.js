// documentToGcode.js — полный цикл «документ → G-code» (вдохновлено Pen Plotter Converter
// из ubu78/Scalable-Pen-Plotter Plugin/test): PDF / DOCX / TXT / MD / вставленный текст
// -> блоки с кеглями -> контуры выбранного шрифта -> раскладка на листе A4 -> G-code.
import { loadFont, mdToBlocks, missingGlyphs, fontName } from './textToGcode.js';
import { buildFillPolylines, buildHandwritePolylines, polylinesToPathD } from './glyphFill.js';
import { documentToContent } from './docToText.js';

const PT = 0.35278;

// ---------- Извлечение блоков с метриками из PDF ----------
let mupdfMod = null;
async function getMupdf() {
  if (!mupdfMod) mupdfMod = await import('mupdf');
  return mupdfMod;
}

export async function pdfExtractBlocks(buf) {
  const mupdf = await getMupdf();
  const doc = mupdf.Document.openDocument(new Uint8Array(buf), 'application/pdf');
  const pages = doc.countPages();
  if (!pages) throw new Error('PDF не содержит страниц');
  const blocks = [];
  for (let pi = 0; pi < pages; pi++) {
    const page = doc.loadPage(pi);
    const st = page.toStructuredText('preserve-whitespace');
    const json = JSON.parse(st.asJSON());
    const lines = [];
    for (const b of json.blocks || []) for (const l of b.lines || []) {
      for (const s of l.text || []) {
        if (!s.text || !s.text.trim()) continue;
        lines.push({
          x: s.x, y: s.y,
          size: (s.font && s.font.size) || 12,
          name: (s.font && s.font.name) || '',
          text: s.text.replace(/\s+$/, ''),
        });
      }
    }
    if (!lines.length) continue;
    lines.sort((a, b) => a.y - b.y || a.x - b.x);
    // группировка в абзацы: строка продолжается, если следующая начинается почти на том же X
    let para = null;
    for (const l of lines) {
      const bold = /bold|black|heavy|semibold/i.test(l.name);
      const italic = /italic|oblique/i.test(l.name);
      const isHead = bold && l.size > 13.5;
      const startsNew = !para || Math.abs(l.x - para.x) > 6 || l.size !== para.size || isHead || (l.y - para.lastY) > para.size * 2.2;
      if (startsNew) {
        para = { type: isHead ? 'heading' : 'paragraph', size: l.size, x: l.x, lastY: l.y, indent: 0, text: l.text };
        blocks.push(para);
      } else {
        para.text += ' ' + l.text;
        para.lastY = l.y;
      }
    }
    // отступы слева относительно минимального X на странице -> списки
    const minX = Math.min(...blocks.slice(-lines.length).map((b) => b.x));
    for (const b of blocks) {
      if (b.indent === undefined) continue;
      if (b.x - minX > 12 && b.type === 'paragraph') {
        b.indent = 1;
        if (!/^[•·\-–]/.test(b.text)) b.text = '•  ' + b.text;
      }
    }
    blocks.push({ type: 'pagebreak' });
  }
  while (blocks.length && blocks[blocks.length - 1].type === 'pagebreak') blocks.pop();
  if (!blocks.length) throw new Error('В PDF не найден текст (возможно, это скан-картинка без OCR)');
  return blocks;
}

// ---------- Эмуляция начертаний (жирный) через утолщение контуров ----------
// Для плоттера «жирность» = замкнутый контур, пройденный по внешнему смещению.
// Простая и надёжная аппроксимация: рисуем глиф N раз со смещением на tiny офсет (штриховка).
// Сдвиг всех координат X/Y в G-коде (для точной позиционации содержимого)
function shiftGcode(gcode, dx, dy) {
  return gcode.replace(/\b([XY])(-?\d*\.?\d+)/g, (m, axis, val) => {
    const v = parseFloat(val);
    if (!Number.isFinite(v)) return m;
    const nv = axis === 'X' ? v + dx : v + dy;
    return axis + nv.toFixed(3);
  });
}

function emboldenPaths(paths, weight) {
  if (!weight || weight <= 1) return paths;
  const out = [];
  const n = Math.min(Math.round(weight), 4); // 1..4 прохода
  const step = 0.12; // мм между проходами
  for (const d of paths) {
    for (let i = 0; i < n; i++) {
      const dx = i * step;
      out.push(translate(d, dx, 0));
    }
  }
  return out;
}

function translate(d, dx, dy) {
  return d.replace(/([MLCQZmlcqz])([^MLCQZmlcqz]*)/g, (m0, cmd, args) => {
    if (cmd.toUpperCase() === 'Z') return cmd;
    const nums = args.trim().split(/[\s,]+/).filter(Boolean).map(parseFloat);
    const shifted = nums.map((v, i) => Math.round((i % 2 === 0 ? v + dx : v + dy) * 100) / 100);
    return cmd + shifted.join(' ');
  });
}

// ---------- Рендер блока строк в SVG-пути (мм страницы, Y вниз) ----------
function cmdsToD(cmds) {
  return cmds
    .map((c) => {
      if (c.type === 'Z') return 'Z';
      if (c.type === 'L') return `L ${c.x.toFixed(2)} ${c.y.toFixed(2)}`;
      if (c.type === 'M') return `M ${c.x.toFixed(2)} ${c.y.toFixed(2)}`;
      if (c.type === 'C') return `C ${c.x1.toFixed(2)} ${c.y1.toFixed(2)} ${c.x2.toFixed(2)} ${c.y2.toFixed(2)} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`;
      if (c.type === 'Q') return `Q ${c.x1.toFixed(2)} ${c.y1.toFixed(2)} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`;
      return '';
    })
    .join(' ');
}

function glyphPath(font, ch, x, baseline, sizePt) {
  try {
    const g = font.charToGlyph(ch);
    if (!g || g.index === 0) return { d: '', adv: ((font.unitsPerEm * 0.5) / font.unitsPerEm) * sizePt * PT };
    const cmds = g.getPath(x, baseline, sizePt).commands;
    const d = cmdsToD(cmds);
    const adv = ((g.advanceWidth || font.unitsPerEm * 0.5) / font.unitsPerEm) * sizePt * PT;
    return { d, adv, cmds };
  } catch (e) {
    return { d: '', adv: sizePt * PT * 0.5, cmds: null };
  }
}

function lineWidth(font, s, sizePt) {
  let w = 0;
  for (const ch of s) w += glyphPath(font, ch, 0, 0, sizePt).adv;
  return w;
}

function wrapByWidth(font, text, sizePt, maxWidth) {
  if (!text.trim()) return [''];
  if (maxWidth <= 0) return [text];
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? cur + ' ' + w : w;
    if (lineWidth(font, cand, sizePt) > maxWidth && cur) { lines.push(cur); cur = w; }
    else cur = cand;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * mainSizePt — базовый кегль (pt). Если preserveSizes=true, размеры из блоков используются как есть,
 * иначе все масштабируются пропорционально mainSizePt / medianBlockSize.
 */
export function layoutBlocks(blocks, opts) {
  const o = {
    pageW: 210, pageH: 297, margin: 12, align: 'left', lineHeight: 1.4,
    preserveSizes: true, scaleAll: 1, boldWeight: 2,
    ...opts,
  };
  const font = o.font;
  const renderMode = ['outline', 'solid', 'hatch', 'handwrite'].includes(o.renderMode) ? o.renderMode : 'outline';
  const availW = o.pageW - 2 * o.margin;
  const paths = [];
  const glyphCmdsList = []; // для solid/hatch
  let y = o.margin;
  let overflow = false;

  for (const b of blocks) {
    if (b.type === 'pagebreak') { y += b.size * PT * 0.6; continue; }
    if (b.type === 'rule') {
      const yy = y + 4;
      paths.push(`M ${o.margin.toFixed(2)} ${yy.toFixed(2)} L ${(o.pageW - o.margin).toFixed(2)} ${yy.toFixed(2)}`);
      y += 8;
      continue;
    }
    const sizePt = Math.max(4, (b.size || o.mainSizePt || 12) * o.scaleAll);
    const indent = (b.indent || 0) * 5;
    const maxW = Math.max(availW - indent, 10);
    const wrapped = wrapByWidth(font, String(b.text ?? ''), sizePt, maxW);
    wrapped.forEach((txt, idx, arr) => {
      const lineH = sizePt * PT * o.lineHeight;
      if (txt.trim()) {
        const lw = lineWidth(font, txt, sizePt);
        let x = o.margin + indent;
        if (o.align === 'center') x = o.margin + (availW - lw) / 2;
        if (o.align === 'right') x = o.margin + availW - lw;
        const baseline = y + sizePt * PT;
        let d = '';
        let penX = x;
        for (const ch of txt) {
          const r = glyphPath(font, ch, penX, baseline, sizePt);
          if (r.d) d += r.d + ' ';
          if (renderMode !== 'outline' && r.cmds && r.cmds.length) glyphCmdsList.push(r.cmds);
          penX += r.adv;
        }
        if (d.trim()) {
          const blockBold = b.bold || b.type === 'heading';
          const list = [d.trim()];
          const w = blockBold ? Math.max(2, o.boldWeight) : 1;
          paths.push(...emboldenPaths(list, w));
        }
      }
      y += lineH;
      if (idx === arr.length - 1) y += (b.gapAfter || (b.type === 'heading' ? 6 : 4)) * 0.5;
    });
    if (y > o.pageH + 60) { overflow = true; }
  }

  // solid/hatch: заменяем контурные пути штрихованными полилиниями глифов;
  // handwrite («ручка»): одна линия по средней линии штрихов, без обводки контура.
  let outPaths = paths;
  if (renderMode === 'handwrite') {
    const hwPolys = buildHandwritePolylines(glyphCmdsList);
    if (hwPolys.length) outPaths = polylinesToPathD(hwPolys);
  } else if (renderMode !== 'outline') {
    const fillPolys = buildFillPolylines(glyphCmdsList, renderMode);
    outPaths = polylinesToPathD(fillPolys);
  }
  return { paths: outPaths, height: y, overflow };
}

// ---------- Основной API ----------
export async function convertDocument({ fileBase64, fileName, text, markdown, fontUrl, options }) {
  const o = options || {};
  const plotW = Number(o.plotWidth) || 210;
  const plotH = Number(o.plotHeight) || 297;

  // 1. Источник контента
  let content = '';
  let md = !!markdown;
  let kind = 'Текст';
  let nativeBlocks = null;
  if (fileBase64 && fileName) {
    const buf = Buffer.from(fileBase64, 'base64');
    const res = await documentToContent(fileName, buf);
    content = res.content;
    md = res.markdown;
    kind = res.kind;
    if (/\.pdf$/i.test(fileName)) {
      try { nativeBlocks = await pdfExtractBlocks(buf); } catch (e) { nativeBlocks = null; }
    }
  } else {
    if (!text || !String(text).trim()) throw new Error('Пустой текст и не загружен файл');
    content = String(text);
  }

  // 2. Шрифт
  if (!fontUrl) throw new Error('Не указан шрифт');
  const font = await loadFont(fontUrl);

  // 3. Параметры листа
  let pageFormat = o.pageFormat || 'A4';
  let pw = o.pageW ? Number(o.pageW) : null;
  let ph = o.pageH ? Number(o.pageH) : null;
  if (!pw || !ph) {
    const fmt = { A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4] }[pageFormat] || [210, 297];
    pw = fmt[0]; ph = fmt[1];
  }
  if (o.orientation === 'landscape') [pw, ph] = [ph, pw];
  pw = Math.min(pw, plotW);
  ph = Math.min(ph, plotH);
  const margin = Math.max(Number(o.textMargin) || 12, 2);

  // 4. Блоки
  let blocks;
  if (nativeBlocks && o.preserveLayout !== false) {
    blocks = nativeBlocks;
  } else {
    // через markdown/textToGcode-разбор
    const { mdToBlocks } = await import('./textToGcode.js');
    blocks = md
      ? mdToBlocks(content, Number(o.fontSize) || 12)
      : content.split(/\r?\n/).map((line) => ({ type: 'paragraph', size: Number(o.fontSize) || 12, text: line, gapAfter: 2 }));
  }

  // авто-масштаб: если содержимое сильно больше листа — уменьшаем кегли
  const baseMedian = (() => {
    const sizes = blocks.filter((b) => b.size).map((b) => b.size).sort((a, b) => a - b);
    return sizes.length ? sizes[Math.floor(sizes.length / 2)] : Number(o.fontSize) || 12;
  })();

  let layout = layoutBlocks(blocks, {
    font, pageW: pw, pageH: ph, margin,
    align: ['left', 'center', 'right'].includes(o.align) ? o.align : 'left',
    lineHeight: Number(o.lineHeight) || 1.4,
    scaleAll: 1,
    boldWeight: Number(o.boldWeight) || 2,
    renderMode: o.renderMode,
  });

  let autoScale = 1;
  if (layout.overflow && o.autoFit !== false) {
    // подбираем масштаб, чтобы высота влезла (грубая пропорция + запас)
    autoScale = Math.max(0.35, (ph - 2 * margin) / Math.max(layout.height, 1));
    // итеративно уточняем (wrap зависит от размера)
    for (let i = 0; i < 4; i++) {
      const t = layoutBlocks(blocks, {
        font, pageW: pw, pageH: ph, margin,
        align: o.align, lineHeight: Number(o.lineHeight) || 1.4,
        scaleAll: autoScale, boldWeight: Number(o.boldWeight) || 2,
        renderMode: o.renderMode,
      });
      if (!t.overflow) { layout = t; break; }
      autoScale *= (ph - 2 * margin) / Math.max(t.height, 1);
      layout = t;
    }
  }

  if (!layout.paths.length) throw new Error('Нечего рисовать — пустой документ или шрифт без нужных глифов');

  // 5. SVG -> G-code (с границами содержимого)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const numRe = /(-?\d*\.?\d+)/g;
  for (const d of layout.paths) {
    let m, i = 0;
    while ((m = numRe.exec(d))) {
      const v = parseFloat(m[1]);
      if (i % 2 === 0) { minX = Math.min(minX, v); maxX = Math.max(maxX, v); }
      else { minY = Math.min(minY, v); maxY = Math.max(maxY, v); }
      i++;
    }
  }
  const contentW = maxX - minX, contentH = maxY - minY;
  const svgText =
    `<svg viewBox="0 0 ${contentW.toFixed(2)} ${contentH.toFixed(2)}" width="${contentW}" height="${contentH}">` +
    layout.paths.map((d) => `<path d="${d}"/>`).join('') +
    '</svg>';

  // Позиция по умолчанию: левый ВЕРХНИЙ угол листа с отступом margin (требование пользователя).
  // offsetX/offsetY (если переданы) задают позицию ЛЕВОГО-ВЕРХНЕГО угла содержимого на столе
  // в мм (Y вверх) — используются для перетаскивания мышью во фронтенде.
  const clampF2 = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const hasPos = Number.isFinite(Number(o.offsetX)) && Number.isFinite(Number(o.offsetY));

  // Если содержимое больше рабочего поля — уменьшаем его целиком, чтобы гарантированно
  // осталось на листе (иначе часть текста печаталась «за границей листа»).
  let fitScale = 1;
  if (contentW > plotW || contentH > plotH) {
    fitScale = Math.min(plotW / contentW, plotH / contentH);
  }
  let gcodeSvg = svgText;
  if (fitScale < 1) {
    const k = fitScale;
    const scaledPaths = layout.paths.map((d) => d.replace(/(-?\d*\.?\d+)/g, (m) => {
      const v = parseFloat(m);
      return Number.isFinite(v) ? (v * k).toFixed(2) : m;
    }));
    gcodeSvg =
      `<svg viewBox="0 0 ${(contentW * k).toFixed(2)} ${(contentH * k).toFixed(2)}" ` +
      `width="${(contentW * k).toFixed(2)}" height="${(contentH * k).toFixed(2)}">` +
      scaledPaths.map((d) => `<path d="${d}"/>`).join('') +
      '</svg>';
  }

  let pageLeft = margin;
  let pageTopY = ph - margin;
  if (hasPos) {
    pageLeft = clampF2(Number(o.offsetX), 0, Math.max(0, plotW - contentW * fitScale));
    pageTopY = clampF2(Number(o.offsetY), contentH * fitScale, plotH);
  }

  const { svgToGcode } = await import('./svgToGcode.js');
  const out = svgToGcode(gcodeSvg, {
    plotWidth: plotW, plotHeight: plotH,
    penUpZ: Number(o.penUpZ ?? 5),
    feedDraw: Number(o.feedDraw ?? 1500),
    feedTravel: Number(o.feedTravel ?? 3000),
    margin: 5,
    scaleToFit: false, // точный размер шрифта; масштаб только если контент не влезает (см. fitScale)
    offsetX: pageLeft,
    offsetY: pageTopY, // левый-верхний угол содержимого
  });

  // Точная нормализация: сдвиг = запрошенная позиция − фактический левый-верхний угол
  let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
  for (const pl of out.preview) {
    for (const p of pl) {
      if (p.x < bMinX) bMinX = p.x;
      if (p.x > bMaxX) bMaxX = p.x;
      if (p.y < bMinY) bMinY = p.y;
      if (p.y > bMaxY) bMaxY = p.y;
    }
  }
  const shX = pageLeft - bMinX;
  const shY = pageTopY - bMaxY;
  if (Math.abs(shX) > 1e-6 || Math.abs(shY) > 1e-6) {
    out.preview = out.preview.map((pl) => pl.map((p) => ({ x: p.x + shX, y: p.y + shY })));
    out.gcode = shiftGcode(out.gcode, shX, shY);
  }

  out.stats.content = { w: bMaxX - bMinX, h: bMaxY - bMinY };
  out.stats.position = { x: pageLeft, y: pageTopY, default: !hasPos };

  out.stats.paper = {
    format: pageFormat, orientation: o.orientation || 'portrait',
    pageW: pw, pageH: ph, contentW, contentH,
    fitsPaper: contentW <= pw + 1 && contentH <= ph + 1,
    overflowY: layout.overflow,
    autoScale,
  };
  out.stats.source = { kind, font: fontName(font), baseMedianPt: baseMedian };
  out.missingGlyphs = missingGlyphs(font, typeof content === 'string' ? content : '');
  out.previewGrid = { width: pw, height: ph, margin };
  return out;
}
