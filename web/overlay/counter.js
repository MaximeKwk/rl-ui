// Overlay "Compteur V/D"
//   /overlay/counter?theme=arena|minimal|broadcast&layout=horizontal|vertical|boost&scale=1&align=left|center|right
//   &hide=wr,streak,ot,mmr&mmr=session|value|both
// Disposition "boost" : source plein écran (taille du canevas OBS), le compteur se cale à gauche de la jauge
// de boost du jeu et prend la couleur de ton équipe. Réglages : &bscale=1&bx=0&by=0 (calibrage), &guide=1 (repère).
(function () {
  const P = OT.params;
  const $ = (id) => document.getElementById(id);
  const w = $('w');
  const preview = !!P.get('preview');
  if (preview) document.body.classList.add('preview');

  const ICON_FIRE =
    '<svg class="ico" viewBox="0 0 24 24"><path d="M13.5 1.7s.7 2.6.7 4.7c0 2-1.3 3.7-3.3 3.7S7.4 8.4 7.4 6.4l.03-.36C5.4 8.5 4.2 11.6 4.2 15c0 4.4 3.6 8 7.8 8s7.8-3.6 7.8-8c0-5.4-2.6-10.2-6.3-13.3zM11.7 20c-1.8 0-3.2-1.4-3.2-3.1 0-1.6 1-2.8 2.8-3.1 1.8-.4 3.6-1.2 4.6-2.6.4 1.3.6 2.6.6 4 0 2.7-2.1 4.8-4.8 4.8z"/></svg>';
  const ICON_COLD =
    '<svg class="ico" viewBox="0 0 24 24"><path d="M22 11h-4.2l3.2-3.2-1.4-1.4L15 11h-2V9l4.6-4.6-1.4-1.4L13 6.2V2h-2v4.2L7.8 3 6.4 4.4 11 9v2H9L4.4 6.4 3 7.8 6.2 11H2v2h4.2L3 16.2l1.4 1.4L9 13h2v2l-4.6 4.6L7.8 21l3.2-3.2V22h2v-4.2l3.2 3.2 1.4-1.4L13 15v-2h2l4.6 4.6 1.4-1.4-3.2-3.2H22z"/></svg>';

  // Jauge de boost du jeu, en pixels d'un écran 1920x1080 (mesurée sur le HUD) : distance de son centre
  // aux bords droit et bas, et rayon extérieur (segments de boost compris).
  const GAUGE = { right: 156, bottom: 150, radius: 118 };
  // Panneau : écart avec la jauge, hauteur au-dessus / en dessous du centre, largeur au niveau du centre
  const PANEL = { gap: 12, top: 118, bottom: 100, width: 128 };

  let prev = null;
  let cfg = {};
  let flashTimer = null;
  let hide = new Set();
  let prevMmr = null;
  let layout = 'horizontal';

  function opt(name, fallback) {
    return P.has(name) ? P.get(name) : fallback;
  }

  function applyConfig(conf) {
    cfg = (conf && conf.overlay) || {};
    OT.applyColors(cfg);
    const theme = opt('theme', cfg.theme || 'arena');
    w.className = w.className.replace(/theme-\S+/g, '').trim() + ` theme-${theme}`;
    document.documentElement.style.setProperty('--s', OT.num('scale', Number(cfg.scale) || 1));
    document.body.classList.remove('align-left', 'align-center', 'align-right');
    document.body.classList.add(`align-${opt('align', 'left')}`);
    for (const id of ['lw', 'bLw']) $(id).textContent = opt('lw', cfg.labelWin || 'V');
    for (const id of ['ll', 'bLl']) $(id).textContent = opt('ll', cfg.labelLoss || 'D');
    hide = new Set(String(opt('hide', '')).split(',').filter(Boolean));
    $('stWr').classList.toggle('hidden', hide.has('wr') || cfg.showWinrate === false);
    $('stStreak').classList.toggle('hidden', hide.has('streak') || cfg.showStreak === false);
    $('stOt').classList.toggle('hidden', hide.has('ot') || cfg.showOt === false);

    layout = opt('layout', cfg.layout || 'horizontal');
    const boost = layout === 'boost';
    document.body.classList.toggle('layout-boost', boost);
    w.classList.toggle('hidden', boost);
    w.classList.toggle('vertical', layout === 'vertical');
    $('boost').classList.toggle('hidden', !boost);
    $('bGuide').classList.toggle('hidden', !boost || !(preview || cfg.boostGuide || P.get('guide') === '1'));
    if (boost) layoutBoost();
    render(OT.state, false);
  }

  // ------------------------------------------------------------------ disposition "boost"
  function arcPath(cx, cy, r, a0, a1) {
    const pt = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
    const [x0, y0] = pt(a0);
    const [x1, y1] = pt(a1);
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }

  function layoutBoost() {
    const vs = Math.min(window.innerWidth / 1920, window.innerHeight / 1080) || 1;
    const k = vs * OT.num('bscale', Number(cfg.boostScale) || 1);
    const dx = OT.num('bx', Number(cfg.boostX) || 0) * vs;
    const dy = OT.num('by', Number(cfg.boostY) || 0) * vs;
    const R = GAUGE.radius + PANEL.gap;
    const x0 = Math.sqrt(R * R - PANEL.top * PANEL.top); // centre -> bord droit du panneau, en haut
    const x1 = Math.sqrt(R * R - PANEL.bottom * PANEL.bottom); // idem en bas
    const cx = R + PANEL.width; // centre de la jauge dans le repère du panneau
    const cy = PANEL.top;
    const W = cx - x0;
    const H = PANEL.top + PANEL.bottom;
    const el = $('boost');
    el.style.setProperty('--k', k);
    el.style.width = `${W * k}px`;
    el.style.height = `${H * k}px`;
    el.style.right = `${(GAUGE.right + x0) * k - dx}px`;
    el.style.bottom = `${(GAUGE.bottom - PANEL.bottom) * k - dy}px`;
    $('bSvg').setAttribute('viewBox', `0 0 ${W.toFixed(1)} ${H}`);
    const r = 14;
    // bord droit = arc concentrique à la jauge
    $('bFill').setAttribute('d', `M ${r} 0 L ${W.toFixed(1)} 0 A ${R} ${R} 0 0 0 ${(cx - x1).toFixed(1)} ${H} L ${r} ${H} Q 0 ${H} 0 ${H - r} L 0 ${r} Q 0 0 ${r} 0 Z`);
    $('bRim').setAttribute('d', `M ${W.toFixed(1)} 0 A ${R} ${R} 0 0 0 ${(cx - x1).toFixed(1)} ${H}`);
    // graduations le long de l'arc, comme sur la jauge du jeu
    const aTop = (Math.atan2(-PANEL.top, -x0) * 180) / Math.PI + 360;
    const aBot = (Math.atan2(PANEL.bottom, -x1) * 180) / Math.PI;
    let ticks = '';
    for (let i = 1; i < 8; i++) {
      const a = ((aBot + ((aTop - aBot) * i) / 8) * Math.PI) / 180;
      const len = i === 4 ? 12 : 6;
      ticks += `<line x1="${(cx + (R + 3) * Math.cos(a)).toFixed(1)}" y1="${(cy + (R + 3) * Math.sin(a)).toFixed(1)}" x2="${(cx + (R + 3 + len) * Math.cos(a)).toFixed(1)}" y2="${(cy + (R + 3 + len) * Math.sin(a)).toFixed(1)}"/>`;
    }
    $('bTicks').innerHTML = ticks;
    $('bCol').style.width = `${PANEL.width * k}px`;
    $('bOt').style.left = `${(PANEL.width / 2) * k}px`;

    // repère de calibrage (et fausse jauge dans l'aperçu du tableau de bord)
    const g = $('bGuide');
    g.style.setProperty('--k', k);
    g.style.width = g.style.height = `${GAUGE.radius * 2 * k}px`;
    g.style.right = `${(GAUGE.right - GAUGE.radius) * k - dx}px`;
    g.style.bottom = `${(GAUGE.bottom - GAUGE.radius) * k - dy}px`;
    const D = GAUGE.radius * 2;
    const c = GAUGE.radius;
    $('bGuideSvg').setAttribute('viewBox', `0 0 ${D} ${D}`);
    $('bGuideSvg').innerHTML = preview
      ? `<circle class="core" cx="${c}" cy="${c}" r="94"/>
         <path d="${arcPath(c, c, 106, 100, 232)}" fill="none" stroke="var(--acc)" stroke-width="15" stroke-dasharray="7 3" opacity="0.9"/>
         <circle class="ring" cx="${c}" cy="${c}" r="94"/>
         <text x="${c + 4}" y="${c + 16}" text-anchor="middle" font-size="68">54</text>
         <text x="${c}" y="${c + 44}" text-anchor="middle" font-size="17" font-style="normal">TURBO</text>`
      : `<circle class="ring" cx="${c}" cy="${c}" r="${c - 2}"/><circle class="core" cx="${c}" cy="${c}" r="94"/>
         <text x="${c}" y="${c + 6}" text-anchor="middle" font-size="18">JAUGE DE BOOST</text>`;
  }
  window.addEventListener('resize', () => {
    if (layout === 'boost') layoutBoost();
  });

  function hexRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return null;
    return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  }

  // Couleur de l'équipe, comme la jauge de boost (bleu / orange, ou couleurs de club)
  function accentColor(live) {
    const neutral = '#cfd8e3';
    if (cfg.boostTeamColor === false) return neutral;
    if (!live || !live.inMatch || live.myTeam == null) return preview ? '#ff7f22' : neutral;
    const t = (live.teams || []).find((x) => x.num === live.myTeam);
    const col = t && t.color ? String(t.color).toLowerCase() : '';
    const std = { '#1873ff': '#3a8fff', '#c26418': '#ff7f22' };
    if (std[col]) return std[col];
    const rgb = hexRgb(col);
    if (!rgb) return live.myTeam === 0 ? '#3a8fff' : '#ff7f22';
    return `#${rgb.map((v) => Math.round(v + (255 - v) * 0.25).toString(16).padStart(2, '0')).join('')}`;
  }

  // ------------------------------------------------------------------ rendu commun
  function setNum(el, value, animate) {
    const txt = String(value);
    const cur = el.querySelector('.roll:not(.out)');
    if (cur && cur.textContent === txt) return;
    const down = cur && Number(txt) < Number(cur.textContent);
    if (cur) {
      if (animate) {
        cur.className = `roll out${down ? ' down' : ''}`;
        setTimeout(() => cur.remove(), 480);
      } else cur.remove();
    }
    const n = document.createElement('span');
    n.className = animate ? `roll in${down ? ' down' : ''}` : 'roll';
    n.textContent = txt;
    el.appendChild(n);
  }

  function flash(kind) {
    for (const el of [w, $('boost')]) {
      el.classList.remove('flash-win', 'flash-loss');
      void el.offsetWidth;
      el.classList.add(`flash-${kind}`);
    }
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      for (const el of [w, $('boost')]) el.classList.remove('flash-win', 'flash-loss');
    }, 1000);
  }

  function mmrText(mm) {
    const mode = opt('mmr', cfg.mmrMode || 'session');
    const d = Math.round(mm.delta || 0);
    const dTxt = d > 0 ? `+${d}` : String(d);
    const cls = d > 0 ? 'up' : d < 0 ? 'down' : '';
    if (mode === 'value' && mm.current != null) return { html: String(mm.current), cls: '' };
    if (mode === 'both' && mm.current != null) return { html: `${mm.current}<small class="${cls}">${dTxt}</small>`, cls: '' };
    return { html: dTxt, cls };
  }

  function render(st, animate = true) {
    if (!st) return;
    const s = st.session;
    const live = st.live || {};
    const mm = s.mmr && s.mmr.primary;
    const showMmr = !!mm && cfg.showMmr !== false && !hide.has('mmr') && (mm.current != null || mm.games > 0);
    const streakHtml = s.streak > 0 ? `${ICON_FIRE} ${s.streak}` : s.streak < 0 ? `${ICON_COLD} ${-s.streak}` : '—';
    const inOt = !!(live.inMatch && live.overtime && live.counted && live.me) && cfg.showOtBadge !== false && opt('otbadge', '1') !== '0';

    // horizontal / vertical
    setNum($('wins'), s.wins, animate);
    setNum($('losses'), s.losses, animate);
    $('wr').textContent = s.played ? `${s.winRate}%` : '—';
    const sk = $('stStreak');
    sk.classList.toggle('hot', s.streak > 0);
    sk.classList.toggle('cold', s.streak < 0);
    $('streak').innerHTML = streakHtml;
    $('ot').textContent = `${s.otWins}-${s.otLosses}`;
    $('stMmr').classList.toggle('hidden', !showMmr);
    if (showMmr) {
      const t = mmrText(mm);
      $('mmr').className = t.cls;
      $('mmr').innerHTML = t.html;
      $('mmrLbl').textContent = 'MMR';
    }
    w.classList.toggle('in-ot', inOt);
    if (inOt) $('clk').textContent = OT.fmtClock(live.time, true);
    const showTag = (cfg.showPlaylist || P.get('playlist') === '1') && live.inMatch && live.playlist && live.playlist.name;
    $('tag').classList.toggle('hidden', !showTag);
    if (showTag) $('tagText').textContent = live.playlist.name;

    // boost
    const b = $('boost');
    setNum($('bWins'), s.wins, animate);
    setNum($('bLosses'), s.losses, animate);
    const items = [];
    if (showMmr) {
      const t = mmrText(mm);
      items.push(`<div class="bst"><b class="${t.cls}">${t.html}</b><i>MMR</i></div>`);
    }
    if (cfg.showStreak !== false && !hide.has('streak')) items.push(`<div class="bst"><b class="${s.streak > 0 ? 'hot' : s.streak < 0 ? 'cold' : ''}">${streakHtml}</b><i>série</i></div>`);
    if (cfg.showWinrate !== false && !hide.has('wr')) items.push(`<div class="bst"><b>${s.played ? `${s.winRate}%` : '—'}</b><i>winrate</i></div>`);
    if (cfg.showOt !== false && !hide.has('ot')) items.push(`<div class="bst"><b>${s.otWins}-${s.otLosses}</b><i>OT</i></div>`);
    $('bStats').innerHTML = items.slice(0, 2).join('');
    const acc = accentColor(live);
    const rgb = hexRgb(acc) || [207, 216, 227];
    for (const el of [b, $('bGuide')]) {
      el.style.setProperty('--acc', acc);
      el.style.setProperty('--acc-glow', `rgba(${rgb.join(',')},0.55)`);
    }
    b.classList.toggle('in-ot', inOt);
    if (inOt) $('bClk').textContent = OT.fmtClock(live.time, true);

    if (showMmr && animate) {
      const sig = `${mm.current}|${Math.round(mm.delta || 0)}`;
      if (prevMmr != null && prevMmr !== sig) {
        const cell = $('stMmr');
        cell.classList.remove('bump');
        void cell.offsetWidth;
        cell.classList.add('bump');
      }
      prevMmr = sig;
    }
    if (animate && prev) {
      if (s.wins > prev.wins && s.id === prev.id) flash('win');
      else if (s.losses > prev.losses && s.id === prev.id) flash('loss');
    }
    prev = { wins: s.wins, losses: s.losses, id: s.id };
    w.classList.add('ready');
    b.classList.add('ready');
  }

  OT.on('config', applyConfig);
  OT.on('state', (st) => render(st, true));
  OT.connect({ overlay: 'counter' });
})();
