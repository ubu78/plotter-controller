import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function ConsolePanel({ connected }) {
  const [lines, setLines] = useState([]);
  const [input, setInput] = useState('');
  const boxRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    // WebSocket для потока сообщений GRBL (если сервер не предоставляет — тихо игнорируем)
    let closed = false;
    let ws = null;
    try {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(proto + '://' + location.host + '/ws');
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'rx') push(msg.text, 'info');
        else if (msg.type === 'tx') push('> ' + msg.text, 'ok');
        else if (msg.type === 'error') push(msg.text, 'err');
      };
      ws.onerror = () => {};
    } catch (e) { /* нет WS — не страшно */ }
    return () => { closed = true; if (ws && ws.readyState <= 1) ws.close(); };
  }, []);

  const pushRef = useRef(() => {});
  pushRef.current = (text, cls) => {
    setLines((ls) => [...ls.slice(-400), { text, cls }]);
    setTimeout(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, 0);
  };
  function push(text, cls) { pushRef.current(text, cls); }

  const send = async () => {
    const cmd = input.trim();
    if (!cmd) return;
    setInput('');
    push('> ' + cmd, 'ok');
    try { await api.command(cmd); } catch (e) { push(e.message, 'err'); }
  };

  return (
    <div className="panel">
      <h2>Консоль GRBL</h2>
      <div className="console" ref={boxRef}>
        {lines.length === 0 && <span className="info">Команды: $$ (настройки), $G, $X, ?, G1 X10 Y10 F1000 ...</span>}
        {lines.map((l, i) => <div key={i} className={l.cls}>{l.text}</div>)}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input
          type="text" value={input} placeholder={connected ? 'Введите команду и Enter' : 'Сначала подключитесь'}
          disabled={!connected}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          style={{ flex: 1 }}
        />
        <button onClick={send} disabled={!connected}>Отправить</button>
      </div>
      <div className="hint">$$ — показать настройки, $-# — вернуть дефолт, $H — homing, ? — статус.</div>
    </div>
  );
}
