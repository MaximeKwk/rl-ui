// Compositions RL-UI : un overlay décrit par des données (une toile, des éléments posés dessus), jamais par du code.
// Ce fichier est partagé : l'app le charge pour valider un thème (require), les pages pour l'afficher (window.Compose).
//
// Un élément est un rectangle posé sur la toile : { id, type, x, y, w, h, … }. Types :
//   box      plaque (fond, arrondi, coin coupé, bordure, ombre)
//   text     texte fixe
//   value    valeur en direct (victoires, winrate, MMR, mode de jeu…)
//   image    image du dossier du thème
//   results  les dernières parties, en pastilles
//   bar      barre victoires / défaites
// Tout ce qui n'est pas dans ces listes est refusé ou ramené à une valeur permise : un thème ne peut rien exécuter.
(function (root) {
  const FORMAT = 2;
  const TYPES = ['box', 'text', 'value', 'image', 'results', 'bar'];
  const FONTS = ['Unbounded', 'Onest', 'Barlow Condensed', 'Archivo'];
  // valeurs en direct qu'un élément « value » peut afficher
  const BINDS = ['wins', 'losses', 'record', 'winRate', 'streak', 'bestStreak', 'otRecord', 'mmr', 'mmrDelta', 'played', 'mvps', 'labelWin', 'labelLoss', 'mode', 'clock', 'score'];
  // quand un élément est visible
  const WHEN = ['always', 'match', 'idle', 'overtime', 'winStreak', 'lossStreak', 'mmr'];
  const TOKENS = ['win', 'loss', 'ot', 'white', 'black', 'auto'];
  const LIMITS = { minW: 40, maxW: 1920, minH: 20, maxH: 1080, elements: 80, text: 80, affix: 12, name: 40 };
  const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const num = (v, def, min, max, round = true) => {
    let n = Number(v);
    if (!Number.isFinite(n)) n = def;
    n = Math.min(max, Math.max(min, n));
    return round ? Math.round(n) : Math.round(n * 100) / 100;
  };
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
  const color = (v, def) => {
    const s = String(v || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(s) || TOKENS.includes(s) ? s : def;
  };
  // chemin d'image : relatif au dossier du thème, sans remontée, une image et rien d'autre
  const imagePath = (v) => {
    const s = String(v || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!s || s.length > 120 || !IMAGE_EXT.test(s)) return '';
    if (s.split('/').some((p) => p === '..' || p === '' || p.startsWith('.'))) return '';
    return /^[\w\-./ ]+$/.test(s) ? s : '';
  };

  function typography(e, d = {}) {
    return {
      font: pick(e.font, FONTS, d.font || 'Unbounded'),
      size: num(e.size, d.size || 32, 6, 400),
      weight: num(Math.round(Number(e.weight) / 100) * 100, d.weight || 700, 100, 900),
      italic: !!e.italic,
      upper: !!e.upper,
      spacing: num(e.spacing, 0, -10, 60, false),
      color: color(e.color, d.color || 'white'),
      align: pick(e.align, ['left', 'center', 'right'], d.align || 'left'),
      valign: pick(e.valign, ['top', 'middle', 'bottom'], 'middle'),
      shadow: pick(e.shadow, ['none', 'soft', 'outline'], 'none'),
    };
  }

  // Ramène un élément à ce que le format permet. Renvoie null si son type est inconnu.
  function cleanElement(e, i, seen) {
    if (!isObj(e) || !TYPES.includes(e.type)) return null;
    let id = /^[a-z0-9]{1,16}$/.test(String(e.id || '')) ? String(e.id) : '';
    // identifiant absent, invalide ou déjà pris : on en donne un libre
    for (let k = i + 1; !id || seen.has(id); k++) id = `e${k}`;
    seen.add(id);
    const out = {
      id,
      type: e.type,
      name: str(e.name, LIMITS.name),
      x: num(e.x, 0, -2000, 4000),
      y: num(e.y, 0, -2000, 4000),
      w: num(e.w, 100, 1, 4000),
      h: num(e.h, 40, 1, 4000),
      rotate: num(e.rotate, 0, -180, 180),
      opacity: num(e.opacity == null ? 1 : e.opacity, 1, 0, 1, false),
      when: pick(e.when, WHEN, 'always'),
      hidden: !!e.hidden,
    };
    if (e.type === 'box') {
      Object.assign(out, {
        fill: color(e.fill, '#0a0f11'),
        fillOpacity: num(e.fillOpacity == null ? 1 : e.fillOpacity, 1, 0, 1, false),
        radius: num(e.radius, 0, 0, 400),
        cut: num(e.cut, 0, 0, 400),
        cutCorner: pick(e.cutCorner, ['tr', 'tl', 'br', 'bl'], 'tr'),
        borderWidth: num(e.borderWidth, 0, 0, 40),
        borderColor: color(e.borderColor, 'white'),
        borderOpacity: num(e.borderOpacity == null ? 1 : e.borderOpacity, 1, 0, 1, false),
        shadow: pick(e.shadow, ['none', 'soft', 'strong'], 'none'),
      });
    } else if (e.type === 'text') {
      Object.assign(out, typography(e), { text: str(e.text, LIMITS.text) });
    } else if (e.type === 'value') {
      Object.assign(out, typography(e), { bind: pick(e.bind, BINDS, 'wins'), prefix: str(e.prefix, LIMITS.affix), suffix: str(e.suffix, LIMITS.affix) });
    } else if (e.type === 'image') {
      Object.assign(out, { src: imagePath(e.src), fit: pick(e.fit, ['contain', 'cover', 'fill'], 'contain'), radius: num(e.radius, 0, 0, 400) });
    } else if (e.type === 'results') {
      Object.assign(out, {
        count: num(e.count, 8, 1, 20),
        gap: num(e.gap, 4, 0, 40),
        radius: num(e.radius, 6, 0, 100),
        letters: e.letters !== false,
        dir: pick(e.dir, ['row', 'column'], 'row'),
        font: pick(e.font, FONTS, 'Onest'),
        weight: num(Math.round(Number(e.weight) / 100) * 100, 700, 100, 900),
      });
    } else if (e.type === 'bar') {
      Object.assign(out, { radius: num(e.radius, 4, 0, 100), gap: num(e.gap, 2, 0, 20), dir: pick(e.dir, ['row', 'column'], 'row'), colorWin: color(e.colorWin, 'win'), colorLoss: color(e.colorLoss, 'loss') });
    }
    return out;
  }

  // Ramène une composition à ce que le format permet. Lève une erreur si ce n'en est pas une.
  function clean(comp) {
    if (!isObj(comp) || !Array.isArray(comp.elements)) throw new Error('composition');
    if (comp.elements.length > LIMITS.elements) throw new Error('too-many');
    const seen = new Set();
    return {
      width: num(comp.width, 1000, LIMITS.minW, LIMITS.maxW),
      height: num(comp.height, 220, LIMITS.minH, LIMITS.maxH),
      elements: comp.elements.map((e, i) => cleanElement(e, i, seen)).filter(Boolean),
    };
  }

  // Images utilisées par une composition (pour ne garder que celles-là dans le dossier du thème)
  const images = (comp) => [...new Set(((comp && comp.elements) || []).filter((e) => e.type === 'image' && e.src).map((e) => e.src))];

  // ------------------------------------------------------------------ données affichées
  // À partir de l'état public de l'app (le même que reçoivent les overlays) et des réglages de l'overlay.
  function dataFrom(state, cfg = {}, tr = (k) => k) {
    const s = (state && state.session) || {};
    const live = (state && state.live) || {};
    const mm = s.mmr && s.mmr.primary;
    const fmtClock = (sec, ot) => {
      if (typeof sec !== 'number' || !isFinite(sec)) return '';
      const v = Math.max(0, Math.round(sec));
      return `${ot ? '+' : ''}${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
    };
    const mine = live.myTeam === 0 || live.myTeam === 1 ? live.myTeam : 0;
    const teams = live.teams || [];
    const sc = (n) => (teams.find((t) => t.num === n) || {}).score;
    const inMatch = !!live.inMatch;
    return {
      wins: s.wins || 0,
      losses: s.losses || 0,
      played: s.played || 0,
      winRate: s.played ? s.winRate : null,
      streak: s.streak || 0,
      bestStreak: s.bestWinStreak || 0,
      otWins: s.otWins || 0,
      otLosses: s.otLosses || 0,
      mvps: s.mvps || 0,
      mmr: mm && mm.current != null ? mm.current : null,
      mmrDelta: mm && (mm.current != null || mm.games > 0) ? Math.round(mm.delta || 0) : null,
      labelWin: cfg.labelWin || tr('lbl.w'),
      labelLoss: cfg.labelLoss || tr('lbl.l'),
      mode: inMatch && live.playlist ? live.playlist.name || '' : '',
      clock: inMatch ? fmtClock(live.time, !!live.overtime) : '',
      score: inMatch && sc(mine) != null ? `${sc(mine)} - ${sc(1 - mine)}` : '',
      inMatch,
      overtime: inMatch && !!live.overtime,
      last: (s.last || []).map((r) => ({ r: r.result, ot: !!r.ot })),
    };
  }

  // Jeux de données d'exemple, pour l'éditeur et les aperçus
  function sample(kind = 'idle', tr = (k) => k) {
    const last = 'WWLWLWWWLLWWLWWW'.split('').map((r, i) => ({ r, ot: i % 5 === 3 }));
    const base = { wins: 12, losses: 5, played: 17, winRate: 71, streak: 3, bestStreak: 5, otWins: 2, otLosses: 1, mvps: 4, mmr: 1175, mmrDelta: 45, labelWin: tr('lbl.w'), labelLoss: tr('lbl.l'), mode: '', clock: '', score: '', inMatch: false, overtime: false, last };
    if (kind === 'match') return { ...base, inMatch: true, mode: tr('cmp.sampleMode'), clock: '2:41', score: '2 - 1' };
    if (kind === 'overtime') return { ...base, inMatch: true, overtime: true, mode: tr('cmp.sampleMode'), clock: '+0:37', score: '2 - 2' };
    if (kind === 'cold') return { ...base, wins: 4, losses: 9, played: 13, winRate: 31, streak: -4, mmrDelta: -38, mmr: 1092, last: 'LWLLWLLLWLLLL'.split('').map((r) => ({ r, ot: false })) };
    if (kind === 'empty') return { ...base, wins: 0, losses: 0, played: 0, winRate: null, streak: 0, bestStreak: 0, otWins: 0, otLosses: 0, mvps: 0, mmr: null, mmrDelta: null, last: [] };
    return base;
  }

  // Texte d'une valeur, et sa « teinte » (hausse, baisse, série chaude ou froide) pour la couleur automatique
  function valueOf(bind, d) {
    const sign = (n) => (n > 0 ? `+${n}` : String(n));
    switch (bind) {
      case 'wins':
        return { text: String(d.wins), tone: 'win' };
      case 'losses':
        return { text: String(d.losses), tone: 'loss' };
      case 'record':
        return { text: `${d.wins} - ${d.losses}`, tone: '' };
      case 'winRate':
        return { text: d.winRate == null ? '—' : `${d.winRate}%`, tone: '' };
      case 'streak':
        return { text: d.streak ? String(Math.abs(d.streak)) : '—', tone: d.streak > 0 ? 'hot' : d.streak < 0 ? 'cold' : '' };
      case 'bestStreak':
        return { text: String(d.bestStreak), tone: '' };
      case 'otRecord':
        return { text: `${d.otWins}-${d.otLosses}`, tone: 'ot' };
      case 'mmr':
        return { text: d.mmr == null ? '—' : String(d.mmr), tone: '' };
      case 'mmrDelta':
        return { text: d.mmrDelta == null ? '—' : sign(d.mmrDelta), tone: d.mmrDelta > 0 ? 'win' : d.mmrDelta < 0 ? 'loss' : '' };
      case 'played':
        return { text: String(d.played), tone: '' };
      case 'mvps':
        return { text: String(d.mvps), tone: '' };
      case 'labelWin':
        return { text: d.labelWin, tone: 'win' };
      case 'labelLoss':
        return { text: d.labelLoss, tone: 'loss' };
      case 'mode':
        return { text: d.mode, tone: '' };
      case 'clock':
        return { text: d.clock, tone: d.overtime ? 'ot' : '' };
      case 'score':
        return { text: d.score, tone: '' };
      default:
        return { text: '', tone: '' };
    }
  }

  function visible(when, d) {
    switch (when) {
      case 'match':
        return d.inMatch;
      case 'idle':
        return !d.inMatch;
      case 'overtime':
        return d.overtime;
      case 'winStreak':
        return d.streak >= 2;
      case 'lossStreak':
        return d.streak <= -2;
      case 'mmr':
        return d.mmrDelta != null;
      default:
        return true;
    }
  }

  const api = { FORMAT, TYPES, FONTS, BINDS, WHEN, TOKENS, LIMITS, clean, cleanElement, images, imagePath, dataFrom, sample, valueOf, visible };

  // ------------------------------------------------------------------ affichage (pages seulement)
  if (typeof document !== 'undefined') {
    const TONES = { win: 'var(--win)', loss: 'var(--loss)', ot: 'var(--ot)', hot: '#ffcf5a', cold: '#8fbcff' };
    const css = (c, tone) => {
      if (c === 'auto') return TONES[tone] || '#ffffff';
      if (c === 'win' || c === 'loss' || c === 'ot') return `var(--${c})`;
      if (c === 'white') return '#ffffff';
      if (c === 'black') return '#000000';
      return c;
    };
    const STYLE = `
.cmp { position: relative; flex: none; transform-origin: 0 0; }
.cmp-el { position: absolute; box-sizing: border-box; }
.cmp-el.cmp-off { display: none; }
.cmp-txt { display: flex; white-space: pre; line-height: 1; overflow: visible; }
.cmp-txt > span { display: block; }
.cmp-pop > span { animation: cmp-pop 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.4); }
@keyframes cmp-pop { 0% { transform: translateY(18%) scale(0.92); opacity: 0.4; } 100% { transform: none; opacity: 1; } }
.cmp-box svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; display: block; }
.cmp-img { background-repeat: no-repeat; background-position: center; }
.cmp-res { display: flex; }
.cmp-res i { flex: 1 1 0; min-width: 0; min-height: 0; display: grid; place-items: center; font-style: normal; line-height: 1; overflow: hidden; }
.cmp-res i.rw { background: var(--win); color: #0f2406; }
.cmp-res i.rl { background: var(--loss); color: #2a0b09; }
.cmp-res i.ro { box-shadow: inset 0 3px 0 var(--ot); }
.cmp-res i.rn { background: rgba(255, 255, 255, 0.12); }
.cmp-bar { display: flex; overflow: hidden; }
.cmp-bar i { display: block; flex: 0 0 auto; transition: flex-basis 0.5s ease; }
@media (prefers-reduced-motion: reduce) { .cmp-pop > span { animation: none; } .cmp-bar i { transition: none; } }`;

    function ensureStyle() {
      if (document.getElementById('cmp-style')) return;
      const st = document.createElement('style');
      st.id = 'cmp-style';
      st.textContent = STYLE;
      document.head.appendChild(st);
    }

    // Contour d'une plaque : rectangle arrondi dont un coin peut être coupé
    function boxPath(w, h, radius, cut, corner, inset = 0) {
      const x0 = inset;
      const y0 = inset;
      const x1 = w - inset;
      const y1 = h - inset;
      const ww = x1 - x0;
      const hh = y1 - y0;
      const r = Math.max(0, Math.min(radius - inset, ww / 2, hh / 2));
      const c = Math.max(0, Math.min(cut, ww - r, hh - r));
      const seg = [];
      // chaque coin : arrondi, ou coupé en biais
      const cornerAt = (name, ax, ay, bx, by, cx, cy) => {
        if (c > 0 && corner === name) seg.push(`L${ax} ${ay} L${bx} ${by}`);
        else if (r > 0) seg.push(`L${ax} ${ay} Q${cx} ${cy} ${bx} ${by}`);
        else seg.push(`L${cx} ${cy}`);
      };
      const k = (name) => (c > 0 && corner === name ? c : r);
      seg.push(`M${x0 + k('tl')} ${y0}`);
      cornerAt('tr', x1 - k('tr'), y0, x1, y0 + k('tr'), x1, y0);
      cornerAt('br', x1, y1 - k('br'), x1 - k('br'), y1, x1, y1);
      cornerAt('bl', x0 + k('bl'), y1, x0, y1 - k('bl'), x0, y1);
      cornerAt('tl', x0, y0 + k('tl'), x0 + k('tl'), y0, x0, y0);
      return `${seg.join(' ')} Z`;
    }

    const NS = 'http://www.w3.org/2000/svg';

    function build(e, opts) {
      const el = document.createElement('div');
      el.className = `cmp-el cmp-${e.type === 'value' ? 'txt cmp-value' : e.type === 'text' ? 'txt' : e.type === 'image' ? 'img' : e.type === 'results' ? 'res' : e.type}`;
      el.dataset.id = e.id;
      const st = el.style;
      st.left = `${e.x}px`;
      st.top = `${e.y}px`;
      st.width = `${e.w}px`;
      st.height = `${e.h}px`;
      if (e.rotate) st.transform = `rotate(${e.rotate}deg)`;
      if (e.opacity < 1) st.opacity = String(e.opacity);
      if (e.type === 'box') {
        const s = document.createElementNS(NS, 'svg');
        s.setAttribute('viewBox', `0 0 ${e.w} ${e.h}`);
        s.setAttribute('preserveAspectRatio', 'none');
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', boxPath(e.w, e.h, e.radius, e.cut, e.cutCorner));
        p.setAttribute('fill', css(e.fill));
        p.setAttribute('fill-opacity', String(e.fillOpacity));
        s.appendChild(p);
        if (e.borderWidth > 0) {
          const b = document.createElementNS(NS, 'path');
          b.setAttribute('d', boxPath(e.w, e.h, e.radius, e.cut, e.cutCorner, e.borderWidth / 2));
          b.setAttribute('fill', 'none');
          b.setAttribute('stroke', css(e.borderColor));
          b.setAttribute('stroke-opacity', String(e.borderOpacity));
          b.setAttribute('stroke-width', String(e.borderWidth));
          b.setAttribute('stroke-linejoin', 'round');
          s.appendChild(b);
        }
        if (e.shadow !== 'none') s.style.filter = e.shadow === 'soft' ? 'drop-shadow(0 6px 14px rgba(0,0,0,0.35))' : 'drop-shadow(0 10px 24px rgba(0,0,0,0.6))';
        el.appendChild(s);
      } else if (e.type === 'text' || e.type === 'value') {
        st.fontFamily = `'${e.font}', sans-serif`;
        st.fontSize = `${e.size}px`;
        st.fontWeight = String(e.weight);
        st.fontStyle = e.italic ? 'italic' : 'normal';
        st.letterSpacing = `${e.spacing}px`;
        st.textTransform = e.upper ? 'uppercase' : 'none';
        st.justifyContent = e.align === 'center' ? 'center' : e.align === 'right' ? 'flex-end' : 'flex-start';
        st.alignItems = e.valign === 'top' ? 'flex-start' : e.valign === 'bottom' ? 'flex-end' : 'center';
        st.textShadow = e.shadow === 'soft' ? '0 2px 8px rgba(0,0,0,0.6)' : e.shadow === 'outline' ? '0 2px 0 rgba(0,0,0,0.6), 0 0 2px #000, 0 0 10px rgba(0,0,0,0.7)' : 'none';
        st.color = css(e.color, '');
        const span = document.createElement('span');
        span.textContent = e.type === 'text' ? e.text : '';
        el.appendChild(span);
      } else if (e.type === 'image') {
        if (e.src) st.backgroundImage = `url("${(opts.imageUrl || ((s) => s))(e.src).replace(/"/g, '%22')}")`;
        st.backgroundSize = e.fit === 'fill' ? '100% 100%' : e.fit;
        st.borderRadius = `${e.radius}px`;
      } else if (e.type === 'results') {
        st.flexDirection = e.dir;
        st.gap = `${e.gap}px`;
        st.fontFamily = `'${e.font}', sans-serif`;
        st.fontWeight = String(e.weight);
      } else if (e.type === 'bar') {
        st.flexDirection = e.dir;
        st.gap = `${e.gap}px`;
        st.borderRadius = `${e.radius}px`;
        for (const k of ['Win', 'Loss']) {
          const i = document.createElement('i');
          i.style.background = css(e[`color${k}`]);
          el.appendChild(i);
        }
      }
      return el;
    }

    // Pose une composition dans `host`. Renvoie { el, update(données), nodes } ; update peut être rappelé à volonté.
    function mount(host, comp, opts = {}) {
      ensureStyle();
      const el = document.createElement('div');
      el.className = 'cmp';
      el.style.width = `${comp.width}px`;
      el.style.height = `${comp.height}px`;
      const nodes = new Map();
      for (const e of comp.elements) {
        const n = build(e, opts);
        nodes.set(e.id, n);
        el.appendChild(n);
      }
      host.appendChild(el);
      const prev = new Map();
      let first = true;

      function update(d) {
        for (const e of comp.elements) {
          const n = nodes.get(e.id);
          // dans l'éditeur, un élément conditionnel reste visible (estompé) pour pouvoir être sélectionné
          const on = !e.hidden && visible(e.when, d);
          n.classList.toggle('cmp-off', !on && !opts.editing);
          if (opts.editing) n.classList.toggle('cmp-ghost', !on);
          if (e.type === 'value') {
            const v = valueOf(e.bind, d);
            const text = v.text === '' ? '' : `${e.prefix}${v.text}${e.suffix}`;
            const span = n.firstChild;
            if (span.textContent !== text) {
              span.textContent = text;
              if (!first && opts.animate !== false && prev.get(e.id) !== text) {
                n.classList.remove('cmp-pop');
                void n.offsetWidth;
                n.classList.add('cmp-pop');
              }
              prev.set(e.id, text);
            }
            n.style.color = css(e.color, v.tone);
          } else if (e.type === 'results') {
            const list = d.last.slice(-e.count);
            const sig = list.map((r) => r.r + (r.ot ? 'o' : '')).join('');
            if (n.dataset.sig !== `${sig}|${d.labelWin}|${d.labelLoss}`) {
              n.dataset.sig = `${sig}|${d.labelWin}|${d.labelLoss}`;
              n.textContent = '';
              const size = Math.max(6, Math.round((e.dir === 'row' ? e.h : (e.h - e.gap * (e.count - 1)) / e.count) * 0.46));
              for (let i = 0; i < e.count; i++) {
                const r = list[i - (e.count - list.length)];
                const c = document.createElement('i');
                c.className = r ? `${r.r === 'W' ? 'rw' : 'rl'}${r.ot ? ' ro' : ''}` : 'rn';
                c.style.borderRadius = `${e.radius}px`;
                c.style.fontSize = `${size}px`;
                if (r && e.letters) c.textContent = r.r === 'W' ? d.labelWin : d.labelLoss;
                n.appendChild(c);
              }
            }
          } else if (e.type === 'bar') {
            const total = d.wins + d.losses;
            const p = total ? (d.wins / total) * 100 : 50;
            n.children[0].style.flexBasis = `calc(${p}% - ${e.gap / 2}px)`;
            n.children[1].style.flexBasis = `calc(${100 - p}% - ${e.gap / 2}px)`;
            n.children[0].style.opacity = n.children[1].style.opacity = total ? '1' : '0.35';
          }
        }
        first = false;
      }
      return { el, nodes, update, destroy: () => el.remove() };
    }

    api.mount = mount;
    api.boxPath = boxPath;
    api.cssColor = css;
  }

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Compose = api;
})(typeof window !== 'undefined' ? window : this);
