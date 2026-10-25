// api.js — обёртка над HTTP API локального сервера
const base = '/api';

async function req(path, opts) {
  const res = await fetch(base + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

export const api = {
  ports: () => req('/ports'),
  connect: (port, baudrate) => req('/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port, baudrate }) }),
  disconnect: () => req('/disconnect', { method: 'POST' }),
  status: () => req('/status'),
  command: (cmd) => req('/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd }) }),
  jog: (axis, distance, feed) => req('/jog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ axis, distance, feed }) }),
  setZero: (axes) => req('/set-zero', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ axes }) }),
  convert: (svg, options) => req('/convert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ svg, options }) }),
  fontCheck: (url, text) => req('/font-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, text }) }),
  textToGcode: (text, fontUrl, options) => req('/text-to-gcode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, fontUrl, options }) }),
  documentToGcode: (payload) => req('/document-to-gcode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  loadGcode: (gcode) => req('/load-gcode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gcode }) }),
  print: () => req('/print', { method: 'POST' }),
  pause: () => req('/pause', { method: 'POST' }),
  resume: () => req('/resume', { method: 'POST' }),
  stop: () => req('/stop', { method: 'POST' }),
  reset: () => req('/reset', { method: 'POST' }),
  shutdown: () => req('/shutdown', { method: 'POST' }),
};
