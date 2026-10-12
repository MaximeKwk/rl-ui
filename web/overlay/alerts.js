// Overlay "Alertes" (1920x1080, fond transparent) : /overlay/alerts?pos=center|top|bottom&scale=1&mute=1&only=win,ot_win
(function () {
  const P = OT.params;
  const esc = OT.esc;
  const stage = document.getElementById('stage');
  const root = document.documentElement.style;
  if (P.get('preview')) document.body.classList.add('preview');

  const ICON = {
    fire: '<svg class="ico" viewBox="0 0 24 24"><path d="M13.5 1.7s.7 2.6.7 4.7c0 2-1.3 3.7-3.3 3.7S7.4 8.4 7.4 6.4l.03-.36C5.4 8.5 4.2 11.6 4.2 15c0 4.4 3.6 8 7.8 8s7.8-3.6 7.8-8c0-5.4-2.6-10.2-6.3-13.3zM11.7 20c-1.8 0-3.2-1.4-3.2-3.1 0-1.6 1-2.8 2.8-3.1 1.8-.4 3.6-1.2 4.6-2.6.4 1.3.6 2.6.6 4 0 2.7-2.1 4.8-4.8 4.8z"/></svg>',
    star: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 2l2.9 6.9 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21.2l1.6-7L2 9.5l7.1-.6z"/></svg>',
    clock: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 18a8 8 0 110-16 8 8 0 010 16zm.5-13H11v6l5.2 3.2.8-1.2-4.5-2.7z"/></svg>',
    bolt: '<svg class="ico" viewBox="0 0 24 24"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>',
  };

  let conf = { overlay: {}, alerts: {} };
  let confVersion = 0;
  const queue = [];
  let busy = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function updateScale() {
    const vs = Math.min(window.innerWidth / 1920, window.innerHeight / 1080) || 1;
    root.setProperty('--s', vs * OT.num('scale', Number(conf.alerts.scale) || 1));
  }
  window.addEventListener('resize', updateScale);

  function applyConfig(c) {
    if (c) conf = c;
    confVersion++;
    OT.applyColors(conf.overlay);
    stage.className = `stage pos-${P.get('pos') || conf.alerts.position || 'center'}`;
    updateScale();
  }

  const lw = () => (conf.overlay && conf.overlay.labelWin) || OT.t('lbl.w');
  const ll = () => (conf.overlay && conf.overlay.labelLoss) || OT.t('lbl.l');

  function kicker(a) {
    const d = a.data || {};
    const pl = d.manual ? '' : d.playlist || '';
    switch (a.type) {
      case 'overtime':
        return `${OT.t('al.suddenDeath')}${pl ? ` · ${pl}` : ''}`;
      case 'ot_win':
        return OT.t('al.golden');
      case 'streak':
        return OT.t('al.inARow');
      default:
        return pl;
    }
  }

  function chips(a) {
    const d = a.data || {};
    const out = [];
    const isWin = a.type === 'win' || a.type === 'ot_win';
    const hasScore = Number.isFinite(d.scoreFor) && Number.isFinite(d.scoreAgainst) && !d.manual;
    if (a.type === 'overtime') {
      if (hasScore) out.push(`<span class="chip score"><b>${d.scoreFor}</b><i>–</i><b>${d.scoreAgainst}</b></span>`);
      out.push(`<span class="chip hl">${ICON.bolt} ${esc(OT.t('al.nextGoal'))}</span>`);
      return out.join('');
    }
    if (a.type === 'streak') {
      out.push(`<span class="chip hl">${esc(OT.t('al.nInARow', { n: d.n }))}</span>`);
      out.push(`<span class="chip">${esc(OT.t('al.session'))} ${d.wins}${esc(lw())} – ${d.losses}${esc(ll())}</span>`);
      return out.join('');
    }
    if (hasScore) out.push(`<span class="chip score"><b class="me">${d.scoreFor}</b><i>–</i><b>${d.scoreAgainst}</b></span>`);
    if (d.mmr && Number.isFinite(d.mmr.delta) && P.get('mmr') !== '0') {
      // "≈" seulement si l'estimation n'a pas encore pu être calibrée sur tes vraies variations
      const v = Math.round(d.mmr.delta);
      out.push(`<span class="chip mmr ${v >= 0 ? 'up' : 'down'}">${d.mmr.learned ? '' : '≈ '}${v > 0 ? '+' : ''}${v} MMR</span>`);
    }
    if (d.overtime && d.otSeconds > 0) out.push(`<span class="chip">${ICON.clock} OT ${OT.fmtClock(d.otSeconds, true)}</span>`);
    if (isWin && d.streak >= 2) out.push(`<span class="chip hl">${esc(OT.t('al.nInARow', { n: d.streak }))}</span>`);
    else if (Number.isFinite(d.wins)) out.push(`<span class="chip">${esc(OT.t('al.session'))} ${d.wins}${esc(lw())} – ${d.losses}${esc(ll())}</span>`);
    if (isWin && d.mvp) out.push(`<span class="chip">${ICON.star} MVP</span>`);
    return out.join('');
  }

  function build(a) {
    const el = document.createElement('div');
    el.className = `al t-${a.type}`;
    // bandeau sobre : emplacement d'image des thèmes, mode de jeu, titre, détail
    el.innerHTML = `<div class="art"></div><div class="kicker">${esc(kicker(a))}</div><div class="title"><span class="tx">${esc(a.title)}</span></div><div class="subs">${chips(a)}</div>`;
    return el;
  }

  // Réduit la taille du titre s'il est trop long pour l'écran
  function fit(el) {
    const tx = el.querySelector('.tx');
    let fs = 190;
    el.style.setProperty('--fs', `${fs}px`);
    const max = window.innerWidth * 0.82;
    const w = tx.offsetWidth;
    if (w > max) {
      fs = Math.floor((fs * max) / w);
      el.style.setProperty('--fs', `${fs}px`);
    }
  }

  function palette() {
    const cs = getComputedStyle(document.documentElement);
    return {
      win: cs.getPropertyValue('--win').trim(),
      loss: cs.getPropertyValue('--loss').trim(),
      otRgb: cs.getPropertyValue('--ot-rgb').trim() || '255,176,32',
    };
  }

  // Plus d'effets de particules ni de secousse : le bandeau suffit (habillage télé sobre).
  // Gardé pour les thèmes qui voudraient le réactiver plus tard.
  function effects() {}

  function effectsLegacy(a) {
    const p = palette();
    const H = window.innerHeight;
    const cy = stage.classList.contains('pos-top') ? H * 0.25 : stage.classList.contains('pos-bottom') ? H * 0.72 : H * 0.47;
    switch (a.type) {
      case 'win':
        setTimeout(() => FX.confetti({ count: 170, y: cy, colors: [p.win, '#ffffff', '#9dffd8', '#2f8cff', '#ffd35a'] }), 330);
        break;
      case 'ot_win':
        setTimeout(() => {
          stage.classList.remove('shake');
          void stage.offsetWidth;
          stage.classList.add('shake');
          FX.confetti({ count: 230, y: cy, power: 1.15, colors: ['#ffd35a', '#fff4c9', '#ffb020', '#ffffff', p.win] });
          FX.sparks({ count: 110, color: '255,211,90', y: cy });
        }, 330);
        setTimeout(() => FX.cannons({ count: 85, colors: ['#ffd35a', '#ffffff', '#ffb020', p.win] }), 750);
        break;
      case 'overtime':
        setTimeout(() => {
          stage.classList.remove('shake');
          void stage.offsetWidth;
          stage.classList.add('shake');
          FX.sparks({ count: 110, color: p.otRgb, y: cy });
        }, 300);
        setTimeout(() => FX.sparks({ count: 70, color: p.otRgb, y: cy }), 1250);
        break;
      case 'streak':
        FX.embers({ count: 130 });
        setTimeout(() => FX.confetti({ count: 80, y: cy, colors: ['#ff8a2a', '#ffd35a', '#ffffff'] }), 350);
        break;
      case 'loss':
      case 'ot_loss':
        setTimeout(() => FX.ash({ count: 70, y: cy }), 350);
        break;
    }
  }

  function sound(a) {
    const al = conf.alerts || {};
    if (al.sound === false || P.get('mute') === '1') return;
    const themeSnd = conf.theme && conf.theme.sounds && conf.theme.sounds[a.type];
    const custom = al.customSounds && al.customSounds[a.type] ? `/sounds/${a.type}?v=${confVersion}` : themeSnd || null;
    try {
      SFX.play(a.type, al.volume ?? 0.7, custom);
    } catch {}
  }

  // ------------------------------------------------------------------ thème composé (éditeur visuel)
  // Le thème dessine lui-même l'alerte : une toile (1920 × 1080 par défaut) posée au centre de l'écran, à son échelle.
  const composition = () => (conf.theme && conf.theme.compose && conf.theme.compose.alerts) || null;
  let shown = null; // { view, comp } de l'alerte composée à l'écran
  function placeComposed() {
    if (!shown) return;
    const host = document.getElementById('cmp');
    const k = Math.min(window.innerWidth / shown.comp.width, window.innerHeight / shown.comp.height) || 1;
    host.style.width = `${shown.comp.width}px`;
    host.style.height = `${shown.comp.height}px`;
    host.style.left = `${(window.innerWidth - shown.comp.width * k) / 2}px`;
    host.style.top = `${(window.innerHeight - shown.comp.height * k) / 2}px`;
    host.style.transform = `scale(${k})`;
  }
  window.addEventListener('resize', placeComposed);

  async function showComposed(a, comp) {
    const theme = conf.theme;
    const host = document.getElementById('cmp');
    host.textContent = '';
    await window.Compose.loadFonts(comp);
    const view = window.Compose.mount(host, comp, { animate: false, imageUrl: (src) => `${theme.assets || ''}${src}?v=${theme.v || 0}` });
    shown = { view, comp };
    placeComposed();
    // (&mmr=0 dans l'adresse : la variation de MMR n'est pas montrée)
    const data = P.get('mmr') === '0' && a.data ? { ...a.data, mmr: null } : a.data;
    view.update(window.Compose.dataFrom(OT.state, conf.overlay, OT.t, { type: a.type, title: a.title, data }));
    view.enter(comp.enter || 'slide');
    sound(a);
    await sleep(Math.max(1.5, Number(a.duration) || 4) * 1000);
    view.leave();
    await sleep(380);
    view.destroy();
    shown = null;
  }

  async function next() {
    const a = queue.shift();
    if (!a) {
      busy = false;
      return;
    }
    busy = true;
    try {
      await document.fonts.ready;
    } catch {}
    const comp = composition();
    if (comp) {
      await showComposed(a, comp);
      await sleep(120);
      return next();
    }
    const el = build(a);
    stage.appendChild(el);
    fit(el);
    effects(a);
    sound(a);
    await sleep(Math.max(1.5, Number(a.duration) || 4) * 1000);
    el.classList.add('out');
    await sleep(460);
    el.remove();
    await sleep(120);
    next();
  }

  OT.on('config', applyConfig);
  OT.on('alert', (a) => {
    const only = P.get('only');
    if (only && !only.split(',').includes(a.type)) return;
    queue.push(a);
    if (queue.length > 4) queue.splice(0, queue.length - 4);
    if (!busy) next();
  });
  applyConfig();
  OT.connect({ overlay: 'alerts' });

  // Démo locale : /overlay/alerts?preview=1&demo=ot_win
  const demo = P.get('demo');
  if (demo) {
    const d = { scoreFor: 3, scoreAgainst: 2, overtime: demo.startsWith('ot'), otSeconds: 42, mvp: true, playlist: OT.lang === 'fr' ? '2v2 Classé' : '2v2 Ranked', streak: 4, wins: 12, losses: 5, n: 5, mmr: { delta: 12, learned: true } };
    if (demo === 'overtime' || demo === 'streak') d.mmr = null;
    if (demo === 'overtime') Object.assign(d, { scoreFor: 2, scoreAgainst: 2 });
    if (demo.includes('loss')) Object.assign(d, { scoreFor: 1, scoreAgainst: 2, streak: -1, mmr: { delta: -11, learned: true } });
    setTimeout(() => {
      const title = ((conf.alerts.texts && conf.alerts.texts[demo]) || OT.t(`alert.${demo}`)).replace('{n}', d.n);
      queue.push({ type: demo, title, duration: OT.num('hold', 30), data: d });
      if (!busy) next();
    }, 400);
  }
})();
