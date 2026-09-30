'use strict';
// Mises à jour : les releases GitHub (dépôt public MaximeKwk/rl-ui).
// - version installée : téléchargement en arrière-plan puis « Redémarrer pour installer »
// - version portable : on signale seulement la nouvelle version (lien de téléchargement)
// - version Microsoft Store : c'est le Store qui met à jour, on ne fait rien

const https = require('https');

const REPO = 'MaximeKwk/rl-ui';
const RELEASES = `https://github.com/${REPO}/releases/latest`;
const EVERY_MS = 4 * 60 * 60 * 1000;

function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function latestTag() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { 'User-Agent': 'RL-UI', Accept: 'application/vnd.github+json' }, timeout: 15000 },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
            resolve(JSON.parse(b).tag_name);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

class Updater {
  constructor({ app, version, onStatus, isEnabled }) {
    this.app = app;
    this.version = version;
    this.onStatus = onStatus;
    this.isEnabled = isEnabled;
    this.status = { state: 'idle', mode: this.mode() };
    this.auto = null;
    this._timer = null;
  }

  // installed | portable | store | dev
  mode() {
    if (!this.app.isPackaged) return 'dev';
    if (process.windowsStore) return 'store';
    if (process.env.PORTABLE_EXECUTABLE_DIR) return 'portable';
    return 'installed';
  }

  _set(patch) {
    this.status = { ...this.status, ...patch, mode: this.mode(), current: this.version };
    this.onStatus(this.status);
  }

  start() {
    const mode = this.mode();
    this._set({ state: 'idle' });
    if (mode === 'store' || mode === 'dev') return;
    if (mode === 'installed') {
      const { autoUpdater } = require('electron-updater');
      this.auto = autoUpdater;
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.logger = null;
      autoUpdater.on('checking-for-update', () => this._set({ state: 'checking' }));
      autoUpdater.on('update-not-available', () => this._set({ state: 'none', checkedAt: Date.now() }));
      autoUpdater.on('update-available', (i) => this._set({ state: 'downloading', version: i.version, percent: 0 }));
      autoUpdater.on('download-progress', (p) => this._set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
      autoUpdater.on('update-downloaded', (i) => this._set({ state: 'ready', version: i.version }));
      autoUpdater.on('error', (e) => this._set({ state: 'error', error: String((e && e.message) || e).split('\n')[0].slice(0, 200) }));
    }
    setTimeout(() => this.check(), 15000).unref();
    this._timer = setInterval(() => this.check(), EVERY_MS);
    this._timer.unref();
  }

  async check(manual = false) {
    if (!manual && !this.isEnabled()) return this.status;
    const mode = this.mode();
    if (mode === 'installed' && this.auto) {
      try {
        await this.auto.checkForUpdates();
      } catch (e) {
        this._set({ state: 'error', error: String(e.message || e).slice(0, 200) });
      }
      return this.status;
    }
    if (mode === 'portable' || (mode === 'dev' && manual)) {
      try {
        this._set({ state: 'checking' });
        const tag = await latestTag();
        if (newer(tag, this.version)) this._set({ state: 'manual', version: tag.replace(/^v/, ''), url: RELEASES });
        else this._set({ state: 'none', checkedAt: Date.now() });
      } catch (e) {
        this._set({ state: 'error', error: String(e.message || e).slice(0, 200) });
      }
    }
    return this.status;
  }

  // installe la mise à jour téléchargée et relance l'application
  install() {
    if (this.status.state !== 'ready' || !this.auto) return false;
    setImmediate(() => this.auto.quitAndInstall(true, true));
    return true;
  }
}

module.exports = { Updater, newer, RELEASES };
