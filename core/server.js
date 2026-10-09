'use strict';
// Serveur local : tableau de bord, overlays OBS (Browser Source), API HTTP (Stream Deck...) et WebSocket temps réel.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { WebSocketServer } = require('ws');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.md': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
};

// Pages d'overlay : un thème ne peut charger que des fichiers locaux (pas de pistage, pas de script externe)
const OVERLAY_CSP = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:";
const { t: tr, getLang } = require('./i18n');
const OVERLAYS = new Set(['counter', 'alerts', 'history', 'summary', 'caster']);

function isLoopback(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

class AppServer extends EventEmitter {
  constructor({ core, webDir }) {
    super();
    this.core = core;
    this.webDir = webDir;
    this.server = null;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    this.clients = new Set();
    this.port = 0;
    this.lan = false;
  }

  get settings() {
    return this.core.store.settings;
  }

  // ---------------------------------------------------------------- démarrage
  async start() {
    const wanted = Number(this.settings.port) || 5757;
    this.lan = !!this.settings.lanAccess;
    const host = this.lan ? '0.0.0.0' : '127.0.0.1';
    let lastErr;
    for (let p = wanted; p < wanted + 20; p++) {
      try {
        await this._listen(p, host);
        this.port = p;
        return p;
      } catch (e) {
        lastErr = e;
        if (e.code !== 'EADDRINUSE' && e.code !== 'EACCES') break;
      }
    }
    throw lastErr;
  }

  _listen(port, host) {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this._handle(req, res));
      srv.on('upgrade', (req, sock, head) => this._upgrade(req, sock, head));
      srv.once('error', reject);
      srv.listen(port, host, () => {
        srv.removeListener('error', reject);
        this.server = srv;
        resolve();
      });
    });
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  stop() {
    return new Promise((resolve) => {
      for (const c of this.clients) {
        try {
          c.terminate();
        } catch {}
      }
      this.clients.clear();
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server.closeAllConnections?.();
      this.server = null;
    });
  }

  lanAddresses() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
    return out;
  }

  _hostAllowed(hostHeader) {
    if (!hostHeader) return false;
    const host = hostHeader.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (!this.lan) return false;
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === os.hostname().toLowerCase();
  }

  _authorized(req, url) {
    const key = url.searchParams.get('key') || req.headers['x-rl-ui-key'];
    return !!key && key === this.settings.apiKey;
  }

  // ---------------------------------------------------------------- WebSocket
  _upgrade(req, sock, head) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws' || !this._hostAllowed(req.headers.host)) {
      sock.destroy();
      return;
    }
    // Un site web ouvert dans le navigateur peut ouvrir un WebSocket vers 127.0.0.1 (pas de CORS) :
    // seules nos propres pages (overlays, tableau de bord) sont acceptées quand une origine est annoncée.
    const origin = req.headers.origin;
    if (origin) {
      let oh = '';
      try {
        oh = new URL(origin).host;
      } catch {}
      if (!oh || !this._hostAllowed(oh)) {
        sock.destroy();
        return;
      }
    }
    const dashboard = url.searchParams.get('role') === 'dashboard' && this._authorized(req, url);
    this.wss.handleUpgrade(req, sock, head, (ws) => {
      ws.isDashboard = dashboard;
      ws.isAlive = true;
      this.clients.add(ws);
      ws.on('pong', () => (ws.isAlive = true));
      ws.on('close', () => {
        this.clients.delete(ws);
        if (ws.overlay) this._overlaysChanged(); // une source OBS s'est fermée
      });
      ws.on('error', () => {});
      ws.on('message', (raw) => {
        // les overlays peuvent signaler qu'ils sont prêts ; rien d'autre n'est accepté
        try {
          const m = JSON.parse(raw.toString());
          if (m.type === 'hello' && typeof m.overlay === 'string') {
            ws.overlay = m.overlay.slice(0, 20);
            this._overlaysChanged(); // une source OBS vient de s'ouvrir
          }
          // abonnement aux données du mode caster (nombreuses : envoyées seulement à qui les demande)
          if (m.type === 'sub' && m.topic === 'caster') {
            ws.subs = ws.subs || new Set();
            ws.subs.add('caster');
            this._send(ws, { type: 'caster', state: this.core.casterState() });
          }
        } catch {}
      });
      this._send(ws, { type: 'state', state: this.core.publicState() });
      this._send(ws, { type: 'config', config: this.core.overlayConfig() });
      if (dashboard) this._send(ws, { type: 'dashboard', data: this.core.dashboardState() });
    });
    if (!this._ping) {
      this._ping = setInterval(() => {
        for (const c of this.clients) {
          if (!c.isAlive) {
            c.terminate();
            continue;
          }
          c.isAlive = false;
          try {
            c.ping();
          } catch {}
        }
      }, 20000);
    }
  }

  _send(ws, msg) {
    if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  broadcast(msg, { dashboardOnly = false, topic = null } = {}) {
    const data = JSON.stringify(msg);
    for (const c of this.clients) {
      if (dashboardOnly && !c.isDashboard) continue;
      if (topic && !(c.subs && c.subs.has(topic))) continue;
      this._send(c, data);
    }
  }

  // Le tableau de bord affiche quels overlays sont ouverts dans OBS : on le prévient tout de suite
  _overlaysChanged() {
    if (this.core && typeof this.core._changed === 'function') this.core._changed();
  }

  overlayClients() {
    const out = {};
    for (const c of this.clients) if (c.overlay) out[c.overlay] = (out[c.overlay] || 0) + 1;
    return out;
  }

  // ---------------------------------------------------------------- HTTP
  _handle(req, res) {
    const url = new URL(req.url, 'http://x');
    if (!this._hostAllowed(req.headers.host)) return this._text(res, 403, tr('s.hostDenied'));
    const p = decodeURIComponent(url.pathname);
    Promise.resolve()
      .then(() => this._route(req, res, url, p))
      .catch((e) => {
        if (!res.headersSent) this._json(res, 500, { ok: false, error: e.message });
      });
  }

  async _route(req, res, url, p) {
    const method = req.method;
    if (p === '/' || p === '/index.html') {
      if (!isLoopback(req.socket.remoteAddress)) return this._text(res, 403, tr('s.dashLocal'));
      // THEME : posé dès le HTML pour que la page s'affiche directement dans le bon thème
      const theme = ['light', 'dark'].includes(this.settings.app.theme) ? this.settings.app.theme : 'system';
      return this._page(res, path.join(this.webDir, 'dashboard', 'index.html'), { KEY: this.settings.apiKey, LANG: getLang(), THEME: theme });
    }
    if (p === '/favicon.ico') return this._file(res, path.join(this.webDir, 'assets', 'icon.png'));
    let m = /^\/overlay\/([a-z]+)\/?$/.exec(p);
    if (m && OVERLAYS.has(m[1])) return this._page(res, path.join(this.webDir, 'overlay', `${m[1]}.html`), { LANG: getLang() }, OVERLAY_CSP);
    // fichiers des thèmes : jamais exécutables, aucune ressource externe
    m = /^\/themes\/([a-z0-9-]+)\/(.+)$/.exec(p);
    if (m) {
      const f = this.core.themes.file(m[1], m[2]);
      if (!f) return this._text(res, 404, 'Introuvable');
      return this._file(res, f, { 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; media-src 'self'; sandbox" });
    }
    // images du mode caster (logos, photos) : jamais exécutables
    m = /^\/caster-assets\/([a-z0-9-]+\.(png|jpe?g|webp|gif|svg))$/.exec(p);
    if (m) {
      const f = this.core.casterAssets.file(m[1]);
      if (!f) return this._text(res, 404, 'Not found');
      return this._file(res, f, { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
    }
    if (p.startsWith('/static/')) return this._static(res, p.slice('/static/'.length));
    m = /^\/sounds\/([a-z_]+)$/.exec(p);
    if (m) {
      const f = this.core.soundFile(m[1]);
      return f ? this._file(res, f) : this._text(res, 404, 'Aucun son');
    }

    // ---- API publique (lecture seule)
    if (p === '/api/state') return this._json(res, 200, this.core.publicState());
    m = /^\/api\/theme\/([a-z0-9-]+)$/.exec(p);
    if (m) {
      const t = this.core.themeInfo(m[1]);
      return t ? this._json(res, 200, t) : this._json(res, 404, { ok: false });
    }
    m = /^\/api\/text\/([a-z]+)$/.exec(p);
    if (m) {
      const t = this.core.textValue(m[1]);
      return t == null ? this._text(res, 404, tr('s.unknownField')) : this._text(res, 200, t);
    }

    // ---- API protégée par la clé
    if (p.startsWith('/api/')) {
      if (!this._authorized(req, url)) return this._json(res, 401, { ok: false, error: tr('s.keyInvalid') });
      m = /^\/api\/action\/([a-z-]+)$/.exec(p);
      if (m && (method === 'GET' || method === 'POST')) {
        const params = Object.fromEntries(url.searchParams);
        if (method === 'POST') Object.assign(params, await this._body(req, true).catch(() => ({})));
        const r = await this.core.action(m[1], params);
        return this._json(res, r && r.ok === false ? 400 : 200, { ok: true, ...r, stats: this.core.publicState().session });
      }
      // mode caster : série (aussi utilisable depuis un Stream Deck)
      m = /^\/api\/caster\/(swap|reset|win-[01]|unwin-[01])$/.exec(p);
      if (m && (method === 'GET' || method === 'POST')) {
        const r = this.core.casterAction(m[1]);
        return this._json(res, r.ok ? 200 : 400, r);
      }
      m = /^\/api\/chat\/(login|logout|reconnect)$/.exec(p);
      if (m && method === 'POST') {
        const r = await this.core.chatAction(m[1]);
        return this._json(res, r.ok ? 200 : 400, r);
      }
      if (p === '/api/chat/preview') {
        const list = this.core.store.settings.chat.commands || [];
        return this._json(res, 200, { ok: true, responses: list.map((c) => ({ name: c.name, text: this.core.chatResponse(c) })) });
      }
      m = /^\/api\/update\/(check|install)$/.exec(p);
      if (m && method === 'POST') {
        const r = await this.core.updateAction(m[1]);
        return this._json(res, r.ok ? 200 : 400, r);
      }
      m = /^\/api\/caster\/(logo|photo)$/.exec(p);
      if (m && (method === 'POST' || method === 'DELETE')) {
        const key = url.searchParams.get(m[1] === 'logo' ? 'team' : 'name') || '';
        if (method === 'DELETE') return this._json(res, 200, this.core.casterImageRemove(m[1], key));
        const buf = await this._body(req, false, 5 * 1024 * 1024);
        const r = this.core.casterImage(m[1], key, buf, url.searchParams.get('ext'));
        return this._json(res, r.ok ? 200 : 400, r);
      }
      if (p === '/api/caster') return this._json(res, 200, this.core.casterState());
      if (p === '/api/dashboard') return this._json(res, 200, this.core.dashboardState());
      if (p === '/api/settings' && method === 'POST') {
        const patch = await this._body(req, true);
        return this._json(res, 200, { ok: true, settings: await this.core.patchSettings(patch) });
      }
      if (p === '/api/identity' && method === 'POST') {
        const b = await this._body(req, true);
        return this._json(res, 200, { ok: this.core.setIdentity(b.key) });
      }
      if (p === '/api/identity/forget' && method === 'POST') {
        const b = await this._body(req, true);
        return this._json(res, 200, { ok: this.core.forgetId(b.id) });
      }
      m = /^\/api\/matches\/([^/]+)$/.exec(p);
      if (m && (method === 'DELETE' || method === 'POST')) return this._json(res, 200, { ok: this.core.deleteMatch(m[1]) });
      if (p === '/api/diagnostic') return this._json(res, 200, this.core.diagnostic());
      if (p === '/api/diagnostic/report') return this._text(res, 200, this.core.diagnosticReport());
      if (p === '/api/diagnostic/count' && method === 'POST') {
        const b = await this._body(req, true);
        const r = this.core.countSkipped(b.id, { player: Number.isInteger(b.player) ? b.player : null, result: b.result });
        return this._json(res, r.ok ? 200 : 400, r);
      }
      if (p === '/api/diagnostic/dismiss' && method === 'POST') {
        const b = await this._body(req, true);
        return this._json(res, 200, { ok: this.core.dismissNotice(b.id) });
      }
      if (p === '/api/history') {
        return this._json(res, 200, this.core.history(url.searchParams.get('scope') || 'session', Number(url.searchParams.get('limit')) || 500));
      }
      if (p === '/api/statsapi/enable' && method === 'POST') {
        const b = await this._body(req, true).catch(() => ({}));
        return this._json(res, 200, await this.core.enableStatsApi(!!b.elevated, Number(b.rate) || null));
      }
      if (p === '/api/statsapi/refresh' && method === 'POST') return this._json(res, 200, await this.core.refreshRlConfig());
      if (p === '/api/obs/scenes') return this._json(res, 200, await this.core.obsScenes());
      m = /^\/api\/sounds\/([a-z_]+)$/.exec(p);
      if (m && method === 'POST') {
        const buf = await this._body(req, false, 8 * 1024 * 1024);
        const r = this.core.saveSound(m[1], buf, url.searchParams.get('ext') || 'mp3');
        return this._json(res, r.ok ? 200 : 400, r);
      }
      if (m && method === 'DELETE') return this._json(res, 200, this.core.deleteSound(m[1]));
      if (p === '/api/themes/install' && method === 'POST') {
        const buf = await this._body(req, false, 60 * 1024 * 1024);
        const r = this.core.installTheme(buf);
        return this._json(res, r.ok ? 200 : 400, r);
      }
      m = /^\/api\/themes\/([a-z0-9-]+)\/(duplicate|export)$/.exec(p);
      if (m && m[2] === 'duplicate' && method === 'POST') {
        const b = await this._body(req, true).catch(() => ({}));
        const r = await this.core.duplicateTheme(m[1], b.name);
        return this._json(res, r.ok ? 200 : 400, r);
      }
      if (m && m[2] === 'export') {
        try {
          const z = this.core.themes.exportZip(m[1]);
          res.writeHead(200, { ...this._headers(MIME['.zip']), 'Content-Disposition': `attachment; filename="${z.name}"` });
          return res.end(z.data);
        } catch (e) {
          return this._json(res, 404, { ok: false, error: e.message });
        }
      }
      m = /^\/api\/themes\/([a-z0-9-]+)$/.exec(p);
      if (m && method === 'DELETE') return this._json(res, 200, { ok: this.core.removeTheme(m[1]) });
      if (p === '/api/open' && method === 'POST') {
        const b = await this._body(req, true);
        return this._json(res, 200, { ok: await this.core.open(b.target, b.url) });
      }
      return this._json(res, 404, { ok: false, error: tr('s.unknownRoute') });
    }
    return this._text(res, 404, 'Introuvable');
  }

  _body(req, json, limit = 256 * 1024) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          reject(new Error(tr('s.tooBig')));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (!json) return resolve(buf);
        try {
          resolve(buf.length ? JSON.parse(buf.toString('utf8')) : {});
        } catch {
          reject(new Error(tr('s.badJson')));
        }
      });
      req.on('error', reject);
    });
  }

  _headers(type) {
    return {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
  }

  _json(res, code, obj) {
    res.writeHead(code, this._headers(MIME['.json']));
    res.end(JSON.stringify(obj));
  }

  _text(res, code, text) {
    res.writeHead(code, this._headers(MIME['.txt']));
    res.end(String(text));
  }

  _page(res, file, vars, csp = null) {
    fs.readFile(file, 'utf8', (err, html) => {
      if (err) return this._text(res, 404, 'Page introuvable');
      const out = html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
      res.writeHead(200, { ...this._headers(MIME['.html']), ...(csp ? { 'Content-Security-Policy': csp } : {}) });
      res.end(out);
    });
  }

  _static(res, rel) {
    const root = path.resolve(this.webDir);
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return this._text(res, 403, 'Interdit');
    return this._file(res, file);
  }

  _file(res, file, extra = {}) {
    fs.readFile(file, (err, buf) => {
      if (err) return this._text(res, 404, 'Introuvable');
      res.writeHead(200, { ...this._headers(MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'), ...extra });
      res.end(buf);
    });
  }
}

module.exports = { AppServer };
