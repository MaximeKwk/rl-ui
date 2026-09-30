// Captures d'écran des pages (contrôle visuel des overlays) — rendu hors écran, son coupé.
//   electron tools/shot.js jobs.json
// jobs.json : [{ "url": "...", "out": "x.png", "w": 1920, "h": 1080, "delays": [800, 2000], "js": "code à exécuter" }]
// (Electron refuse de démarrer si une URL est suivie d'autres arguments : d'où le fichier JSON.)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const jobsFile = process.argv.slice(2).find((a) => a.endsWith('.json'));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  // Une seule fenêtre réutilisée (créer/détruire des fenêtres hors écran en boucle fait planter Electron)
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  win.webContents.setAudioMuted(true);
  win.webContents.setFrameRate(30);
  let frame = null;
  win.webContents.on('paint', (_e, _dirty, image) => {
    frame = image;
  });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') console.log('[page]', e.message);
  });
  for (const job of jobs) {
    win.setContentSize(job.w || 1920, job.h || 1080);
    frame = null;
    try {
      await win.loadURL(job.url);
    } catch (e) {
      console.log('chargement impossible', job.url, e.message);
      continue;
    }
    const delays = job.delays || [1500];
    let elapsed = 0;
    for (const d of delays) {
      await new Promise((r) => setTimeout(r, Math.max(0, d - elapsed)));
      elapsed = d;
      if (job.js && d === delays[0]) {
        try {
          await win.webContents.executeJavaScript(job.js);
        } catch (e) {
          console.log('js :', e.message);
        }
        await new Promise((r) => setTimeout(r, 700));
      }
      const img = frame || (await win.webContents.capturePage());
      const file = delays.length > 1 ? job.out.replace(/\.png$/, `-${d}.png`) : job.out;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, img.toPNG());
      console.log('capture :', file);
    }
  }
  win.destroy();
  app.quit();
});
