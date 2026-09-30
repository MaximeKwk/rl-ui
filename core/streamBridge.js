'use strict';
// Actions automatiques dans le logiciel de stream, pour OBS Studio ou Streamlabs Desktop :
// changer de scène (avec retour automatique) ou afficher une source pendant N secondes,
// à chaque événement (overtime, victoire, défaite, OT gagné / perdu, série).
//
// - OBS Studio : obs-websocket v5 (intégré à OBS 28+, Outils > Paramètres du serveur WebSocket), port 4455.
// - Streamlabs Desktop : API de contrôle à distance (Paramètres > Contrôle à distance), WebSocket
//   ws://127.0.0.1:59650/api/websocket, JSON-RPC 2.0, authentification par jeton.

const crypto = require('crypto');
const { EventEmitter } = require('events');
const WebSocket = require('ws');

const SOFTWARE_NAMES = { obs: 'OBS', streamlabs: 'Streamlabs' };

function obsAuthString(password, salt, challenge) {
  const secret = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secret + challenge).digest('base64');
}

// ---------------------------------------------------------------------------- OBS Studio
class ObsDriver {
  constructor(s, bridge) {
    this.s = s;
    this.bridge = bridge;
    this.ws = null;
    this.pending = new Map();
    this.version = '';
  }

  connect() {
    const s = this.s;
    const ws = new WebSocket(`ws://${s.host || '127.0.0.1'}:${Number(s.port) || 4455}`, 'obswebsocket.json', { handshakeTimeout: 4000 });
    this.ws = ws;
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.op === 0) {
        const d = { rpcVersion: 1, eventSubscriptions: 0 };
        if (msg.d && msg.d.authentication) {
          if (!s.password) return this.bridge._fail('OBS demande un mot de passe');
          d.authentication = obsAuthString(s.password, msg.d.authentication.salt, msg.d.authentication.challenge);
        }
        this.version = `websocket ${(msg.d && msg.d.obsWebSocketVersion) || ''}`.trim();
        ws.send(JSON.stringify({ op: 1, d }));
      } else if (msg.op === 2) {
        this.bridge._connected(this.version);
      } else if (msg.op === 7) {
        const p = this.pending.get(msg.d.requestId);
        if (!p) return;
        this.pending.delete(msg.d.requestId);
        clearTimeout(p.timer);
        if (msg.d.requestStatus && msg.d.requestStatus.result) p.resolve(msg.d.responseData || {});
        else p.reject(new Error((msg.d.requestStatus && msg.d.requestStatus.comment) || 'Requête OBS refusée'));
      }
    });
    ws.on('close', (code) => {
      this._rejectAll();
      this.bridge._closed(this, code === 4009 ? 'Mot de passe OBS incorrect' : 'OBS non joignable (serveur WebSocket activé ?)');
    });
    ws.on('error', () => {});
  }

  close() {
    this._rejectAll();
    if (!this.ws) return;
    this.ws.removeAllListeners();
    this.ws.on('error', () => {});
    try {
      this.ws.terminate();
    } catch {}
    this.ws = null;
  }

  _rejectAll() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Déconnecté d\'OBS'));
    }
    this.pending.clear();
  }

  request(requestType, requestData) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) return reject(new Error('OBS non connecté'));
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('OBS ne répond pas'));
      }, 5000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }

  async currentScene() {
    const r = await this.request('GetCurrentProgramScene');
    return r.currentProgramSceneName || r.sceneName;
  }

  setScene(name) {
    return this.request('SetCurrentProgramScene', { sceneName: name });
  }

  async setSourceVisible(scene, source, visible) {
    const { sceneItemId } = await this.request('GetSceneItemId', { sceneName: scene, sourceName: source });
    await this.request('SetSceneItemEnabled', { sceneName: scene, sceneItemId, sceneItemEnabled: visible });
  }

  async listScenes() {
    const { scenes = [], currentProgramSceneName } = await this.request('GetSceneList');
    const out = [];
    for (const sc of [...scenes].reverse()) {
      let sources = [];
      try {
        const r = await this.request('GetSceneItemList', { sceneName: sc.sceneName });
        sources = (r.sceneItems || []).map((i) => i.sourceName);
      } catch {}
      out.push({ name: sc.sceneName, sources });
    }
    return { current: currentProgramSceneName, scenes: out };
  }
}

