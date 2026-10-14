// docToText.js — извлечение текста из документов: PDF / DOCX / TXT / MD.
// PDF разбирается через mupdf (WASM, без системных зависимостей): текст с позициями,
// размерами и начертанием шрифта -> Markdown-блоки, которые затем рендерятся векторными
// контурами выбранного шрифта плоттера (как в Pen Plotter Converter из ubu78/Scalable-Pen-Plotter).
import JSZip from 'jszip';

const PT = 0.35278; // 1pt = mm

// ---------- PDF ----------
let mupdfMod = null;
async function getMupdf() {
  if (!mupdfMod) mupdfMod = await import('mupdf');
  return mupdfMod;
}

// Сопоставление имён встроенных шрифтов PDF с markdown-размерами заголовков
function headingSizeFor(basePt, name, sizePt, bold) {
  const n = (name || '').toLowerCase();
  if (/^(h\d|heading|title|subtitle)/.test(n)) {
    if (/subtitle/.test(n)) return Math.min(basePt * 1.4, 16);
    const m = n.match(/^h(\d)/);
    const mult = m ? [1, 2.2, 1.7, 1.35, 1.15, 1.05, 1][Number(m[1])] : 1.5;
    return basePt * mult;
  }
  return sizePt;
}

export async function pdfToMarkdown(buf) {
  const mupdf = await getMupdf();
  let doc;
  try {
    doc = mupdf.Document.openDocument(new Uint8Array(buf), 'application/pdf');
  } catch (e) {
    throw new Error('Не удалось открыть PDF: ' + e.message);
  }
  const pages = doc.countPages();
  if (!pages) throw new Error('PDF не содержит страниц');
  const out = [];

  for (let pi = 0; pi < pages; pi++) {
    const page = doc.loadPage(pi);
    const st = page.toStructuredText('preserve-whitespace');
    const json = JSON.parse(st.asJSON());
    const blocks = json.blocks || [];
    // Собираем все строки со всех блоков, сортируем по вертикали (чтение сверху вниз)
    const lines = [];
    for (const b of blocks) for (const l of b.lines || []) {
      for (const s of l.text || []) {
        if (!s.text || !s.text.trim()) continue;
        lines.push({
          x: s.x, y: s.y,
          size: (s.font && s.font.size) || 12,
          name: (s.font && s.font.name) || '',
          text: s.text,
        });
      }
    }
    lines.sort((a, b) => a.y - b.y || a.x - b.x);
    if (!lines.length) {
      if (pi > 0) out.push('\n---\n');
      continue;
    }
    const sizes = lines.map((l) => l.size);
    const minSize = Math.min(...sizes);
    const maxSize = Math.max(...sizes);
    const sizeSpan = maxSize - minSize;

    for (const l of lines) {
      const bold = /bold|black|heavy|semibold|mediump/i.test(l.name);
      const italic = /italic|oblique/i.test(l.name);
      let txt = l.text.trim();
      if (!txt) continue;
      if (bold) txt = '**' + txt + '**';
      if (italic) txt = '*' + txt + '*';

      const rel = sizeSpan > 0.5 ? (l.size - minSize) / sizeSpan : 0;
      let line;
      if (sizeSpan >= 3 && l.size >= maxSize - 0.5) line = '# ' + txt.replace(/\*\*/g, '');
      else if (sizeSpan >= 3 && rel >= 0.66) line = '## ' + txt.replace(/\*\*/g, '');
      else if (sizeSpan >= 3 && rel >= 0.33) line = '### ' + txt.replace(/\*\*/g, '');
      else if (l.x > 30 && /^\d+[.)]\s/.test(txt)) line = '1. ' + txt.slice(txt.indexOf(' ') + 1);
      else if (l.x > 30 && /^[•·◦o\-–]\s/.test(txt)) line = '- ' + txt.slice(1).trim();
      else line = txt;

      out.push(line);
    }
    if (pi < pages - 1) out.push('\n---\n'); // разрыв страницы -> горизонтальная линия
  }
  return out.join('\n');
}

