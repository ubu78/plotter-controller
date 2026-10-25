// staticServer.js — оффлайн-сервер без железа (режим --offline в AppRun)
// Отдаёт dist/ + конвертационные API (SVG/текст/документ → G-code, Google Fonts),
// но НЕ использует serialport/express/ws — работает всегда, даже если основной
// сервер не поднялся. Печать на плоттер в этом режиме недоступна.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 8765);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 30 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const svgMod = await import('./svgToGcode.js');
const textMod = await import('./textToGcode.js');
const docMod = await import('./documentToGcode.js');

function normalizeTextOptions(o) {
  o = o || {};
  const plotW = Number(o.plotWidth) || 210;
  const plotH = Number(o.plotHeight) || 297;
  let pageFormat = o.pageFormat || 'A4';
  let pw = o.pageW ? Number(o.pageW) : null;
  let ph = o.pageH ? Number(o.pageH) : null;
  if (!pw || !ph) {
    const f = textMod.PAGE_FORMATS[pageFormat] || textMod.PAGE_FORMATS.A4;
    pw = f[0]; ph = f[1];
  }
  if (o.orientation === 'landscape') [pw, ph] = [ph, pw];
  pw = Math.min(pw, plotW);
  ph = Math.min(ph, plotH);
  return {
    markdown: !!o.markdown,
    fontSize: Number(o.fontSize) || 12,
    lineHeight: Number(o.lineHeight) || 1.4,
    align: ['left', 'center', 'right'].includes(o.align) ? o.align : 'left',
    pageW: pw, pageH: ph, pageFormat,
    orientation: o.orientation || 'portrait',
    margin: Math.max(Number(o.textMargin) || 12, 2),
    plotWidth: plotW, plotHeight: plotH,
    penUpZ: Number(o.penUpZ ?? 5),
    feedDraw: Number(o.feedDraw ?? 1500),
    feedTravel: Number(o.feedTravel ?? 3000),
    scaleToFit: o.scaleToFit !== false,
    offsetX: Number.isFinite(Number(o.offsetX)) && o.offsetX !== null && o.offsetX !== '' && o.offsetX !== undefined ? Number(o.offsetX) : null,
    offsetY: Number.isFinite(Number(o.offsetY)) && o.offsetY !== null && o.offsetY !== '' && o.offsetY !== undefined ? Number(o.offsetY) : null,
  };
}

async function handleApi(url, body, res) {
  if (url === '/api/status') return sendJSON(res, 200, { connected: false, state: 'Offline', offline: true, job: {} });
  if (url === '/api/ports') return sendJSON(res, 200, []);
  if (url === '/api/shutdown') { sendJSON(res, 200, { ok: true }); setTimeout(() => process.exit(0), 200); return; }
  if (url === '/api/convert') {
    const out = svgMod.svgToGcode(body.svg || '', body.options || {});
    return sendJSON(res, 200, { gcode: out.gcode, stats: out.stats, preview: out.preview });
  }
  if (url === '/api/preview') {
    const { plotWidth = 210, plotHeight = 297, margin = 5, scaleToFit = true } = body.options || {};
    const parsed = svgMod.extractPathsFromSvg(body.svg || '');
    const polylines = svgMod.pathsToPolylines(parsed.paths);
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
    return sendJSON(res, 200, {
      size: { width: plotWidth, height: plotHeight },
      polylines: polylines.map((pl) => pl.map((p) => ({ x: p.x * s + offX, y: topY - (p.y - minY) * s }))),
    });
  }
  if (url === '/api/resolve-font') {
    const r = await textMod.resolveGoogleFontUrl(String(body.url || ''));
    return sendJSON(res, 200, { ok: true, url: r.url, family: r.family });
  }
  if (url === '/api/font-check') {
    const font = await textMod.loadFont(body.url);
    return sendJSON(res, 200, {
      ok: true,
      family: textMod.fontName(font), glyphs: font.numGlyphs,
      hasCyrillic: !!font.charToGlyph('Я') && font.charToGlyph('Я').index !== 0,
      missing: body.text ? textMod.missingGlyphs(font, body.text) : [],
    });
  }
  if (url === '/api/text-to-gcode') {
    if (!body.text || !String(body.text).trim()) return sendJSON(res, 400, { error: 'Empty text' });
    if (!body.fontUrl) return sendJSON(res, 400, { error: 'No font' });
    const font = await textMod.loadFont(body.fontUrl);
    const out = textMod.renderText(body.text, { font, ...normalizeTextOptions(body.options) });
    return sendJSON(res, 200, { gcode: out.gcode, stats: out.stats, preview: out.preview, missingGlyphs: textMod.missingGlyphs(font, body.text) });
  }
  if (url === '/api/document-to-gcode') {
    if (!body.fontUrl) return sendJSON(res, 400, { error: 'No font' });
    const out = await docMod.convertDocument(body);
    return sendJSON(res, 200, out);
  }
  return sendJSON(res, 501, { error: 'API not available in offline mode: ' + url });
}

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  try {
    if (url.startsWith('/api/') || url === '/ws') {
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        return await handleApi(url, body, res);
      }
      if (url === '/api/status') return await handleApi(url, {}, res);
      return sendJSON(res, 501, { error: 'offline mode' });
    }
    let filePath = path.normalize(path.join(DIST, url === '/' ? 'index.html' : url));
    if (!filePath.startsWith(DIST)) { res.writeHead(403); return res.end('Forbidden'); }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(DIST, 'index.html');
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    sendJSON(res, 500, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, () => console.log('Plotter Controller (offline): http://localhost:' + PORT));
