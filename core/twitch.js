'use strict';
// Commandes du chat Twitch (!wl, !mmr…) : connexion par code (twitch.tv/activate) puis chat IRC.
// Le jeton est rangé à part (twitch-auth.json dans le dossier de données), jamais envoyé aux pages.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { makeVault } = require('./vault');

// Identifiant PUBLIC de l'application Twitch « RL-UI » (dev.twitch.tv/console/apps, type « Public »).
// Vide = commandes du chat indisponibles. Peut être remplacé par RLUI_TWITCH_CLIENT_ID pour les tests.
const TWITCH_CLIENT_ID = 'tr82baux8w08dbceriq6q0ilyn47zw';
const SCOPES = 'chat:read chat:edit';
const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';

// ---------------------------------------------------------------- IRC
function parseIrc(line) {
  const m = { tags: {}, prefix: '', command: '', params: [] };
  let rest = line;
  if (rest.startsWith('@')) {
    const i = rest.indexOf(' ');
    for (const kv of rest.slice(1, i).split(';')) {
      const j = kv.indexOf('=');
      m.tags[j < 0 ? kv : kv.slice(0, j)] = j < 0 ? '' : kv.slice(j + 1).replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\');
    }
    rest = rest.slice(i + 1);
  }
  if (rest.startsWith(':')) {
    const i = rest.indexOf(' ');
    m.prefix = rest.slice(1, i);
    rest = rest.slice(i + 1);
  }
  const t = rest.indexOf(' :');
  const head = t < 0 ? rest : rest.slice(0, t);
  const parts = head.split(' ').filter(Boolean);
  m.command = parts.shift() || '';
  m.params = parts;
  if (t >= 0) m.params.push(rest.slice(t + 2));
  return m;
}

// Commande reconnue dans un message ("!wl", "!WL please" → "wl"), selon la liste des commandes
function matchCommand(text, commands) {
  const w = /^!([\p{L}\p{N}_-]{1,30})/u.exec(String(text || '').trim());
  if (!w) return null;
  const word = w[1].toLowerCase();
  return (
    commands.find((c) => c.enabled !== false && [c.name, ...String(c.aliases || '').split(',')].map((s) => s.trim().toLowerCase().replace(/^!/, '')).includes(word)) || null
  );
}

// texte envoyé dans le chat : une seule ligne, longueur limitée par Twitch
const chatSafe = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 480);

class TwitchChat extends EventEmitter {
  constructor({ dataDir, getSettings, render, fetchImpl = globalThis.fetch, ircUrl = IRC_URL, pollMs = null, vault = makeVault(null), clientId = process.env.RLUI_TWITCH_CLIENT_ID || TWITCH_CLIENT_ID }) {
    super();
    this.file = path.join(dataDir, 'twitch-auth.json');
    this.getSettings = getSettings;
    this.render = render; // (commande) => texte de réponse
    this.fetch = fetchImpl;
    this.ircUrl = ircUrl;
    this.pollMs = pollMs; // tests : délai entre deux vérifications du code
    this.clientId = clientId;
    this.vault = vault;
    this.auth = this._loadAuth();
    this.ws = null;
    this.state = 'off'; // off | code | connecting | connected | error
    this.error = '';
    this.device = null; // { code, uri, expiresAt }
    this.lastUse = new Map();
    this._retry = 0;
    this._timer = null;
    this._pollTimer = null;
  }

  status() {
    return {
      available: !!this.clientId,
      state: this.state,
      login: this.auth ? this.auth.login : null,
      channel: this._channel(),
      code: this.device ? this.device.code : null,
      uri: this.device ? this.device.uri : null,
      error: this.error,
    };
  }

  _changed() {
    this.emit('status', this.status());
  }

