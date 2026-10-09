// Génère les icônes de l'app à partir du logo (tools/logo.js).
//   electron tools/make-icon.js
//   build/icon.png            512 px, avec « RL » : installeur et exécutable
//   web/assets/icon.png       256 px, avec « RL » : fenêtre, onglet du navigateur
//   web/assets/icon-tray.png   64 px, sans lettres : zone de notification (affichée en 16 px)
//   docs/images/icon.png      256 px : site
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { logoHtml } = require('./logo');

const root = path.join(__dirname, '..');
const OUT = [
  ['build/icon.png', 512, true],
  ['web/assets/icon.png', 256, true],
  ['web/assets/icon-tray.png', 64, false],
  ['docs/images/icon.png', 256, true],
];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  // Une seule fenêtre réutilisée (créer/détruire des fenêtres hors écran en boucle fait planter Electron)
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  let frame = null;
  win.webContents.on('paint', (_e, _d, img) => (frame = img));
  for (const letters of [true, false]) {
    const tmp = path.join(os.tmpdir(), `rl-ui-icon-${Date.now()}.html`);
    fs.writeFileSync(tmp, logoHtml({ size: 512, letters }));
    frame = null;
    await win.loadFile(tmp);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    await new Promise((r) => setTimeout(r, 600));
    const img = frame || (await win.webContents.capturePage());
    for (const [file, size, withLetters] of OUT) {
      if (withLetters !== letters) continue;
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), img.resize({ width: size, height: size, quality: 'best' }).toPNG());
    }
    fs.unlinkSync(tmp);
  }
  console.log('icônes générées');
  app.quit();
});
