import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { LangContext, makeT, getLang, setLang as saveLang, LANGS } from './i18n.js';
import { THEMES, getTheme, setTheme as saveTheme, applyTheme } from './themes.js';
import ConnectionPanel from './components/ConnectionPanel.jsx';
import ManualPanel from './components/ManualPanel.jsx';
import SvgPanel from './components/SvgPanel.jsx';
import TextPanel from './components/TextPanel.jsx';
import DocumentPanel from './components/DocumentPanel.jsx';
import ConsolePanel from './components/ConsolePanel.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';

const DEFAULT_OPTIONS = {
  plotWidth: 210,   // максимум — бумага A4
  plotHeight: 297,
  margin: 5,
  penUpZ: 5,
  feedDraw: 1500,
  feedTravel: 3000,
  scaleToFit: true,
};

export default function App() {
  const [lang, setLangState] = useState(getLang());
  const [theme, setThemeState] = useState(getTheme());
  const t = useMemo(() => makeT(lang), [lang]);
  // применяем тему к CSS-переменным при каждом изменении
  useEffect(() => { applyTheme(theme); }, [theme]);
  const ctx = useMemo(() => ({
    lang,
    setLang: (code) => { saveLang(code); setLangState(code); },
    t,
  }), [lang, t]);
  const [status, setStatus] = useState({ connected: false, state: 'Offline', job: {} });
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [gcode, setGcode] = useState(null);
  const [preview, setPreview] = useState(null); // polylines в мм стола
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [docCtx, setDocCtx] = useState(null); // { fileBase64, fileName, fontUrl, opts } для перетаскивания
  const [textCtx, setTextCtx] = useState(null); // { polylines } для перетаскивания текста мышью
  const statusRef = useRef(null);

  // Опрос статуса раз в секунду
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await api.status();
        if (alive) setStatus(s);
      } catch (e) { /* сервер мог перезапуститься */ }
    };
    statusRef.current = tick;
    tick();
    const iv = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const handleConvert = async ({ svg, gcode: rawGcode, options: opts, textResult, docResult, docPayload }) => {
    setBusy(true); setError('');
    try {
      if (docResult) {
        // Документ уже загружен в задание на сервере (/api/document-to-gcode)
        setDocCtx(docPayload || null); // сохраняем payload для перетаскивания мышью
        setGcode(docResult.gcode);
        setPreview({ size: { width: options.plotWidth, height: options.plotHeight }, polylines: docResult.preview });
        if (docResult.missingGlyphs && docResult.missingGlyphs.length) {
          setError(t('app.warn.missingGlyphs') + ' ' + docResult.missingGlyphs.join(' '));
        } else if (docResult.stats?.paper && !docResult.stats.paper.fitsPaper) {
          setError(t('app.warn.noFit'));
        } else if (docResult.stats?.paper?.autoScale && docResult.stats.paper.autoScale < 1) {
          setError(t('app.warn.autoScaled', { p: Math.round(docResult.stats.paper.autoScale * 100) }));
        }
      } else if (textResult) {
        setDocCtx(null);
        // сохраняем payload для перетаскивания мышью и ручной позиции старта
        setTextCtx({ polylines: textResult.preview, ...(textResult.textPayload || {}) });
        setGcode(textResult.gcode);
        setPreview({ size: { width: textResult.plotWidth ?? options.plotWidth, height: textResult.plotHeight ?? options.plotHeight }, polylines: textResult.preview });
        if (textResult.missingGlyphs && textResult.missingGlyphs.length) {
          setError(t('app.warn.missingGlyphs') + ' ' + textResult.missingGlyphs.join(' '));
        } else if (textResult.stats?.paper && !textResult.stats.paper.fitsPaper) {
          setError(t('app.warn.textNoFit'));
        }
      } else if (rawGcode) {
        setDocCtx(null);
        await api.loadGcode(rawGcode);
        setGcode(rawGcode);
        setPreview(null);
      } else {
        setDocCtx(null);
        const out = await api.convert(svg, opts || options);
        setGcode(out.gcode);
        // строим preview локально из тех же координат (сервер вернул массив полилиний)
        setPreview(out.preview ? { size: { width: opts?.plotWidth ?? options.plotWidth, height: opts?.plotHeight ?? options.plotHeight }, polylines: out.preview } : null);
      }
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  // Перетаскивание текста/документа на превью: перегенерируем G-code с новой позицией
  // offsetX/offsetY — левый-верхний угол содержимого в мм стола (Y вверх)
  const moveDoc = async (newX, newY) => {
    if (!docCtx || busy) return;
    setBusy(true);
    try {
      const opts = { ...docCtx.options, plotWidth: options.plotWidth, plotHeight: options.plotHeight, offsetX: newX, offsetY: newY };
      const out = await api.documentToGcode({ fileBase64: docCtx.fileBase64, fileName: docCtx.fileName, fontUrl: docCtx.fontUrl, options: opts });
      setGcode(out.gcode);
      setPreview({ size: { width: options.plotWidth, height: options.plotHeight }, polylines: out.preview });
      setDocCtx({ ...docCtx, lastPos: { x: newX, y: newY } });
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  // Перетаскивание текста мышью: перегенерируем G-code с новой позицией левого-верхнего угла
  const moveText = async (newX, newY) => {
    if (!textCtx || busy) return;
    if (!textCtx.text || !textCtx.fontUrl) return; // без payload перемещение недоступно
    setBusy(true);
    try {
      const opts = { ...textCtx.options, plotWidth: options.plotWidth, plotHeight: options.plotHeight, offsetX: newX, offsetY: newY };
      const out = await api.textToGcode(textCtx.text, textCtx.fontUrl, opts);
      setGcode(out.gcode);
      setPreview({ size: { width: options.plotWidth, height: options.plotHeight }, polylines: out.preview });
      setTextCtx({ ...textCtx, polylines: out.preview, lastPos: { x: newX, y: newY } });
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const doPrint = async () => {
    setError('');
    try { await api.print(); } catch (e) { setError(e.message); }
  };
  const safe = (p) => () => p().catch((e) => setError(e.message));

  const job = status.job || {};
  const pct = job.total ? Math.round(((job.sent || 0) / job.total) * 100) : 0;

  return (
    <LangContext.Provider value={ctx}>
    <div className="app">
      <div className="topbar">
        <h1>Plotter Controller</h1>
        <span className={'badge ' + (status.connected ? (status.state === 'Alarm' ? 'alarm' : 'online') : '')}>
          {status.connected ? status.state : (status.offline ? t('app.offlineMode') : t('app.notConnected'))}
        </span>
        {job.running && <span className="badge run">{t('app.printing')} {pct}%</span>}
        <div style={{ flex: 1 }} />
        <a className="made-with" href="https://coder.qwen.ai" target="_blank" rel="noreferrer" title="Coder Qwen AI">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
          </svg>
          <span>{t('app.madeWith')}</span>
        </a>
        <span className="theme-label">{t('app.theme')}</span>
        <select className="theme-select" value={theme}
          onChange={(e) => { saveTheme(e.target.value); setThemeState(e.target.value); }}
          title="Design / Дизайн">
          {THEMES.map((th) => <option key={th.code} value={th.code}>{t('app.theme.' + th.code)}</option>)}
        </select>
        <select className="lang-select" value={lang} onChange={(e) => ctx.setLang(e.target.value)} title="Language / Язык">
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <button onClick={safe(api.pause)} disabled={!status.connected}>{t('app.btn.pause')}</button>
        <button onClick={safe(api.resume)} disabled={!status.connected}>{t('app.btn.resume')}</button>
        <button className="danger" onClick={safe(api.stop)} disabled={!job.running}>{t('app.btn.stop')}</button>
        <button
          className="exit-btn"
          title={t('app.btn.exit')}
          onClick={() => {
            if (!window.confirm(t('app.exit.confirm'))) return;
            api.shutdown().then(() => { document.body.innerHTML = '<div style="display:flex;height:100vh;align-items:center;justify-content:center;font-family:sans-serif;color:#888">' + t('app.exit.done') + '</div>'; }).catch((e) => setError(e.message));
          }}
        >⏻ {t('app.btn.exit')}</button>
      </div>

      <div className="layout">
        <div className="left">
          <ConnectionPanel connected={status.connected} onStatus={() => statusRef.current && statusRef.current()} />
          <TextPanel options={options} setOptions={setOptions} onConvert={handleConvert} busy={busy} />
          <DocumentPanel options={options} setOptions={setOptions} onConvert={handleConvert} busy={busy} />
          <SvgPanel
            options={options} setOptions={setOptions}
            onConvert={handleConvert} gcode={gcode} busy={busy} error={error}
          />
          <div className="panel">
            <h2>{t('app.job.title')}</h2>
            <div className="row">
              <button className="primary" onClick={doPrint} disabled={!status.connected || !gcode || job.running}>
                {t('app.job.start')}
              </button>
              <button onClick={() => {
                if (!gcode) return;
                const blob = new Blob([gcode], { type: 'text/plain' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob); a.download = 'plot.gcode'; a.click();
              }} disabled={!gcode}>{t('app.job.save')}</button>
            </div>
            <div className="hint">
              {t('app.job.hint', { n: job.total ?? 0 })}
            </div>
            {(job.running || job.total > 0) && (
              <div className="progress"><div style={{ width: pct + '%' }} /></div>
            )}
            {error && <div className="hint" style={{ color: 'var(--red)' }}>{error}</div>}
          </div>
          <ManualPanel connected={status.connected} />
          <SettingsPanel connected={status.connected} />
          <ConsolePanel connected={status.connected} />
        </div>

        <div className="center">
          <div className="canvas-wrap">
            <PreviewCanvas
              preview={preview} mpos={status.mpos} bedW={options.plotWidth} bedH={options.plotHeight}
              draggable={!!(docCtx || textCtx)} busy={busy}
              onMoveDoc={moveDoc} onMoveText={moveText}
              docMode={!!docCtx}
            />
          </div>
          <div className="status-strip">
            <span>{t('app.status.sheet')} <b>{options.plotWidth}×{options.plotHeight} mm ({t('app.status.maxA4')})</b></span>
            <span>{t('app.status.mpos')} <b>{status.mpos ? status.mpos.map((v) => v.toFixed(2)).join(', ') : '—'}</b></span>
            <span>{t('app.status.wpos')} <b>{status.wpos ? status.wpos.map((v) => v.toFixed(2)).join(', ') : '—'}</b></span>
            <span>{t('app.status.feed')} <b>{status.fs ? status.fs[0] + ' ' + t('app.status.mmmin') : '—'}</b></span>
            <span>{t('app.status.queue')} <b>{job.queue ?? 0}</b></span>
            <span>{t('app.status.state')} <b>{status.state}</b></span>
          </div>
        </div>
      </div>
    </div>
    </LangContext.Provider>
  );
}

function PreviewCanvas({ preview, mpos, bedW, bedH, draggable, busy, onMoveDoc, onMoveText, docMode }) {
  // Вид: стол bedW x bedH мм, Y вверх (как у GRBL). Добавляем рамку и сетку.
  const svgRef = useRef(null);
  const drag = useRef(null); // { startX, startY, curDX, curDY } в мм стола
  const [ghost, setGhost] = useState(null); // временный офсет во время перетаскивания

  const toMm = (clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: -p.y }; // svg Y вниз -> стол Y вверх
  };

  const contentBox = (() => {
    if (!preview || !preview.polylines || !preview.polylines.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pl of preview.polylines) for (const p of pl) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  })();

  const hitContent = (mm) => {
    if (!contentBox) return false;
    const b = contentBox;
    return mm.x >= b.minX - 5 && mm.x <= b.maxX + 5 && mm.y >= b.minY - 5 && mm.y <= b.maxY + 5;
  };

  const clampOffset = (dx, dy) => {
    if (!contentBox) return { dx: 0, dy: 0 };
    const b = contentBox;
    // содержимое не должно выходить за границы стола
    const ndx = Math.max(-b.minX, Math.min(bedW - b.maxX, dx));
    const ndy = Math.max(-b.minY, Math.min(bedH - b.maxY, dy));
    return { dx: ndx, dy: ndy };
  };

  const onPointerDown = (e) => {
    if (!draggable || busy || !preview) return;
    const mm = toMm(e.clientX, e.clientY);
    if (!mm || !hitContent(mm)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { sx: mm.x, sy: mm.y, dx: 0, dy: 0 };
    setGhost({ dx: 0, dy: 0 });
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const mm = toMm(e.clientX, e.clientY);
    if (!mm) return;
    const clamped = clampOffset(mm.x - drag.current.sx, mm.y - drag.current.sy);
    drag.current.dx = clamped.dx; drag.current.dy = clamped.dy;
    setGhost(clamped);
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    const { dx, dy } = drag.current;
    drag.current = null;
    setGhost(null);
    if ((Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2) || !contentBox) return;
    // единый интерфейс: левый-верхний угол содержимого после сдвига (мм стола, Y вверх)
    if (docMode && onMoveDoc) onMoveDoc(contentBox.minX + dx, contentBox.maxY + dy);
    else if (onMoveText) onMoveText(contentBox.minX + dx, contentBox.maxY + dy);
  };

  const pad = 20;
  const vb = `${-pad} ${-pad - bedH} ${bedW + 2 * pad} ${bedH + 2 * pad}`;
  const gdx = ghost ? ghost.dx : 0;
  const gdy = ghost ? ghost.dy : 0;
  const paths = preview
    ? preview.polylines.map((pl) => 'M ' + pl.map((p) => `${(p.x + gdx).toFixed(2)} ${(-(p.y + gdy)).toFixed(2)}`).join(' L ')).join(' ')
    : '';
  // позиция инструмента
  const tool = mpos ? { x: mpos[0], y: -mpos[1] } : null;

  const gridLines = [];
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim() || '#243040';
  for (let gx = 0; gx <= bedW; gx += 50) gridLines.push(<line key={'gx' + gx} x1={gx} y1={0} x2={gx} y2={-bedH} stroke={gridColor} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />);
  for (let gy = 0; gy <= bedH; gy += 50) gridLines.push(<line key={'gy' + gy} x1={0} y1={-gy} x2={bedW} y2={-gy} stroke={gridColor} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />);

  // рамка содержимого при перетаскивании
  const selRect = draggable && contentBox ? (
    <rect
      x={contentBox.minX + gdx} y={-(contentBox.maxY + gdy)} width={contentBox.w} height={contentBox.h}
      fill="none" stroke={ghost ? 'var(--accent)' : 'var(--bed-stroke)'} strokeWidth={0.6} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" rx={1}
    />
  ) : null;

  return (
    <svg
      ref={svgRef} viewBox={vb} preserveAspectRatio="xMidYMid meet"
      style={{ cursor: draggable ? 'grab' : 'default', touchAction: 'none' }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
    >
      <rect className="plot-bed" x={0} y={-bedH} width={bedW} height={bedH} rx={2} />
      {gridLines}
      <text x={2} y={4} fontSize={6} fill="var(--muted)">0,0</text>
      {paths && <path d={paths} className="plot-path" />}
      {selRect}
      {tool && (
        <g transform={`translate(${tool.x} ${tool.y})`}>
          <circle r={3} fill="none" stroke="#f87171" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <line x1={-6} y1={0} x2={6} y2={0} stroke="#f87171" strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
          <line x1={0} y1={-6} x2={0} y2={6} stroke="#f87171" strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
        </g>
      )}
    </svg>
  );
}
