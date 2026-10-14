import React, { useRef, useState } from 'react';

export default function SvgPanel({ options, setOptions, onConvert, gcode, busy, error }) {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [svgText, setSvgText] = useState('');
  const [over, setOver] = useState(false);

  const setOpt = (k, v) => setOptions({ ...options, [k]: v });

  const readFile = (file) => {
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.gcode') || file.name.toLowerCase().endsWith('.nc') || file.name.toLowerCase().endsWith('.ngc')) {
      file.text().then(async (text) => {
        setFileName(file.name);
        try { await onConvert({ gcode: text }); } catch (e) { /* handled by parent */ }
      });
      return;
    }
    file.text().then((text) => {
      setFileName(file.name);
      setSvgText(text);
    });
  };

  const convert = () => {
    if (!svgText.trim()) return;
    onConvert({ svg: svgText, options });
  };

  return (
    <div className="panel">
      <h2>Рисунок → G-code</h2>
      <div
        className={'file-drop' + (over ? ' over' : '')}
        onClick={() => fileRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); readFile(e.dataTransfer.files[0]); }}
      >
        {fileName || 'Перетащите или выберите SVG / G-code файл'}
      </div>
      <input
        ref={fileRef} type="file" accept=".svg,.gcode,.nc,.ngc" style={{ display: 'none' }}
        onChange={(e) => readFile(e.target.files[0])}
      />

      <div className="row" style={{ marginTop: 10 }}>
        <label className="field">Стол X, мм
          <input type="number" value={options.plotWidth} onChange={(e) => setOpt('plotWidth', Number(e.target.value))} />
        </label>
        <label className="field">Стол Y, мм
          <input type="number" value={options.plotHeight} onChange={(e) => setOpt('plotHeight', Number(e.target.value))} />
        </label>
      </div>
      <div className="row">
        <label className="field">Поле, мм
          <input type="number" value={options.margin} onChange={(e) => setOpt('margin', Number(e.target.value))} />
        </label>
        <label className="field">Высота подъёма пера Z, мм
          <input type="number" value={options.penUpZ} onChange={(e) => setOpt('penUpZ', Number(e.target.value))} />
        </label>
      </div>
      <div className="row">
        <label className="field">F рисование, мм/мин
          <input type="number" value={options.feedDraw} onChange={(e) => setOpt('feedDraw', Number(e.target.value))} />
        </label>
        <label className="field">F перемещение, мм/мин
          <input type="number" value={options.feedTravel} onChange={(e) => setOpt('feedTravel', Number(e.target.value))} />
        </label>
      </div>
      <div className="row check">
        <input id="stf" type="checkbox" checked={options.scaleToFit} onChange={(e) => setOpt('scaleToFit', e.target.checked)} />
        <label htmlFor="stf">Масштабировать под стол</label>
      </div>

      <div className="row">
        <button className="primary" onClick={convert} disabled={busy || !svgText.trim()}>Конвертировать SVG</button>
      </div>
      {error && <div className="hint" style={{ color: 'var(--red)' }}>{error}</div>}
      {gcode && (
        <details>
          <summary className="hint" style={{ cursor: 'pointer' }}>Показать G-code ({gcode.split('\n').length} строк)</summary>
          <pre className="console" style={{ height: 200 }}>{gcode}</pre>
        </details>
      )}
      <div className="hint" style={{ marginTop: 6 }}>
        Совет: текст и сложные изображения переводите в SVG-пути (Inkscape: Path → Object to Path).
        Рабочая область плоттера из репозитория Scalable Pen Plotter задайте в полях «Стол».
      </div>
    </div>
  );
}
