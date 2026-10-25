// svgToGcode.js — конвертация SVG (path/polyline/polygon/line/rect/circle/ellipse) в G-code
import parsePath from 'svg-path-parser';

const FLAT_TOL = 0.15; // точность аппроксимации кривых, единицы SVG

export function extractPathsFromSvg(svgText) {
  const vb = svgText.match(/viewBox\s*=\s*"([^"]+)"/);
  let width = null, height = null;
  const wm = svgText.match(/\bwidth\s*=\s*"([\d.]+)/);
  const hm = svgText.match(/\bheight\s*=\s*"([\d.]+)/);
  if (wm) width = parseFloat(wm[1]);
  if (hm) height = parseFloat(hm[1]);
  let vbW = width, vbH = height;
  if (vb) {
    const parts = vb[1].trim().split(/[\s,]+/).map(parseFloat);
    if (parts.length === 4) { vbW = parts[2]; vbH = parts[3]; }
  }

  const paths = [];
  let m;
  // <path d="..."/>
  const pathRe = /<path\b[^>]*?\sd\s*=\s*"([^"]*)"[^>]*>/gi;
  while ((m = pathRe.exec(svgText))) {
    try {
      const cmds = parsePath(m[1]);
      if (cmds.length) paths.push(cmds);
    } catch (e) { /* пропускаем битый путь */ }
  }
  // <polyline>/<polygon points="..."/>
  const polyRe = /<(polyline|polygon)\b[^>]*?points\s*=\s*"([^"]*)"[^>]*>/gi;
  while ((m = polyRe.exec(svgText))) {
    const nums = m[2].trim().split(/[\s,]+/).map(parseFloat).filter((v) => !isNaN(v));
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
    if (pts.length >= 2) {
      const cmds = [{ command: 'moveto', relative: false, x: pts[0].x, y: pts[0].y }];
      for (let i = 1; i < pts.length; i++)
        cmds.push({ command: 'lineto', relative: false, x: pts[i].x, y: pts[i].y });
      if (m[1].toLowerCase() === 'polygon') cmds.push({ command: 'closepath', relative: false });
      paths.push(cmds);
    }
  }
  // <line .../>
  const lineRe = /<line\b[^>]*?>/gi;
  while ((m = lineRe.exec(svgText))) {
    const tag = m[0];
    const get = (a) => {
      const r = tag.match(new RegExp('\\b' + a + '\\s*=\\s*"([\\d.eE+-]+)"'));
      return r ? parseFloat(r[1]) : null;
    };
    const x1 = get('x1'), y1 = get('y1'), x2 = get('x2'), y2 = get('y2');
    if ([x1, y1, x2, y2].every((v) => v != null)) {
      paths.push([
        { command: 'moveto', relative: false, x: x1, y: y1 },
        { command: 'lineto', relative: false, x: x2, y: y2 },
      ]);
    }
  }
  // <rect .../>
  const rectRe = /<rect\b[^>]*?>/gi;
  while ((m = rectRe.exec(svgText))) {
    const tag = m[0];
    const get = (a, d = 0) => {
      const r = tag.match(new RegExp('\\b' + a + '\\s*=\\s*"([\\d.eE+-]+)"'));
      return r ? parseFloat(r[1]) : d;
    };
    const x = get('x'), y = get('y'), w = get('width'), h = get('height');
    if (w > 0 && h > 0) {
      paths.push([
        { command: 'moveto', relative: false, x, y },
        { command: 'lineto', relative: false, x: x + w, y },
        { command: 'lineto', relative: false, x: x + w, y: y + h },
        { command: 'lineto', relative: false, x, y: y + h },
        { command: 'closepath', relative: false },
      ]);
    }
  }
  // <circle>/<ellipse> — два arcs
  const circleRe = /<(circle|ellipse)\b[^>]*?>/gi;
  while ((m = circleRe.exec(svgText))) {
    const tag = m[0];
    const get = (a, d = 0) => {
      const r = tag.match(new RegExp('\\b' + a + '\\s*=\\s*"([\\d.eE+-]+)"'));
      return r ? parseFloat(r[1]) : d;
    };
    const cx = get('cx'), cy = get('cy');
    let rx, ry;
    if (m[1].toLowerCase() === 'circle') { rx = ry = get('r'); }
    else { rx = get('rx'); ry = get('ry'); }
    if (rx > 0 && ry > 0) {
      paths.push([
        { command: 'moveto', relative: false, x: cx - rx, y: cy },
        { command: 'elliptical arc', relative: false, rx, ry, x_axis_rotation: 0, large_arc_flag: 1, sweep_flag: 1, x: cx + rx, y: cy },
        { command: 'elliptical arc', relative: false, rx, ry, x_axis_rotation: 0, large_arc_flag: 1, sweep_flag: 1, x: cx - rx, y: cy },
        { command: 'closepath', relative: false },
      ]);
    }
  }

  return { width: vbW || width || 100, height: vbH || height || 100, paths };
}

