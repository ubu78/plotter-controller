import React, { useState } from 'react';
import { api } from '../api.js';

export default function ManualPanel({ connected }) {
  const [step, setStep] = useState(10);
  const [feed, setFeed] = useState(2000);
  const [err, setErr] = useState('');

  const jog = (axis, dir) => {
    api.jog(axis, dir * step, feed).catch((e) => setErr(e.message));
  };

  return (
    <div className="panel">
      <h2>Ручное управление (Jog)</h2>
      <div className="row">
        <label className="field">Шаг, мм
          <input type="number" value={step} onChange={(e) => setStep(Number(e.target.value))} />
        </label>
        <label className="field">Подача, мм/мин
          <input type="number" value={feed} onChange={(e) => setFeed(Number(e.target.value))} />
        </label>
      </div>
      <div className="jogpad">
        <button className="empty" disabled></button>
        <button disabled={!connected} onClick={() => jog('y', +1)} title="Y+">↑</button>
        <button className="empty" disabled></button>
        <button disabled={!connected} onClick={() => jog('x', -1)} title="X−">←</button>
        <button disabled={!connected} onClick={() => api.setZero('XY').catch((e) => setErr(e.message))} title="Обнулить X,Y здесь">*</button>
        <button disabled={!connected} onClick={() => jog('x', +1)} title="X+">→</button>
        <button className="empty" disabled></button>
        <button disabled={!connected} onClick={() => jog('y', -1)} title="Y−">↓</button>
        <button className="empty" disabled></button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button disabled={!connected} onClick={() => api.command('G1 Z0 F1000').catch((e) => setErr(e.message))}>Опустить перо (Z0)</button>
        <button disabled={!connected} onClick={() => api.command('G0 Z5 F1000').catch((e) => setErr(e.message))}>Поднять перо (Z5)</button>
      </div>
      <div className="row">
        <button disabled={!connected} onClick={() => api.command('$H').catch((e) => setErr(e.message))}>Home ($H)</button>
        <button disabled={!connected} onClick={() => api.command('G28').catch((e) => setErr(e.message))}>G28 (домой)</button>
      </div>
      {err && <div className="hint" style={{ color: 'var(--red)' }}>{err}</div>}
      <div className="hint">Кнопка «*» обнуляет рабочие координаты в текущей позиции — используйте её для выставления начала листа.</div>
    </div>
  );
}
