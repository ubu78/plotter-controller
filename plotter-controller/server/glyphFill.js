// glyphFill.js — альтернативные режимы генерации G-code из глифов текста:
//  • 'solid'     — залитые буквы (штриховка контуров глифа параллельными линиями)
//  • 'outline'   — обводка контуров (как раньше)
//  • 'hatch'     — разреженная диагональная штриховка внутри букв
//  • 'handwrite' — «ручка»: одна непрерывная линия по средней линии штриха,
//                  без обводки контура и без подъёма пера между буквами
//
// Алгоритм solid/hatch: для каждого глифа строим замкнутые полилинии контуров
// (внешний + дырки), затем горизонтальным лучом (scanline) находим интервалы
// «внутри» и превращаем их в отрезки. Для hatch добавляем второй проход под
// углом ~45° с более крупным шагом. Отрезки склеиваются в непрерывные
// полилинии (chain): если конец одного отрезка совпадает с началом другого —
// они идут одним пером без подъёма (буквы получаются «залитыми», а не росчерками).

const EPS = 1e-9;

// ---- Сэмплирование путей opentype.js в полилинии ----
function sampleCommands(cmds, step) {
  const polys = [];
  let cur = [];
  let cx = 0, cy = 0;
  const push = (x, y) => { if (cur.length && Math.abs(cur[cur.length - 1].x - x) < EPS && Math.abs(cur[cur.length - 1].y - y) < EPS) return; cur.push({ x, y }); };
  const flush = () => { if (cur.length > 2) polys.push(cur); cur = []; };
  for (const c of cmds) {
    switch (c.type) {
      case 'M': flush(); cx = c.x; cy = c.y; push(cx, cy); break;
      case 'L': cx = c.x; cy = c.y; push(cx, cy); break;
      case 'Q': {
        const x0 = cx, y0 = cy, x1 = c.x1, y1 = c.y1, x2 = c.x, y2 = c.y;
        const n = Math.max(4, Math.ceil(Math.hypot(x2 - x0, y2 - y0) / step));
        for (let i = 1; i <= n; i++) {
          const t = i / n, mt = 1 - t;
          cx = mt * mt * x0 + 2 * mt * t * x1 + t * t * x2;
          cy = mt * mt * y0 + 2 * mt * t * y1 + t * t * y2;
          push(cx, cy);
        }
        break;
      }
      case 'C': {
        const x0 = cx, y0 = cy, x1 = c.x1, y1 = c.y1, x2 = c.x2, y2 = c.y2, x3 = c.x, y3 = c.y;
        const n = Math.max(6, Math.ceil(Math.hypot(x3 - x0, y3 - y0) / step));
        for (let i = 1; i <= n; i++) {
          const t = i / n, mt = 1 - t;
          cx = mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3;
          cy = mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3;
          push(cx, cy);
        }
        break;
      }
      case 'Z': {
        // замыкаем субпуть к его началу
        if (cur.length) {
          const s = cur[0];
          if (Math.abs(cx - s.x) > EPS || Math.abs(cy - s.y) > EPS) push(s.x, s.y);
          else { cx = s.x; cy = s.y; }
        }
        flush();
        break;
      }
      default: break;
    }
  }
  flush();
  return polys;
}

