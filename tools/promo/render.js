// Rend la vidéo promo : electron tools/promo/render.js <sortie.mp4> [--stills=1,6,9]
// Chaque image est figée à un temps précis (setTime), capturée, puis envoyée à ffmpeg avec la bande-son
// (rythme + vrais sons d'alerte de RL-UI, mixés hors ligne avec OfflineAudioContext).
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FPS = 30;
const DURATION = 21;
const W = 1920, H = 1080;
const args = process.argv.slice(2).filter((a) => !a.startsWith('--') && !/electron|render\.js$/i.test(a));
const out = path.resolve(args[args.length - 1] || 'rl-ui-promo.mp4');
const stillsArg = process.argv.find((a) => a.startsWith('--stills='));
const sfx = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'shared', 'sfx.js'), 'utf8');

// bande-son, exécutée dans la page
const AUDIO = `async (sfxCode, dur) => {
  const R = 44100, oc = new OfflineAudioContext(2, Math.ceil(R * dur), R);
  window.AudioContext = function () { return oc; };
  (0, eval)(sfxCode);
  const music = oc.createGain(); music.gain.value = 0.5; music.connect(oc.destination);
  const env = (node, t, peak, a, d) => { const g = oc.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); node.connect(g); return g; };
  const osc = (type, f, t, len) => { const o = oc.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(t + len + 0.05); return o; };
  const noiseBuf = (() => { const b = oc.createBuffer(1, R, R), d = b.getChannelData(0); for (let i = 0; i < R; i++) d[i] = Math.random() * 2 - 1; return b; })();
  const noise = (t, len) => { const s = oc.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(t); s.stop(t + len + 0.05); return s; };
  const kick = (t, v = 0.9) => { const o = osc('sine', 120, t, 0.3); o.frequency.exponentialRampToValueAtTime(40, t + 0.22); env(o, t, v, 0.003, 0.28).connect(music); };
  const hat = (t, v = 0.12) => { const f = oc.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8000; noise(t, 0.06).connect(f); env(f, t, v, 0.002, 0.05).connect(music); };
  const clap = (t, v = 0.25) => { const f = oc.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.8; noise(t, 0.2).connect(f); env(f, t, v, 0.003, 0.16).connect(music); };
  const bass = (n, t, len, v = 0.22) => { const o = osc('sawtooth', 440 * 2 ** ((n - 69) / 12), t, len); const f = oc.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; o.connect(f); env(f, t, v, 0.008, len).connect(music); };
  const whoosh = (t, len = 0.6, v = 0.35) => { const f = oc.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.1; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(6000, t + len); noise(t, len).connect(f); env(f, t, v, len * 0.75, len * 0.25).connect(oc.destination); };
  const pad = (notes, t, len, v = 0.03) => notes.forEach((n) => [-8, 8].forEach((dt) => { const o = osc('sawtooth', 440 * 2 ** ((n - 69) / 12), t, len); o.detune.value = dt; const f = oc.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800; o.connect(f); env(f, t, v, 0.4, len - 0.4).connect(music); }));

  // rythme 120 BPM de 2,5 s à 17,5 s ; basse C A F G (2 s par accord)
  const roots = [36, 33, 29, 31];
  for (let t = 2.5; t < 17.5; t += 0.5) {
    const beat = Math.round((t - 2.5) / 0.5);
    kick(t);
    hat(t + 0.25);
    if (beat % 2 === 1) clap(t);
    const root = roots[Math.floor((t - 2.5) / 2) % 4];
    bass(root, t + 0.25, 0.2);
    if (beat % 4 === 3) bass(root + 12, t + 0.375, 0.1, 0.16);
  }
  // musique plus basse pendant les alertes
  for (const [a, b] of [[5.6, 7.9], [8.5, 10.4], [11.0, 13.2]]) { music.gain.setValueAtTime(0.5, a - 0.05); music.gain.linearRampToValueAtTime(0.28, a + 0.05); music.gain.setValueAtTime(0.28, b); music.gain.linearRampToValueAtTime(0.5, b + 0.3); }
  for (const t of [2.2, 4.7, 13.7, 17.2]) whoosh(t - 0.25);
  // intro : impact sur l'apparition du logo ; fin : accord tenu
  kick(0.15, 1); whoosh(0.0, 0.3, 0.25);
  pad([48, 55, 60, 64, 67], 17.6, 3.3);
  kick(17.6, 1);

  const at = (t, fn) => oc.suspend(t).then(() => { fn(); oc.resume(); });
  at(5.6, () => SFX.play('win', 0.8));
  at(8.5, () => SFX.play('overtime', 0.8));
  at(11.0, () => SFX.play('ot_win', 0.8));
  at(17.6, () => SFX.play('streak', 0.6));
  const buf = await oc.startRendering();
  const L = buf.getChannelData(0), Rr = buf.getChannelData(1);
  let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(Rr[i]));
  const k = peak > 0.95 ? 0.95 / peak : 1;
  const pcm = new Int16Array(L.length * 2);
  for (let i = 0; i < L.length; i++) { pcm[2 * i] = L[i] * k * 32767; pcm[2 * i + 1] = Rr[i] * k * 32767; }
  return { peak, bytes: Array.from(new Uint8Array(pcm.buffer)) };
}`;

function wav(bytes) {
  const d = Buffer.from(bytes), h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + d.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(44100, 24); h.writeUInt32LE(44100 * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(d.length, 40);
  return Buffer.concat([h, d]);
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
  await win.loadFile(path.join(__dirname, 'promo.html'));
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');

  if (stillsArg) {
    for (const t of stillsArg.slice(9).split(',').map(Number)) fs.writeFileSync(out.replace(/\.\w+$/, '') + `-${t}s.png`, await frame(win, t));
    console.log('images fixes écrites');
    return app.quit();
  }

  const audioFile = path.join(os.tmpdir(), `rl-ui-promo-${Date.now()}.wav`);
  const a = await win.webContents.executeJavaScript(`(${AUDIO})(${JSON.stringify(sfx)}, ${DURATION})`);
  fs.writeFileSync(audioFile, wav(a.bytes));
  console.log('bande-son : pic', a.peak.toFixed(2));

  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-i', audioFile,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const total = FPS * DURATION;
  for (let i = 0; i < total; i++) {
    const png = await frame(win, i / FPS);
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 90 === 0) console.log(`image ${i}/${total}`);
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