  _channel() {
    const c = String(this.getSettings().chat.channel || '').trim().replace(/^#/, '').toLowerCase();
    return c || (this.auth ? this.auth.login : '');
  }

  // le fichier contient { enc: "enc:v1:…" } (connexion chiffrée par Windows) ou, sans chiffrement, la connexion en clair
  _loadAuth() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const a = raw && raw.enc ? JSON.parse(this.vault.open(raw.enc) || 'null') : raw;
      if (!a || !a.access_token) return null;
      if (!raw.enc && this.vault.available) this._write(a); // ancienne version en clair : on chiffre
      return a;
    } catch {
      return null;
    }
  }

  _write(a) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const body = this.vault.available ? { enc: this.vault.seal(JSON.stringify(a)) } : a;
    fs.writeFileSync(this.file, JSON.stringify(body));
  }

  _saveAuth(a) {
    this.auth = a;
    if (!a) {
      try {
        fs.unlinkSync(this.file);
      } catch {}
      return;
    }
    this._write(a);
  }

  async _post(url, form) {
    const r = await this.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body: j };
  }

  // ---------------------------------------------------------------- connexion par code
  async startLogin() {
    if (!this.clientId) throw new Error('twitch-unavailable');
    clearTimeout(this._pollTimer);
    const r = await this._post('https://id.twitch.tv/oauth2/device', { client_id: this.clientId, scopes: SCOPES });
    if (!r.ok) throw new Error(r.body.message || `Twitch ${r.status}`);
    const d = r.body;
    this.device = { code: d.user_code, uri: d.verification_uri, expiresAt: Date.now() + d.expires_in * 1000, deviceCode: d.device_code, interval: Math.max(2, d.interval || 5) };
    this.state = 'code';
    this.error = '';
    this._changed();
    this._poll();
    return this.status();
  }

  _poll() {
    const dev = this.device;
    if (!dev) return;
    this._pollTimer = setTimeout(async () => {
      if (this.device !== dev) return;
      if (Date.now() > dev.expiresAt) {
        this.device = null;
        this.state = 'off';
        this.error = 'expired';
        return this._changed();
      }
      try {
        const r = await this._post('https://id.twitch.tv/oauth2/token', {
          client_id: this.clientId,
          scopes: SCOPES,
          device_code: dev.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        });
        if (r.ok && r.body.access_token) {
          this.device = null;
          await this._useTokens(r.body);
          return this.connect();
        }
        // "authorization_pending" tant que l'utilisateur n'a pas validé
        if (!/pending|slow_down/i.test(String(r.body.message || ''))) {
          this.device = null;
          this.state = 'error';
          this.error = String(r.body.message || `Twitch ${r.status}`);
          return this._changed();
        }
      } catch (e) {
        this.error = e.message;
      }
      this._poll();
    }, this.pollMs || dev.interval * 1000);
    if (this._pollTimer.unref) this._pollTimer.unref();
  }

  async _useTokens(tok) {
    const v = await this.fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${tok.access_token}` } });
    const info = await v.json().catch(() => ({}));
    if (!v.ok || !info.login) throw new Error('invalid-token');
    this._saveAuth({ access_token: tok.access_token, refresh_token: tok.refresh_token || (this.auth && this.auth.refresh_token), login: info.login, userId: info.user_id });
  }

  async _refresh() {
    if (!this.auth || !this.auth.refresh_token) return false;
    const r = await this._post('https://id.twitch.tv/oauth2/token', { client_id: this.clientId, grant_type: 'refresh_token', refresh_token: this.auth.refresh_token });
    if (!r.ok || !r.body.access_token) return false;
    await this._useTokens(r.body);
    return true;
  }

  logout() {
    this.disconnect();
    this._saveAuth(null);
    this.device = null;
    this.state = 'off';
    this.error = '';
    this._changed();
  }

  // ---------------------------------------------------------------- chat IRC
  start() {
    if (this.auth && this.clientId && this.getSettings().chat.enabled !== false) this.connect();
  }

  connect() {
    this.disconnect(true);
    if (!this.auth) return;
    const channel = this._channel();
    this.state = 'connecting';
    this._changed();
    const ws = new WebSocket(this.ircUrl);
    this.ws = ws;
    ws.on('open', () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send(`PASS oauth:${this.auth.access_token}`);
      ws.send(`NICK ${this.auth.login}`);
      ws.send(`JOIN #${channel}`);
    });
    ws.on('message', (raw) => {
      for (const line of raw.toString().split('\r\n')) if (line) this._line(line, ws);
    });
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.state === 'off') return;
      this.state = 'connecting';
      this._changed();
      this._timer = setTimeout(() => this.connect(), Math.min(60000, 2000 * 2 ** this._retry++));
      if (this._timer.unref) this._timer.unref();
    });
    ws.on('error', () => {});
  }

  disconnect(keepState = false) {
    clearTimeout(this._timer);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {}
    }
    if (!keepState) {
      this.state = 'off';
      this._changed();
    }
  }

  async _line(line, ws) {
    const m = parseIrc(line);
    if (m.command === 'PING') return ws.send(`PONG :${m.params[0] || 'tmi.twitch.tv'}`);
    if (m.command === 'NOTICE' && /authentication failed|improperly formatted auth/i.test(m.params[1] || '')) {
      // jeton expiré : on le renouvelle une fois, sinon il faut se reconnecter
      this.disconnect(true);
      const ok = await this._refresh().catch(() => false);
      if (ok) return this.connect();
      this._saveAuth(null);
      this.state = 'error';
      this.error = 'auth';
      return this._changed();
    }
    if (m.command === 'ROOMSTATE' || (m.command === 'JOIN' && m.prefix.startsWith(`${this.auth && this.auth.login}!`))) {
      if (this.state !== 'connected') {
        this.state = 'connected';
        this.error = '';
        this._retry = 0;
        this._changed();
      }
      return;
    }
    if (m.command === 'PRIVMSG') this._onMessage(m, ws);
  }

  _onMessage(m, ws) {
    const s = this.getSettings().chat;
    if (s.enabled === false) return;
    const cmd = matchCommand(m.params[1], s.commands || []);
    if (!cmd) return;
    const now = Date.now();
    const cd = Math.max(0, Number(s.cooldown) || 0) * 1000;
    if (now - (this.lastUse.get(cmd.name) || 0) < cd) return;
    this.lastUse.set(cmd.name, now);
    const text = chatSafe(this.render(cmd));
    if (!text) return;
    const reply = m.tags.id ? `@reply-parent-msg-id=${m.tags.id} ` : '';
    ws.send(`${reply}PRIVMSG ${m.params[0]} :${text}`);
    this.emit('command', { name: cmd.name, user: m.tags['display-name'] || m.prefix.split('!')[0], text });
  }
}

module.exports = { TwitchChat, parseIrc, matchCommand, chatSafe, TWITCH_CLIENT_ID };
