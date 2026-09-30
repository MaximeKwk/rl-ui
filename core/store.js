'use strict';
// Persistance : réglages + sessions + historique des parties (un seul fichier JSON, écriture atomique).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALERT_TYPES = ['win', 'loss', 'overtime', 'ot_win', 'ot_loss', 'streak'];

// Anciennes valeurs par défaut (en français) : remplacées par "vide" pour suivre la langue choisie
const OLD_DEFAULTS = {
  texts: { win: 'VICTOIRE', loss: 'DÉFAITE', overtime: 'OVERTIME', ot_win: 'VICTOIRE EN OVERTIME', ot_loss: 'DÉFAITE EN OVERTIME', streak: 'SÉRIE DE {n}' },
  template: '{w}{lw} - {l}{ll} · {wr}% · Série {streak}',
};

function migrateDefaults(s) {
  if (!['en', 'fr'].includes(s.language)) s.language = 'en';
  for (const [k, v] of Object.entries(OLD_DEFAULTS.texts)) if (s.alerts.texts[k] === v) s.alerts.texts[k] = '';
  if (s.overlay.labelWin === 'V') s.overlay.labelWin = '';
  if (s.overlay.labelLoss === 'D') s.overlay.labelLoss = '';
  if (s.text.template === OLD_DEFAULTS.template) s.text.template = '';
}

