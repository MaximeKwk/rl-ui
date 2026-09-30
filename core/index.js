'use strict';
// Cœur de l'application (sans Electron) : relie la Stats API, le log du jeu, le tracker,
// le stockage, le serveur des overlays, OBS et les fichiers texte.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const { Store, ALERT_TYPES } = require('./store');
const { Tracker } = require('./tracker');
const { StatsApiClient } = require('./statsApiClient');
const { RlLogWatcher } = require('./rlLogWatcher');
const rlConfig = require('./rlConfig');
const { computeStats, statsByPlaylist } = require('./stats');
const { TextExporter, renderTemplate, templateVars } = require('./textExport');
const { StreamBridge } = require('./streamBridge');
const { AppServer } = require('./server');
const { MmrTracker } = require('./mmr');
const { CATEGORY_LABELS, describePlaylist } = require('./playlists');

const SOUND_EXT = new Set(['mp3', 'wav', 'ogg', 'm4a']);

class Core extends EventEmitter {
  constructor({ dataDir, documentsDir, webDir, logPath, version = '1.0.0', hooks = {} }) {
    super();
    this.dataDir = dataDir;
    this.documentsDir = documentsDir;
    this.version = version;
    this.hooks = hooks;
    this.store = new Store(dataDir);
    this.soundsDir = path.join(dataDir, 'sounds');
    this.logWatcher = new RlLogWatcher({ documentsDir, logPath });
    this.tracker = new Tracker({ store: this.store, logWatcher: this.logWatcher });
    this.mmr = new MmrTracker(this.store);
    this.stats = new StatsApiClient(this._statsOpts({ effective: rlConfig.DEFAULTS }));
    this.text = new TextExporter(path.join(dataDir, 'texte'));
    this.obs = new StreamBridge(() => this.store.settings);
    this.server = new AppServer({ core: this, webDir });
    this.logs = [];
    this.rlConfig = null;
    this.rlRunning = false;
    this.hotkeyErrors = [];
    this._stats = null;
    this._changeTimer = null;
    this._wire();
  }

  // ---------------------------------------------------------------- démarrage / arrêt
  async start() {
    this.store.autoResetIfIdle();
    await this.refreshRlConfig().catch((e) => this.log(`Config Rocket League illisible : ${e.message}`, 'warn'));
    await this._backfillMmr();
    this.stats.start();
    this.logWatcher.start();
    this.obs.apply();
    const port = await this.server.start();
    if (port !== this.store.settings.port) {
      this.log(`Port ${this.store.settings.port} occupé : overlays servis sur le port ${port} (mets à jour les URL dans OBS)`, 'warn');
    }
    this._checkRunning();
    this._rlTimer = setInterval(() => this._checkRunning(), 5000);
    this._writeText();
    this.log(`BoostSide prêt — http://127.0.0.1:${port}`);
    return port;
  }

  async stop() {
    clearInterval(this._rlTimer);
    this.stats.stop();
    this.logWatcher.stop();
    this.obs.stop();
    await this.server.stop();
    this.store.flush();
  }

  _statsOpts(cfg) {
    const s = this.store.settings.stats;
    const eff = (cfg && cfg.effective) || rlConfig.DEFAULTS;
    return {
      host: s.host || '127.0.0.1',
      tcpPort: Number(s.tcpPort) > 0 ? Number(s.tcpPort) : eff.Port,
      webPort: Number(s.webPort) > 0 ? Number(s.webPort) : eff.WebPort,
      transport: s.transport || 'auto',
    };
  }

  // MMR des sessions de jeu précédentes : ton MMR est connu dès le lancement de l'app
  async _backfillMmr() {
    if (!this.store.settings.mmr.enabled) return;
    try {
      this._backfilling = true;
      const samples = await this.logWatcher.scanBackups({ maxFiles: 12, newerThan: this.mmr.lastSampleAt() - 60e3 });
      let n = 0;
      for (const s of samples) if (this.mmr.onSample(s)) n++;
      if (n) this.log(`MMR : ${n} valeur${n > 1 ? 's' : ''} retrouvée${n > 1 ? 's' : ''} dans les journaux du jeu`);
    } catch (e) {
      this.log(`Lecture des anciens journaux impossible : ${e.message}`, 'warn');
    } finally {
      this._backfilling = false;
    }
  }

