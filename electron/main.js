'use strict';
// Processus principal Electron : fenêtre du tableau de bord, icône dans la zone de notification,
// raccourcis clavier globaux et démarrage avec Windows. Toute la logique est dans ../core.

const { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, shell, globalShortcut, dialog, safeStorage } = require('electron');
const path = require('path');
const { Core } = require('../core');
const { migrateLegacyData } = require('./migrate');
const { Updater } = require('./updater');
const { t } = require('../core/i18n');
const pkg = require('../package.json');

// Dossier de données alternatif (tests) : RLUI_DATA=C:\chemin
if (process.env.RLUI_DATA) app.setPath('userData', process.env.RLUI_DATA);

// Reprise des données de l'ancienne version (nom de code "Overtime Tracker")
function migrateLegacy() {
  if (process.env.RLUI_DATA) return false;
  return migrateLegacyData(path.join(app.getPath('appData'), 'Overtime Tracker'), app.getPath('userData'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.setAppUserModelId('com.zoxam.rlui');

const ICON = path.join(__dirname, '..', 'web', 'assets', 'icon.png');
const ICON_TRAY = path.join(__dirname, '..', 'web', 'assets', 'icon-tray.png'); // sans lettres : lisible en 16 px
const isDev = !app.isPackaged;
let core = null;
let win = null;
let tray = null;
let quitting = false;
let updater = null;
let stopped = false;

const dashboardUrl = () => `http://127.0.0.1:${core.server.port}/?app=1`;

// Thème de la fenêtre : suit le réglage app.theme (system | light | dark). On le donne à Electron
// (la page et les menus natifs suivent), et les boutons de la barre de titre prennent les couleurs
// de la barre du haut du tableau de bord (--rail et --muted de web/dashboard/style.css).
const CHROME = {
  dark: { color: '#0e1316', symbolColor: '#97a6aa' },
  light: { color: '#e7eeee', symbolColor: '#55666a' },
};
const windowChrome = () => (nativeTheme.shouldUseDarkColors ? CHROME.dark : CHROME.light);
function applyWindowTheme() {
  const pref = core.store.settings.app.theme;
  const source = pref === 'light' || pref === 'dark' ? pref : 'system';
  if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
  if (!win || win.isDestroyed()) return;
  const c = windowChrome();
  win.setBackgroundColor(c.color);
  // setTitleBarOverlay n'existe que là où la barre de titre est superposée (Windows, Linux)
  if (typeof win.setTitleBarOverlay === 'function') {
    try {
      win.setTitleBarOverlay({ color: c.color, symbolColor: c.symbolColor, height: 44 });
    } catch {}
  }
}

function createWindow(show = true) {
  applyWindowTheme();
  const chrome = windowChrome();
  win = new BrowserWindow({
    width: 1340,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'RL-UI',
    icon: ICON,
    backgroundColor: chrome.color,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: chrome.color, symbolColor: chrome.symbolColor, height: 44 },
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.loadURL(dashboardUrl());
  win.once('ready-to-show', () => {
    if (show) win.show();
  });
  // Liens externes -> navigateur par défaut
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${core.server.port}/`)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && isDev) win.webContents.toggleDevTools();
    if (input.type === 'keyDown' && input.key === 'F5') win.webContents.reload();
  });
  win.on('close', (e) => {
    if (quitting || !core.store.settings.app.minimizeToTray) return;
    e.preventDefault();
    win.hide();
    if (!core.store.settings.app.trayHintShown && tray) {
      tray.displayBalloon({
        iconType: 'info',
        title: t('e.stillRunning'),
        content: t('e.stillRunningBody'),
      });
      core.store.patchSettings({ app: { trayHintShown: true } });
    }
  });
  win.on('closed', () => {
    win = null;
  });
}

function showWindow() {
  if (!win) return createWindow(true);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function updateTray() {
  if (!tray) return;
  const st = core.sessionStats();
  const s = core.store.settings;
  const lw = core.labelWin();
  const ll = core.labelLoss();
  tray.setToolTip(`RL-UI — ${st.wins}${lw} - ${st.losses}${ll}${s.paused ? t('e.pausedTip') : ''}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t('e.session', { w: st.wins, lw, l: st.losses, ll, wr: st.played ? ` (${st.winRate}%)` : '' }), enabled: false },
      { type: 'separator' },
      { label: t('e.open'), click: showWindow },
      { label: t('e.win'), click: () => core.action('win') },
      { label: t('e.loss'), click: () => core.action('loss') },
      { label: t('e.undo'), click: () => core.action('undo') },
      { label: t(s.paused ? 'e.resume' : 'e.pause'), click: () => core.action('toggle-pause') },
      { label: t('e.newSession'), click: () => core.action('new-session') },
      { type: 'separator' },
      {
        label: t('e.quit'),
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const h = core.store.settings.hotkeys;
  const errors = [];
  if (h.enabled) {
    for (const act of ['win', 'loss', 'undo']) {
      const acc = h[act];
      if (!acc) continue;
      try {
        if (!globalShortcut.register(acc, () => core.action(act))) errors.push(acc);
      } catch {
        errors.push(acc);
      }
    }
  }
  core.hotkeyErrors = errors;
}

function applyLoginItem() {
  if (isDev || process.windowsStore) return; // dev : on ne touche pas au démarrage ; Store : réglé dans les paramètres de Windows
  const s = core.store.settings.app;
  app.setLoginItemSettings({ openAtLogin: !!s.startWithWindows, args: ['--hidden'] });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const migrated = migrateLegacy();
  core = new Core({
    dataDir: app.getPath('userData'),
    documentsDir: app.getPath('documents'),
    webDir: path.join(__dirname, '..', 'web'),
    version: pkg.version,
    hooks: {
      // mots de passe OBS / Streamlabs et connexion Twitch chiffrés par Windows (DPAPI)
      vault: safeStorage.isEncryptionAvailable()
        ? { encrypt: (s) => safeStorage.encryptString(s).toString('base64'), decrypt: (b) => safeStorage.decryptString(Buffer.from(b, 'base64')) }
        : null,
      openPath: async (p) => !(await shell.openPath(p)),
      openExternal: (url) => shell.openExternal(url),
      onSettingsChanged: (s, prev) => {
        if (JSON.stringify(s.hotkeys) !== JSON.stringify(prev.hotkeys)) registerHotkeys();
        if (s.app.startWithWindows !== prev.app.startWithWindows) applyLoginItem();
        updateTray();
      },
      onServerRestarted: () => {
        if (win) win.loadURL(dashboardUrl());
      },
      checkUpdate: () => updater.check(true),
      installUpdate: async () => {
        if (!updater || updater.status.state !== 'ready') return false;
        // on arrête proprement le tracker avant de lancer l'installeur
        quitting = true;
        globalShortcut.unregisterAll();
        await Promise.race([core.stop(), new Promise((r) => setTimeout(r, 2000))]);
        stopped = true;
        return updater.install();
      },
    },
  });
  try {
    await core.start();
  } catch (e) {
    dialog.showErrorBox('RL-UI', t('e.serverFail', { e: e.message }));
    quitting = true;
    app.quit();
    return;
  }
  if (migrated) core.log(t('s.migrated'));
  registerHotkeys();
  tray = new Tray(nativeImage.createFromPath(ICON_TRAY).resize({ width: 16, height: 16, quality: 'best' }));
  tray.on('click', showWindow);
  updateTray();
  let trayTimer = null;
  let shownTheme = core.store.settings.app.theme;
  nativeTheme.on('updated', applyWindowTheme); // le système passe du clair au sombre
  core.on('changed', () => {
    if (core.store.settings.app.theme !== shownTheme) {
      shownTheme = core.store.settings.app.theme;
      applyWindowTheme();
    }
    if (trayTimer) return;
    trayTimer = setTimeout(() => {
      trayTimer = null;
      updateTray();
    }, 1000);
  });
  const hidden = process.argv.includes('--hidden') || core.store.settings.app.startMinimized;
  createWindow(!hidden);
  applyLoginItem();
  updater = new Updater({
    app,
    version: pkg.version,
    onStatus: (st) => core.setUpdateStatus(st),
    isEnabled: () => core.store.settings.app.autoUpdate !== false,
  });
  updater.start();
});

app.on('second-instance', () => {
  if (core) showWindow();
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (!core || !core.store.settings.app.minimizeToTray) app.quit();
});

app.on('will-quit', (e) => {
  if (stopped || !core) return;
  e.preventDefault();
  globalShortcut.unregisterAll();
  // on relance la fermeture une fois le tracker arrêté (laisse l'installeur de mise à jour se lancer si besoin)
  const done = () => {
    stopped = true;
    app.quit();
  };
  Promise.race([core.stop(), new Promise((r) => setTimeout(r, 2000))]).then(done, done);
});
