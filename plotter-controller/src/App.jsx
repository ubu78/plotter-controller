import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import ConnectionPanel from './components/ConnectionPanel.jsx';
import ManualPanel from './components/ManualPanel.jsx';
import SvgPanel from './components/SvgPanel.jsx';
import TextPanel from './components/TextPanel.jsx';
import DocumentPanel from './components/DocumentPanel.jsx';
import ConsolePanel from './components/ConsolePanel.jsx';

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
  const [status, setStatus] = useState({ connected: false, state: 'Offline', job: {} });
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [gcode, setGcode] = useState(null);
  const [preview, setPreview] = useState(null); // polylines в мм стола
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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

  const handleConvert = async ({ svg, gcode: rawGcode, options: opts, textResult, docResult }) => {
    setBusy(true); setError('');
    try {
      if (docResult) {
        // Документ уже загружен в задание на сервере (/api/document-to-gcode)
        setGcode(docResult.gcode);
        setPreview({ size: { width: options.plotWidth, height: options.plotHeight }, polylines: docResult.preview });
        if (docResult.missingGlyphs && docResult.missingGlyphs.length) {
          setError('Внимание: шрифт не содержит глифов для символов: ' + docResult.missingGlyphs.join(' '));
        } else if (docResult.stats?.paper && !docResult.stats.paper.fitsPaper) {
          setError('Содержимое не помещается на выбранный лист — включите авто-вписывание или уменьшите кегль.');
        } else if (docResult.stats?.paper?.autoScale && docResult.stats.paper.autoScale < 1) {
          setError('Кегли автоматически уменьшены до ~' + Math.round(docResult.stats.paper.autoScale * 100) + '% чтобы вписаться в лист.');
        }
      } else if (textResult) {
        setGcode(textResult.gcode);
        setPreview({ size: { width: textResult.plotWidth ?? options.plotWidth, height: textResult.plotHeight ?? options.plotHeight }, polylines: textResult.preview });
        if (textResult.missingGlyphs && textResult.missingGlyphs.length) {
          setError('Внимание: шрифт не содержит глифов для символов: ' + textResult.missingGlyphs.join(' '));
        } else if (textResult.stats?.paper && !textResult.stats.paper.fitsPaper) {
          setError('Текст не помещается на выбранный лист — уменьшите кегль или объём текста.');
        }
      } else if (rawGcode) {
        await api.loadGcode(rawGcode);
        setGcode(rawGcode);
        setPreview(null);
      } else {
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

  const doPrint = async () => {
    setError('');
    try { await api.print(); } catch (e) { setError(e.message); }
  };
  const safe = (p) => () => p().catch((e) => setError(e.message));

  const job = status.job || {};
  const pct = job.total ? Math.round(((job.sent || 0) / job.total) * 100) : 0;

  return (
    <div className="app">
      <div className="topbar">
        <h1>Plotter Controller</h1>
        <span className={'badge ' + (status.connected ? (status.state === 'Alarm' ? 'alarm' : 'online') : '')}>
          {status.connected ? status.state : 'Не подключено'}
        </span>
        {job.running && <span className="badge run">Печать {pct}%</span>}
        <div style={{ flex: 1 }} />
        <button onClick={safe(api.pause)} disabled={!status.connected}>Пауза (!)</button>
        <button onClick={safe(api.resume)} disabled={!status.connected}>Продолжить (~)</button>
        <button className="danger" onClick={safe(api.stop)} disabled={!job.running}>Стоп</button>
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
            <h2>Задание</h2>
            <div className="row">
              <button className="primary" onClick={doPrint} disabled={!status.connected || !gcode || job.running}>
                ▶ Начать печать
              </button>
              <button onClick={() => {
                if (!gcode) return;
                const blob = new Blob([gcode], { type: 'text/plain' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob); a.download = 'plot.gcode'; a.click();
              }} disabled={!gcode}>Сохранить .gcode</button>
            </div>
            <div className="hint">
              Строк движения: {job.total ?? 0}. Отправка идёт с согласованием по «ok» — буфер GRBL не переполняется.
            </div>
            {(job.running || job.total > 0) && (
              <div className="progress"><div style={{ width: pct + '%' }} /></div>
            )}
            {error && <div className="hint" style={{ color: 'var(--red)' }}>{error}</div>}
          </div>
          <ManualPanel connected={status.connected} />
          <ConsolePanel connected={status.connected} />
        </div>

        <div className="center">
          <div className="canvas-wrap">
            <PreviewCanvas preview={preview} mpos={status.mpos} bedW={options.plotWidth} bedH={options.plotHeight} />
          </div>
          <div className="status-strip">
            <span>Лист: <b>{options.plotWidth}×{options.plotHeight} мм (макс. A4)</b></span>
            <span>MPos: <b>{status.mpos ? status.mpos.map((v) => v.toFixed(2)).join(', ') : '—'}</b></span>
            <span>WPos: <b>{status.wpos ? status.wpos.map((v) => v.toFixed(2)).join(', ') : '—'}</b></span>
            <span>Feed: <b>{status.fs ? status.fs[0] + ' мм/мин' : '—'}</b></span>
            <span>Очередь: <b>{job.queue ?? 0}</b></span>
            <span>Состояние: <b>{status.state}</b></span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewCanvas({ preview, mpos, bedW, bedH }) {
  // Вид: стол bedW x bedH мм, Y вверх (как у GRBL). Добавляем рамку и сетку.
  const pad = 20;
  const vb = `${-pad} ${-pad - bedH} ${bedW + 2 * pad} ${bedH + 2 * pad}`;
  const paths = preview
    ? preview.polylines.map((pl) => 'M ' + pl.map((p) => `${p.x.toFixed(2)} ${(-p.y).toFixed(2)}`).join(' L ')).join(' ')
    : '';
  // позиция инструмента
  const tool = mpos ? { x: mpos[0], y: -mpos[1] } : null;

  const gridLines = [];
  for (let gx = 0; gx <= bedW; gx += 50) gridLines.push(<line key={'gx' + gx} x1={gx} y1={0} x2={gx} y2={-bedH} stroke="#243040" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />);
  for (let gy = 0; gy <= bedH; gy += 50) gridLines.push(<line key={'gy' + gy} x1={0} y1={-gy} x2={bedW} y2={-gy} stroke="#243040" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />);

  return (
    <svg viewBox={vb} preserveAspectRatio="xMidYMid meet">
      <rect className="plot-bed" x={0} y={-bedH} width={bedW} height={bedH} rx={2} />
      {gridLines}
      <text x={2} y={4} fontSize={6} fill="#8b98a8">0,0</text>
      {paths && <path d={paths} className="plot-path" />}
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