  async refreshRlConfig() {
    this.rlConfig = await rlConfig.getStatsConfig(this.documentsDir);
    this.stats.configure(this._statsOpts(this.rlConfig));
    this._changed();
    return this.rlConfig;
  }

  async _checkRunning() {
    const running = await rlConfig.isRocketLeagueRunning().catch(() => false);
    if (running !== this.rlRunning) {
      this.rlRunning = running;
      this.log(running ? 'Rocket League est lancé' : 'Rocket League est fermé');
      this._changed();
    }
  }

  // ---------------------------------------------------------------- événements
  _wire() {
    this.stats.on('message', (env) => this.tracker.handle(env.event, env.data));
    this.stats.on('connected', (kind) => this.log(`Connecté à la Stats API (${kind === 'tcp' ? 'TCP' : 'WebSocket'})`));
    this.stats.on('disconnected', () => {
      this.log('Stats API déconnectée');
      this.tracker.onDisconnected();
    });
    this.stats.on('status', () => this._changed());

    this.logWatcher.on('account', (a) => {
      this.log(`Compte détecté : ${a.name} (${a.platform})`);
      this.store.learnId(a.id);
      this._changed();
    });
    this.logWatcher.on('playlist', () => this._changed());
    this.logWatcher.on('change', () => this._changed());
    this.logWatcher.on('mmr', (s) => {
      if (this.store.settings.mmr.enabled) this.mmr.onSample(s);
    });

    this.mmr.on('update', (u) => {
      if (!this._backfilling && u.delta != null && Math.abs(u.delta) >= 0.05) {
        const d = Math.round(u.delta);
        const n = u.assigned.length;
        this.log(`MMR ${describePlaylist(u.playlist).name} : ${Math.round(u.mmr)} (${d > 0 ? '+' : ''}${d}${n > 1 ? ` sur ${n} parties` : ''})`);
      }
      this._statsChanged();
    });
    this.mmr.on('log', (m) => this.log(m));

    this.tracker.on('live', () => this._changed());
    this.tracker.on('log', (m) => this.log(m));
    this.tracker.on('identity', (i) => {
      const via = { account: 'compte du jeu', known: 'compte mémorisé', name: 'pseudo', camera: 'caméra', manual: 'choix manuel' }[i.via] || i.via;
      this.log(`Tu joues : ${i.name} (identifié via ${via})`);
    });
    this.tracker.on('session', () => {
      this.log('Nouvelle session démarrée automatiquement (inactivité)');
      this._statsChanged();
    });
    this.tracker.on('overtime', (info) => {
      this.log('OVERTIME !');
      this._alert('overtime', { ...info, playlist: info.playlist.name });
      this.obs.trigger('overtime');
    });
    this.tracker.on('result', (r) => this._onResult(r));
    this.tracker.on('record-updated', () => this._statsChanged());

    this.obs.on('status', () => this._changed());
    this.obs.on('log', (m) => this.log(m, 'warn'));
  }

  _onResult(r) {
    // estimation immédiate de la variation de MMR (remplacée par la vraie valeur à la prochaine file)
    if (this.store.settings.mmr.enabled && this.mmr.onMatch(r)) this.store.save();
    this._statsChanged();
    const st = this.sessionStats();
    const label = r.result === 'W' ? 'Victoire' : 'Défaite';
    const mmrTxt = r.mmr ? ` · MMR ≈ ${r.mmr.delta > 0 ? '+' : ''}${Math.round(r.mmr.delta)}` : '';
    this.log(
      `${label}${r.overtime ? ' en overtime' : ''}${r.abandon ? ' (abandon)' : ''} ${r.scoreFor}-${r.scoreAgainst} · ${r.playlistName} → session ${st.wins}V - ${st.losses}D${mmrTxt}`,
      r.result === 'W' ? 'win' : 'loss'
    );
    const type = r.result === 'W' ? (r.overtime ? 'ot_win' : 'win') : r.overtime ? 'ot_loss' : 'loss';
    if (!r.abandon || this.store.settings.alerts.alertOnAbandon) {
      this._alert(type, this._alertData(r, st));
      this.obs.trigger(type);
    }
    if (r.result === 'W' && this.store.settings.alerts.streakMilestones.includes(st.streak)) {
      this._alert('streak', { ...this._alertData(r, st), n: st.streak });
      this.obs.trigger('streak');
    }
  }

