// server.js — HTTP API для управления плоттером через GRBL
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GrblConnection } from './grbl.js';
import { svgToGcode, extractPathsFromSvg, pathsToPolylines } from './svgToGcode.js';
import { loadFont, renderText, missingGlyphs, fontName, PAGE_FORMATS, resolveGoogleFontUrl } from './textToGcode.js';
import { convertDocument } from './documentToGcode.js';
import http from 'http';
import { attachWebSocket } from './ws.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, '..', 'dist')));

const grbl = new GrblConnection();

// Состояние задания печати
let job = {
  total: 0,
  sent: 0,
  running: false,
  paused: false,
  gcode: null,
};

grbl.printListener = (line) => console.log('[grbl]', line);
grbl.errorListener = (e) => console.log('[grbl error]', e);

// ---- Порты ----
app.get('/api/ports', async (req, res) => {
  try { res.json(await grbl.listPorts()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/connect', async (req, res) => {
  const { port, baudrate = 115200 } = req.body || {};
  if (!port) return res.status(400).json({ error: 'Не указан порт' });
  try {
    await grbl.connect(port, baudrate);
    // Ждём приветствие GRBL и делаем soft-reset
    setTimeout(async () => {
      grbl.sendRealtime('\x18'); // Ctrl-X soft reset
      grbl.sendCommand('$X');    // unlock (если не в alarm — просто ok)
    }, 400);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/disconnect', (req, res) => {
  stopJobInternal();
  grbl.disconnect();
  res.json({ ok: true });
});

// ---- Статус ----
app.get('/api/status', async (req, res) => {
  if (!grbl.connected) return res.json({ connected: false, state: 'Offline', job });
  const st = await grbl.getStatus();
  res.json({
    connected: true,
    state: st ? st.state : 'Unknown',
    mpos: st ? st.MPos : null,
    wpos: st ? st.WPos : null,
    fs: st ? st.FS : null,
    pin: st ? st.PIN : null,
    job: { ...job, queue: grbl.queueLength },
  });
});

// ---- Ручное управление / консоль ----
app.post('/api/command', async (req, res) => {
  const cmd = String(req.body?.cmd ?? '').trim();
  if (!cmd) return res.status(400).json({ error: 'Пустая команда' });
  if (!grbl.connected) return res.status(400).json({ error: 'Не подключено' });
  // realtime-команды отправляем сразу
  if (cmd === '?' || cmd === '!' || cmd === '~') {
    grbl.sendRealtime(cmd);
    return res.json({ ok: true, realtime: true });
  }
  if (cmd === '$X' || cmd === '$H' || cmd === '$$') {
    // special: $$ печатает настройки через printListener
    grbl.sendCommand(cmd);
    return res.json({ ok: true });
  }
  grbl.sendCommand(cmd);
  res.json({ ok: true });
});

// Jog: относительное перемещение с ограничением по размеру стола
app.post('/api/jog', (req, res) => {
  const { axis, distance, feed = 2000 } = req.body || {};
  if (!grbl.connected) return res.status(400).json({ error: 'Не подключено' });
  if (!['x', 'y', 'z'].includes(axis)) return res.status(400).json({ error: 'Неверная ось' });
  const d = Number(distance);
  if (!isFinite(d) || Math.abs(d) > 1000) return res.status(400).json({ error: 'Слишком большое перемещение' });
  grbl.sendCommand(`$J=G91 G21 ${axis.toUpperCase()}${d.toFixed(3)} F${Number(feed)}`);
  res.json({ ok: true });
});

app.post('/api/set-zero', (req, res) => {
  const axes = req.body?.axes ?? 'XYZ';
  if (!grbl.connected) return res.status(400).json({ error: 'Не подключено' });
  grbl.sendCommand('G10 L20 P0 ' + [...axes].map((a) => a.toUpperCase() + '0').join(' '));
  res.json({ ok: true });
});

// ---- SVG -> G-code ----
app.post('/api/convert', (req, res) => {
  const { svg, options } = req.body || {};
  if (!svg) return res.status(400).json({ error: 'Нет SVG' });
  try {
    const out = svgToGcode(svg, options || {});
    job.gcode = out.gcode;
    job.total = countMotionLines(out.gcode);
    job.sent = 0;
    res.json({ gcode: out.gcode, stats: out.stats, preview: out.preview });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Превью без генерации gcode (для отрисовки на фронте можно и самому, но удобно)
app.post('/api/preview', (req, res) => {
  const { svg, options } = req.body || {};
  try {
    const { plotWidth = 300, plotHeight = 300, margin = 5, scaleToFit = true } = options || {};
    const parsed = extractPathsFromSvg(svg || '');
    const polylines = pathsToPolylines(parsed.paths);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pl of polylines) for (const p of pl) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const s = scaleToFit ? Math.min((plotWidth - 2 * margin) / Math.max(maxX - minX, 1e-6), (plotHeight - 2 * margin) / Math.max(maxY - minY, 1e-6)) : 1;
    const offX = margin + (plotWidth - 2 * margin - (maxX - minX) * s) / 2 - minX * s;
    const availH = plotHeight - 2 * margin;
    const drawHs = (maxY - minY) * s;
    const topY = margin + (availH - drawHs) / 2 + drawHs;
    res.json({
      size: { width: plotWidth, height: plotHeight },
      polylines: polylines.map((pl) => pl.map((p) => ({ x: p.x * s + offX, y: topY - (p.y - minY) * s }))),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Текст / Markdown -> G-code ----
// Разрешение ссылки Google Fonts -> прямой URL полного TTF (с кириллицей).
// Делается на сервере: браузер получил бы woff2/latin-подмножество без русских букв.
app.post('/api/resolve-font', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Некорректный URL шрифта' });
  try {
    const r = await resolveGoogleFontUrl(url);
    res.json({ ok: true, url: r.url, family: r.family });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Проверка/загрузка шрифта по URL (прямой .ttf/.otf). Опционально — покрытие символов текста.
app.post('/api/font-check', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  const text = String(req.body?.text || '');
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Некорректный URL шрифта' });
  try {
    const font = await loadFont(url);
    res.json({
      ok: true,
      family: fontName(font),
      glyphs: font.numGlyphs,
      hasCyrillic: !!font.charToGlyph('Я') && font.charToGlyph('Я').index !== 0,
      missing: text ? missingGlyphs(font, text) : [],
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/text-to-gcode', async (req, res) => {
  const { text, fontUrl, options } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Пустой текст' });
  if (!fontUrl) return res.status(400).json({ error: 'Не указан шрифт' });
  try {
    const font = await loadFont(fontUrl);
    const out = renderText(text, { font, ...normalizeTextOptions(options) });
    job.gcode = out.gcode;
    job.total = countMotionLines(out.gcode);
    job.sent = 0;
    const missing = missingGlyphs(font, text);
    res.json({ gcode: out.gcode, stats: out.stats, preview: out.preview, missingGlyphs: missing });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function normalizeTextOptions(o) {
  o = o || {};
  const plotW = Number(o.plotWidth) || 210;
  const plotH = Number(o.plotHeight) || 297;
  // Ограничение размера бумаги — не больше рабочего поля плоттера
  let pageFormat = o.pageFormat || 'A4';
  let pw = o.pageW ? Number(o.pageW) : null;
  let ph = o.pageH ? Number(o.pageH) : null;
  if (!pw || !ph) {
    const f = PAGE_FORMATS[pageFormat] || PAGE_FORMATS.A4;
    pw = f[0]; ph = f[1];
  }
  if (o.orientation === 'landscape') [pw, ph] = [ph, pw];
  // если выбранный формат больше стола — урезаем до стола
  pw = Math.min(pw, plotW);
  ph = Math.min(ph, plotH);
  return {
    markdown: !!o.markdown,
    fontSize: Number(o.fontSize) || 12,
    lineHeight: Number(o.lineHeight) || 1.4,
    align: ['left', 'center', 'right'].includes(o.align) ? o.align : 'left',
    pageW: pw,
    pageH: ph,
    pageFormat,
    orientation: o.orientation || 'portrait',
    margin: Math.max(Number(o.textMargin) || 12, 2),
    plotWidth: plotW,
    plotHeight: plotH,
    penUpZ: Number(o.penUpZ ?? 5),
    feedDraw: Number(o.feedDraw ?? 1500),
    feedTravel: Number(o.feedTravel ?? 3000),
    scaleToFit: o.scaleToFit !== false,
  };
}

// ---- Документ (PDF / DOCX / TXT / MD / текст) → G-code ----
app.post('/api/document-to-gcode', async (req, res) => {
  const { fileBase64, fileName, text, markdown, fontUrl, options } = req.body || {};
  if (!fontUrl) return res.status(400).json({ error: 'Не указан шрифт' });
  try {
    const out = await convertDocument({ fileBase64, fileName, text, markdown, fontUrl, options });
    job.gcode = out.gcode;
    job.total = countMotionLines(out.gcode);
    job.sent = 0;
    res.json(out);
  } catch (e) {
    console.error('[document-to-gcode]', e);
    res.status(400).json({ error: e.message });
  }
});

// ---- Печать G-code ----
app.post('/api/load-gcode', (req, res) => {
  const gcode = String(req.body?.gcode ?? '');
  if (!gcode.trim()) return res.status(400).json({ error: 'Пустой G-code' });
  job.gcode = gcode;
  job.total = countMotionLines(gcode);
  job.sent = 0;
  res.json({ ok: true, total: job.total });
});

app.post('/api/print', (req, res) => {
  if (!grbl.connected) return res.status(400).json({ error: 'Не подключено к GRBL' });
  if (!job.gcode) return res.status(400).json({ error: 'Нет загруженного G-code — сначала сконвертируйте SVG или загрузите файл' });
  if (job.running) return res.status(400).json({ error: 'Задание уже выполняется' });
  const lines = job.gcode.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith(';'));
  job.running = true;
  job.paused = false;
  job.sent = 0;
  grbl.sendBatch(lines);
  // отслеживание прогресса
  const iv = setInterval(() => {
    job.sent = Math.max(0, job.total - grbl.queueLength);
    if (!grbl.queueLength) {
      job.sent = job.total;
      job.running = false;
      clearInterval(iv);
    }
  }, 250);
  res.json({ ok: true, total: job.total });
});

function stopJobInternal() {
  grbl.clearQueue();
  grbl.sendRealtime('!'); // feed hold на всякий случай
  job.running = false;
  job.paused = false;
  job.sent = job.total;
}

app.post('/api/stop', (req, res) => {
  stopJobInternal();
  res.json({ ok: true });
});

app.post('/api/pause', (req, res) => {
  if (!grbl.connected) return res.status(400).json({ error: 'Не подключено' });
  grbl.sendRealtime('!'); // feed hold
  job.paused = true;
  res.json({ ok: true });
});

app.post('/api/resume', (req, res) => {
  if (!grbl.connected) return res.status(400).json({ error: 'Не подключено' });
  grbl.sendRealtime('~'); // resume
  job.paused = false;
  res.json({ ok: true });
});

app.post('/api/reset', (req, res) => {
  if (!grbl.connected) return res.status(400).json({ error: 'Не подключено' });
  stopJobInternal();
  grbl.sendRealtime('\x18'); // Ctrl-X
  grbl.sendCommand('$X');
  res.json({ ok: true });
});

function countMotionLines(gcode) {
  return gcode.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return t && !t.startsWith(';') && /^(G[0123]|M|\$)/i.test(t);
  }).length;
}

const PORT = process.env.PORT || 3001;
const server = http.createServer(app);
attachWebSocket(server, grbl, () => job);
server.listen(PORT, () => {
  console.log('Plotter server: http://localhost:' + PORT);
});
