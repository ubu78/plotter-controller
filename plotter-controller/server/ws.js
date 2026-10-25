// ws.js — минимальный WebSocket-мост к потоку GRBL (rx/tx/error) для консоли
import { WebSocketServer } from 'ws';

export function attachWebSocket(server, grbl, jobGetter) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const broadcast = (obj) => {
    const data = JSON.stringify(obj);
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(data);
    }
  };

  // перехватываем listeners, не ломая существующих
  const origPrint = grbl.printListener;
  const origError = grbl.errorListener;
  const origState = grbl.stateReportListener;

  grbl.printListener = (line) => { broadcast({ type: 'rx', text: line }); if (origPrint) origPrint(line); };
  grbl.errorListener = (e) => { broadcast({ type: 'error', text: String(e) }); if (origError) origError(e); };
  grbl.stateReportListener = (s) => { broadcast({ type: 'rx', text: s }); if (origState) origState(s); };

  // tx: подписка на отправку команд через хук в sendCommand/sendBatch
  const origSendCommand = grbl.sendCommand.bind(grbl);
  grbl.sendCommand = (cmd) => { broadcast({ type: 'tx', text: cmd }); return origSendCommand(cmd); };
  const origSendBatch = grbl.sendBatch.bind(grbl);
  grbl.sendBatch = (lines) => { broadcast({ type: 'tx', text: '(batch: ' + lines.length + ' lines)' }); return origSendBatch(lines); };
  const origRealtime = grbl.sendRealtime.bind(grbl);
  grbl.sendRealtime = (cmd) => {
    const printable = cmd === '\x18' ? '$RST' : cmd;
    broadcast({ type: 'tx', text: '(realtime) ' + printable });
    return origRealtime(cmd);
  };

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'rx', text: '// connected to plotter bridge' }));
  });

  return { broadcast };
}