  _alertData(r, st) {
    return {
      result: r.result,
      scoreFor: r.scoreFor,
      scoreAgainst: r.scoreAgainst,
      overtime: !!r.overtime,
      otSeconds: r.otSeconds || 0,
      abandon: !!r.abandon,
      mvp: !!r.mvp,
      playlist: r.playlistName || '',
      manual: !!r.manual,
      streak: st.streak,
      wins: st.wins,
      losses: st.losses,
      winRate: st.winRate,
      n: st.streak,
      mmr:
        r.mmr && this.store.settings.mmr.showInAlerts
          ? { delta: r.mmr.delta, after: r.mmr.after, learned: !!r.mmr.learned, status: r.mmr.status }
          : null,
    };
  }

  _alert(type, data = {}) {
    const a = this.store.settings.alerts;
    if (!a.enabled[type]) return null;
    const alert = {
      id: crypto.randomUUID(),
      type,
      at: Date.now(),
      title: renderTemplate(a.texts[type] || type, { n: data.n ?? data.streak ?? '' }),
      duration: Number(a.duration[type]) || 4,
      data,
      test: !!data.test,
    };
    this.server.broadcast({ type: 'alert', alert });
    this.emit('alert', alert);
    return alert;
  }

  log(msg, level = 'info') {
    this.logs.push({ at: Date.now(), msg, level });
    if (this.logs.length > 200) this.logs.splice(0, this.logs.length - 200);
    if (process.env.BOOSTSIDE_DEBUG) console.log(`[${level}] ${msg}`);
    this._changed();
  }

  _statsChanged() {
    this._stats = null;
    this._writeText();
    this._changed();
  }

  _changed() {
    if (this._changeTimer) return;
    this._changeTimer = setTimeout(() => {
      this._changeTimer = null;
      this.emit('changed');
      if (!this.server.server) return;
      this.server.broadcast({ type: 'state', state: this.publicState() });
      this.server.broadcast({ type: 'dashboard', data: this.dashboardState() }, { dashboardOnly: true });
    }, 120);
  }

  _writeText() {
    const ms = this.store.sessionMatches();
    this.text.write(this.sessionStats(), this.store.settings, ms[ms.length - 1], this.mmrSummary());
  }

  // ---------------------------------------------------------------- état
  sessionStats() {
    if (!this._stats) this._stats = computeStats(this.store.sessionMatches());
    return this._stats;
  }

  _rlState() {
    const api = this.stats.status.state;
    if (api === 'live') return 'live';
    if (this.rlRunning || api === 'waiting') return 'running';
    return 'closed';
  }

  // MMR de la session : mode principal (partie en cours ou dernier joué) + détail par mode
  mmrSummary(live = this.tracker.live()) {
    if (!this.store.settings.mmr.enabled) return null;
    let liveKey = null;
    if (live.inMatch && live.me && live.playlist && live.playlist.id != null && this.mmr.tracks(live.playlist.id)) {
      liveKey = this.mmr.key(live.me.key, live.playlist.id);
    }
    const acc = this.logWatcher.account && this.logWatcher.account.id;
    return this.mmr.summary(this.store.sessionMatches(), { liveKey, accountId: acc });
  }

  publicState() {
    const live = this.tracker.live();
    const s = this.store.settings;
    const strip = (e) => e && { playlist: e.playlist, name: e.name, short: e.short, current: e.current, delta: e.delta, games: e.games, approx: e.approx };
    const mmr = this.mmrSummary(live);
    return {
      app: { name: 'BoostSide', version: this.version },
      session: {
        id: this.store.session.id,
        startedAt: this.store.session.startedAt,
        ...this.sessionStats(),
        mmr: mmr ? { primary: strip(mmr.primary), list: mmr.list.map(strip) } : null,
      },
      live: {
        ...live,
        players: (live.players || []).map(({ key, ...p }) => p),
        me: live.me ? { name: live.me.name, team: live.me.team } : null,
      },
      status: { rl: this._rlState(), paused: !!s.paused, account: this.logWatcher.account ? this.logWatcher.account.name : null },
    };
  }