// ---------------------------------------------------------------------------- Streamlabs Desktop
class StreamlabsDriver {
  constructor(s, bridge) {
    this.s = s;
    this.bridge = bridge;
    this.ws = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  connect() {
    const s = this.s;
    const ws = new WebSocket(`ws://${s.host || '127.0.0.1'}:${Number(s.slPort) || 59650}/api/websocket`, { handshakeTimeout: 4000 });
    this.ws = ws;
    ws.on('open', async () => {
      if (!s.slToken) return this.bridge._fail('Colle le jeton de Streamlabs (Paramètres > Contrôle à distance)');
      try {
        await this.call('auth', 'TcpServerService', [String(s.slToken).trim()]);
        this.bridge._connected('');
      } catch (e) {
        this.bridge._fail(/auth|token|jeton/i.test(e.message) ? 'Jeton Streamlabs refusé' : e.message);
      }
    });
    ws.on('message', (raw) => {
      // plusieurs réponses peuvent arriver dans un même message, séparées par des retours ligne
      for (const line of raw.toString().split('\n')) {
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const p = msg.id != null && this.pending.get(msg.id);
        if (!p) continue;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(String(msg.error.message || 'Erreur Streamlabs').replace('INTERNAL_JSON_RPC_ERROR ', '')));
        else p.resolve(msg.result);
      }
    });
    ws.on('close', () => {
      this._rejectAll();
      this.bridge._closed(this, 'Streamlabs non joignable (contrôle à distance activé ?)');
    });
    ws.on('error', () => {});
  }

  close() {
    this._rejectAll();
    if (!this.ws) return;
    this.ws.removeAllListeners();
    this.ws.on('error', () => {});
    try {
      this.ws.terminate();
    } catch {}
    this.ws = null;
  }

  _rejectAll() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Déconnecté de Streamlabs'));
    }
    this.pending.clear();
  }

  call(method, resource, args = []) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) return reject(new Error('Streamlabs non connecté'));
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Streamlabs ne répond pas'));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: { resource, args } })}\n`);
    });
  }

  async _scenes() {
    const list = await this.call('getScenes', 'ScenesService');
    return Array.isArray(list) ? list : [];
  }

  async _sceneByName(name) {
    const sc = (await this._scenes()).find((x) => x.name === name);
    if (!sc) throw new Error(`Scène « ${name} » introuvable dans Streamlabs`);
    return sc;
  }

  async currentScene() {
    let id = null;
    try {
      id = await this.call('activeSceneId', 'ScenesService');
    } catch {
      const sc = await this.call('activeScene', 'ScenesService');
      id = sc && sc.id;
    }
    const sc = (await this._scenes()).find((x) => x.id === id);
    return sc ? sc.name : null;
  }

  async setScene(name) {
    const sc = await this._sceneByName(name);
    await this.call('makeSceneActive', 'ScenesService', [sc.id]);
  }

  async setSourceVisible(scene, source, visible) {
    const sc = await this._sceneByName(scene);
    const items = await this.call('getItems', sc.resourceId || `Scene["${sc.id}"]`);
    const item = (items || []).find((i) => i.name === source);
    if (!item) throw new Error(`Source « ${source} » introuvable dans la scène « ${scene} »`);
    await this.call('setVisibility', item.resourceId || `SceneItem["${sc.id}","${item.sceneItemId}","${item.sourceId}"]`, [visible]);
  }

  async listScenes() {
    const scenes = await this._scenes();
    const out = [];
    for (const sc of scenes) {
      let sources = [];
      try {
        sources = ((await this.call('getItems', sc.resourceId || `Scene["${sc.id}"]`)) || []).map((i) => i.name);
      } catch {}
      out.push({ name: sc.name, sources });
    }
    let current = null;
    try {
      current = await this.currentScene();
    } catch {}
    return { current, scenes: out };
  }
}

