// grbl.js — менеджер последовательного порта и очереди команд для GRBL
import { SerialPort } from 'serialport';

export class GrblConnection {
  constructor() {
    this.port = null;
    this.connected = false;
    this.buffer = '';
    this.queue = []; // ожидающие отправки строки
    this.idleWaiters = [];
    this.stateReportListener = null;
    this.errorListener = null;
    this.printListener = null;
  }

  listPorts() {
    return SerialPort.list().then((ports) =>
      ports.map((p) => ({
        path: p.path,
        manufacturer: p.manufacturer,
        vendorId: p.vendorId,
        productId: p.productId,
      }))
    );
  }

  connect(path, baudrate = 115200) {
    return new Promise((resolve, reject) => {
      if (this.port) this.disconnect();
      const port = new SerialPort({ path, baudRate: Number(baudrate), autoOpen: false });
      port.open((err) => {
        if (err) return reject(err);
        this.port = port;
        this.connected = true;
        this.buffer = '';
        this.queue = [];

        port.on('data', (chunk) => this._onData(chunk));
        port.on('close', () => {
          this.connected = false;
          this.queue = [];
        });
        port.on('error', (e) => this.errorListener && this.errorListener(e.message));

        // GRBL: после открытия порта — сброс (Ctrl-X), затем он пришлёт приветствие
        port.write('\x18');
        resolve();
      });
    });
  }

  disconnect() {
    if (this.port && this.port.isOpen) {
      try { this.port.close(); } catch (e) { /* ignore */ }
    }
    this.port = null;
    this.connected = false;
    this.queue = [];
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    waiters.forEach((w) => w());
  }

  _onData(chunk) {
    this.buffer += chunk.toString('utf8');
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      this._handleLine(line);
    }
  }

  _handleLine(line) {
    if (!line) return;
    if (line === 'ok') {
      // ok освобождает слот внутреннего буфера GRBL — можно слать дальше
      setImmediate(() => this._pump());
      return;
    }
    if (line.startsWith('error')) {
      this.errorListener && this.errorListener(line);
      setImmediate(() => this._pump());
      return;
    }
    if (line.startsWith('<')) {
      this.stateReportListener && this.stateReportListener(line);
      return;
    }
    // Прочие сообщения ("Grbl 1.1h ...", "$G", ALARM, настройки)
    this.printListener && this.printListener(line);
  }

  // Поставить команду в очередь (отправка синхронизирована по "ok")
  sendCommand(cmd) {
    return new Promise((resolve) => {
      if (!this.connected) return resolve(false);
      this.queue.push({ text: cmd, resolve });
      this._pump();
    });
  }

  // Отправить пачку строк G-code в очередь (не блокируя HTTP-запрос до конца печати)
  sendBatch(lines) {
    for (const text of lines) {
      this.queue.push({ text, resolve: () => {} });
    }
    this._pump();
  }

  get queueLength() {
    return this.queue.length;
  }

  // Немедленная realtime-команда (?, !, ~, Ctrl-X) — минуя очередь
  sendRealtime(cmd) {
    if (!this.connected || !this.port || !this.port.isOpen) return false;
    this.port.write(cmd + '\n');
    return true;
  }

  sendRawBytes(hexByte) {
    if (!this.connected || !this.port || !this.port.isOpen) return false;
    this.port.write(Buffer.from([hexByte]));
    return true;
  }

  _pump() {
    if (!this.connected || !this.port || !this.port.isOpen) return;
    if (!this.queue.length) {
      if (this.idleWaiters.length) {
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        waiters.forEach((w) => w());
      }
      return;
    }
    const item = this.queue.shift();
    this.port.write(item.text + '\n', (err) => {
      item.resolve(!err);
      if (err) this.errorListener && this.errorListener('write error: ' + err.message);
    });
  }

  waitIdle() {
    if (!this.queue.length && !this.connected) return Promise.resolve();
    if (!this.queue.length) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  clearQueue() {
    const items = this.queue.splice(0, this.queue.length);
    items.forEach((i) => i.resolve(false));
  }

  getStatus(timeoutMs = 1500) {
    return new Promise((resolve) => {
      const prev = this.stateReportListener;
      let done = false;
      this.stateReportListener = (s) => {
        if (!done) {
          done = true;
          this.stateReportListener = prev;
          resolve(parseStateReport(s));
        }
        if (prev) prev(s);
      };
      this.sendRealtime('?');
      setTimeout(() => {
        if (!done) {
          done = true;
          this.stateReportListener = prev;
          resolve(null);
        }
      }, timeoutMs);
    });
  }
}

export function parseStateReport(str) {
  // Пример: <Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:0,0,0>
  const m = str.match(/^<([^>]+)>$/);
  if (!m) return null;
  const parts = m[1].split('|');
  const out = { state: parts[0], raw: str };
  for (const p of parts.slice(1)) {
    const ci = p.indexOf(':');
    if (ci < 0) continue;
    const k = p.slice(0, ci);
    const v = p.slice(ci + 1);
    if (['MPos', 'WPos', 'FS', 'SD', 'OVR'].includes(k)) {
      out[k] = v.split(',').map((x) => parseFloat(x));
    } else {
      out[k] = v;
    }
  }
  return out;
}
