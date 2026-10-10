// Rend le film de présentation (tools/promo/promo.html) en vidéo.
//   electron tools/promo/render.js <sortie.mp4> [--lang=fr|en] [--fps=60] [--stills=1,6,9]
// Chaque image est figée à un temps précis (setTime), capturée, puis envoyée à ffmpeg avec la bande-son
// (rythme + vrais sons d'alerte de RL-UI, mixés hors ligne par la page : window.promoAudio).
// La durée, les textes et la bande-son sont dans promo.html ; ce script ne fait que capturer et encoder.
// ffmpeg doit être installé. Pour regarder le film sans le rendre : ouvrir promo.html?play=1&lang=fr dans un navigateur.
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const W = 1920, H = 1080;
const flag = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const args = process.argv.slice(2).filter((a) => !a.startsWith('--') && !/electron|render\.js$/i.test(a));
const out = path.resolve(args[args.length - 1] || 'rl-ui-2.mp4');
const lang = flag('lang', 'en') === 'fr' ? 'fr' : 'en';
const FPS = Number(flag('fps', 60)) || 60;
const stills = flag('stills', '');
const sfx = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'shared', 'sfx.js'), 'utf8');

function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(44100, 24); h.writeUInt32LE(44100 * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const frame = async (win, t) => {
  await win.webContents.executeJavaScript(`setTime(${t}); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
  const img = await win.webContents.capturePage();
  const s = img.getSize();
  return (s.width === W && s.height === H ? img : img.resize({ width: W, height: H, quality: 'best' })).toPNG();
};

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const win = new BrowserWindow({ width: W, height: H, show: false, frame: false, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false } });
  await win.loadFile(path.join(__dirname, 'promo.html'), { query: { lang } });
  const js = (code) => win.webContents.executeJavaScript(code);
  await js('document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {})))).then(() => true)');
  const duration = await js('window.PROMO.duration');
  // (les polices des overlays ne se chargent qu'à leur première utilisation : un premier passage sur tout le film)
  for (let t = 0; t < duration; t += 1) await js(`setTime(${t})`);
  await js('document.fonts.ready.then(() => true)');

  if (stills) {
    for (const t of stills.split(',').map(Number)) fs.writeFileSync(out.replace(/\.\w+$/, '') + `-${t}s.png`, await frame(win, t));
    console.log('images fixes écrites');
    return app.quit();
  }

  const audioFile = path.join(os.tmpdir(), `rl-ui-promo-${Date.now()}.wav`);
  const a = await js(`window.promoAudio(${JSON.stringify(sfx)})`);
  fs.writeFileSync(audioFile, wav(Buffer.from(a.base64, 'base64')));
  console.log('bande-son : pic', a.peak.toFixed(2));

  // (loudnorm : le niveau sonore habituel des vidéos en ligne, −16 LUFS)
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-i', audioFile,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const total = Math.round(FPS * duration);
  for (let i = 0; i < total; i++) {
    const png = await frame(win, i / FPS);
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 300 === 0) console.log(`image ${i}/${total}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  fs.unlinkSync(audioFile);
  console.log('vidéo :', out);
  app.quit();
}).catch((e) => {
  console.error(e);
  app.exit(1);
});