// ---- Scanline: интервалы «внутри» полигона по лучу y=const ----
// Возвращает массив [x0,x1] пар, отсортированных по x. Нечётные пересечения
// считаются внутренними (nonzero/even-odd на простых контурах даёт один результат).
function scanIntervals(polys, y) {
  const xs = [];
  for (const pl of polys) {
    for (let i = 0; i < pl.length - 1; i++) {
      const a = pl[i], b = pl[i + 1];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
  }
  xs.sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

// Преобразует полилинии контуров в систему координат луча: проекция на направление
// луча u=(cos a, sin a) и перпендикуляр v=(-sin a, cos a). Штрихи идут вдоль u,
// лучи — поперёк (шаг по v).
function toRaySpace(pts, angle) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  return pts.map((p) => ({ x: p.x * ca + p.y * sa, y: -p.x * sa + p.y * ca }));
}
function fromRaySpace(uv01, v, angle) {
  // [u0,u1] вдоль луча при фиксированном v -> обратно в XY
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const pt = (u) => ({ x: u * ca - v * sa, y: u * sa + v * ca });
  return [pt(uv01[0]), pt(uv01[1])];
}

// Генерация штрихованных отрезков для одного глифа (полилинии в мм-координатах страницы)
export function fillGlyph(polys, opts) {
  const { spacing, angle = 0 } = opts;
  // полилинии каждого контура по отдельности переводим в систему координат луча
  const rp = polys.map((pl) => toRaySpace(pl, angle));
  let minY = Infinity, maxY = -Infinity;
  for (const pl of rp) for (const p of pl) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  if (!isFinite(minY)) return [];
  const segments = [];
  const start = Math.ceil(minY / spacing) * spacing;
  for (let v = start; v <= maxY + EPS; v += spacing) {
    const ints = scanIntervals(rp, v);
    for (const it of ints) {
      if (it[1] - it[0] < spacing * 0.35) continue; // слишком узкие щели пропускаем
      segments.push(fromRaySpace([it[0], it[1]], v, angle));
    }
  }
  return segments;
}

// ---- Склейка отрезков в непрерывные полилинии (минимум подъёмов пера) ----
// key квантованный, чтобы стыковать точки с точностью до 0.01 мм.
export function chainSegments(segs, tol = 0.01) {
  const q = (v) => Math.round(v / tol);
  const byEnd = new Map(); // "qx,qy" -> индекс начала ещё неиспользованного отрезка
  const starts = segs.map((s) => ({ used: false, a: q(s[0].x) + ',' + q(s[0].y), b: q(s[1].x) + ',' + q(s[1].y), s }));
  for (let i = 0; i < starts.length; i++) {
    const k = starts[i].a;
    if (!byEnd.has(k)) byEnd.set(k, []);
    byEnd.get(k).push(i);
  }
  const chains = [];
  for (const st of starts) {
    if (st.used) continue;
    st.used = true;
    const chain = [st.s[0], st.s[1]];
    // идём вперёд по совпадающим концам
    let guard = starts.length;
    while (guard--) {
      const k = q(chain[chain.length - 1].x) + ',' + q(chain[chain.length - 1].y);
      const bucket = byEnd.get(k);
      let found = -1;
      if (bucket) for (const idx of bucket) if (!starts[idx].used) { found = idx; break; }
      if (found < 0) break;
      starts[found].used = true;
      chain.push(starts[found].s[1]);
    }
    chains.push(chain);
  }
  return chains;
}

// Главный вход: массив глифов -> список полилиний (в координатах SVG-страницы, мм)
// glyphsPaths: [{cmds, penX, baseline, sizePt}] уже смещённые на месте? — нет: сюда
// приходят commands opentype.jsgetPath(penX, baseline, size) — они уже в мм страницы.
export function buildFillPolylines(glyphCmdsList, mode) {
  // mode: 'solid' | 'hatch'
  const allChains = [];
  for (const cmds of glyphCmdsList) {
    const polys = sampleCommands(cmds, 0.18); // шаг сэмплирования кривых, мм
    if (!polys.length) continue;
    const spacing = mode === 'solid' ? 0.3 : 0.9;
    const segs = fillGlyph(polys, { spacing, angle: mode === 'solid' ? 0 : Math.PI / 4 });
    // в solid дополнительно вертикальные штрихи не нужны; в hatch — только диагональ
    if (!segs.length) continue;
    for (const ch of chainSegments(segs)) allChains.push(ch);
  }
  return allChains;
}

// ===================== handwrite («ручка»): скелетон штрихов =====================
// Для каждого глифа строим bitmap «внутри контура», вычисляем карту расстояний
// (chamfer DT) и извлекаем остов (ridge lines local maxima) — центральную линию
// каждого штриха буквы. Затем отрезки остова склеиваются в одну непрерывную
// цепь по всему тексту (перо не поднимается между буквами).

// Растровая проверка «точка внутри глифа»: ray casting по замкнутым полилиниям.
function insidePolys(polys, x, y) {
  let inside = false;
  for (const pl of polys) {
    for (let i = 0, j = pl.length - 1; i < pl.length; j = i++) {
      const xi = pl[i].x, yi = pl[i].y, xj = pl[j].x, yj = pl[j].y;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// Chamfer distance transform (3-4 проход) над булевой сеткой mask[y*w+x]=внутри.
function chamferDT(mask, w, h) {
  const INF = 1e9;
  const d = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
  const A = 1, B = 1.4142135;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let v = d[i];
      if (y > 0) v = Math.min(v, d[i - w] + A);
      if (x > 0) v = Math.min(v, d[i - 1] + A);
      if (y > 0 && x > 0) v = Math.min(v, d[i - w - 1] + B);
      if (y > 0 && x < w - 1) v = Math.min(v, d[i - w + 1] + B);
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let v = d[i];
      if (y < h - 1) v = Math.min(v, d[i + w] + A);
      if (x < w - 1) v = Math.min(v, d[i + 1] + A);
      if (y < h - 1 && x < w - 1) v = Math.min(v, d[i + w + 1] + B);
      if (y < h - 1 && x > 0) v = Math.min(v, d[i + w - 1] + B);
      d[i] = v;
    }
  }
  return d;
}

// Извлечение остова: пиксели «внутри», которые локальные максимумы DT (не меньше
// соседей 8-окрестности) и имеют толщину штриха >= minTh. Возвращает сегменты
// между соседними остовными пикселями (4-связность) в мм.
function extractSkeleton(d, mask, w, h, px, py, cell, minTh) {
  const skel = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i] || d[i] < minTh) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (d[i + dy * w + dx] > d[i]) { isMax = false; break; }
        }
      }
      if (isMax) skel[i] = 1;
    }
  }
  const segs = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!skel[i]) continue;
      const ax = px + x * cell, ay = py + y * cell;
      if (x + 1 < w && skel[i + 1]) segs.push([[ax, ay], [px + (x + 1) * cell, ay]]);
      if (y + 1 < h && skel[i + w]) segs.push([[ax, ay], [ax, py + (y + 1) * cell]]);
      if (x + 1 < w && y + 1 < h && skel[i + w + 1]) segs.push([[ax, ay], [px + (x + 1) * cell, py + (y + 1) * cell]]);
      if (x > 0 && y + 1 < h && skel[i + w - 1]) segs.push([[ax, ay], [px + (x - 1) * cell, py + (y + 1) * cell]]);
    }
  }
  return segs;
}