// ---------- DOCX ----------
export async function docxToMarkdown(buf) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (e) {
    throw new Error('Не удалось открыть DOCX (это должен быть zip-архив): ' + e.message);
  }
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('В DOCX не найден word/document.xml — возможно это старый формат .doc');
  const xml = await entry.async('string');

  // Очень простой парсер OOXML без внешних зависимостей
  const decode = (s) =>
    s
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&amp;/g, '&');

  const paras = xml.match(/<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g) || [];
  const outLines = [];
  for (const p of paras) {
    // стили абзаца
    const styleM = p.match(/<w:pStyle w:val="([^"]+)"/);
    const style = styleM ? styleM[1] : '';
    const numPr = /<w:numPr\b/.test(p);
    const ilvlM = p.match(/<w:ilvl w:val="(\d+)"/);
    const ilvl = ilvlM ? Number(ilvlM[1]) : 0;

    // прогоны (runs)
    const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
    let text = '';
    let anyBold = false, anyItalic = false, maxSz = 0;
    let m;
    while ((m = runRe.exec(p))) {
      const run = m[1];
      if (/<w:b\/>|<w:b w:val="(1|true|on)"/.test(run)) anyBold = true;
      if (/<w:i\/>|<w:i w:val="(1|true|on)"/.test(run)) anyItalic = true;
      const szM = run.match(/<w:sz w:val="(\d+)"/);
      if (szM) maxSz = Math.max(maxSz, Number(szM[1]) / 2); // half-points -> pt
      const tRe = /<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g;
      let t;
      while ((t = tRe.exec(run))) {
        if (t[0] === '<w:tab/>') text += '\t';
        else if (t[0] === '<w:br/>') text += '\n';
        else text += decode(t[1] || '');
      }
    }
    text = text.trim();
    if (!text) continue;

    let md = text;
    const hM = style.match(/^Heading(\d)$/i);
    if (hM) md = '#'.repeat(Math.min(Number(hM[1]), 6)) + ' ' + text;
    else if (/^Title$/i.test(style)) md = '# ' + text;
    else if (/^Subtitle$/i.test(style)) md = '## ' + text;
    else if (numPr) md = '\t'.repeat(ilvl) + '- ' + text;
    else if (/List/i.test(style)) md = '\t'.repeat(ilvl) + '- ' + text;
    else if (anyBold && maxSz <= 0) md = '**' + text + '**';
    if (anyBold && !md.startsWith('#')) md = md.replace(text, '**' + text + '**');
    outLines.push(md);
  }
  if (!outLines.length) throw new Error('В документе нет извлекаемого текста');
  return outLines.join('\n\n');
}

// ---------- DOC (старый бинарный Word) ----------
// Извлечение «сырого» текста из OLE-потока WordDocument (эвристика, без гарантии качества)
export function docExtractText(buf) {
  const u8 = new Uint8Array(buf);
  // быстрый поиск подписи
  const isOle = u8[0] === 0xd7 && u8[1] === 0xcd && u8[2] === 0xc6 && u8[3] === 0xa0;
  if (!isOle) throw new Error('Файл .doc не распознан (не OLE). Сохраните его как .docx или PDF.');
  // Сканируем область текста: последовательности печатных символов длиной >= 4
  let out = '';
  let run = '';
  for (let i = 0; i < u8.length; i++) {
    const c = u8[i];
    const printable = (c >= 32 && c <= 126) || c === 10 || c === 13 || c === 9 || (c >= 0xc0 && c <= 0xff);
    if (printable) {
      run += c === 13 ? '\n' : String.fromCharCode(c <= 126 ? c : c);
    } else {
      if (run.replace(/[\s]/g, '').length >= 4) out += run.trim() + '\n';
      run = '';
    }
  }
  if (run.replace(/[\s]/g, '').length >= 4) out += run.trim();
  const cleaned = out
    .split('\n')
    .map((l) => l.replace(/[^\x09\x0a\x20-\x7e\u00c0-\u024f\u0400-\u04ff]/g, ''))
    .filter((l) => l.trim().length > 1)
    .join('\n');
  if (cleaned.length < 4) throw new Error('Не удалось извлечь текст из .doc. Пересохраните файл в .docx или PDF.');
  return cleaned;
}

// ---------- TXT / MD ----------
export function plainToText(buf) {
  // BOM strip, попытка определить UTF-8 vs CP1251
  let u8 = new Uint8Array(buf);
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) u8 = u8.subarray(3);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(u8);
  // если много replacement-символов — пробуем windows-1251
  const bad = (utf8.match(/\ufffd/g) || []).length;
  if (bad > utf8.length * 0.01) {
    try { return new TextDecoder('windows-1251').decode(u8); } catch (e) { /* ignore */ }
  }
  return utf8;
}

// ---------- Диспетчер ----------
export async function documentToContent(name, buf) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'pdf':
      return { content: await pdfToMarkdown(buf), markdown: true, kind: 'PDF' };
    case 'docx':
      return { content: await docxToMarkdown(buf), markdown: true, kind: 'DOCX' };
    case 'doc':
      return { content: docExtractText(buf), markdown: false, kind: 'DOC (сырой текст)' };
    case 'md':
    case 'markdown':
      return { content: plainToText(buf), markdown: true, kind: 'Markdown' };
    case 'txt':
      return { content: plainToText(buf), markdown: false, kind: 'Текст' };
    default:
      throw new Error('Неподдерживаемый формат файла: .' + ext + ' (можно PDF, DOCX, DOC, TXT, MD)');
  }
}