// Разворачивание путей SVG в полилинии (точки)
export function pathsToPolylines(commandsList) {
  const result = [];
  for (const cmds of commandsList) {
    const current = [];
    let cx = 0, cy = 0;
    let startX = 0, startY = 0;
    let lastC = null, lastQ = null;
    let prevType = null;

    const flush = () => {
      if (current.length > 1) result.push(current.splice(0, current.length));
      else current.length = 0;
    };
    const push = (x, y) => {
      if (current.length) {
        const last = current[current.length - 1];
        if (Math.abs(last.x - x) < 1e-9 && Math.abs(last.y - y) < 1e-9) return;
      }
      current.push({ x, y });
    };

    for (const c of cmds) {
      const rel = !!c.relative;
      const g = (v, base) => (rel ? base + v : v);
      switch (c.command) {
        case 'moveto':
          flush();
          cx = g(c.x, cx); cy = g(c.y, cy);
          startX = cx; startY = cy;
          push(cx, cy);
          lastC = lastQ = null;
          break;
        case 'lineto':
          cx = g(c.x, cx); cy = g(c.y, cy);
          push(cx, cy);
          lastC = lastQ = null;
          break;
        case 'horizontal lineto':
          cx = g(c.x, cx);
          push(cx, cy);
          lastC = lastQ = null;
          break;
        case 'vertical lineto':
          cy = g(c.y, cy);
          push(cx, cy);
          lastC = lastQ = null;
          break;
        case 'curveto': {
          const x1 = g(c.x1, cx), y1 = g(c.y1, cy);
          const x2 = g(c.x2, cx), y2 = g(c.y2, cy);
          const x = g(c.x, cx), y = g(c.y, cy);
          flattenCubic(current, cx, cy, x1, y1, x2, y2, x, y);
          lastC = { x: x2, y: y2 };
          cx = x; cy = y;
          push(cx, cy);
          break;
        }
        case 'shorthandle curveto': {
          let x1 = cx, y1 = cy;
          if (lastC && (prevType === 'curveto' || prevType === 'shorthandle curveto')) {
            x1 = 2 * cx - lastC.x; y1 = 2 * cy - lastC.y;
          }
          const x2 = g(c.x2, cx), y2 = g(c.y2, cy);
          const x = g(c.x, cx), y = g(c.y, cy);
          flattenCubic(current, cx, cy, x1, y1, x2, y2, x, y);
          lastC = { x: x2, y: y2 };
          cx = x; cy = y;
          push(cx, cy);
          break;
        }
        case 'quadratic curveto': {
          const x1 = g(c.x1, cx), y1 = g(c.y1, cy);
          const x = g(c.x, cx), y = g(c.y, cy);
          flattenQuadratic(current, cx, cy, x1, y1, x, y);
          lastQ = { x: x1, y: y1 };
          cx = x; cy = y;
          push(cx, cy);
          break;
        }
        case 'short quadratic curveto': {
          let x1 = cx, y1 = cy;
          if (lastQ && (prevType === 'quadratic curveto' || prevType === 'short quadratic curveto')) {
            x1 = 2 * cx - lastQ.x; y1 = 2 * cy - lastQ.y;
          }
          const x = g(c.x, cx), y = g(c.y, cy);
          flattenQuadratic(current, cx, cy, x1, y1, x, y);
          lastQ = { x: x1, y: y1 };
          cx = x; cy = y;
          push(cx, cy);
          break;
        }
        case 'elliptical arc': {
          const x = g(c.x, cx), y = g(c.y, cy);
          flattenArc(current, cx, cy, c.rx, c.ry, c.x_axis_rotation || 0,
                     !!c.large_arc_flag, !!c.sweep_flag, x, y);
          cx = x; cy = y;
          push(cx, cy);
          lastC = lastQ = null;
          break;
        }
        case 'closepath':
          push(startX, startY);
          flush();
          cx = startX; cy = startY;
          lastC = lastQ = null;
          break;
      }
      prevType = c.command;
    }
    flush();
  }
  return result;
}

