import React, { useState } from 'react';
import { api } from '../api.js';
import { useLang } from '../i18n.js';

export default function ManualPanel({ connected }) {
  const { t } = useLang();
  const [step, setStep] = useState(10);
  const [feed, setFeed] = useState(2000);
  const [err, setErr] = useState('');

  const jog = (axis, dir) => {
    api.jog(axis, dir * step, feed).catch((e) => setErr(e.message));
  };

  return (
    <div className="panel">
      <h2>{t('manual.title')}</h2>
      <div className="row">
        <label className="field">{t('manual.step')}
          <input type="number" value={step} onChange={(e) => setStep(Number(e.target.value))} />
        </label>
        <label className="field">{t('manual.feed')}
          <input type="number" value={feed} onChange={(e) => setFeed(Number(e.target.value))} />
        </label>
      </div>
      <div className="jogpad">
        <button className="empty" disabled></button>
        <button disabled={!connected} onClick={() => jog('y', +1)} title="Y+">↑</button>
        <button className="empty" disabled></button>
        <button disabled={!connected} onClick={() => jog('x', -1)} title="X−">←</button>
        <button disabled={!connected} onClick={() => api.setZero('XY').catch((e) => setErr(e.message))} title={t('manual.zeroHint')}>*</button>
        <button disabled={!connected} onClick={() => jog('x', +1)} title="X+">→</button>
        <button className="empty" disabled></button>
        <button disabled={!connected} onClick={() => jog('y', -1)} title="Y−">↓</button>
        <button className="empty" disabled></button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button disabled={!connected} onClick={() => api.command('G1 Z0 F1000').catch((e) => setErr(e.message))}>{t('manual.penDown')}</button>
        <button disabled={!connected} onClick={() => api.command('G0 Z5 F1000').catch((e) => setErr(e.message))}>{t('manual.penUp')}</button>
      </div>
      <div className="row">
        <button disabled={!connected} onClick={() => api.command('$H').catch((e) => setErr(e.message))}>Home ($H)</button>
        <button disabled={!connected} onClick={() => api.command('G28').catch((e) => setErr(e.message))}>{t('manual.g28')}</button>
      </div>
      {err && <div className="hint" style={{ color: 'var(--red)' }}>{err}</div>}
      <div className="hint">{t('manual.hint')}</div>
    </div>
  );
}