// ---------------------------------------------------------------------------- pont commun
class StreamBridge extends EventEmitter {
  constructor(getSettings) {
    super();
    this.getSettings = getSettings;
    this.driver = null;
    this.state = 'off'; // off | connecting | connected | error
    this.error = '';
    this.version = '';
    this._retry = null;
    this._sig = '';
    this._timers = new Set();
  }

  get software() {
    return this.getSettings().obs.software === 'streamlabs' ? 'streamlabs' : 'obs';
  }

  get status() {
    return { state: this.state, error: this.error, software: this.software, name: SOFTWARE_NAMES[this.software], version: this.version };
  }

  _set(state, error = '') {
    this.state = state;
    this.error = error;
    this.emit('status', this.status);
  }

  // Au démarrage et à chaque changement de réglages
  apply() {
    const s = this.getSettings().obs;
    const sig = JSON.stringify([s.enabled, s.software, s.host, s.port, s.password, s.slPort, s.slToken]);
    if (sig === this._sig) return;
    this._sig = sig;
    this._disconnect();
    if (s.enabled) this._connect();
    else this._set('off');
  }

  stop() {
    this._sig = '';
    this._disconnect();
  }

  _connect() {
    const s = this.getSettings().obs;
    this._set('connecting');
    this.version = '';
    const Driver = this.software === 'streamlabs' ? StreamlabsDriver : ObsDriver;
    this.driver = new Driver({ ...s }, this);
    try {
      this.driver.connect();
    } catch (e) {
      this._fail(e.message);
    }
  }

  _disconnect() {
    clearTimeout(this._retry);
    this._retry = null;
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
    if (this.driver) this.driver.close();
    this.driver = null;
  }

  _connected(version) {
    this.version = version || '';
    this._set('connected');
  }

  // Erreur définitive tant que les réglages ne changent pas (mauvais mot de passe / jeton)
  _fail(msg) {
    if (this.driver) this.driver.close();
    this.driver = null;
    this._set('error', msg);
    this._scheduleRetry(15000);
  }

  _closed(driver, msg) {
    if (driver !== this.driver) return;
    this.driver = null;
    if (this.state !== 'error') this._set('error', msg);
    this._scheduleRetry(5000);
  }

  _scheduleRetry(ms) {
    clearTimeout(this._retry);
    if (!this.getSettings().obs.enabled) return;
    this._retry = setTimeout(() => this._connect(), ms);
  }

  _ready() {
    if (!this.driver || this.state !== 'connected') throw new Error(`${SOFTWARE_NAMES[this.software]} non connecté`);
    return this.driver;
  }

  async listScenes() {
    return this._ready().listScenes();
  }

  _later(fn, ms) {
    const t = setTimeout(() => {
      this._timers.delete(t);
      fn();
    }, ms);
    this._timers.add(t);
  }

  // Déclenche l'action configurée pour un événement (win, loss, overtime, ot_win, ot_loss, streak)
  async trigger(type) {
    const s = this.getSettings().obs;
    if (!s.enabled || this.state !== 'connected' || !this.driver) return false;
    let a = s.actions[type];
    // OT gagné / perdu sans action dédiée : on retombe sur victoire / défaite
    if ((!a || a.type === 'none') && (type === 'ot_win' || type === 'ot_loss')) a = s.actions[type === 'ot_win' ? 'win' : 'loss'];
    if (!a || a.type === 'none') return false;
    const d = this.driver;
    const dur = Math.max(0, Number(a.duration) || 0) * 1000;
    try {
      if (a.type === 'scene' && a.scene) {
        const prev = await d.currentScene();
        if (prev === a.scene) return true;
        await d.setScene(a.scene);
        if (a.returnBack && dur > 0 && prev) this._later(() => d.setScene(prev).catch(() => {}), dur);
        return true;
      }
      if (a.type === 'source' && a.scene && a.source) {
        await d.setSourceVisible(a.scene, a.source, true);
        if (dur > 0) this._later(() => d.setSourceVisible(a.scene, a.source, false).catch(() => {}), dur);
        return true;
      }
    } catch (e) {
      this.emit('log', `${SOFTWARE_NAMES[this.software]} : ${e.message}`);
    }
    return false;
  }
}

module.exports = { StreamBridge, ObsDriver, StreamlabsDriver, obsAuthString };
