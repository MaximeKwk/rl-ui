'use strict';
// Processus principal Electron : fenêtre du tableau de bord, icône dans la zone de notification,
// raccourcis clavier globaux et démarrage avec Windows. Toute la logique est dans ../core.

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, globalShortcut, dialog } = require('electron');
const path = require('path');
const { Core } = require('../core');
const { migrateLegacyData } = require('./migrate');
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
const isDev = !app.isPackaged;
let core = null;
let win = null;
let tray = null;
let quitting = false;

const dashboardUrl = () => `http://127.0.0.1:${core.server.port}/?app=1`;

function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1340,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'RL-UI',
    icon: ICON,
    backgroundColor: '#070a12',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#070a12', symbolColor: '#aab4c8', height: 44 },
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
        title: 'RL-UI tourne toujours',
        content: 'Le tracking continue en arrière-plan. Clic droit sur l\'icône pour quitter.',
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
  tray.setToolTip(`RL-UI — ${st.wins}V - ${st.losses}D${s.paused ? ' (pause)' : ''}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Session : ${st.wins}V - ${st.losses}D${st.played ? ` (${st.winRate}%)` : ''}`, enabled: false },
      { type: 'separator' },
      { label: 'Ouvrir le tableau de bord', click: showWindow },
      { label: '+1 victoire', click: () => core.action('win') },
      { label: '+1 défaite', click: () => core.action('loss') },
      { label: 'Annuler la dernière partie', click: () => core.action('undo') },
      { label: s.paused ? 'Reprendre le tracking' : 'Mettre en pause', click: () => core.action('toggle-pause') },
      { label: 'Nouvelle session', click: () => core.action('new-session') },
      { type: 'separator' },
      {
        label: 'Quitter',
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
  if (isDev) return; // en développement on ne touche pas au démarrage de Windows
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
    },
  });
  try {
    await core.start();
  } catch (e) {
    dialog.showErrorBox('RL-UI', `Impossible de démarrer le serveur local des overlays :\n${e.message}`);
    quitting = true;
    app.quit();
    return;
  }
  if (migrated) core.log('Historique et réglages repris de l\'ancienne version (Overtime Tracker)');
  registerHotkeys();
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16, quality: 'best' }));
  tray.on('click', showWindow);
  updateTray();
  let trayTimer = null;
  core.on('changed', () => {
    if (trayTimer) return;
    trayTimer = setTimeout(() => {
      trayTimer = null;
      updateTray();
    }, 1000);
  });
  const hidden = process.argv.includes('--hidden') || core.store.settings.app.startMinimized;
  createWindow(!hidden);
  applyLoginItem();
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

let stopped = false;
app.on('will-quit', (e) => {
  if (stopped || !core) return;
  e.preventDefault();
  globalShortcut.unregisterAll();
  const done = () => {
    stopped = true;
    app.exit(0);
  };
  Promise.race([core.stop(), new Promise((r) => setTimeout(r, 2000))]).then(done, done);
});