// Склеивание сегментов в минимальное число непрерывных путей (Eulerian paths).
// Граф рёбер: вершины со степенью != 2 соединяются цепочками через проходы
// кратчайшей длины (жадно), чтобы перо поднималось как можно реже.
function chainAllSegments(segs, tol) {
  const key = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  const nodes = new Map(); // k -> {x,y,edges:Set(idx)}
  const edges = [];
  for (const [a, b] of segs) {
    let ka = key(a), kb = key(b);
    if (ka === kb) continue;
    if (!nodes.has(ka)) nodes.set(ka, { x: a[0], y: a[1], edges: new Set() });
    if (!nodes.has(kb)) nodes.set(kb, { x: b[0], y: b[1], edges: new Set() });
    const ei = edges.length;
    edges.push({ a: ka, b: kb });
    nodes.get(ka).edges.add(ei);
    nodes.get(kb).edges.add(ei);
  }
  const used = new Array(edges.length).fill(false);
  const walkFrom = (startNode, startEdge) => {
    const path = [];
    const n0 = nodes.get(startNode);
    path.push([n0.x, n0.y]);
    let curNode = startNode, curEdge = startEdge;
    while (curEdge != null) {
      used[curEdge] = true;
      const e = edges[curEdge];
      const next = e.a === curNode ? e.b : e.a;
      const nn = nodes.get(next);
      path.push([nn.x, nn.y]);
      curNode = next;
      curEdge = null;
      for (const ei of nodes.get(curNode).edges) { if (!used[ei]) { curEdge = ei; break; } }
    }
    return path;
  };
  const chains = [];
  // сначала цепи между «концами» (нечётные степени)
  for (const [k, n] of nodes) {
    for (const ei of n.edges) {
      if (used[ei]) continue;
      if (nodes.get(k).edges.size % 2 === 1 || nodes.get(n.edges ? k : k).edges.size % 2 === 1) {
        chains.push(walkFrom(k, ei));
      }
    }
  }
  // оставшиеся циклы
  for (let ei = 0; ei < edges.length; ei++) {
    if (used[ei]) continue;
    chains.push(walkFrom(edges[ei].a, ei));
  }
  return chains;
}

