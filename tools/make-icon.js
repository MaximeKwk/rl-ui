// Génère l'icône de l'app (build/icon.png + web/assets/icon.png) à partir d'un SVG.
//   electron tools/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const font = pathToFileURL(path.join(root, 'web', 'assets', 'fonts', 'barlow-condensed-900-italic.woff2')).href;

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4aa0ff"/><stop offset="1" stop-color="#1747c9"/></linearGradient>
    <linearGradient id="o" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc04d"/><stop offset="1" stop-color="#ff5f14"/></linearGradient>
    <linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe9ff"/></linearGradient>
    <clipPath id="r"><rect width="512" height="512" rx="116"/></clipPath>
  </defs>
  <g clip-path="url(#r)">
    <rect width="512" height="512" fill="#0a0f1d"/>
    <polygon points="0,0 352,0 160,512 0,512" fill="url(#b)"/>
    <polygon points="352,0 512,0 512,512 160,512" fill="url(#o)"/>
    <polygon points="330,0 374,0 182,512 138,512" fill="#0a0f1d"/>
    <rect width="512" height="512" fill="url(#t)" opacity="0.06"/>
  </g>
  <text x="266" y="372" text-anchor="middle" font-family="BC" font-weight="900" font-style="italic" font-size="340"
        fill="url(#t)" stroke="#0a0f1d" stroke-width="18" paint-order="stroke" letter-spacing="0">B</text>
</svg>`;

const html = `<!doctype html><html><head><style>
@font-face { font-family: 'BC'; src: url('${font}') format('woff2'); font-weight: 900; font-style: italic; }
html, body { margin: 0; background: transparent; overflow: hidden; }
svg { display: block; }
</style></head><body>${svg}</body></html>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const tmp = path.join(os.tmpdir(), `boostside-icon-${Date.now()}.html`);
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
