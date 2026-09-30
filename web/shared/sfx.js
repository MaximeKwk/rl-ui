// Sons des alertes, synthétisés en Web Audio (aucun fichier, aucun droit d'auteur).
// Un fichier perso (mp3/wav/ogg) peut remplacer chaque son depuis le tableau de bord.
(function () {
  let ctx = null;
  let master = null;
  let wet = null;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 4;
      master.connect(comp);
      comp.connect(ctx.destination);
      // réverbe synthétique (bruit décroissant)
      const rev = ctx.createConvolver();
      const len = Math.floor(ctx.sampleRate * 2.4);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
      }
      rev.buffer = buf;
      wet = ctx.createGain();
      wet.gain.value = 0.28;
      wet.connect(rev);
      rev.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function out(node, reverb = true) {
    node.connect(master);
    if (reverb) node.connect(wet);
  }

  function tone(freq, t, dur, o = {}) {
    const c = ctx;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + (o.slideTime || dur));
    if (o.detune) osc.detune.value = o.detune;
    if (o.vibrato) {
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = o.vibrato;
      lg.gain.value = freq * 0.012;
      lfo.connect(lg);
      lg.connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.5);
    }
    let node = osc;
    if (o.lowpass) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(o.lowpass, t);
      if (o.lowpassTo) f.frequency.exponentialRampToValueAtTime(o.lowpassTo, t + dur);
      f.Q.value = o.q || 0.8;
      osc.connect(f);
      node = f;
    }
    const peak = o.gain ?? 0.2;
    const a = o.attack ?? 0.01;
    const r = o.release ?? 0.25;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + Math.max(a, dur - r));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g);
    out(g, o.reverb !== false);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise(t, dur, o = {}) {
    const c = ctx;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = o.filter || 'highpass';
    f.frequency.setValueAtTime(o.freq || 3000, t);
    if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, t + dur);
    f.Q.value = o.q || 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain || 0.15, t + (o.attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    out(g, o.reverb !== false);
    src.start(t);
    src.stop(t + dur);
  }

  const N = (n) => 440 * Math.pow(2, (n - 69) / 12); // note MIDI -> Hz

  function brass(note, t, dur, gain = 0.07) {
    tone(N(note), t, dur, { type: 'sawtooth', gain, attack: 0.03, release: 0.3, lowpass: 900, lowpassTo: 2600, detune: -6 });
    tone(N(note), t, dur, { type: 'sawtooth', gain, attack: 0.03, release: 0.3, lowpass: 900, lowpassTo: 2600, detune: 7 });
    tone(N(note + 12), t, dur, { type: 'triangle', gain: gain * 0.6, attack: 0.02, release: 0.3 });
  }

  function thump(t, gain = 0.5) {
    tone(110, t, 0.22, { type: 'sine', gain, attack: 0.004, release: 0.18, slideTo: 42, slideTime: 0.2, reverb: false });
  }

  function heartbeat(t, gain = 0.55) {
    thump(t, gain);
    thump(t + 0.2, gain * 0.7);
  }

  function sparkle(t, notes, step = 0.06) {
    notes.forEach((n, i) => tone(N(n), t + i * step, 0.5, { type: 'sine', gain: 0.05, attack: 0.005, release: 0.45 }));
  }

  const SOUNDS = {
    win(t) {
      [67, 72, 76, 79].forEach((n, i) => brass(n, t + i * 0.09, 0.22));
      thump(t + 0.38, 0.35);
      [72, 76, 79, 84].forEach((n) => brass(n, t + 0.38, 1.1, 0.055));
      noise(t + 0.38, 0.9, { freq: 6000, gain: 0.05 });
      sparkle(t + 0.55, [96, 100, 103, 108]);
    },
    loss(t) {
      thump(t, 0.6);
      noise(t, 0.5, { filter: 'lowpass', freq: 600, freqTo: 120, gain: 0.12 });
      [75, 72, 68].forEach((n, i) => tone(N(n), t + 0.12 + i * 0.2, 0.55, { type: 'square', gain: 0.045, lowpass: 1400, lowpassTo: 500, release: 0.4 }));
      tone(N(56), t + 0.72, 1.0, { type: 'sawtooth', gain: 0.05, lowpass: 700, lowpassTo: 200, attack: 0.05, release: 0.8, vibrato: 5 });
    },
    overtime(t) {
      brass(57, t, 0.28, 0.09);
      brass(64, t, 0.28, 0.06);
      brass(57, t + 0.36, 0.75, 0.09);
      brass(64, t + 0.36, 0.75, 0.06);
      brass(69, t + 0.36, 0.75, 0.04);
      heartbeat(t + 1.2);
      heartbeat(t + 1.85, 0.45);
    },
    ot_win(t) {
      heartbeat(t, 0.5);
      heartbeat(t + 0.45, 0.6);
      const s = t + 0.9;
      [67, 72, 76, 79, 84].forEach((n, i) => brass(n, s + i * 0.07, 0.22, 0.075));
      thump(s + 0.36, 0.55);
      noise(s + 0.36, 1.6, { freq: 4500, gain: 0.09 });
      [72, 76, 79, 84, 88].forEach((n) => brass(n, s + 0.36, 1.5, 0.05));
      sparkle(s + 0.5, [96, 100, 103, 108, 103, 108, 112], 0.07);
    },
    ot_loss(t) {
      heartbeat(t, 0.5);
      heartbeat(t + 0.45, 0.35);
      SOUNDS.loss(t + 0.95);
    },
    streak(t) {
      noise(t, 0.7, { filter: 'bandpass', freq: 300, freqTo: 5000, q: 1.2, gain: 0.12 });
      sparkle(t + 0.55, [88, 92, 95, 100], 0.07);
      tone(N(100), t + 0.83, 0.9, { type: 'triangle', gain: 0.05, release: 0.8 });
    },
  };

  const audioCache = {};

  window.SFX = {
    // type : win | loss | overtime | ot_win | ot_loss | streak
    play(type, volume = 0.7, customUrl = null) {
      if (customUrl) {
        const a = audioCache[customUrl] || (audioCache[customUrl] = new Audio(customUrl));
        a.volume = Math.max(0, Math.min(1, volume));
        a.currentTime = 0;
        a.play().catch(() => {});
        return;
      }
      const c = ac();
      if (!c || !SOUNDS[type]) return;
      master.gain.setValueAtTime(Math.max(0, Math.min(1, volume)) * 1.1, c.currentTime);
      SOUNDS[type](c.currentTime + 0.03);
    },
    unlock() {
      ac();
    },
  };
})();
