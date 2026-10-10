// Éditeur de thèmes RL-UI : on compose à la souris le compteur, et si on veut le compteur « Boost », les alertes,
// les dernières parties, le récap de session et l'overlay caster (choisir, déplacer, redimensionner, régler) ; le résultat se voit tout de suite. Ce qui est enregistré est une description en données (voir compose.js),
// jamais du code : c'est ce qui permet de partager un thème sans risque.
(function () {
  const KEY = document.querySelector('meta[name="ot-key"]').content;
  const ID = new URLSearchParams(location.search).get('theme') || '';
  const C = window.Compose;
  const t = OT.t;
  const esc = OT.esc;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  if (OT.params.has('app')) document.body.classList.add('in-app');

  let theme = null; // le thème entier (nom, couleurs, habillage de base, compositions)
  let kind = C.KINDS.includes(OT.params.get('overlay')) ? OT.params.get('overlay') : 'counter'; // overlay en cours d'édition
  let comp = null; // theme[kind] : la composition de cet overlay (null si le thème ne le redessine pas)
  let sel = []; // identifiants des éléments choisis
  let sample = 'idle';
  // situations d'aperçu proposées pour chaque overlay (« a:… » : une alerte de ce type, « c:… » : un moment d'une partie castée)
  const SAMPLES = C.SAMPLES;
  const data = () => C.sampleFor(kind, sample, t);
  // overlays où beaucoup d'éléments n'existent que pour une situation (une alerte, le but, le tableau final) et se superposent
  const staged = () => kind === 'alerts' || kind === 'caster';
  let zoom = 1;
  let dirty = false;
  let active = false; // ce thème est-il celui des overlays ?
  let mounted = null;
  let clip = null;
  let bindsOpen = false;
  const undo = [];
  const redo = [];
  let lastKey = '';
  let lastAt = 0;

  // ------------------------------------------------------------------ outils
  function api(path, opts = {}) {
    const sep = path.includes('?') ? '&' : '?';
    return fetch(`${path}${sep}key=${encodeURIComponent(KEY)}`, opts)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) j.ok = false;
        return j;
      })
      .catch(() => ({ ok: false, error: t('d.unreachable') }));
  }
  const json = (method, path, body) => api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 3400);
  }
  const byId = (id) => (comp ? comp.elements.find((e) => e.id === id) : undefined);
  const chosen = () => sel.map(byId).filter(Boolean);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const imageUrl = (src) => `/themes/${ID}/${src}?v=${Date.now() >> 12}`;
  const ICON = {
    box: '<rect x="4" y="6" width="16" height="12" rx="3" />',
    text: '<path d="M6 7h12M12 7v11" />',
    value: '<path d="M5 17l4-10 4 10M6.5 13.5h5M16 9v8M19 12v5" />',
    image: '<rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 16l5-4 4 3 3-2 4 3" /><circle cx="9" cy="9" r="1.3" />',
    results: '<rect x="4" y="8" width="4" height="8" rx="1" /><rect x="10" y="8" width="4" height="8" rx="1" /><rect x="16" y="8" width="4" height="8" rx="1" />',
    bar: '<path d="M4 12h10" /><path d="M16 12h4" opacity="0.5" />',
    arc: '<path d="M5 17a8 8 0 1 1 14 0" />',
    players: '<path d="M4 7h16M4 12h16M4 17h16" /><path d="M4 9.500h9M4 14.500h5M4 19.500h12" opacity="0.5" />',
    pips: '<path d="M4 12h3M10.500 12h3M17 12h3" stroke-width="3.2" />',
    board: '<rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 10h16M4 14.500h16M10 10v9" />',
    eye: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.500 6-9.500 6S2.500 12 2.500 12z" /><circle cx="12" cy="12" r="2.6" />',
    eyeOff: '<path d="M4 4l16 16M9.5 6.400A9 9 0 0 1 12 6c6 0 9.500 6 9.500 6a16 16 0 0 1-3 3.500M6.200 8A16 16 0 0 0 2.500 12S6 18 12 18a9 9 0 0 0 3-.5" />',
    up: '<path d="M12 18V6M7 11l5-5 5 5" />',
    down: '<path d="M12 6v12M7 13l5 5 5-5" />',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ''}</svg>`;

  // Nom d'un élément dans la liste des calques : celui donné, sinon ce qu'il affiche
  function label(e) {
    if (e.name) return e.name;
    if (e.type === 'text') return e.text || t('e.type.text');
    if (e.type === 'value') return t(`e.bind.${e.bind}`);
    if (e.type === 'image' && e.bind) return t(`e.ibind.${e.bind}`);
    return t(`e.type.${e.type}`);
  }

  // ------------------------------------------------------------------ historique (annuler / rétablir)
  // key : des changements rapprochés du même réglage (une saisie, un glissement) ne font qu'une étape
  function change(fn, key = '') {
    const now = Date.now();
    if (!key || key !== lastKey || now - lastAt > 700) {
      undo.push(JSON.stringify({ theme, sel }));
      if (undo.length > 120) undo.shift();
      redo.length = 0;
    }
    lastKey = key;
    lastAt = now;
    fn();
    setDirty(true);
  }
  function restore(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify({ theme, sel }));
    const s = JSON.parse(from.pop());
    theme = s.theme;
    comp = theme[kind] || null;
    sel = s.sel.filter((id) => byId(id));
    lastKey = '';
    setDirty(true);
    renderAll();
  }
  function setDirty(v) {
    dirty = v;
    const st = $('#edStatus');
    st.className = `pill ${v ? 'wait' : 'ok'}`;
    st.textContent = t(v ? 'e.unsaved' : 'e.saved');
    $('#edUndo').disabled = !undo.length;
    $('#edRedo').disabled = !redo.length;
  }

  // ------------------------------------------------------------------ affichage de la toile
  function renderCanvas() {
    const canvas = $('#edCanvas');
    const host = $('#edComp');
    host.textContent = '';
    // overlay que le thème ne redessine pas : pas de toile, une invitation à le composer
    $('#edWrap').classList.toggle('hidden', !comp);
    $('#edHint').classList.toggle('hidden', !comp);
    $('#edHintAlerts').classList.toggle('hidden', !comp || kind !== 'alerts');
    $('#edHintCaster').classList.toggle('hidden', !comp || kind !== 'caster');
    $('#edHintBoost').classList.toggle('hidden', !comp || kind !== 'boost');
    renderEmpty();
    if (!comp) {
      mounted = null;
      return;
    }
    canvas.style.width = `${comp.width}px`;
    canvas.style.height = `${comp.height}px`;
    canvas.style.transform = `scale(${zoom})`;
    // l'enveloppe prend la taille zoomée : c'est elle qui est centrée et qui fait défiler la zone
    $('#edWrap').style.width = `${comp.width * zoom}px`;
    $('#edWrap').style.height = `${comp.height * zoom}px`;
    for (const k of ['win', 'loss', 'ot']) canvas.style.setProperty(`--${k}`, theme.colors[k] || { win: '#8bd95a', loss: '#f2685f', ot: '#f0b03f' }[k]);
    // alertes : beaucoup d'éléments n'existent que pour un événement et se superposent ; ceux de l'événement
    // affiché restent seuls visibles, les autres ne se montrent (en fantôme) que sélectionnés depuis les calques
    canvas.classList.toggle('quiet', staged());
    renderGauge();
    mounted = C.mount(host, comp, { editing: true, animate: false, imageUrl });
    mounted.update(data());
    for (const e of comp.elements) if (e.hidden) mounted.nodes.get(e.id).style.display = 'none';
    renderOverlay();
    $('#zoomFit').textContent = `${Math.round(zoom * 100)} %`;
  }

  // Compteur « Boost » : la jauge de boost du jeu, dessinée là où elle sera à l'écran (la toile est calée sur le coin bas droit)
  function renderGauge() {
    const g = $('#edGauge');
    g.textContent = '';
    if (kind === 'boost' && comp) g.appendChild(C.gauge(comp, data().teamColor));
  }

  // Overlay non composé : ce qui se passe aujourd'hui, et le bouton pour le dessiner soi-même
  function renderEmpty() {
    const box = $('#edEmpty');
    box.classList.toggle('hidden', !!comp);
    if (comp) return;
    const base = { signature: 'Signature', epure: t('e.base.epure'), contraste: t('e.base.contraste') }[theme.base] || 'Signature';
    box.innerHTML = `<h2>${esc(t(`e.empty.${kind}`))}</h2><p class="muted">${esc(t(kind === 'boost' ? 'e.empty.textBoost' : 'e.empty.text', { b: base }))}</p><button type="button" class="btn primary" id="edCompose">${esc(t('e.empty.go'))}</button><p class="muted small">${esc(t('e.empty.note'))}</p>`;
  }

  // Onglets des overlays : celui qu'on édite, et ceux que le thème redessine (point de couleur)
  function renderKinds() {
    $('#edKinds').innerHTML = C.KINDS.map((k) => `<button type="button" data-kind="${k}" class="${k === kind ? 'on' : ''}" aria-pressed="${k === kind}"><span>${esc(t(`e.kind.${k}`))}</span>${theme[k] ? `<i title="${esc(t('e.kind.drawn'))}"></i>` : ''}</button>`).join('');
    // situations d'aperçu de cet overlay
    const list = SAMPLES[kind];
    if (!list.includes(sample)) sample = list[0];
    $('#edSample').innerHTML = list.map((k) => `<option value="${k}" ${k === sample ? 'selected' : ''}>${esc(sampleName(k))}</option>`).join('');
    $('#edReplay').classList.toggle('hidden', kind !== 'alerts' || !comp);
  }

  const sampleName = (k) => t(k.startsWith('a:') ? `type.${k.slice(2)}` : k.startsWith('c:') ? `e.sample.c.${k.slice(2)}` : `e.sample.${k}`);

  function setKind(k) {
    if (!C.KINDS.includes(k) || k === kind) return;
    kind = k;
    comp = theme[kind] || null;
    sel = [];
    bindsOpen = false;
    lastKey = '';
    renderAll();
    if (comp) fit();
  }

  function bounds(list) {
    const x0 = Math.min(...list.map((e) => e.x));
    const y0 = Math.min(...list.map((e) => e.y));
    const x1 = Math.max(...list.map((e) => e.x + e.w));
    const y1 = Math.max(...list.map((e) => e.y + e.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function renderOverlay(guides = []) {
    const ov = $('#edOverlay');
    const list = chosen();
    if (mounted) for (const [id, n] of mounted.nodes) n.classList.toggle('cmp-picked', sel.includes(id));
    let html = '';
    for (const e of list) {
      const single = list.length === 1;
      html += `<div class="ed-sel ${single ? '' : 'multi'}" style="left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;${e.rotate ? `transform:rotate(${e.rotate}deg);` : ''}border-width:${1.5 / zoom}px">
        ${single ? ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => `<i data-h="${h}" style="transform:scale(${1 / zoom})"></i>`).join('') : ''}
        ${single ? `<span class="dim" style="transform:scale(${1 / zoom});transform-origin:0 0">${e.w} × ${e.h}</span>` : ''}
      </div>`;
    }
    for (const g of guides) html += `<div class="ed-guide ${g.v != null ? 'v' : 'h'}" style="${g.v != null ? `left:${g.v}px;width:${1 / zoom}px` : `top:${g.h}px;height:${1 / zoom}px`}"></div>`;
    ov.innerHTML = html;
  }

  // ------------------------------------------------------------------ calques
  function renderLayers() {
    $('.ed-left').classList.toggle('off', !comp);
    if (!comp) {
      $('#edLayers').innerHTML = '';
      return;
    }
    const rows = [...comp.elements].reverse();
    $('#edLayers').innerHTML = rows.length
      ? rows
          .map(
            (e) => `
      <div class="ed-layer ${sel.includes(e.id) ? 'on' : ''} ${e.hidden ? 'off' : ''}" data-layer="${e.id}" draggable="true" role="button" tabindex="0" aria-pressed="${sel.includes(e.id)}">
        ${icon(e.type)}
        <span class="nm">${esc(label(e))}${e.when !== 'always' ? `<small>${esc(t(`e.when.${e.when}`))}</small>` : ''}</span>
        <span class="acts">
          <button type="button" class="mv" data-lay="up" title="${esc(t('e.forward'))}">${icon('up')}</button>
          <button type="button" class="mv" data-lay="down" title="${esc(t('e.backward'))}">${icon('down')}</button>
          <button type="button" data-lay="eye" title="${esc(t(e.hidden ? 'e.show' : 'e.hide'))}" aria-pressed="${!e.hidden}">${icon(e.hidden ? 'eyeOff' : 'eye')}</button>
        </span>
      </div>`
          )
          .join('')
      : `<p class="muted small">${esc(t('e.noLayers'))}</p>`;
  }

  // ------------------------------------------------------------------ palette
  function renderPalette() {
    // les éléments proposés dépendent de l'overlay : ceux de la session, ou ceux d'une partie castée
    const bindBtn = (b) => `<button type="button" data-addbind="${b}">${esc(t(`e.bind.${b}`))}</button>`;
    const binds = kind === 'caster' ? C.CASTER_GROUPS.map(([g, list]) => `<b>${esc(t(`e.cgroup.${g}`))}</b>${list.map(bindBtn).join('')}`).join('') : C.BINDS_FOR[kind].map(bindBtn).join('');
    $('#edPalette').innerHTML =
      C.TYPES_FOR[kind].map((type) => `<button type="button" data-add="${type}" ${type === 'value' ? `aria-expanded="${bindsOpen}"` : ''}>${icon(type)}<span>${esc(t(`e.type.${type}`))}</span></button>`).join('') +
      (bindsOpen ? `<div class="ed-binds">${binds}</div>` : '');
  }

  function freeId() {
    for (let i = comp.elements.length + 1; ; i++) if (!byId(`e${i}`)) return `e${i}`;
  }

  function addElement(base) {
    if (!comp) return;
    if (comp.elements.length >= C.LIMITS.elements) return toast(t('e.tooMany', { n: C.LIMITS.elements }), 'err');
    const w = base.w || 160;
    const h = base.h || 48;
    const raw = { ...base, w, h, x: Math.round((comp.width - w) / 2), y: Math.round((comp.height - h) / 2) };
    change(() => {
      const e = C.cleanElement(raw, comp.elements.length, new Set(comp.elements.map((x) => x.id)));
      e.id = freeId();
      comp.elements.push(e);
      sel = [e.id];
    });
    renderAll();
  }

  const DEFAULTS = {
    box: () => ({ type: 'box', w: 320, h: 86, fill: '#0a0f11', fillOpacity: 0.94, radius: 16 }),
    text: () => ({ type: 'text', text: t('e.newText'), w: 180, h: 40, font: 'Onest', size: 22, weight: 600, align: 'center' }),
    results: () => ({ type: 'results', w: 280, h: 32, count: 10, gap: 4, radius: 7 }),
    bar: () => ({ type: 'bar', w: 220, h: 10, radius: 5, gap: 2 }),
    arc: () => ({ type: 'arc', w: 120, h: 120, from: 0, to: 360, thickness: 8, color: kind === 'boost' ? 'team' : 'white', ...(kind === 'caster' ? { bind: 'tgBoost', track: 0.18, cap: 'round', color: 'event', when: 'target' } : {}) }),
    players: () => ({ type: 'players', team: 0, w: 330, h: 256, rowH: 58, when: 'boosts' }),
    pips: () => ({ type: 'pips', team: 0, w: 122, h: 8, when: 'series' }),
    board: () => ({ type: 'board', w: 1240, h: 315, rowH: 46, when: 'post' }),
  };

  // ------------------------------------------------------------------ propriétés
  const num = (k, lbl, o = {}) => ({ k, lbl, kind: 'num', ...o });
  const range = (k, lbl, min, max, step) => ({ k, lbl, kind: 'range', min, max, step });
  const pickOf = (k, lbl, opts, o = {}) => ({ k, lbl, kind: 'sel', opts, ...o });
  const colorF = (k, lbl, auto = false) => ({ k, lbl, kind: 'color', auto, wide: true });
  const textF = (k, lbl, o = {}) => ({ k, lbl, kind: 'text', wide: true, ...o });
  const check = (k, lbl) => ({ k, lbl, kind: 'check', wide: true });

  const TYPO = () => [
    pickOf('font', 'e.p.font', C.FONTS.map((f) => [f, f]), { wide: true }),
    num('size', 'e.p.size', { min: 6, max: 400 }),
    pickOf('weight', 'e.p.weight', [300, 400, 500, 600, 700, 800, 900].map((w) => [w, t(`e.w.${w}`)])),
    pickOf('align', 'e.p.align', ['left', 'center', 'right'].map((a) => [a, t(`e.a.${a}`)])),
    pickOf('valign', 'e.p.valign', ['top', 'middle', 'bottom'].map((a) => [a, t(`e.va.${a}`)])),
    num('spacing', 'e.p.spacing', { min: -10, max: 60, step: 0.5 }),
    pickOf('shadow', 'e.p.shadow', ['none', 'soft', 'outline'].map((a) => [a, t(`e.sh.${a}`)])),
    check('upper', 'e.p.upper'),
    check('italic', 'e.p.italic'),
    check('fit', 'e.p.fitText'),
  ];

  function sections(e) {
    const out = [];
    if (e.type === 'text') out.push(['e.s.content', [textF('text', 'e.p.text', { max: C.LIMITS.text })]]);
    if (e.type === 'value') {
      out.push([
        'e.s.content',
        [pickOf('bind', 'e.p.bind', [...new Set([...C.BINDS_FOR[kind], e.bind])].map((b) => [b, t(`e.bind.${b}`)]), { wide: true }), textF('prefix', 'e.p.prefix', { max: C.LIMITS.affix, wide: false }), textF('suffix', 'e.p.suffix', { max: C.LIMITS.affix, wide: false })],
      ]);
    }
    if (e.type === 'image' && (kind === 'caster' || e.bind)) out.push(['e.s.source', [pickOf('bind', 'e.p.ibind', [['', t('e.ibind.none')], ...C.IMAGE_BINDS.map((b) => [b, t(`e.ibind.${b}`)])], { wide: true }), ...(e.bind ? [{ kind: 'note', lbl: 'e.ibind.note' }] : [])]]);
    if (e.type === 'image') out.push(['e.s.content', [...(e.bind ? [] : [{ kind: 'image', wide: true }]), pickOf('fit', 'e.p.fit', ['contain', 'cover', 'fill'].map((a) => [a, t(`e.fit.${a}`)])), num('radius', 'e.p.radius', { min: 0, max: 400 })]]);
    if (e.type === 'text' || e.type === 'value') {
      out.push(['e.s.color', [colorF('color', 'e.p.color', e.type === 'value')]]);
      out.push(['e.s.type', TYPO()]);
    }
    if (e.type === 'box') {
      out.push(['e.s.fill', [colorF('fill', 'e.p.fill'), range('fillOpacity', 'e.p.fillOpacity', 0, 1, 0.01)]]);
      out.push(['e.s.shape', [num('radius', 'e.p.radius', { min: 0, max: 400 }), num('cut', 'e.p.cut', { min: 0, max: 400 }), pickOf('cutCorner', 'e.p.cutCorner', ['tr', 'tl', 'br', 'bl'].map((a) => [a, t(`e.corner.${a}`)])), pickOf('shadow', 'e.p.shadow', ['none', 'soft', 'strong'].map((a) => [a, t(`e.bsh.${a}`)]))]]);
      out.push(['e.s.border', [num('borderWidth', 'e.p.borderWidth', { min: 0, max: 40 }), range('borderOpacity', 'e.p.borderOpacity', 0, 1, 0.01), colorF('borderColor', 'e.p.borderColor')]]);
    }
    if (e.type === 'results') {
      out.push([
        'e.s.content',
        [num('count', 'e.p.count', { min: 1, max: 20 }), num('gap', 'e.p.gap', { min: 0, max: 40 }), num('radius', 'e.p.radius', { min: 0, max: 100 }), pickOf('dir', 'e.p.dir', ['row', 'column'].map((a) => [a, t(`e.dir.${a}`)])), pickOf('font', 'e.p.font', C.FONTS.map((f) => [f, f])), pickOf('weight', 'e.p.weight', [500, 600, 700, 800, 900].map((w) => [w, t(`e.w.${w}`)])), check('letters', 'e.p.letters')],
      ]);
    }
    const team = () => pickOf('team', 'e.p.team', [[0, t('e.team.0')], [1, t('e.team.1')]]);
    const fonts = () => [pickOf('font', 'e.p.font', C.FONTS.map((f) => [f, f]), { wide: true }), num('size', 'e.p.size', { min: 8, max: 80 }), pickOf('weight', 'e.p.weight', [500, 600, 700, 800, 900].map((w) => [w, t(`e.w.${w}`)]))];
    if (e.type === 'arc') {
      const binds = [...new Set([...C.ARC_BINDS_FOR[kind], ...(e.bind ? [e.bind] : [])])];
      out.push(['e.s.shape', [num('from', 'e.p.from', { min: -360, max: 360 }), num('to', 'e.p.to', { min: -360, max: 720 }), num('thickness', 'e.p.thickness', { min: 1, max: 200 }), pickOf('cap', 'e.p.cap', ['butt', 'round'].map((a) => [a, t(`e.cap.${a}`)])), num('ticks', 'e.p.ticks', { min: 0, max: 72 }), num('tickW', 'e.p.tickW', { min: 1, max: 20, step: 0.1 })]]);
      out.push(['e.s.color', [colorF('color', 'e.p.color')]]);
      out.push(['e.s.gauge', [pickOf('bind', 'e.p.arcBind', [['', t('e.arcBind.none')], ...binds.map((b) => [b, t(`e.bind.${b}`)])], { wide: true }), ...(e.bind ? [range('track', 'e.p.track', 0, 1, 0.01)] : [])]]);
    }
    if (e.type === 'players') {
      out.push(['e.s.content', [team(), pickOf('side', 'e.p.side', ['left', 'right'].map((a) => [a, t(`e.a.${a}`)])), num('rowH', 'e.p.rowH', { min: 20, max: 200 }), num('gap', 'e.p.gap', { min: 0, max: 60 }), num('barH', 'e.p.barH', { min: 0, max: 40 }), num('stripe', 'e.p.stripe', { min: 0, max: 30 })]]);
      out.push(['e.s.fill', [colorF('fill', 'e.p.fill'), range('fillOpacity', 'e.p.fillOpacity', 0, 1, 0.01), num('radius', 'e.p.radius', { min: 0, max: 100 })]]);
      out.push(['e.s.type', [...fonts(), colorF('color', 'e.p.color')]]);
    }
    if (e.type === 'pips') out.push(['e.s.content', [team(), num('gap', 'e.p.gap', { min: 0, max: 40 }), num('radius', 'e.p.radius', { min: 0, max: 60 }), check('skew', 'e.p.skew'), colorF('color', 'e.p.color')]]);
    if (e.type === 'board') {
      out.push(['e.s.content', [num('rowH', 'e.p.rowH', { min: 20, max: 160 }), num('stripe', 'e.p.stripe', { min: 0, max: 30 }), range('lines', 'e.p.lines', 0, 1, 0.01), check('header', 'e.p.header')]]);
      out.push(['e.s.fill', [colorF('fill', 'e.p.fill'), range('fillOpacity', 'e.p.fillOpacity', 0, 1, 0.01)]]);
      out.push(['e.s.type', [...fonts(), colorF('color', 'e.p.color')]]);
    }
    if (e.type === 'bar') out.push(['e.s.content', [colorF('colorWin', 'e.p.colorWin'), colorF('colorLoss', 'e.p.colorLoss'), num('radius', 'e.p.radius', { min: 0, max: 100 }), num('gap', 'e.p.gap', { min: 0, max: 20 }), pickOf('dir', 'e.p.dir', ['row', 'column'].map((a) => [a, t(`e.dir.${a}`)]))]]);
    out.push(['e.s.display', [range('opacity', 'e.p.opacity', 0, 1, 0.01), pickOf('when', 'e.p.when', [...new Set([...C.WHEN_FOR[kind], e.when])].map((w) => [w, t(`e.when.${w}`)]), { wide: true }), textF('name', 'e.p.name', { max: C.LIMITS.name })]]);
    return out;
  }

  const SWATCH = { win: 'var(--win)', loss: 'var(--loss)', ot: 'var(--ot)', white: '#ffffff', black: '#000000', event: 'conic-gradient(var(--win), var(--ot), var(--loss), var(--win))', team: 'linear-gradient(135deg, #3a8fff 50%, #ff7f22 50%)', team0: '#1873ff', team1: '#ff7a1a' };
  function field(f, e) {
    const v = f.k ? e[f.k] : null;
    const wide = f.wide ? ' wide' : '';
    if (f.kind === 'num') return `<label class="ed-f${wide}"><span>${esc(t(f.lbl))}</span><input type="number" data-k="${f.k}" value="${v}" min="${f.min}" max="${f.max}" step="${f.step || 1}" /></label>`;
    if (f.kind === 'range') return `<label class="ed-f wide"><span>${esc(t(f.lbl))}</span><span class="row"><input type="range" data-k="${f.k}" value="${v}" min="${f.min}" max="${f.max}" step="${f.step}" /><output>${Math.round(v * 100)} %</output></span></label>`;
    if (f.kind === 'sel') return `<label class="ed-f${wide}"><span>${esc(t(f.lbl))}</span><select data-k="${f.k}">${f.opts.map(([val, txt]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(txt)}</option>`).join('')}</select></label>`;
    if (f.kind === 'text') return `<label class="ed-f${wide}"><span>${esc(t(f.lbl))}</span><input type="text" data-k="${f.k}" value="${esc(v)}" maxlength="${f.max}" /></label>`;
    if (f.kind === 'check') return `<label class="ed-check wide"><input type="checkbox" data-k="${f.k}" ${v ? 'checked' : ''} /> ${esc(t(f.lbl))}</label>`;
    if (f.kind === 'color') {
      // couleurs propres à l'overlay : celle de l'alerte affichée (alertes), de ton équipe (Boost), des équipes (caster)
      const own = C.TOKENS_FOR[kind];
      const tokens = [...new Set([...own, ...(C.TOKENS.includes(v) && v !== 'auto' ? [v] : []), ...(kind === 'caster' ? [] : ['win', 'loss', 'ot']), 'white', 'black'])];
      const tokName = (k) => t(k === 'event' && kind === 'caster' ? 'e.c.eventTeam' : `e.c.${k}`);
      const tokTip = (k) => (k === 'event' ? t(kind === 'caster' ? 'e.c.eventTeamTip' : 'e.c.eventTip') : k === 'team' ? t('e.c.teamTip') : '');
      const custom = /^#/.test(v);
      return `<div class="ed-f wide"><span>${esc(t(f.lbl))}</span><div class="ed-colors" data-color="${f.k}">
        ${f.auto ? `<button type="button" data-tok="auto" class="${v === 'auto' ? 'on' : ''}" title="${esc(t('e.c.autoTip'))}"><i style="background:conic-gradient(var(--win), #ffcf5a, var(--loss), var(--win))"></i>${esc(t('e.c.auto'))}</button>` : ''}
        ${tokens.map((k) => `<button type="button" data-tok="${k}" class="${v === k ? 'on' : ''}" ${tokTip(k) ? `title="${esc(tokTip(k))}"` : ''}><i style="background:${k === 'event' && kind === 'caster' ? SWATCH.team : SWATCH[k]}"></i>${esc(tokName(k))}</button>`).join('')}
        <input type="color" data-k="${f.k}" value="${custom ? v : '#2fd2c6'}" title="${esc(t('e.c.custom'))}" aria-label="${esc(t('e.c.custom'))}" class="${custom ? 'on' : ''}" />
      </div></div>`;
    }
    if (f.kind === 'note') return `<p class="ed-note wide">${esc(t(f.lbl))}</p>`;
    if (f.kind === 'image') return `<div class="ed-f wide"><span>${esc(t('e.p.image'))}</span><div class="ed-img"><i style="${e.src ? `background-image:url('${imageUrl(e.src)}')` : ''}"></i><button type="button" class="btn small" data-do="image">${esc(t(e.src ? 'e.imgChange' : 'e.imgPick'))}</button></div><p class="ed-note">${esc(t('e.imgNote'))}</p></div>`;
    return '';
  }

  const ALIGN = [
    ['left', '<path d="M5 4v16M9 8h10M9 16h6" />'],
    ['hcenter', '<path d="M12 4v16M6 8h12M8 16h8" />'],
    ['right', '<path d="M19 4v16M5 8h10M9 16h6" />'],
    ['top', '<path d="M4 5h16M8 9v10M16 9v6" />'],
    ['vcenter', '<path d="M4 12h16M8 6v12M16 8v8" />'],
    ['bottom', '<path d="M4 19h16M8 5v10M16 9v6" />'],
  ];

  function renderProps() {
    const host = $('#edProps');
    // les pastilles « Victoire / Défaite / Overtime » montrent les couleurs du thème, pas celles de l'app
    for (const k of ['win', 'loss', 'ot']) host.style.setProperty(`--${k}`, theme.colors[k] || { win: '#8bd95a', loss: '#f2685f', ot: '#f0b03f' }[k]);
    const list = chosen();
    if (!list.length) return renderThemeProps(host);
    if (!comp) return;
    const many = list.length > 1;
    const e = list[0];
    const b = bounds(list);
    let html = `<div class="ed-sec"><h3>${esc(many ? t('e.nSelected', { n: list.length }) : label(e))}<span class="muted small">${esc(many ? '' : t(`e.type.${e.type}`))}</span></h3>
      <div class="ed-grid">
        <label class="ed-f"><span>X</span><input type="number" data-geo="x" value="${b.x}" /></label>
        <label class="ed-f"><span>Y</span><input type="number" data-geo="y" value="${b.y}" /></label>
        ${many ? '' : `<label class="ed-f"><span>${esc(t('e.p.w'))}</span><input type="number" data-k="w" value="${e.w}" min="1" max="4000" /></label>
        <label class="ed-f"><span>${esc(t('e.p.h'))}</span><input type="number" data-k="h" value="${e.h}" min="1" max="4000" /></label>
        <label class="ed-f wide"><span>${esc(t('e.p.rotate'))}</span><span class="row"><input type="range" data-k="rotate" value="${e.rotate}" min="-180" max="180" step="1" /><output>${e.rotate}°</output></span></label>`}
      </div>
      <p class="ed-note">${esc(t(many ? 'e.alignSel' : 'e.alignCanvas'))}</p>
      <div class="ed-align">${ALIGN.map(([k, p]) => `<button type="button" data-align="${k}" title="${esc(t(`e.al.${k}`))}" aria-label="${esc(t(`e.al.${k}`))}"><svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg></button>`).join('')}</div>
      <div class="ed-tools">
        ${list.length >= 3 ? `<button type="button" data-do="disth" title="${esc(t('e.distH'))}">↔</button><button type="button" data-do="distv" title="${esc(t('e.distV'))}">↕</button>` : ''}
        <button type="button" data-do="dup" title="${esc(t('e.dup'))} (Ctrl + D)">${esc(t('e.dupShort'))}</button>
        <button type="button" data-do="front" title="${esc(t('e.front'))}">${icon('up')}</button>
        <button type="button" data-do="back" title="${esc(t('e.back'))}">${icon('down')}</button>
        <button type="button" class="danger" data-do="del" title="${esc(t('e.del'))} (Suppr)">${esc(t('e.delShort'))}</button>
      </div></div>`;
    if (!many) for (const [title, fields] of sections(e)) html += `<div class="ed-sec"><h3>${esc(t(title))}</h3><div class="ed-grid">${fields.map((f) => field(f, e)).join('')}</div></div>`;
    host.innerHTML = html;
  }

  function renderThemeProps(host) {
    const c = theme.colors;
    host.innerHTML = `
      <div class="ed-sec"><h3>${esc(t('e.s.theme'))}</h3>
        <div class="ed-grid">
          <label class="ed-f wide"><span>${esc(t('e.t.desc'))}</span><textarea data-t="description" maxlength="300">${esc(theme.description)}</textarea></label>
          <label class="ed-f"><span>${esc(t('e.t.author'))}</span><input type="text" data-t="author" value="${esc(theme.author)}" maxlength="60" /></label>
          <label class="ed-f"><span>${esc(t('e.t.version'))}</span><input type="text" data-t="version" value="${esc(theme.version)}" maxlength="11" /></label>
        </div>
        <p class="ed-note">${esc(t('e.t.tags'))}</p>
        <div class="ed-tags">${['minimal', 'competitive', 'neon', 'dark', 'light', 'colorful', 'retro', 'esport', 'compact', 'vertical'].map((k) => `<label><input type="checkbox" data-tag="${k}" ${theme.tags.includes(k) ? 'checked' : ''} />${esc(t(`e.tag.${k}`))}</label>`).join('')}</div>
      </div>
      <div class="ed-sec"><h3>${esc(t('e.s.colors'))}</h3>
        <div class="ed-grid three">${['win', 'loss', 'ot'].map((k) => `<label class="ed-f"><span>${esc(t(`e.c.${k}`))}</span><input type="color" data-tc="${k}" value="${c[k] || { win: '#8bd95a', loss: '#f2685f', ot: '#f0b03f' }[k]}" /></label>`).join('')}</div>
        <p class="ed-note">${esc(t('e.t.colorsNote'))}</p>
      </div>
      ${comp
        ? `<div class="ed-sec"><h3>${esc(t('e.s.canvas'))} <span class="muted small">${esc(t(`e.kind.${kind}`))}</span></h3>
        <div class="ed-grid">
          <label class="ed-f"><span>${esc(t('e.p.w'))}</span><input type="number" data-cv="width" value="${comp.width}" min="${C.LIMITS.minW}" max="${C.LIMITS.maxW}" /></label>
          <label class="ed-f"><span>${esc(t('e.p.h'))}</span><input type="number" data-cv="height" value="${comp.height}" min="${C.LIMITS.minH}" max="${C.LIMITS.maxH}" /></label>
          ${kind === 'alerts' ? `<label class="ed-f wide"><span>${esc(t('e.t.enter'))}</span><select data-cv="enter">${C.ENTER.map((k) => `<option value="${k}" ${(comp.enter || 'slide') === k ? 'selected' : ''}>${esc(t(`e.enter.${k}`))}</option>`).join('')}</select></label>` : ''}
        </div>
        <p class="ed-note">${esc(t(kind === 'counter' ? 'e.t.canvasNote' : `e.t.canvasNote.${kind}`))}</p>
        ${kind === 'boost' ? `<label class="ed-check"><input type="checkbox" data-cv="gaugeCut" ${comp.gaugeGap != null ? 'checked' : ''} /> ${esc(t('e.t.gaugeCut'))}</label>
        ${comp.gaugeGap != null ? `<div class="ed-grid"><label class="ed-f"><span>${esc(t('e.t.gaugeGap'))}</span><input type="number" data-cv="gaugeGap" value="${comp.gaugeGap}" min="0" max="80" /></label></div>` : ''}` : ''}
        <label class="ed-check"><input type="checkbox" id="edChecker" ${$('#edCanvas').classList.contains('checker') ? 'checked' : ''} /> ${esc(t('e.t.checker'))}</label>
        ${kind === 'counter' ? '' : `<button type="button" class="btn small ghost danger ed-uncompose" data-do="uncompose">${esc(t('e.uncompose'))}</button>`}
      </div>`
        : ''}
      <div class="ed-sec"><h3>${esc(t('e.s.base'))}</h3>
        <label class="ed-f wide"><span>${esc(t('e.t.base'))}</span><select data-t="base">${[['signature', 'Signature'], ['epure', t('e.base.epure')], ['contraste', t('e.base.contraste')]].map(([k, n]) => `<option value="${k}" ${theme.base === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        <p class="ed-note">${esc(t('e.t.baseNote'))}</p>
      </div>`;
  }

  function renderAll() {
    renderKinds();
    renderCanvas();
    renderLayers();
    renderProps();
    renderPalette();
    const name = $('#edName');
    if (document.activeElement !== name) name.value = theme.name;
    $('#edApply').textContent = t(active ? 'e.applied' : 'e.apply');
    $('#edApply').disabled = active;
  }

  // ------------------------------------------------------------------ modifications
  function setProp(k, raw, el) {
    const list = chosen();
    if (!list.length) return;
    change(() => {
      for (const e of list) {
        const next = C.cleanElement({ ...e, [k]: raw }, 0, new Set());
        e[k] = next[k];
      }
    }, `prop:${k}:${sel.join(',')}`);
    // on ne redessine que la toile : le champ en cours de saisie garde le curseur
    renderCanvas();
    if (k === 'name' || k === 'text' || k === 'bind' || k === 'when') renderLayers();
    // (une image liée n'a plus de fichier à choisir, un arc lié gagne son réglage de fond)
    if (k === 'bind' && list[0].type !== 'value') renderProps();
    if (el && el.type === 'range') {
      const out = el.parentElement.querySelector('output');
      if (out) out.textContent = k === 'rotate' ? `${list[0][k]}°` : `${Math.round(list[0][k] * 100)} %`;
    }
  }

  function moveSel(dx, dy, key) {
    const list = chosen();
    if (!list.length || (!dx && !dy)) return;
    change(() => {
      for (const e of list) {
        e.x = clamp(e.x + dx, -2000, 4000);
        e.y = clamp(e.y + dy, -2000, 4000);
      }
    }, key);
  }

  function align(kind) {
    const list = chosen();
    if (!list.length) return;
    // un seul élément : par rapport à la toile ; plusieurs : par rapport à leur ensemble
    const ref = list.length > 1 ? bounds(list) : { x: 0, y: 0, w: comp.width, h: comp.height };
    change(() => {
      for (const e of list) {
        if (kind === 'left') e.x = ref.x;
        if (kind === 'hcenter') e.x = Math.round(ref.x + (ref.w - e.w) / 2);
        if (kind === 'right') e.x = ref.x + ref.w - e.w;
        if (kind === 'top') e.y = ref.y;
        if (kind === 'vcenter') e.y = Math.round(ref.y + (ref.h - e.h) / 2);
        if (kind === 'bottom') e.y = ref.y + ref.h - e.h;
      }
    });
    renderAll();
  }

  // Répartit trois éléments ou plus à intervalles égaux
  function distribute(axis) {
    const list = chosen();
    if (list.length < 3) return;
    const pos = axis === 'h' ? 'x' : 'y';
    const size = axis === 'h' ? 'w' : 'h';
    const sorted = [...list].sort((a, b) => a[pos] - b[pos]);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const free = last[pos] + last[size] - first[pos] - sorted.reduce((s, e) => s + e[size], 0);
    const gap = free / (sorted.length - 1);
    change(() => {
      let at = first[pos];
      for (const e of sorted) {
        e[pos] = Math.round(at);
        at += e[size] + gap;
      }
    });
    renderAll();
  }

  function removeSel() {
    if (!sel.length) return;
    change(() => {
      comp.elements = comp.elements.filter((e) => !sel.includes(e.id));
      sel = [];
    });
    renderAll();
  }

  function duplicate(list = chosen(), offset = 14) {
    if (!list.length) return;
    if (comp.elements.length + list.length > C.LIMITS.elements) return toast(t('e.tooMany', { n: C.LIMITS.elements }), 'err');
    change(() => {
      const ids = [];
      for (const e of list) {
        const copy = { ...JSON.parse(JSON.stringify(e)), id: freeId(), x: e.x + offset, y: e.y + offset };
        comp.elements.push(copy);
        ids.push(copy.id);
      }
      sel = ids;
    });
    renderAll();
  }

  // Ordre des calques : dir = +1 (vers l'avant), -1 (vers l'arrière), 'front', 'back'
  function reorder(ids, dir) {
    change(() => {
      const els = comp.elements;
      const pick = els.filter((e) => ids.includes(e.id));
      if (dir === 'front' || dir === 'back') {
        const rest = els.filter((e) => !ids.includes(e.id));
        comp.elements = dir === 'front' ? [...rest, ...pick] : [...pick, ...rest];
        return;
      }
      const order = dir > 0 ? [...pick].reverse() : pick;
      for (const e of order) {
        const i = comp.elements.indexOf(e);
        const j = i + dir;
        if (j < 0 || j >= comp.elements.length || ids.includes(comp.elements[j].id)) continue;
        [comp.elements[i], comp.elements[j]] = [comp.elements[j], comp.elements[i]];
      }
    });
    renderAll();
  }

  // ------------------------------------------------------------------ souris sur la toile
  const SNAP = 6;
  // Lignes sur lesquelles un bord peut s'aimanter : la toile et les autres éléments
  function snapLines(skip) {
    const xs = [0, comp.width / 2, comp.width];
    const ys = [0, comp.height / 2, comp.height];
    for (const e of comp.elements) {
      if (skip.includes(e.id) || e.hidden) continue;
      xs.push(e.x, e.x + e.w / 2, e.x + e.w);
      ys.push(e.y, e.y + e.h / 2, e.y + e.h);
    }
    return { xs, ys };
  }
  // Cherche le plus petit décalage qui pose un des points sur une des lignes
  function snap(points, lines, on) {
    if (!on) return { d: 0, line: null };
    let best = { d: 0, line: null, gap: SNAP / zoom + 0.01 };
    for (const p of points) {
      for (const l of lines) {
        const gap = Math.abs(l - p);
        if (gap < best.gap) best = { d: l - p, line: l, gap };
      }
    }
    return best;
  }

  function toCanvas(ev) {
    const r = $('#edCanvas').getBoundingClientRect();
    return { x: (ev.clientX - r.left) / zoom, y: (ev.clientY - r.top) / zoom };
  }

  let drag = null;
  $('#edCanvas').addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    $('#edStage').focus({ preventScroll: true });
    const handle = ev.target.closest('.ed-sel i');
    const node = ev.target.closest('.cmp-el');
    const p = toCanvas(ev);
    if (handle && sel.length === 1) {
      const e = byId(sel[0]);
      drag = { kind: 'size', h: handle.dataset.h, p, start: { x: e.x, y: e.y, w: e.w, h: e.h }, id: e.id, moved: false };
    } else if (node) {
      const id = node.dataset.id;
      if (ev.shiftKey) sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
      else if (!sel.includes(id)) sel = [id];
      drag = { kind: 'move', p, start: chosen().map((e) => ({ id: e.id, x: e.x, y: e.y })), moved: false };
      renderOverlay();
      renderLayers();
      renderProps();
    } else {
      sel = [];
      renderOverlay();
      renderLayers();
      renderProps();
      return;
    }
    ev.preventDefault();
    $('#edCanvas').setPointerCapture(ev.pointerId);
  });

  $('#edCanvas').addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const p = toCanvas(ev);
    let dx = Math.round(p.x - drag.p.x);
    let dy = Math.round(p.y - drag.p.y);
    if (!drag.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    const guides = [];
    const snapOn = !ev.altKey;
    if (!drag.moved) {
      // une seule étape d'historique pour tout le geste
      undo.push(JSON.stringify({ theme, sel }));
      redo.length = 0;
      drag.moved = true;
    }
    if (drag.kind === 'move') {
      const lines = snapLines(sel);
      const els = chosen();
      const b0 = bounds(drag.start.map((s) => ({ ...byId(s.id), x: s.x, y: s.y })));
      const sx = snap([b0.x + dx, b0.x + dx + b0.w / 2, b0.x + dx + b0.w], lines.xs, snapOn);
      const sy = snap([b0.y + dy, b0.y + dy + b0.h / 2, b0.y + dy + b0.h], lines.ys, snapOn);
      dx += Math.round(sx.d);
      dy += Math.round(sy.d);
      if (sx.line != null) guides.push({ v: sx.line });
      if (sy.line != null) guides.push({ h: sy.line });
      for (const s of drag.start) {
        const e = byId(s.id);
        e.x = s.x + dx;
        e.y = s.y + dy;
        const n = mounted.nodes.get(e.id);
        n.style.left = `${e.x}px`;
        n.style.top = `${e.y}px`;
      }
      void els;
    } else {
      const e = byId(drag.id);
      const s = drag.start;
      const lines = snapLines([e.id]);
      let { x, y, w, h } = s;
      const H = drag.h;
      if (H.includes('e')) {
        const sn = snap([s.x + s.w + dx], lines.xs, snapOn);
        w = Math.max(4, s.w + dx + Math.round(sn.d));
        if (sn.line != null) guides.push({ v: sn.line });
      }
      if (H.includes('w')) {
        const sn = snap([s.x + dx], lines.xs, snapOn);
        const nx = Math.min(s.x + s.w - 4, s.x + dx + Math.round(sn.d));
        w = s.x + s.w - nx;
        x = nx;
        if (sn.line != null) guides.push({ v: sn.line });
      }
      if (H.includes('s')) {
        const sn = snap([s.y + s.h + dy], lines.ys, snapOn);
        h = Math.max(4, s.h + dy + Math.round(sn.d));
        if (sn.line != null) guides.push({ h: sn.line });
      }
      if (H.includes('n')) {
        const sn = snap([s.y + dy], lines.ys, snapOn);
        const ny = Math.min(s.y + s.h - 4, s.y + dy + Math.round(sn.d));
        h = s.y + s.h - ny;
        y = ny;
        if (sn.line != null) guides.push({ h: sn.line });
      }
      Object.assign(e, { x, y, w, h });
      // une plaque est dessinée à sa taille : on la reconstruit ; le reste suit en changeant ses dimensions
      if (e.type === 'box' || e.type === 'results') renderCanvasKeep();
      else {
        const n = mounted.nodes.get(e.id);
        Object.assign(n.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      }
    }
    renderOverlay(guides);
  });

  function renderCanvasKeep() {
    const host = $('#edComp');
    host.textContent = '';
    // alertes : beaucoup d'éléments n'existent que pour un événement et se superposent ; ceux de l'événement
    // affiché restent seuls visibles, les autres ne se montrent (en fantôme) que sélectionnés depuis les calques
    canvas.classList.toggle('quiet', kind === 'alerts');
    mounted = C.mount(host, comp, { editing: true, animate: false, imageUrl });
    mounted.update(data());
    for (const e of comp.elements) if (e.hidden) mounted.nodes.get(e.id).style.display = 'none';
  }

  const endDrag = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) {
      lastKey = '';
      setDirty(true);
      renderAll();
    }
  };
  $('#edCanvas').addEventListener('pointerup', endDrag);
  $('#edCanvas').addEventListener('pointercancel', endDrag);

  // ------------------------------------------------------------------ clavier
  document.addEventListener('keydown', (ev) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      return save();
    }
    if (typing) return;
    if (!comp && !(mod && /^[zy]$/i.test(ev.key))) return;
    if (mod && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      return ev.shiftKey ? restore(redo, undo) : restore(undo, redo);
    }
    if (mod && ev.key.toLowerCase() === 'y') {
      ev.preventDefault();
      return restore(redo, undo);
    }
    if (mod && ev.key.toLowerCase() === 'd') {
      ev.preventDefault();
      return duplicate();
    }
    if (mod && ev.key.toLowerCase() === 'c' && sel.length) {
      clip = JSON.stringify(chosen());
      return;
    }
    if (mod && ev.key.toLowerCase() === 'v' && clip) {
      ev.preventDefault();
      return duplicate(JSON.parse(clip), 20);
    }
    if (mod && ev.key.toLowerCase() === 'a') {
      ev.preventDefault();
      sel = comp.elements.filter((e) => !e.hidden).map((e) => e.id);
      return renderAll();
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      return removeSel();
    }
    if (ev.key === 'Escape') {
      sel = [];
      return renderAll();
    }
    const step = ev.shiftKey ? 10 : 1;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[ev.key] && sel.length) {
      ev.preventDefault();
      moveSel(arrows[ev.key][0], arrows[ev.key][1], `nudge:${sel.join(',')}`);
      renderCanvas();
      renderProps();
    }
    if (ev.key === ']' && sel.length) reorder(sel, 1);
    if (ev.key === '[' && sel.length) reorder(sel, -1);
  });

  // ------------------------------------------------------------------ panneau de droite
  $('#edProps').addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.k) {
      const v = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value;
      if (el.type === 'number' && el.value === '') return;
      setProp(el.dataset.k, v, el);
      if (el.type === 'color') {
        $$('button', el.parentElement).forEach((b) => b.classList.remove('on'));
        el.classList.add('on');
      }
      return;
    }
    if (el.dataset.geo && el.value !== '') {
      const b = bounds(chosen());
      const d = Number(el.value) - b[el.dataset.geo];
      moveSel(el.dataset.geo === 'x' ? d : 0, el.dataset.geo === 'y' ? d : 0, `geo:${el.dataset.geo}:${sel.join(',')}`);
      renderCanvas();
      return;
    }
    if (el.dataset.t) {
      change(() => (theme[el.dataset.t] = el.value), `theme:${el.dataset.t}`);
      return;
    }
    if (el.dataset.tag) {
      change(() => {
        const set = new Set(theme.tags);
        if (el.checked) set.add(el.dataset.tag);
        else set.delete(el.dataset.tag);
        theme.tags = [...set].slice(0, 5);
      });
      if (theme.tags.length >= 5) toast(t('e.t.tagsMax'));
      return renderProps();
    }
    if (el.dataset.tc) {
      change(() => (theme.colors[el.dataset.tc] = el.value), `tc:${el.dataset.tc}`);
      return renderCanvas();
    }
    if (el.dataset.cv === 'gaugeCut') {
      change(() => {
        if (el.checked) comp.gaugeGap = 12;
        else delete comp.gaugeGap;
      });
      renderCanvas();
      return renderProps();
    }
    if (el.dataset.cv === 'gaugeGap') {
      if (el.value === '') return;
      change(() => (comp.gaugeGap = clamp(Math.round(Number(el.value)), 0, 80)), 'cv:gaugeGap');
      return renderCanvas();
    }
    if (el.dataset.cv === 'enter') {
      change(() => (comp.enter = C.ENTER.includes(el.value) ? el.value : 'slide'));
      if (mounted) mounted.enter(comp.enter);
      return;
    }
    if (el.dataset.cv && el.value !== '') {
      const k = el.dataset.cv;
      const lim = k === 'width' ? [C.LIMITS.minW, C.LIMITS.maxW] : [C.LIMITS.minH, C.LIMITS.maxH];
      change(() => (comp[k] = clamp(Math.round(Number(el.value)), lim[0], lim[1])), `cv:${k}`);
      return renderCanvas();
    }
    if (el.id === 'edChecker') $('#edCanvas').classList.toggle('checker', el.checked);
  });

  $('#edProps').addEventListener('click', (ev) => {
    const tok = ev.target.closest('[data-tok]');
    if (tok) {
      setProp(tok.parentElement.dataset.color, tok.dataset.tok);
      return renderProps();
    }
    const al = ev.target.closest('[data-align]');
    if (al) return align(al.dataset.align);
    const act = ev.target.closest('[data-do]');
    if (!act) return;
    const d = act.dataset.do;
    if (d === 'del') removeSel();
    else if (d === 'dup') duplicate();
    else if (d === 'front') reorder(sel, 'front');
    else if (d === 'back') reorder(sel, 'back');
    else if (d === 'disth') distribute('h');
    else if (d === 'distv') distribute('v');
    else if (d === 'image') pickImage(sel[0]);
    else if (d === 'uncompose') uncompose();
  });

  // ---- composer / ne plus composer un overlay (alertes, dernières parties, récap)
  async function compose() {
    const r = await api(`/api/themes/starter?overlay=${kind}`);
    if (!r.ok || !r.composition) return toast(r.error || t('d.failed'), 'err');
    change(() => {
      theme[kind] = r.composition;
      comp = theme[kind];
      sel = [];
    });
    renderAll();
    fit();
  }
  function uncompose() {
    if (kind === 'counter' || !comp || !window.confirm(t('e.uncomposeQ', { n: t(`e.kind.${kind}`) }))) return;
    change(() => {
      theme[kind] = null;
      comp = null;
      sel = [];
    });
    renderAll();
  }
  $('#edEmpty').addEventListener('click', (ev) => {
    if (ev.target.closest('#edCompose')) compose();
  });
  $('#edKinds').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-kind]');
    if (b) setKind(b.dataset.kind);
  });
  $('#edReplay').addEventListener('click', () => {
    if (mounted && comp) mounted.enter(comp.enter || 'slide');
  });

  // ------------------------------------------------------------------ calques et palette
  $('#edLayers').addEventListener('click', (ev) => {
    const row = ev.target.closest('[data-layer]');
    if (!row) return;
    const id = row.dataset.layer;
    const b = ev.target.closest('[data-lay]');
    if (b) {
      if (b.dataset.lay === 'eye') {
        change(() => {
          const e = byId(id);
          e.hidden = !e.hidden;
        });
        return renderAll();
      }
      return reorder([id], b.dataset.lay === 'up' ? 1 : -1);
    }
    if (ev.shiftKey) sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    else sel = [id];
    renderAll();
  });
  $('#edLayers').addEventListener('keydown', (ev) => {
    const row = ev.target.closest('[data-layer]');
    if (row && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      sel = [row.dataset.layer];
      renderAll();
    }
  });
  // glisser un calque pour changer l'ordre
  let dragLayer = null;
  $('#edLayers').addEventListener('dragstart', (ev) => {
    const row = ev.target.closest('[data-layer]');
    if (!row) return;
    dragLayer = row.dataset.layer;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', dragLayer);
  });
  $('#edLayers').addEventListener('dragover', (ev) => {
    const row = ev.target.closest('[data-layer]');
    if (!row || !dragLayer) return;
    ev.preventDefault();
    $$('.ed-layer.over').forEach((r) => r.classList.remove('over'));
    row.classList.add('over');
  });
  $('#edLayers').addEventListener('drop', (ev) => {
    const row = ev.target.closest('[data-layer]');
    if (!row || !dragLayer || row.dataset.layer === dragLayer) return;
    ev.preventDefault();
    const target = row.dataset.layer;
    change(() => {
      const moving = byId(dragLayer);
      comp.elements = comp.elements.filter((e) => e !== moving);
      // la liste est affichée à l'envers : déposer « sur » un calque place l'élément juste devant lui
      comp.elements.splice(comp.elements.indexOf(byId(target)) + 1, 0, moving);
      sel = [moving.id];
    });
    dragLayer = null;
    renderAll();
  });
  $('#edLayers').addEventListener('dragend', () => {
    dragLayer = null;
    $$('.ed-layer.over').forEach((r) => r.classList.remove('over'));
  });

  $('#edPalette').addEventListener('click', (ev) => {
    const bind = ev.target.closest('[data-addbind]');
    if (bind) {
      const b = bind.dataset.addbind;
      const big = b === 'wins' || b === 'losses' || b === 'record';
      bindsOpen = false;
      // un titre d'alerte : grand, de la couleur de l'alerte, rétréci s'il est long
      if (b === 'alertTitle') return addElement({ type: 'value', bind: b, w: Math.min(900, comp.width - 40), h: 110, size: 88, weight: 800, align: 'left', color: 'event', fit: true });
      if (kind === 'caster') {
        const big = /^(teamScore|finalScore|matchClock)/.test(b);
        const name = /Name|Scorer|Line|Text|Title|Info|Assist|tgTeam/.test(b);
        const when = (C.CASTER_GROUPS.find((g) => g[1].includes(b)) || [])[0];
        return addElement({ type: 'value', bind: b, font: 'Barlow Condensed', weight: 900, w: big ? 150 : name ? 300 : 90, h: big ? 78 : 44, size: big ? 60 : name ? 34 : 28, align: name ? 'left' : 'center', fit: name, color: b === 'matchClock' || b === 'clockNote' ? 'auto' : 'white', when: { target: 'target', goal: 'goal', feed: 'feed', post: 'post', series: 'series' }[when] || 'always' });
      }
      if (b === 'alertDetail' || b === 'player') return addElement({ type: 'value', bind: b, w: 420, h: 40, font: 'Onest', size: 26, weight: 700, align: 'left', fit: true });
      return addElement({ type: 'value', bind: b, w: big ? 150 : 120, h: big ? 64 : 40, size: big ? 44 : 24, weight: 700, align: 'center', color: ['wins', 'losses', 'streak', 'mmrDelta', 'labelWin', 'labelLoss', 'matchMmr', 'goalDiff'].includes(b) ? 'auto' : 'white' });
    }
    const b = ev.target.closest('[data-add]');
    if (!b) return;
    const type = b.dataset.add;
    if (type === 'value') {
      bindsOpen = !bindsOpen;
      return renderPalette();
    }
    if (type === 'image' && kind === 'caster') return addElement({ type: 'image', bind: 'teamLogo0', w: 58, h: 58 });
    if (type === 'image') return pickImage(null);
    addElement(DEFAULTS[type]());
  });

  // ------------------------------------------------------------------ images
  let imageFor = null;
  function pickImage(id) {
    imageFor = id;
    $('#edFile').value = '';
    $('#edFile').click();
  }
  $('#edFile').addEventListener('change', async () => {
    const f = $('#edFile').files[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return toast(t('s.imageTooBig'), 'err');
    const r = await api(`/api/themes/${ID}/image?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
    if (!r.ok) return toast(r.error || t('d.failed'), 'err');
    // taille de départ : celle de l'image, ramenée dans la toile
    const dim = await new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => resolve({ w: 120, h: 120 });
      im.src = imageUrl(r.src);
    });
    const k = Math.min(1, (comp.width * 0.5) / dim.w, (comp.height * 0.8) / dim.h);
    if (imageFor && byId(imageFor)) {
      change(() => (byId(imageFor).src = r.src));
      renderAll();
    } else addElement({ type: 'image', src: r.src, w: Math.max(8, Math.round(dim.w * k)), h: Math.max(8, Math.round(dim.h * k)) });
    // l'image est dans le dossier du thème ; elle n'y reste que si le thème enregistré s'en sert
    toast(t('e.imgAdded'), 'ok');
  });

  // ------------------------------------------------------------------ barre du haut
  $('#edName').addEventListener('input', (ev) => change(() => (theme.name = ev.target.value), 'theme:name'));
  $('#edSample').addEventListener('change', (ev) => {
    sample = ev.target.value;
    renderCanvas();
    if (kind === 'alerts' && mounted && comp) mounted.enter(comp.enter || 'slide');
    // (en changeant de situation, un élément choisi peut ne plus être à l'écran : ses réglages restent ouverts)
  });
  const zoomTo = (z) => {
    zoom = clamp(Math.round(z * 100) / 100, 0.25, 4);
    renderCanvas();
  };
  function fit() {
    if (!comp) return;
    const st = $('#edStage');
    zoomTo(Math.min(2, (st.clientWidth - 72) / comp.width, (st.clientHeight - 140) / comp.height));
  }
  $('#zoomIn').addEventListener('click', () => zoomTo(zoom * 1.2));
  $('#zoomOut').addEventListener('click', () => zoomTo(zoom / 1.2));
  $('#zoomFit').addEventListener('click', fit);
  $('#edStage').addEventListener(
    'wheel',
    (ev) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      zoomTo(zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1));
    },
    { passive: false }
  );
  $('#edUndo').addEventListener('click', () => restore(undo, redo));
  $('#edRedo').addEventListener('click', () => restore(redo, undo));
  $('#edSave').addEventListener('click', () => save());
  $('#edApply').addEventListener('click', async () => {
    if (dirty && !(await save())) return;
    const r = await json('POST', '/api/settings', { overlay: { themePack: ID } });
    if (r.ok === false) return toast(r.error || t('d.failed'), 'err');
    active = true;
    renderAll();
    toast(t('e.appliedToast'), 'ok');
  });
  $('#edBack').addEventListener('click', (ev) => {
    if (dirty && !window.confirm(t('e.leaveQ'))) ev.preventDefault();
    else dirty = false;
  });
  window.addEventListener('beforeunload', (ev) => {
    if (dirty) ev.preventDefault();
  });

  // ------------------------------------------------------------------ enregistrement
  async function save() {
    if (!theme.name.trim()) {
      toast(t('e.needName'), 'err');
      $('#edName').focus();
      return false;
    }
    $('#edSave').disabled = true;
    const r = await json('PUT', `/api/themes/${ID}/source`, theme);
    $('#edSave').disabled = false;
    if (!r.ok) {
      toast(r.error || t('d.failed'), 'err');
      return false;
    }
    // ce que l'app a gardé fait foi (valeurs ramenées dans les limites du format)
    theme = r.theme;
    comp = theme[kind] || null;
    sel = sel.filter((id) => byId(id));
    setDirty(false);
    renderAll();
    savePreview();
    toast(t(active ? 'e.savedLive' : 'e.savedToast'), 'ok');
    return true;
  }

  // Aperçu du thème (preview.png) : la composition redessinée sur un canevas, sur le faux fond de match
  async function savePreview() {
    try {
      const comp = theme.counter; // (la vignette d'un thème montre son compteur, quel que soit l'overlay en cours d'édition)
      const W = 960;
      const H = 240;
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const g = cv.getContext('2d');
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#1b2438');
      bg.addColorStop(0.55, '#0b1020');
      bg.addColorStop(1, '#070a12');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      for (const [x, col] of [[W * 0.2, 'rgba(24,115,255,0.35)'], [W * 0.8, 'rgba(255,138,42,0.3)']]) {
        const rg = g.createRadialGradient(x, H * 1.1, 0, x, H * 1.1, W * 0.6);
        rg.addColorStop(0, col);
        rg.addColorStop(1, 'transparent');
        g.fillStyle = rg;
        g.fillRect(0, 0, W, H);
      }
      const d = C.sample('idle', t);
      const shown = comp.elements.filter((e) => !e.hidden && C.visible(e.when, d));
      if (!shown.length) return;
      const b = bounds(shown);
      const k = Math.min((W - 80) / b.w, (H - (b.h > b.w ? 28 : 60)) / b.h, 2.2); // (une colonne prend toute la hauteur)
      g.translate((W - b.w * k) / 2 - b.x * k, (H - b.h * k) / 2 - b.y * k);
      g.scale(k, k);
      const col = (c, tone) => {
        const base = { win: theme.colors.win || '#8bd95a', loss: theme.colors.loss || '#f2685f', ot: theme.colors.ot || '#f0b03f', white: '#ffffff', black: '#000000', hot: '#ffcf5a', cold: '#8fbcff' };
        base.event = base.win; // (hors alerte, « couleur de l'alerte » vaut celle de la victoire)
        Object.assign(base, { team: '#ff7f22', team0: '#1873ff', team1: '#ff7a1a' });
        if (c === 'auto') return base[tone] || '#ffffff';
        return base[c] || c;
      };
      await Promise.all([...new Set(shown.filter((e) => e.font).map((e) => `${e.italic ? 'italic ' : ''}${e.weight} ${e.size || 16}px '${e.font}'`))].map((f) => document.fonts.load(f).catch(() => {})));
      const imgs = new Map();
      await Promise.all(
        C.images(comp).map(
          (src) =>
            new Promise((resolve) => {
              const im = new Image();
              im.onload = () => {
                imgs.set(src, im);
                resolve();
              };
              im.onerror = resolve;
              im.src = imageUrl(src);
            })
        )
      );
      for (const e of shown) {
        g.save();
        g.globalAlpha = e.opacity;
        g.translate(e.x + e.w / 2, e.y + e.h / 2);
        if (e.rotate) g.rotate((e.rotate * Math.PI) / 180);
        g.translate(-e.w / 2, -e.h / 2);
        if (e.type === 'box') {
          g.globalAlpha = e.opacity * e.fillOpacity;
          g.fillStyle = col(e.fill);
          // (les ombres d'un canevas ne suivent pas l'échelle : on la leur applique)
          if (e.shadow !== 'none') {
            g.shadowColor = e.shadow === 'soft' ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.6)';
            g.shadowBlur = (e.shadow === 'soft' ? 14 : 24) * k;
            g.shadowOffsetY = (e.shadow === 'soft' ? 6 : 10) * k;
          }
          g.fill(new Path2D(C.boxPath(e.w, e.h, e.radius, e.cut, e.cutCorner)));
          g.shadowColor = 'transparent';
          if (e.borderWidth > 0) {
            g.globalAlpha = e.opacity * e.borderOpacity;
            g.lineWidth = e.borderWidth;
            g.strokeStyle = col(e.borderColor);
            g.stroke(new Path2D(C.boxPath(e.w, e.h, e.radius, e.cut, e.cutCorner, e.borderWidth / 2)));
          }
        } else if (e.type === 'text' || e.type === 'value') {
          const v = e.type === 'value' ? C.valueOf(e.bind, d) : { text: e.text, tone: '' };
          let txt = e.type === 'value' ? (v.text === '' ? '' : `${e.prefix}${v.text}${e.suffix}`) : v.text;
          if (e.upper) txt = txt.toUpperCase();
          g.font = `${e.italic ? 'italic ' : ''}${e.weight} ${e.size}px '${e.font}', sans-serif`;
          g.fillStyle = col(e.color, v.tone);
          g.textAlign = e.align;
          g.textBaseline = 'middle';
          try {
            g.letterSpacing = `${e.spacing}px`;
          } catch {}
          const x = e.align === 'center' ? e.w / 2 : e.align === 'right' ? e.w : 0;
          const y = e.valign === 'top' ? e.size / 2 : e.valign === 'bottom' ? e.h - e.size / 2 : e.h / 2;
          // texte « ajusté » : rétréci depuis son côté d'alignement s'il dépasse la largeur de l'élément
          const tw = g.measureText(txt).width;
          g.translate(x, y + e.size * 0.04);
          if (e.fit && tw > e.w) g.scale(e.w / tw, e.w / tw);
          if (e.shadow !== 'none') {
            g.shadowColor = e.shadow === 'soft' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.9)';
            g.shadowBlur = (e.shadow === 'soft' ? 8 : 5) * k;
            g.shadowOffsetY = 2 * k;
            if (e.shadow === 'outline') g.fillText(txt, 0, 0); // (deux passes : un contour plus dense)
          }
          g.fillText(txt, 0, 0);
        } else if (e.type === 'image' && imgs.get(e.src)) {
          const im = imgs.get(e.src);
          let [dw, dh] = [e.w, e.h];
          if (e.fit !== 'fill') {
            const s = (e.fit === 'cover' ? Math.max : Math.min)(e.w / im.naturalWidth, e.h / im.naturalHeight);
            dw = im.naturalWidth * s;
            dh = im.naturalHeight * s;
          }
          g.beginPath();
          g.roundRect(0, 0, e.w, e.h, e.radius);
          g.clip();
          g.drawImage(im, (e.w - dw) / 2, (e.h - dh) / 2, dw, dh);
        } else if (e.type === 'results') {
          const list = d.last.slice(-e.count);
          const row = e.dir === 'row';
          const cell = ((row ? e.w : e.h) - e.gap * (e.count - 1)) / e.count;
          for (let i = 0; i < e.count; i++) {
            const r = list[i - (e.count - list.length)];
            const cx = row ? i * (cell + e.gap) : 0;
            const cy = row ? 0 : i * (cell + e.gap);
            const cw = row ? cell : e.w;
            const ch = row ? e.h : cell;
            g.beginPath();
            g.roundRect(cx, cy, cw, ch, e.radius);
            g.fillStyle = r ? col(r.r === 'W' ? 'win' : 'loss') : 'rgba(255,255,255,0.12)';
            g.fill();
            if (r && e.letters) {
              g.font = `${e.weight} ${Math.round(ch * 0.46)}px '${e.font}', sans-serif`;
              g.fillStyle = r.r === 'W' ? '#0f2406' : '#2a0b09';
              g.textAlign = 'center';
              g.textBaseline = 'middle';
              g.fillText(r.r === 'W' ? d.labelWin : d.labelLoss, cx + cw / 2, cy + ch / 2 + 1);
            }
          }
        } else if (e.type === 'arc') {
          const rad = (a) => ((a - 90) * Math.PI) / 180;
          const p = e.bind ? Math.max(0, Math.min(100, Number(d[e.bind]) || 0)) / 100 : 1;
          const draw = (to, alpha) => {
            g.globalAlpha = e.opacity * alpha;
            g.beginPath();
            g.ellipse(e.w / 2, e.h / 2, Math.max(0.5, e.w / 2 - e.thickness / 2), Math.max(0.5, e.h / 2 - e.thickness / 2), 0, rad(e.from), rad(to), to < e.from);
            g.stroke();
          };
          g.strokeStyle = col(e.color);
          g.lineWidth = e.thickness;
          g.lineCap = e.ticks > 0 ? 'butt' : e.cap;
          if (e.ticks > 0) {
            const len = ((Math.min(360, Math.abs(e.to - e.from)) * Math.PI) / 180) * Math.sqrt(((e.w / 2 - e.thickness / 2) ** 2 + (e.h / 2 - e.thickness / 2) ** 2) / 2);
            g.setLineDash([e.tickW, e.ticks > 1 ? Math.max(0.1, (len - e.tickW * e.ticks) / (e.ticks - 1)) : len + 1]);
          }
          if (e.bind && e.track > 0) draw(e.to, e.track);
          if (p > 0) draw(e.from + (e.to - e.from) * p, 1);
        } else if (e.type === 'bar') {
          const p = d.wins + d.losses ? d.wins / (d.wins + d.losses) : 0.5;
          const row = e.dir === 'row';
          const len = (row ? e.w : e.h) - e.gap;
          g.beginPath();
          g.roundRect(0, 0, e.w, e.h, e.radius);
          g.clip();
          g.fillStyle = col(e.colorWin);
          if (row) g.fillRect(0, 0, len * p, e.h);
          else g.fillRect(0, 0, e.w, len * p);
          g.fillStyle = col(e.colorLoss);
          if (row) g.fillRect(len * p + e.gap, 0, len * (1 - p), e.h);
          else g.fillRect(0, len * p + e.gap, e.w, len * (1 - p));
        }
        g.restore();
      }
      const blob = await new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
      if (blob) await api(`/api/themes/${ID}/preview`, { method: 'POST', body: blob });
    } catch (e) {
      console.warn('aperçu', e);
    }
  }

  // ------------------------------------------------------------------ démarrage
  async function start() {
    OT.applyI18n();
    // (la liste des situations d'aperçu est remplie selon l'overlay : voir renderKinds)
    if (OT.params.has('app')) $('#edBack').href = '/?app=1';
    const r = await api(`/api/themes/${encodeURIComponent(ID)}/source`);
    if (!r.ok || !r.theme || !r.theme.counter) {
      const f = $('#edFatal');
      f.classList.remove('hidden');
      f.innerHTML = `<h2>${esc(t('e.cantOpen'))}</h2><p class="muted">${esc(r.error || '')}</p><a class="btn primary" href="${OT.params.has('app') ? '/?app=1' : '/'}">${esc(t('h.e.back'))}</a>`;
      return;
    }
    theme = r.theme;
    comp = theme[kind] || null;
    active = !!r.active;
    document.title = `${theme.name} — RL-UI`;
    setDirty(false);
    renderAll();
    fit();
    // premier passage : le thème n'a pas encore d'image d'aperçu
    savePreview();
  }
  window.addEventListener('resize', () => {
    if (theme && !sel.length && !dirty) fit();
  });
  start();
})();