  overlayConfig() {
    const s = this.store.settings;
    const custom = {};
    for (const t of ALERT_TYPES) custom[t] = !!this.soundFile(t);
    return {
      overlay: s.overlay,
      alerts: {
        enabled: s.alerts.enabled,
        texts: s.alerts.texts,
        duration: s.alerts.duration,
        sound: s.alerts.sound,
        volume: s.alerts.volume,
        position: s.alerts.position,
        scale: s.alerts.scale,
        customSounds: custom,
      },
    };
  }

  dashboardState() {
    const s = this.store.settings;
    const all = this.store.data.matches;
    const allStats = computeStats(all);
    delete allStats.last;
    return {
      version: this.version,
      settings: s,
      port: this.server.port,
      lanAddresses: this.server.lan ? this.server.lanAddresses() : [],
      dataDir: this.dataDir,
      textDir: this.text.dir(s),
      sessionMatches: this.store.sessionMatches().slice(-100).reverse(),
      allTime: { ...allStats, byPlaylist: statsByPlaylist(all), sessions: this.store.data.sessions.length },
      live: this.tracker.live(),
      status: {
        rl: this._rlState(),
        rlRunning: this.rlRunning,
        api: this.stats.status,
        account: this.logWatcher.account,
        logFound: this.logWatcher.exists,
        playlist: this.logWatcher.playlist,
        rlConfig: this.rlConfig,
        obs: this.obs.status,
        overlays: this.server.overlayClients(),
      },
      categories: CATEGORY_LABELS,
      logs: this.logs.slice(-80),
      hotkeyErrors: this.hotkeyErrors,
      mmr: {
        summary: this.mmrSummary(),
        known: this.mmr.known(this.logWatcher.account && this.logWatcher.account.id),
      },
    };
  }

  history(scope, limit) {
    const list = scope === 'all' ? this.store.data.matches : this.store.sessionMatches();
    return { scope, total: list.length, matches: list.slice(-limit).reverse() };
  }

  textValue(field) {
    const st = this.sessionStats();
    const v = templateVars(st, this.store.settings, this.mmrSummary());
    const map = {
      mmr: v.mmr,
      mmrsession: v.mmrd,
      record: `${v.w} - ${v.l}`,
      wins: String(v.w),
      losses: String(v.l),
      winrate: `${v.wr}%`,
      streak: v.streak,
      ot: `${v.otw} - ${v.otl}`,
      summary: renderTemplate(this.store.settings.text.template, v),
      played: String(v.played),
    };
    return field in map ? map[field] : null;
  }

