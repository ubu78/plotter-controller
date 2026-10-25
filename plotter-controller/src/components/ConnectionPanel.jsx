import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useLang } from '../i18n.js';

export default function ConnectionPanel({ onStatus, connected }) {
  const { t } = useLang();
  const [ports, setPorts] = useState([]);
  const [port, setPort] = useState('');
  const [baud, setBaud] = useState(115200);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      const list = await api.ports();
      setPorts(list);
      if (list.length && !port) setPort(list[0].path);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { refresh(); }, []);

  const connect = async () => {
    setBusy(true); setError('');
    try {
      await api.connect(port, baud);
      onStatus && onStatus();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const disconnect = async () => {
    setBusy(true);
    try { await api.disconnect(); } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div className="panel">
      <h2>{t('conn.title')}</h2>
      <div className="row">
        <select value={port} onChange={(e) => setPort(e.target.value)} disabled={connected}>
          {ports.length === 0 && <option value="">{t('conn.noPorts')}</option>}
          {ports.map((p) => (
            <option key={p.path} value={p.path}>
              {p.path}{p.manufacturer ? ' — ' + p.manufacturer : ''}
            </option>
          ))}
        </select>
        <button className="small" onClick={refresh} disabled={connected}>↻</button>
      </div>
      <div className="row">
        <label className="field">{t('conn.baud')}
          <select value={baud} onChange={(e) => setBaud(Number(e.target.value))} disabled={connected}>
            {[115200, 57600, 9600].map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
      </div>
      <div className="row">
        {!connected ? (
          <button className="primary" onClick={connect} disabled={busy || !port}>{t('conn.connect')}</button>
        ) : (
          <button onClick={disconnect} disabled={busy}>{t('conn.disconnect')}</button>
        )}
        <button onClick={() => api.reset().catch((e) => setError(e.message))} disabled={!connected}>{t('conn.softReset')}</button>
      </div>
      {error && <div className="hint" style={{ color: 'var(--red)' }}>{error}</div>}
      <div className="hint">
        {t('conn.hint')}
      </div>
    </div>
  );
}
