// shutdown-helper.js — безопасная остановка сервера Plotter Controller.
// Вызывается из AppRun при Ctrl+C или «убить зависший экземпляр»:
// сначала штатный HTTP-запрос /api/shutdown (порт берётся из окружения),
// если ответа нет — SIGTERM по PID.
const PORT = Number(process.env.PORT || 8765);
fetch('http://localhost:' + PORT + '/api/shutdown', { method: 'POST' })
  .then((r) => process.exit(r.ok ? 0 : 1))
  .catch(() => process.exit(2));
setTimeout(() => process.exit(3), 3000); // сервер не отвечает — выходим, AppRun добьёт по PID