  // ---------------------------------------------------------------- actions
  async action(name, params = {}) {
    const alert = params.alert === '1' || params.alert === true || params.alert === 'true';
    switch (name) {
      case 'win':
      case 'loss': {
        this.store.autoResetIfIdle();
        const now = Date.now();
        const r = this.store.addMatch({
          id: `manual-${crypto.randomUUID()}`,
          startedAt: now,
          endedAt: now,
          result: name === 'win' ? 'W' : 'L',
          overtime: params.ot === '1' || params.ot === true,
          manual: true,
          playlistName: 'Ajout manuel',
          category: 'manual',
        });
        this._statsChanged();
        this.log(`${name === 'win' ? 'Victoire' : 'Défaite'} ajoutée manuellement`);
        if (alert) {
          const st = this.sessionStats();
          const type = name === 'win' ? (r.overtime ? 'ot_win' : 'win') : r.overtime ? 'ot_loss' : 'loss';
          this._alert(type, this._alertData(r, st));
          this.obs.trigger(type);
        }
        return { ok: true };
      }
      case 'remove-win':
      case 'remove-loss': {
        const r = this.store.removeLast(name === 'remove-win' ? 'W' : 'L');
        if (r) this.mmr.forget(r.id);
        this._statsChanged();
        if (r) this.log(`${r.result === 'W' ? 'Victoire' : 'Défaite'} retirée`);
        return { ok: !!r };
      }
      case 'undo': {
        const r = this.store.removeLast();
        if (r) this.mmr.forget(r.id);
        this._statsChanged();
        if (r) this.log(`Dernière partie annulée (${r.result === 'W' ? 'victoire' : 'défaite'})`);
        return { ok: !!r };
      }
      case 'new-session':
      case 'reset':
        this.store.newSession();
        this._statsChanged();
        this.log('Nouvelle session');
        return { ok: true };
      case 'pause':
      case 'resume':
      case 'toggle-pause': {
        const paused = name === 'toggle-pause' ? !this.store.settings.paused : name === 'pause';
        this.store.patchSettings({ paused });
        this.log(paused ? 'Tracker en pause' : 'Tracker réactivé');
        this._changed();
        return { ok: true, paused };
      }
      case 'test': {
        const type = ALERT_TYPES.includes(params.type) ? params.type : 'win';
        const st = this.sessionStats();
        const fake = {
          result: type.includes('loss') ? 'L' : 'W',
          scoreFor: type.includes('loss') ? 1 : 3,
          scoreAgainst: 2,
          overtime: type.startsWith('ot') || type === 'overtime',
          otSeconds: 42,
          mvp: type === 'win' || type === 'ot_win',
          playlist: '2v2 Classé',
          streak: type.includes('loss') ? -1 : Math.max(2, st.streak + 1),
          wins: st.wins,
          losses: st.losses,
          winRate: st.winRate,
          n: Number(params.n) || 5,
          mmr: this.store.settings.mmr.enabled && this.store.settings.mmr.showInAlerts && type !== 'overtime' && type !== 'streak'
            ? { delta: type.includes('loss') ? -11 : 12, learned: true, status: 'estimated' }
            : null,
          test: true,
        };
        const a = this._alert(type, fake);
        if (params.obs === '1' || params.obs === true) await this.obs.trigger(type);
        return { ok: !!a, disabled: !a };
      }
      default:
        return { ok: false, error: `Action inconnue : ${name}` };
    }
  }

  setIdentity(key) {
    const ok = this.tracker.setIdentity(String(key || ''));
    this._changed();
    return ok;
  }

  forgetId(id) {
    const ids = this.store.settings.identity.knownIds;
    const i = ids.indexOf(id);
    if (i < 0) return false;
    ids.splice(i, 1);
    this.store.save();
    this._changed();
    return true;
  }

  deleteMatch(id) {
    const r = this.store.removeMatch(id);
    if (r) {
      this.mmr.forget(r.id);
      this._statsChanged();
      this.log('Partie supprimée de l\'historique');
    }
    return !!r;
  }

  async patchSettings(patch) {
    const before = JSON.stringify(this.store.settings);
    const prev = JSON.parse(before);
    const s = this.store.patchSettings(patch || {});
    if (JSON.stringify(s) === before) return s;
    if (JSON.stringify(prev.stats) !== JSON.stringify(s.stats)) this.stats.configure(this._statsOpts(this.rlConfig));
    if (JSON.stringify(prev.obs) !== JSON.stringify(s.obs)) this.obs.apply();
    if (JSON.stringify(prev.mmr) !== JSON.stringify(s.mmr)) {
      this.mmr._learn = null;
      this._statsChanged();
    }
    if (JSON.stringify(prev.overlay) !== JSON.stringify(s.overlay) || JSON.stringify(prev.alerts) !== JSON.stringify(s.alerts)) {
      this.server.broadcast({ type: 'config', config: this.overlayConfig() });
    }
    if (JSON.stringify(prev.text) !== JSON.stringify(s.text) || JSON.stringify(prev.overlay) !== JSON.stringify(s.overlay)) {
      this.text.cache.clear();
      this._writeText();
    }
    if (JSON.stringify(prev.counting) !== JSON.stringify(s.counting) || prev.paused !== s.paused) this.tracker._touch();
    if (prev.port !== s.port || prev.lanAccess !== s.lanAccess) {
      // on laisse le temps à la réponse HTTP de partir avant de redémarrer le serveur
      setTimeout(async () => {
        try {
          const port = await this.server.restart();
          this.log(`Serveur redémarré sur le port ${port}${s.lanAccess ? ' (accessible sur le réseau local)' : ''}`);
          if (this.hooks.onServerRestarted) this.hooks.onServerRestarted(port);
        } catch (e) {
          this.log(`Impossible de redémarrer le serveur : ${e.message}`, 'error');
        }
      }, 300);
    }
    if (this.hooks.onSettingsChanged) this.hooks.onSettingsChanged(s, prev);
    this._changed();
    return s;
  }

