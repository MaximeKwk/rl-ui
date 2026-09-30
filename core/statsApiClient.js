'use strict';
// Client de la Stats API officielle de Rocket League.
// Le jeu écoute en TCP (Port, 49123 par défaut : JSON concaténés) et en WebSocket (WebPort, 49124).
// En mode "auto" on tente les deux en parallèle : le premier qui envoie des données devient le transport actif.

const net = require('net');
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { JsonFramer, decodeEnvelope } = require('./jsonFramer');

const RETRY_MS = 2000;
const LIVE_TIMEOUT_MS = 6000;

class StatsApiClient extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = { host: '127.0.0.1', tcpPort: 49123, webPort: 49124, transport: 'auto', ...opts };
    this.cands = { tcp: null, ws: null };
    this.active = null;
    this.running = false;
    this.lastMessageAt = 0;
    this.messages = 0;
    this._status = null;
    this._timers = {};
    this._tick = null;
  }

  get status() {
    const connected = Object.values(this.cands).some((c) => c && c.connected);
    let state = 'offline';
    if (!this.running) state = 'off';
    else if (this.active && Date.now() - this.lastMessageAt < LIVE_TIMEOUT_MS) state = 'live';
    else if (connected) state = 'waiting';
    return {
      state,
      transport: this.active,
      connected: Object.entries(this.cands)
        .filter(([, c]) => c && c.connected)
        .map(([k]) => k),
      lastMessageAt: this.lastMessageAt,
      messages: this.messages,
      host: this.opts.host,
      tcpPort: this.opts.tcpPort,
      webPort: this.opts.webPort,
      transportMode: this.opts.transport,
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._openAll();
    this._tick = setInterval(() => this._emitStatus(), 1000);
    this._emitStatus();
  }

  stop() {
    this.running = false;
    clearInterval(this._tick);
    for (const k of Object.keys(this._timers)) clearTimeout(this._timers[k]);
    this._timers = {};
    for (const k of Object.keys(this.cands)) this._close(k);
    this.active = null;
    this._emitStatus();
  }

  configure(opts) {
    const next = { ...this.opts, ...opts };
    const changed = ['host', 'tcpPort', 'webPort', 'transport'].some((k) => next[k] !== this.opts[k]);
    this.opts = next;
    if (changed && this.running) {
      this.stop();
      this.start();
    }
  }

  _kinds() {
    const t = this.opts.transport;
    const kinds = [];
    if ((t === 'auto' || t === 'tcp') && this.opts.tcpPort > 0) kinds.push('tcp');
    if ((t === 'auto' || t === 'ws') && this.opts.webPort > 0) kinds.push('ws');
    return kinds;
  }

  _openAll() {
    for (const k of this._kinds()) this._open(k);
  }

  _schedule(kind) {
    if (!this.running || this._timers[kind]) return;
    this._timers[kind] = setTimeout(() => {
      delete this._timers[kind];
      if (!this.running) return;
      if (this.active && this.active !== kind) return;
      this._open(kind);
    }, RETRY_MS);
  }

  _open(kind) {
    if (this.cands[kind]) return;
    const cand = { kind, connected: false, framer: new JsonFramer(), sock: null, closed: false };
    this.cands[kind] = cand;
    const onData = (chunk) => {
      for (const raw of cand.framer.push(chunk)) {
        const env = decodeEnvelope(raw);
        if (env) this._onMessage(kind, env);
      }
    };
    const onClose = () => {
      if (cand.closed) return;
      cand.closed = true;
      if (this.cands[kind] === cand) this.cands[kind] = null;
      if (this.active === kind) {
        this.active = null;
        this.emit('disconnected', kind);
        this._openAll();
      }
      this._schedule(kind);
      this._emitStatus();
    };

    if (kind === 'tcp') {
      const sock = net.connect({ host: this.opts.host, port: this.opts.tcpPort });
      cand.sock = sock;
      sock.setNoDelay(true);
      sock.on('connect', () => {
        cand.connected = true;
        sock.setKeepAlive(true, 5000);
        this._emitStatus();
      });
      sock.on('data', onData);
      sock.on('error', () => {});
      sock.on('close', onClose);
    } else {
      const ws = new WebSocket(`ws://${this.opts.host}:${this.opts.webPort}`, {
        handshakeTimeout: 4000,
        perMessageDeflate: false,
      });
      cand.sock = ws;
      ws.on('open', () => {
        cand.connected = true;
        this._emitStatus();
      });
      ws.on('message', (data) => onData(Buffer.isBuffer(data) ? data : Buffer.from(data)));
      ws.on('error', () => {});
      ws.on('unexpected-response', () => {
        try {
          ws.terminate();
        } catch {}
      });
      ws.on('close', onClose);
    }
  }

  _close(kind) {
    const c = this.cands[kind];
    if (!c) return;
    c.closed = true;
    this.cands[kind] = null;
    try {
      if (kind === 'tcp') c.sock.destroy();
      else c.sock.terminate();
    } catch {}
  }

  _onMessage(kind, env) {
    if (!this.active) {
      this.active = kind;
      // on garde un seul transport pour ne pas recevoir chaque événement en double
      for (const other of Object.keys(this.cands)) if (other !== kind) this._close(other);
      this.emit('connected', kind);
    } else if (this.active !== kind) {
      return;
    }
    this.lastMessageAt = Date.now();
    this.messages++;
    this.emit('message', env);
    if (this.messages === 1 || this._status !== 'live') this._emitStatus();
  }

  _emitStatus() {
    const st = this.status;
    const sig = `${st.state}|${st.transport}|${st.connected.join(',')}`;
    if (sig !== this._sig) {
      this._sig = sig;
      this._status = st.state;
      this.emit('status', st);
    }
  }
}

module.exports = { StatsApiClient };