function flattenCubic(out, x0, y0, x1, y1, x2, y2, x3, y3) {
  const d =
    Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
  const steps = Math.max(4, Math.min(200, Math.ceil(d / FLAT_TOL)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, mt = 1 - t;
    out.push({
      x: mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
      y: mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
    });
  }
}

function flattenQuadratic(out, x0, y0, x1, y1, x2, y2) {
  const cx1 = x0 + (2 / 3) * (x1 - x0), cy1 = y0 + (2 / 3) * (y1 - y0);
  const cx2 = x2 + (2 / 3) * (x1 - x2), cy2 = y2 + (2 / 3) * (y1 - y2);
  flattenCubic(out, x0, y0, cx1, cy1, cx2, cy2, x2, y2);
}

function flattenArc(out, x0, y0, rxIn, ryIn, rotDeg, largeArc, sweep, x1, y1) {
  if (!rxIn || !ryIn) { out.push({ x: x1, y: y1 }); return; }
  let rx = Math.abs(rxIn), ry = Math.abs(ryIn);
  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx = (x0 - x1) / 2, dy = (y0 - y1) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  let rxx = rx * rx, ryy = ry * ry;
  const lambda = (x1p * x1p) / rxx + (y1p * y1p) / ryy;
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; rxx = rx * rx; ryy = ry * ry; }
  const sign = largeArc !== sweep ? 1 : -1;
  const num = rxx * ryy - rxx * y1p * y1p - ryy * x1p * x1p;
  const den = rxx * y1p * y1p + ryy * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x0 + x1) / 2;
  const cy = sinP * cxp + cosP * cyp + (y0 + y1) / 2;

  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;

  const steps = Math.max(4, Math.min(180, Math.ceil((Math.abs(delta) * Math.max(rx, ry)) / FLAT_TOL)));
  for (let i = 1; i <= steps; i++) {
    const t = theta1 + (delta * i) / steps;
    const px = rx * Math.cos(t), py = ry * Math.sin(t);
    out.push({ x: cosP * px - sinP * py + cx, y: sinP * px + cosP * py + cy });
  }
}

const fnum = (v) => (Math.round(v * 1000) / 1000).toFixed(3);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export function svgToGcode(svgText, opts) {
  const {
    plotWidth = 300, plotHeight = 300,
    penUpZ = 5, feedTravel = 3000, feedDraw = 1500,
    margin = 5, scaleToFit = true, mirrorY = false,
    offsetX = null, offsetY = null, // позиция левого-верхнего угла рисунка в мм стола; null = авто-центрирование
  } = opts || {};

  const svg = extractPathsFromSvg(svgText);
  const polylines = pathsToPolylines(svg.paths);
  if (!polylines.length) throw new Error('В SVG не найдено ни одного пути (<path>, <polyline>, <polygon>, <line>, <rect>, <circle>)');

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pl of polylines) {
    for (const p of pl) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const drawW = Math.max(maxX - minX, 1e-6);
  const drawH = Math.max(maxY - minY, 1e-6);

  const availW = plotWidth - 2 * margin;
  const availH = plotHeight - 2 * margin;
  let s = 1;
  if (scaleToFit) s = Math.min(availW / drawW, availH / drawH);
  // Позиция левого-верхнего угла рисунка на столе (мм).
  // offsetX — левый край; offsetY — верхний край (в мм стола, Y вверх). null = авто-центрирование.
  const clampF = (v, lo, hi) => (hi >= lo ? Math.min(Math.max(v, lo), hi) : lo);
  const leftX = offsetX != null ? clampF(Number(offsetX), 0, plotWidth - drawW * s)
                                : margin + (availW - drawW * s) / 2;
  const topYmm = offsetY != null ? clampF(Number(offsetY), drawH * s, plotHeight)
                                 : margin + (availH - drawH * s) / 2 + drawH * s; // низ блока в SVG-координатах -> верх в мм стола
  const offX = leftX - minX * s;
  // Y инвертируется: в SVG ось Y направлена вниз, у плоттера — вверх.
  const topY = topYmm;
  const tf = (p) => ({ x: p.x * s + offX, y: topY - (p.y - minY) * s });

  const lines = [];
  lines.push('; Generated by Plotter Controller');
  lines.push('; SVG viewBox: ' + svg.width + ' x ' + svg.height + ', scale=' + fnum(s));
  lines.push('G21 G90 G17');
  lines.push('G0 Z' + fnum(penUpZ));
  for (const pl of polylines) {
    if (pl.length < 2) continue;
    const p0 = tf(pl[0]);
    lines.push(`G0 X${fnum(p0.x)} Y${fnum(p0.y)} F${feedTravel}`);
    lines.push(`G1 Z0 F${feedTravel}`);
    for (let i = 1; i < pl.length; i++) {
      const p = tf(pl[i]);
      lines.push(`G1 X${fnum(p.x)} Y${fnum(p.y)} F${feedDraw}`);
    }
    lines.push(`G0 Z${fnum(penUpZ)} F${feedTravel}`);
  }
  lines.push('M5 ; spindle/pen off');
  lines.push('M2 ; program end');

  return {
    gcode: lines.join('\n'),
    preview: polylines.map((pl) => pl.map(tf)),
    stats: {
      paths: polylines.filter((p) => p.length > 1).length,
      points: polylines.reduce((a, p) => a + p.length, 0),
      boundsSVG: { minX, minY, maxX, maxY },
      scale: s,
    },
  };
}