  async enableStatsApi(elevated = false) {
    try {
      if (elevated) {
        await rlConfig.enableStatsApiElevated(this.documentsDir);
        await this.refreshRlConfig();
        this.log('Stats API activée (administrateur). Redémarre Rocket League.');
        return { ok: true, config: this.rlConfig };
      }
      const r = await rlConfig.enableStatsApi(this.documentsDir);
      await this.refreshRlConfig();
      const failed = r.results.filter((x) => !x.ok);
      if (failed.length) this.log(`Écriture impossible : ${failed.map((f) => f.file).join(', ')}`, 'warn');
      else this.log('Stats API activée. Redémarre Rocket League pour l\'appliquer.');
      return { ok: failed.length === 0, needsAdmin: failed.some((f) => f.needsAdmin), results: r.results, config: this.rlConfig };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async obsScenes() {
    try {
      return { ok: true, ...(await this.obs.listScenes()) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ---------------------------------------------------------------- sons personnalisés
  soundFile(type) {
    const name = this.store.settings.alerts.customSounds[type];
    if (!name || !ALERT_TYPES.includes(type)) return null;
    const f = path.join(this.soundsDir, path.basename(name));
    return fs.existsSync(f) ? f : null;
  }

  saveSound(type, buf, ext) {
    ext = String(ext || '').toLowerCase().replace('.', '');
    if (!ALERT_TYPES.includes(type)) return { ok: false, error: 'Type inconnu' };
    if (!SOUND_EXT.has(ext)) return { ok: false, error: 'Format accepté : mp3, wav, ogg, m4a' };
    if (!buf || !buf.length) return { ok: false, error: 'Fichier vide' };
    fs.mkdirSync(this.soundsDir, { recursive: true });
    for (const e of SOUND_EXT) {
      try {
        fs.unlinkSync(path.join(this.soundsDir, `${type}.${e}`));
      } catch {}
    }
    fs.writeFileSync(path.join(this.soundsDir, `${type}.${ext}`), buf);
    this.store.settings.alerts.customSounds[type] = `${type}.${ext}`;
    this.store.save();
    this.server.broadcast({ type: 'config', config: this.overlayConfig() });
    this._changed();
    return { ok: true };
  }

  deleteSound(type) {
    const f = this.soundFile(type);
    if (f) {
      try {
        fs.unlinkSync(f);
      } catch {}
    }
    delete this.store.settings.alerts.customSounds[type];
    this.store.save();
    this.server.broadcast({ type: 'config', config: this.overlayConfig() });
    this._changed();
    return { ok: true };
  }

  async open(target, url) {
    const s = this.store.settings;
    const dirs = {
      text: this.text.dir(s),
      data: this.dataDir,
      rlconfig: rlConfig.userConfigDir(this.documentsDir),
    };
    if (target in dirs) {
      fs.mkdirSync(dirs[target], { recursive: true });
      if (this.hooks.openPath) return !!(await this.hooks.openPath(dirs[target]));
      return false;
    }
    if (target === 'url' && typeof url === 'string') {
      const ok = /^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(url) || /^https:\/\/(obsproject\.com|www\.rocketleague\.com)\//.test(url);
      if (ok && this.hooks.openExternal) {
        await this.hooks.openExternal(url);
        return true;
      }
    }
    return false;
  }
}

module.exports = { Core };