function defaultSettings() {
  const obsAction = (type = 'none') => ({ type, scene: '', source: '', duration: 8, returnBack: true });
  return {
    language: 'en', // en | fr
    port: 5757,
    lanAccess: false,
    apiKey: crypto.randomBytes(9).toString('base64url'),
    paused: false,
    stats: { transport: 'auto', host: '127.0.0.1', tcpPort: 0, webPort: 0 }, // 0 = lu dans l'ini du jeu
    identity: { names: [], knownIds: [], useCameraTarget: true },
    counting: { ranked: true, casual: true, extra: true, tournament: true, private: false, offline: false, unknown: true },
    abandonAsLoss: 'ranked', // always | ranked | never
    session: { autoResetHours: 6 },
    mmr: { enabled: true, includeCasual: false, defaultDelta: 12, showInAlerts: true },
    overlay: {
      theme: 'arena', // arena | minimal | broadcast
      themePack: 'classique', // thème (DA) : intégré ou perso
      themeColors: true, // utiliser les couleurs du thème
      layout: 'horizontal', // horizontal | vertical | boost (collé à la jauge de boost du jeu)
      boostScale: 1, // calibrage de la disposition "boost" (taille du HUD du jeu)
      boostX: 0,
      boostY: 0,
      boostTeamColor: true,
      boostGuide: false,
      labelWin: '', // vide = W / V selon la langue
      labelLoss: '', // vide = L / D selon la langue
      showWinrate: true,
      showStreak: true,
      showOt: true,
      showPlaylist: false,
      showOtBadge: true,
      showMmr: true,
      mmrMode: 'session', // session (+45) | value (1175) | both
      winColor: '#2ef2a0',
      lossColor: '#ff4d6d',
      otColor: '#ffb020',
      scale: 1,
    },
    alerts: {
      enabled: { win: true, loss: true, overtime: true, ot_win: true, ot_loss: true, streak: true },
      texts: {
        // vide = texte par défaut dans la langue choisie
        win: '',
        loss: '',
        overtime: '',
        ot_win: '',
        ot_loss: '',
        streak: '',
      },
      duration: { win: 5, loss: 4, overtime: 4, ot_win: 7, ot_loss: 4.5, streak: 4 },
      streakMilestones: [3, 5, 10, 15, 20],
      alertOnAbandon: false,
      sound: true,
      volume: 0.7,
      customSounds: {}, // type -> nom de fichier dans /sounds
      position: 'center', // center | top | bottom
      scale: 1,
    },
    text: { enabled: true, dir: '', template: '' }, // vide = format par défaut selon la langue
    obs: {
      enabled: false,
      software: 'obs', // obs | streamlabs
      host: '127.0.0.1',
      port: 4455,
      password: '',
      slPort: 59650,
      slToken: '',
      actions: Object.fromEntries(ALERT_TYPES.map((t) => [t, obsAction()])),
    },
    hotkeys: {
      enabled: true,
      win: 'Ctrl+Alt+Shift+Up',
      loss: 'Ctrl+Alt+Shift+Down',
      undo: 'Ctrl+Alt+Shift+Backspace',
    },
    app: { minimizeToTray: true, startWithWindows: false, startMinimized: false, trayHintShown: false, autoUpdate: true, onboarded: false },
    // Commandes du chat Twitch (texte vide = réponse par défaut dans la langue choisie)
    chat: {
      enabled: true,
      channel: '', // vide = la chaîne du compte connecté
      cooldown: 10, // secondes entre deux utilisations d'une même commande
      commands: [
        { name: 'wl', aliases: 'record, score', enabled: true, text: '' },
        { name: 'mmr', aliases: 'elo', enabled: true, text: '' },
        { name: 'last', aliases: 'lastgame', enabled: true, text: '' },
        { name: 'streak', aliases: '', enabled: true, text: '' },
        { name: 'ot', aliases: 'overtime', enabled: false, text: '' },
      ],
    },
    // Mode caster : noms d'équipe (vide = nom du jeu), série (BO), options d'affichage de l'overlay
    caster: {
      title: '',
      names: ['', ''],
      bestOf: 5, // 1 | 3 | 5 | 7
      wins: [0, 0],
      autoSeries: true, // +1 à l'équipe gagnante à la fin de chaque partie observée
      showSeries: true,
      showBoosts: true,
      showTarget: true,
      showGoals: true,
      showFeed: true,
      showPostgame: true,
      speedUnit: 'kmh', // kmh | mph
    },
  };
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// Fusion profonde : les clés inconnues de `src` sont ignorées si `strict` (pour les patchs venant de l'UI).
function deepMerge(target, src, strict = false) {
  if (!isPlainObject(src)) return target;
  for (const [k, v] of Object.entries(src)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (strict && !(k in target)) continue;
    if (isPlainObject(v) && isPlainObject(target[k])) {
      // les maps libres (customSounds, actions) acceptent de nouvelles clés
      deepMerge(target[k], v, strict && k !== 'customSounds');
    } else if (
      !strict ||
      target[k] == null ||
      (Array.isArray(target[k]) ? Array.isArray(v) : typeof v === typeof target[k])
    ) {
      target[k] = v;
    }
  }
  return target;
}

class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'data.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.data = this._load();
    this._timer = null;
  }

  _load() {
    const base = { version: 1, settings: defaultSettings(), sessions: [], currentSessionId: null, matches: [] };
    for (const f of [this.file, this.file + '.bak']) {
      try {
        // (un fichier retouché à la main peut commencer par un BOM UTF-8)
        const raw = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
        const data = { ...base, ...raw };
        data.settings = deepMerge(defaultSettings(), raw.settings || {});
        migrateDefaults(data.settings);
        if (!Array.isArray(data.matches)) data.matches = [];
        if (!Array.isArray(data.sessions)) data.sessions = [];
        if (!data.currentSessionId) this._newSession(data);
        return data;
      } catch (e) {
        if (e.code !== 'ENOENT') console.warn('[store] lecture impossible', f, e.message);
      }
    }
    this._newSession(base);
    return base;
  }

  _newSession(data) {
    const s = { id: crypto.randomUUID(), startedAt: Date.now() };
    data.sessions.push(s);
    data.currentSessionId = s.id;
    return s;
  }

  get settings() {
    return this.data.settings;
  }

  save(immediate = false) {
    clearTimeout(this._timer);
    if (immediate) return this._write();
    this._timer = setTimeout(() => this._write(), 250);
  }

  _write() {
    clearTimeout(this._timer);
    this._timer = null;
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      if (fs.existsSync(this.file)) {
        try {
          fs.copyFileSync(this.file, this.file + '.bak');
        } catch {}
      }
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] écriture impossible', e.message);
    }
  }

  flush() {
    if (this._timer) this._write();
  }

  // ---- réglages
  patchSettings(patch) {
    deepMerge(this.data.settings, patch, true);
    this.save();
    return this.data.settings;
  }

  // ---- sessions
  get session() {
    return this.data.sessions.find((s) => s.id === this.data.currentSessionId) || this._newSession(this.data);
  }

  newSession() {
    const s = this._newSession(this.data);
    // on ne garde que les 200 dernières sessions (les parties restent dans l'historique)
    if (this.data.sessions.length > 200) this.data.sessions.splice(0, this.data.sessions.length - 200);
    this.save();
    return s;
  }

  sessionMatches(sessionId = this.data.currentSessionId) {
    return this.data.matches.filter((m) => m.sessionId === sessionId);
  }

  lastActivity() {
    const ms = this.sessionMatches();
    return ms.length ? ms[ms.length - 1].endedAt : this.session.startedAt;
  }

  // Démarre une nouvelle session si la dernière activité est trop ancienne.
  autoResetIfIdle(now = Date.now()) {
    const h = Number(this.settings.session.autoResetHours) || 0;
    if (h <= 0) return false;
    const idle = now - this.lastActivity();
    if (this.sessionMatches().length && idle > h * 3600e3) {
      this.newSession();
      return true;
    }
    return false;
  }

  // ---- parties
  hasMatch(id) {
    return !!id && this.data.matches.some((m) => m.id === id);
  }

  getMatch(id) {
    const ms = this.data.matches;
    for (let i = ms.length - 1; i >= 0; i--) if (ms[i].id === id) return ms[i];
    return null;
  }

  addMatch(record) {
    record.sessionId = this.data.currentSessionId;
    this.data.matches.push(record);
    if (this.data.matches.length > 20000) this.data.matches.splice(0, this.data.matches.length - 20000);
    this.save();
    return record;
  }

  removeMatch(id) {
    const i = this.data.matches.findIndex((m) => m.id === id);
    if (i < 0) return null;
    const [r] = this.data.matches.splice(i, 1);
    this.save();
    return r;
  }

  // Retire la dernière partie de la session (optionnellement d'un résultat donné)
  removeLast(result = null) {
    const sid = this.data.currentSessionId;
    for (let i = this.data.matches.length - 1; i >= 0; i--) {
      const m = this.data.matches[i];
      if (m.sessionId !== sid) continue;
      if (result && m.result !== result) continue;
      this.data.matches.splice(i, 1);
      this.save();
      return m;
    }
    return null;
  }

  learnId(id) {
    if (!id || /^unknown\|/i.test(id)) return false;
    const ids = this.settings.identity.knownIds;
    if (ids.includes(id)) return false;
    ids.push(id);
    this.save();
    return true;
  }
}

module.exports = { Store, defaultSettings, deepMerge, ALERT_TYPES };
