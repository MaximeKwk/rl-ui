// Sons des alertes, synthétisés en Web Audio (aucun fichier, aucun droit d'auteur).
// Style jeu vidéo moderne : montée, impact, gros accords synthé (supersaw) et sub, courts (1 à 2 s).
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
      const len = Math.floor(ctx.sampleRate * 1.1);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
      }
      rev.buffer = buf;
      wet = ctx.createGain();
      wet.gain.value = 0.22;
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

  // JEU MODERNE : montée, impact, gros accords synthé (supersaw), sub
  function saw(note, t, dur, gain, o = {}) {
    [-14, -5, 0, 6, 15].forEach((d) => tone(N(note), t, dur, { type: 'sawtooth', gain: gain / 3, attack: o.attack ?? 0.01, release: o.release ?? dur * 0.6, detune: d, lowpass: o.lp ?? 3200, lowpassTo: o.lpTo ?? 900, slideTo: o.slideTo ? N(note) * o.slideTo : undefined, slideTime: dur }));
  }
  function chord(notes, t, dur, gain = 0.05, o) {
    notes.forEach((n) => saw(n, t, dur, gain, o));
  }
  function riser(t, dur, gain = 0.09) {
    noise(t, dur, { filter: 'highpass', freq: 300, freqTo: 7000, gain, attack: dur * 0.95 });
    tone(N(48), t, dur, { type: 'sawtooth', gain: 0.03, attack: dur * 0.9, release: 0.02, slideTo: N(72), slideTime: dur, lowpass: 600, lowpassTo: 3000 });
  }
  function impact(t, gain = 0.6) {
    tone(70, t, 0.6, { type: 'sine', gain, attack: 0.003, release: 0.55, slideTo: 32, slideTime: 0.5, reverb: false });
    noise(t, 0.35, { filter: 'lowpass', freq: 4000, freqTo: 300, gain: 0.16, attack: 0.002 });
  }
  function shimmer(t, notes) {
    notes.forEach((n, i) => tone(N(n), t + i * 0.05, 0.6, { type: 'triangle', gain: 0.035, attack: 0.004, release: 0.55 }));
  }
  function boom(t, gain = 0.5) {
    tone(60, t, 0.3, { type: 'sine', gain, attack: 0.003, release: 0.27, slideTo: 38, slideTime: 0.25, reverb: false });
  }

  const SOUNDS = {
    win(t) {
      riser(t, 0.4);
      impact(t + 0.4);
      chord([60, 64, 67, 72], t + 0.4, 1.3, 0.05);
      shimmer(t + 0.5, [84, 88, 91, 96]);
    },
    loss(t) {
      impact(t, 0.55);
      chord([57, 60, 64], t, 1.3, 0.045, { lp: 1800, lpTo: 250, slideTo: 0.84 });
      tone(N(45), t, 1.2, { type: 'sawtooth', gain: 0.04, attack: 0.01, release: 0.9, lowpass: 700, lowpassTo: 120, slideTo: N(33), slideTime: 1.2 });
    },
    overtime(t) {
      boom(t);
      boom(t + 0.45, 0.45);
      riser(t + 0.2, 0.75, 0.08);
      impact(t + 0.95);
      chord([57, 62, 64, 69], t + 0.95, 1.2, 0.05);
    },
    ot_win(t) {
      boom(t, 0.4);
      riser(t, 0.55, 0.11);
      impact(t + 0.55, 0.7);
      chord([60, 64, 67, 72], t + 0.55, 0.3, 0.05, { release: 0.1 });
      impact(t + 0.85, 0.5);
      chord([64, 67, 72, 76], t + 0.85, 1.5, 0.055);
      shimmer(t + 0.95, [88, 91, 96, 100, 103]);
    },
    ot_loss(t) {
      boom(t, 0.4);
      riser(t, 0.45, 0.07);
      SOUNDS.loss(t + 0.45);
    },
    streak(t) {
      noise(t, 0.45, { filter: 'bandpass', freq: 400, freqTo: 6000, q: 1.3, gain: 0.1, attack: 0.4 });
      [67, 71, 74, 79].forEach((n, i) => saw(n, t + 0.3 + i * 0.07, 0.18, 0.04, { release: 0.12 }));
      impact(t + 0.58, 0.45);
      chord([67, 71, 74, 79], t + 0.58, 1.0, 0.045);
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
