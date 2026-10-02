// Génère l'icône de l'app (build/icon.png + web/assets/icon.png) à partir d'un SVG.
//   electron tools/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const font = pathToFileURL(path.join(root, 'web', 'assets', 'fonts', 'barlow-condensed-800-normal.woff2')).href;

// Logo : une plaque d'habillage télé (coins coupés à 45°, comme les overlays), « RL » en chiffres droits
// et la barre des deux équipes (bleu | orange). Couleurs pleines, sans dégradé ni lueur, lisible en 16 px.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <polygon points="96,0 512,0 512,416 416,512 0,512 0,96" fill="#1b1d22"/>
  <text x="256" y="336" text-anchor="middle" font-family="BC" font-weight="800" font-size="330" fill="#e7e4de" letter-spacing="-4">RL</text>
  <rect x="80" y="388" width="170" height="44" fill="#4c8df6"/>
  <rect x="262" y="388" width="170" height="44" fill="#f08a3c"/>
</svg>`;

const html = `<!doctype html><html><head><style>
@font-face { font-family: 'BC'; src: url('${font}') format('woff2'); font-weight: 800; font-style: normal; }
html, body { margin: 0; background: transparent; overflow: hidden; }
svg { display: block; }
</style></head><body>${svg}</body></html>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const tmp = path.join(os.tmpdir(), `rl-ui-icon-${Date.now()}.html`);
  fs.writeFileSync(tmp, html);
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  let frame = null;
  win.webContents.on('paint', (_e, _d, img) => (frame = img));
  await win.loadFile(tmp);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await new Promise((r) => setTimeout(r, 600));
  const img = frame || (await win.webContents.capturePage());
  const png = img.resize({ width: 512, height: 512 }).toPNG();
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), png);
  fs.mkdirSync(path.join(root, 'web', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'web', 'assets', 'icon.png'), img.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
  fs.unlinkSync(tmp);
  console.log('icône générée');
  app.quit();
});