// Упрощение цепи: убираем collinear-соседние точки, оставляем характерные изломы.
function simplifyChain(pts, maxAngleDev = 0.35 /* рад */) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = out[out.length - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const a1 = Math.atan2(y1 - y0, x1 - x0), a2 = Math.atan2(y2 - y1, x2 - x1);
    let da = Math.abs(a2 - a1); if (da > Math.PI) da = 2 * Math.PI - da;
    if (da > maxAngleDev) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// Вход для режима 'handwrite': все команды глифов текста -> одна (минимум подъёмов)
// последовательность непрерывных полилиний.
export function buildHandwritePolylines(glyphCmdsList) {
  const CELL = 0.12; // мм на пиксель растра
  const MIN_TH = 0.7; // мм — минимальная половина толщины штриха для остова
  const TOL = CELL * 1.5;
  const allSegs = [];
  for (const cmds of glyphCmdsList) {
    const polys = sampleCommands(cmds, 0.15);
    if (!polys.length) continue;
    // границы глифа
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pl of polys) for (const p of pl) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    if (!isFinite(minX)) continue;
    const w = Math.ceil((maxX - minX) / CELL) + 1;
    const h = Math.ceil((maxY - minY) / CELL) + 1;
    if (w * h > 400000) continue; // защита от гигантских глифов
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const py = minY + y * CELL;
      for (let x = 0; x < w; x++) {
        if (insidePolys(polys, minX + x * CELL, py)) mask[y * w + x] = 1;
      }
    }
    const d = chamferDT(mask, w, h);
    const segs = extractSkeleton(d, mask, w, h, minX, minY, CELL, MIN_TH / CELL);
    for (const s of segs) allSegs.push(s);
  }
  if (!allSegs.length) return [];
  let chains = chainAllSegments(allSegs, TOL);
  // жадно объединяем цепи в порядке ближайших концов (перо едет по тексту слева направо)
  chains.sort((c1, c2) => (c1[0][0] + c1[0][1] * 1e6) - (c2[0][0] + c2[0][1] * 1e6));
  const merged = [];
  for (const ch of chains) {
    const pts = simplifyChain(ch);
    if (pts.length < 2) continue;
    merged.push(pts);
  }
  return merged;
}

// Полилинии -> SVG path d-строки (для svgToGcode). Поддерживает точки в формате
// {x,y} (solid/hatch) и [x,y] (handwrite-цепи).
const ptXY = (p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y]);
export function polylinesToPathD(polys) {
  return polys.map((pl) =>
    'M ' + pl.map((p) => { const [x, y] = ptXY(p); return `${x.toFixed(2)} ${y.toFixed(2)}`; }).join(' L ')
  );
}
