// Galerie de thèmes de la communauté (page Overlays → Galerie).
// L'app lit le catalogue en ligne et vérifie tout ; cette page ne parle qu'à l'app, jamais à un autre site.
(function () {
  const R = window.RLUI;
  const { $, $$, esc, t, tn, api, post, toast } = R;
  const C = window.Compose;
  const TAGS = ['minimal', 'competitive', 'neon', 'dark', 'light', 'colorful', 'retro', 'esport', 'compact', 'vertical'];

  let data = null; // réponse de /api/market
  let loading = false;
  let q = '';
  let scope = 'all';
  let tag = '';
  let sort = 'likes';
  const busy = new Set(); // thèmes en cours d'installation
  let open = null; // thème affiché en grand
  let live = null; // sa composition, posée dans la fenêtre
  let sample = 'idle';
  let liveKind = 'counter'; // overlay montré dans la fenêtre : compteur, alertes, dernières parties ou récap
  let liveTheme = null; // compositions du thème ouvert
  // situations d'aperçu de chaque overlay (« a:… » : une alerte de ce type)
  const SAMPLES = { counter: ['idle', 'match', 'overtime', 'cold'], alerts: ['a:win', 'a:loss', 'a:overtime', 'a:ot_win', 'a:streak'], history: ['idle', 'cold'], summary: ['idle', 'cold'] };
  const sampleData = () => (sample.startsWith('a:') ? { ...C.sample('idle', t), ...C.alertFields(C.sampleAlert(sample.slice(2), t), t) } : C.sample(sample, t));

  try {
    sort = localStorage.getItem('rlui-mksort') || sort;
  } catch {}

  const fileUrl = (id, path) => `/api/market/file?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}&key=${encodeURIComponent(R.key)}`;
  const loc = () => (OT.lang === 'fr' ? 'fr-FR' : 'en-US');
  const fmtDay = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const fmtSize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toLocaleString(loc(), { maximumFractionDigits: 1 })} ${t('d.mk.mb')}` : `${Math.max(1, Math.round(n / 1024))} ${t('d.mk.kb')}`);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const activeId = () => (R.state() && R.state().settings.overlay.themePack) || 'signature';

  // ------------------------------------------------------------------ lecture
  async function load(force) {
    if (loading) return;
    loading = true;
    render();
    data = await api(`/api/market${force ? '?refresh=1' : ''}`);
    if (!Array.isArray(data.themes)) data = { ok: false, error: data.error || t('d.unreachable'), themes: [] };
    loading = false;
    render();
    if (force && data.ok) toast(t('d.mk.refreshed'), 'ok');
  }

  // Thèmes à afficher : recherche, portée (tous, favoris, installés), style, tri
  function shown() {
    const words = norm(q).split(/\s+/).filter(Boolean);
    const list = data.themes.filter((x) => {
      if (scope === 'fav' && !x.favorite) return false;
      if (scope === 'installed' && !x.installed) return false;
      if (tag && !x.tags.includes(tag)) return false;
      if (!words.length) return true;
      const hay = norm(`${x.name} ${x.author} ${x.description} ${x.tags.map((k) => t(`e.tag.${k}`)).join(' ')} ${x.tags.join(' ')}`);
      return words.every((w) => hay.includes(w));
    });
    const by = {
      likes: (a, b) => b.likes - a.likes || (b.updated || '').localeCompare(a.updated || '') || a.name.localeCompare(b.name),
      installs: (a, b) => b.installs - a.installs || b.likes - a.likes || a.name.localeCompare(b.name),
      new: (a, b) => (b.updated || b.added || '').localeCompare(a.updated || a.added || '') || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return list.sort(by[sort] || by.likes);
  }

  // ------------------------------------------------------------------ affichage
  function thumb(x) {
    if (x.hasPreview) return `<img src="${esc(fileUrl(x.id, 'preview.png'))}" alt="" loading="lazy" />`;
    const c = x.colors || {};
    return `<div class="sw">${[c.win || '#8bd95a', c.loss || '#f2685f', c.ot || '#f0b03f'].map((k) => `<i style="background:${esc(k)}"></i>`).join('')}</div>`;
  }

  // Bouton principal d'une carte : installer, mettre à jour, utiliser, ou rien à faire
  function mainAction(x, big = false) {
    const cls = `btn ${big ? '' : 'small '}primary`;
    if (busy.has(x.id)) return `<button class="${cls}" disabled>${esc(t('d.mk.installing'))}</button>`;
    if (!x.compatible) return `<button class="btn ${big ? '' : 'small'}" disabled title="${esc(t('d.mk.needsTip', { v: x.minApp, c: data.appVersion }))}">${esc(t('d.mk.needs', { v: x.minApp }))}</button>`;
    if (x.update) return `<button class="${cls}" data-mk="install">${esc(t('d.mk.update', { v: x.version }))}</button>`;
    if (!x.installed) return `<button class="${cls}" data-mk="install">${esc(t(big ? 'd.mk.installUse' : 'd.mk.install'))}</button>`;
    if (x.themeId !== activeId()) return `<button class="${cls}" data-mk="use">${esc(t('d.use'))}</button>`;
    return `<span class="pill ok">${esc(t('d.active'))}</span>`;
  }

  function badge(x) {
    if (x.update) return `<span class="pill wait">${esc(t('d.mk.updateBadge'))}</span>`;
    if (x.installed) return `<span class="pill ok">${esc(t(x.themeId === activeId() ? 'd.active' : 'd.mk.installedBadge'))}</span>`;
    return '';
  }

  const heart = (x) =>
    `<button class="mk-fav${x.favorite ? ' on' : ''}" data-mk="fav" aria-pressed="${x.favorite}" title="${esc(t(x.favorite ? 'd.mk.unfav' : 'd.mk.fav'))}" aria-label="${esc(t(x.favorite ? 'd.mk.unfav' : 'd.mk.fav'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" /></svg></button>`;

  const num = (n) => (n >= 10000 ? `${Math.round(n / 1000)} k` : n >= 1000 ? `${(n / 1000).toLocaleString(loc(), { maximumFractionDigits: 1 })} k` : String(n));
  const likes = (x) =>
    `<span class="mk-stat" title="${esc(tn('d.mk.likes', x.likes))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v10H4V10zM7 10l4-7c1.5 0 2.5 1 2.5 2.5V9h5a2 2 0 0 1 2 2.3l-1.2 7a2 2 0 0 1-2 1.7H7" /></svg>${num(x.likes)}<span class="sr">${esc(tn('d.mk.likes', x.likes))}</span></span>`;
  const installs = (x) =>
    `<span class="mk-stat" title="${esc(tn('d.mk.installs', x.installs))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.500 11l4.500 4.500 4.500-4.500M5 20h14" /></svg>${num(x.installs)}<span class="sr">${esc(tn('d.mk.installs', x.installs))}</span></span>`;

  function card(x) {
    return `
      <div class="th mk-card${x.themeId && x.themeId === activeId() ? ' on' : ''}${x.compatible ? '' : ' off'}" data-mkid="${esc(x.id)}">
        <div class="thumb"><button class="mk-open" data-mk="open" aria-label="${esc(t('d.mk.openAria', { n: x.name }))}">${thumb(x)}</button>${badge(x)}</div>
        <div class="info">
          <div class="mk-name"><b>${esc(x.name)}</b>${heart(x)}</div>
          <span class="muted small">${esc(t('d.byAuthor', { a: x.author || t('d.mk.anon') }))} · v${esc(x.version)}</span>
          <span class="desc">${esc(x.description)}</span>
          <span class="mk-chips">${x.tags.map((k) => `<button class="mk-chip" data-mk="tag" data-tag="${k}">${esc(t(`e.tag.${k}`))}</button>`).join('')}</span>
        </div>
        <div class="acts">${mainAction(x)}<button class="btn small ghost" data-mk="open">${esc(t('d.mk.preview'))}</button><span class="grow"></span>${installs(x)}${likes(x)}</div>
      </div>`;
  }

  function render() {
    const state = $('#mkState');
    const grid = $('#mkGrid');
    if (!state) return;
    $$('#mkScope button').forEach((b) => b.classList.toggle('on', b.dataset.scope === scope));
    $('#mkSort').value = sort;
    $('#mkRefresh').disabled = loading;
    const msg = (html) => {
      state.innerHTML = html;
      state.classList.remove('hidden');
    };
    state.classList.add('hidden');
    if (!data) {
      grid.innerHTML = '';
      $('#mkTags').innerHTML = '';
      $('#mkFoot').textContent = '';
      if (loading) msg(`<p>${esc(t('d.mk.loading'))}</p>`);
      return;
    }
    // styles présents dans la galerie, avec le nombre de thèmes
    const counts = {};
    for (const x of data.themes) for (const k of x.tags) counts[k] = (counts[k] || 0) + 1;
    if (tag && !counts[tag]) tag = '';
    $('#mkTags').innerHTML = data.themes.length
      ? [`<button class="mk-chip${tag ? '' : ' on'}" data-tag="" aria-pressed="${!tag}">${esc(t('d.mk.allStyles'))}</button>`]
          .concat(TAGS.filter((k) => counts[k]).map((k) => `<button class="mk-chip${tag === k ? ' on' : ''}" data-tag="${k}" aria-pressed="${tag === k}">${esc(t(`e.tag.${k}`))} <i>${counts[k]}</i></button>`))
          .join('')
      : '';
    if (!data.ok) {
      grid.innerHTML = '';
      msg(`<p><b>${esc(t('d.mk.down'))}</b> ${esc(data.error || '')}</p><p class="muted small">${esc(t('d.mk.downHelp'))}</p><button class="btn small" data-mk="retry">${esc(t('d.mk.retry'))}</button>`);
    } else {
      const list = shown();
      grid.innerHTML = list.map(card).join('');
      if (!list.length) {
        const why = !data.themes.length ? 'd.mk.empty' : scope === 'fav' && !q && !tag ? 'd.mk.noFav' : scope === 'installed' && !q && !tag ? 'd.mk.noInstalled' : 'd.mk.noMatch';
        msg(`<p>${esc(t(why))}</p>${why === 'd.mk.noMatch' ? `<button class="btn small" data-mk="clear">${esc(t('d.mk.clear'))}</button>` : ''}`);
      }
    }
    const n = data.themes.length;
    $('#mkFoot').textContent = `${data.ok ? `${tn('d.mk.count', n)} · ` : ''}${t(data.official ? 'd.mk.footOfficial' : 'd.mk.footCustom', { u: data.host })}`;
    $('#mkSite').classList.toggle('hidden', !data.site);
    if (open) renderModal();
  }

  // ------------------------------------------------------------------ actions
  async function install(id, use) {
    const x = data.themes.find((k) => k.id === id);
    if (!x || busy.has(id)) return;
    busy.add(id);
    render();
    const r = await post('/api/market/install', { id, use });
    busy.delete(id);
    if (!r.ok) {
      toast(r.error || t('d.failed'), 'err');
      return render();
    }
    toast(t(r.updated ? 'd.mk.updatedToast' : use ? 'd.mk.installedUsed' : 'd.mk.installedToast', { n: x.name }), 'ok');
    data = await api('/api/market');
    render();
  }

  async function use(x) {
    await post('/api/settings', { overlay: { themePack: x.themeId } });
    toast(t('d.themeApplied', { n: x.name }), 'ok');
  }

  async function favorite(x) {
    x.favorite = !x.favorite;
    render();
    await post('/api/market/favorite', { id: x.id, on: x.favorite });
  }

  function onClick(e) {
    const b = e.target.closest('[data-mk]');
    if (!b || !data) return;
    const act = b.dataset.mk;
    if (act === 'retry') return load(true);
    if (act === 'clear') {
      q = '';
      tag = '';
      scope = 'all';
      $('#mkSearch').value = '';
      return render();
    }
    const host = b.closest('[data-mkid]');
    const x = host && data.themes.find((k) => k.id === host.dataset.mkid);
    if (!x) return;
    if (act === 'tag') {
      tag = b.dataset.tag;
      closeModal();
      return render();
    }
    if (act === 'open') return openModal(x.id);
    if (act === 'fav') return favorite(x);
    if (act === 'install') return install(x.id, !!b.closest('#mkModal'));
    if (act === 'use') return use(x);
    if (act === 'page') return R.openUrl(x.page);
    if (act === 'link') return R.copy(x.page);
    if (act === 'custom') return customize(x);
  }

  // Une copie à soi, ouverte dans l'éditeur : le thème de la galerie reste tel quel, et à jour
  async function customize(x) {
    const r = await post(`/api/themes/${x.themeId}/duplicate`, { name: t('d.customCopyName', { n: x.name }), open: false });
    if (r.ok) location.href = R.editor(r.id);
    else toast(r.error || t('d.failed'), 'err');
  }

  // ------------------------------------------------------------------ fenêtre d'un thème : aperçu en direct
  function closeModal() {
    if (live) live.destroy();
    live = null;
    liveTheme = null;
    open = null;
    $('#mkModal').classList.add('hidden');
  }

  function fit() {
    if (!live) return;
    const stage = $('#mkmStage');
    const w = stage.clientWidth - 32;
    // l'aperçu cadre ce que le thème dessine, pas toute la toile
    const b = live.bounds;
    const k = Math.min(w / b.w, 260 / b.h, 1.6);
    live.view.el.style.transform = `translate(${-b.x * k}px, ${-b.y * k}px) scale(${k})`;
    live.box.style.width = `${b.w * k}px`;
    live.box.style.height = `${b.h * k}px`;
  }

  // Rectangle qui contient tous les éléments d'une composition (même ceux qui n'apparaissent qu'en match)
  function boundsOf(comp) {
    const list = comp.elements.filter((e) => !e.hidden);
    if (!list.length) return { x: 0, y: 0, w: comp.width, h: comp.height };
    const x = Math.max(0, Math.min(...list.map((e) => e.x)) - 12);
    const y = Math.max(0, Math.min(...list.map((e) => e.y)) - 12);
    return { x, y, w: Math.min(comp.width, Math.max(...list.map((e) => e.x + e.w)) + 12) - x, h: Math.min(comp.height, Math.max(...list.map((e) => e.y + e.h)) + 12) - y };
  }

  async function openModal(id) {
    closeModal();
    open = id;
    sample = 'idle';
    $('#mkModal').classList.remove('hidden');
    renderModal();
    const stage = $('#mkmStage');
    const x = data.themes.find((k) => k.id === id);
    stage.innerHTML = x.hasPreview ? `<img src="${esc(fileUrl(id, 'preview.png'))}" alt="" />` : '';
    $('#mkmClose').focus();
    const r = await api(`/api/market/theme?id=${encodeURIComponent(id)}`);
    if (open !== id) return;
    // (composition illisible : l'image d'aperçu reste affichée)
    if (!r.ok || !r.counter || !C || !C.mount) return $('.mk-live').classList.add('hidden');
    liveTheme = r;
    liveKind = 'counter';
    mountLive();
    $('.mk-live').classList.remove('hidden');
  }

  // Pose dans la fenêtre l'overlay choisi du thème ouvert
  function mountLive() {
    if (live) live.destroy();
    live = null;
    const r = liveTheme;
    const comp = (r.compose && r.compose[liveKind]) || r.counter;
    const stage = $('#mkmStage');
    stage.innerHTML = '<div class="mk-fit"></div>';
    const box = stage.firstChild;
    for (const k of ['win', 'loss', 'ot']) if (r.colors && r.colors[k]) box.style.setProperty(`--${k}`, r.colors[k]);
    const view = C.mount(box, comp, { imageUrl: (src) => fileUrl(open, src) });
    live = { view, box, comp, bounds: boundsOf(comp), destroy: () => view.destroy() };
    if (!SAMPLES[liveKind].includes(sample)) sample = SAMPLES[liveKind][0];
    view.update(sampleData());
    fit();
    if (liveKind === 'alerts') view.enter(comp.enter || 'slide');
    // onglets des overlays que le thème dessine (s'il n'y a que le compteur, pas d'onglets), puis situations d'aperçu
    const kinds = C.KINDS.filter((k) => r.compose && r.compose[k]);
    $('#mkmKinds').classList.toggle('hidden', kinds.length < 2);
    $('#mkmKinds').innerHTML = kinds.map((k) => `<button data-kind="${k}" class="${k === liveKind ? 'on' : ''}">${esc(t(`e.kind.${k}`))}</button>`).join('');
    $('#mkmSample').innerHTML = SAMPLES[liveKind].map((k) => `<button data-sample="${k}" class="${k === sample ? 'on' : ''}">${esc(t(k.startsWith('a:') ? `type.${k.slice(2)}` : `e.sample.${k}`))}</button>`).join('');
  }

  function renderModal() {
    const x = data && data.themes.find((k) => k.id === open);
    if (!x) return closeModal();
    const box = $('#mkModal .mk-box');
    box.dataset.mkid = x.id;
    $('#mkmName').textContent = x.name;
    $('#mkmDesc').textContent = x.description;
    const fact = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
    $('#mkmFacts').innerHTML = [
      fact(t('d.mk.fAuthor'), esc(x.author || t('d.mk.anon'))),
      fact(t('d.mk.fVersion'), `${esc(x.version)}${x.updated ? ` · ${esc(fmtDay(x.updated))}` : ''}`),
      fact(t('d.mk.fDraws'), esc(x.draws.map((k) => t(`e.kind.${k}`)).join(', '))),
      fact(t('d.mk.fStyle'), x.tags.map((k) => `<button class="mk-chip" data-mk="tag" data-tag="${k}">${esc(t(`e.tag.${k}`))}</button>`).join('') || '—'),
      fact(t('d.mk.fCompat'), x.compatible ? `<span class="pill ok">${esc(t('d.mk.compatOk', { v: x.minApp }))}</span>` : `<span class="pill wait">${esc(t('d.mk.compatNo', { v: x.minApp, c: data.appVersion }))}</span>`),
      fact(t('d.mk.fSize'), esc(fmtSize(x.size))),
      fact(t('d.mk.fLikes'), `${likes(x)}${installs(x)}${x.page ? ` <button class="link" data-mk="page">${esc(t('d.mk.likeIt'))}</button>` : ''}`),
    ].join('');
    $('#mkmActs').innerHTML = `${heart(x)}${x.page ? `<button class="btn ghost" data-mk="link">${esc(t('d.mk.copyLink'))}</button>` : ''}<span class="grow"></span>${x.installed && !x.update ? `<button class="btn" data-mk="custom">${esc(t('d.mk.customize'))}</button>` : ''}${mainAction(x, true)}`;
  }

  // ------------------------------------------------------------------ proposer un thème
  const CHECKS = {
    empty: 'd.chk.empty',
    author: 'd.chk.author',
    description: 'd.chk.description',
    'no-preview': 'd.chk.noPreview',
    'too-big': 'd.chk.tooBig',
    'too-many-files': 'd.chk.tooMany',
    'needs-newer-app': 'd.chk.newer',
  };
  function why(p) {
    if (CHECKS[p]) return t(CHECKS[p]);
    const i = p.indexOf(':');
    const kind = p.slice(0, i);
    const rest = p.slice(i + 1);
    if (kind === 'adjusted') return t('d.chk.adjusted');
    if (kind === 'file') return t('d.chk.file', { f: rest });
    if (kind === 'big') return t('d.chk.big', { f: rest });
    if (kind === 'missing') return t('d.chk.missing', { f: rest });
    if (kind === 'not-image') return t('d.chk.notImage', { f: rest });
    if (kind === 'sound') return t('d.chk.sound', { f: rest });
    return t('d.chk.other');
  }

  let shareId = null;
  let shareSeq = 0;
  async function share(id) {
    const mine = ((R.state().themes && R.state().themes.list) || []).filter((x) => x.editable && !x.market);
    const box = $('#mksBody');
    $('#mkShare').classList.remove('hidden');
    if (!mine.length) {
      box.innerHTML = `<p>${esc(t('d.mk.shareNone'))}</p><div class="actions"><button class="btn primary" data-mks="create">${esc(t('d.mk.createBtn'))}</button></div>`;
      return;
    }
    shareId = mine.some((x) => x.id === id) ? id : mine.some((x) => x.id === shareId) ? shareId : mine[0].id;
    const th = mine.find((x) => x.id === shareId);
    box.innerHTML = `
      <label class="mk-pick"><span>${esc(t('d.mk.shareWhich'))}</span>
        <select id="mksTheme">${mine.map((x) => `<option value="${esc(x.id)}"${x.id === shareId ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      </label>
      <div class="mk-check" id="mksCheck" role="status"><p class="muted">${esc(t('d.mk.checking'))}</p></div>`;
    const seq = ++shareSeq;
    const r = await api(`/api/themes/${encodeURIComponent(shareId)}/check`);
    if (seq !== shareSeq) return;
    const problems = [...new Set((r.problems || []).map(why))];
    const submit = (data && data.submit) || '';
    const ok = !problems.length;
    $('#mksCheck').innerHTML = ok
      ? `<p class="mk-ok"><span class="pill ok">${esc(t('d.mk.ready'))}</span> ${esc(t('d.mk.readyText', { n: th.name }))}</p>
         <ol class="mk-steps">
           <li><div><b>${esc(t('d.mk.step1'))}</b><span>${esc(t('d.mk.step1Text'))}</span></div><button class="btn small" data-mks="export">${esc(t('d.mk.step1Btn'))}</button></li>
           <li><div><b>${esc(t('d.mk.step2'))}</b><span>${esc(t(submit ? 'd.mk.step2Text' : 'd.mk.step2Off'))}</span></div><button class="btn small primary" data-mks="site"${submit ? '' : ' disabled'}>${esc(t('d.mk.step2Btn'))}</button></li>
         </ol>
         <p class="muted small">${esc(t('d.mk.step3Text'))}</p>`
      : `<p><span class="pill wait">${esc(tn('d.mk.notReady', problems.length))}</span></p>
         <ul class="mk-problems">${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
         <div class="actions"><button class="btn primary" data-mks="edit">${esc(t('d.mk.fixInEditor'))}</button></div>`;
  }

  function onShareClick(e) {
    const b = e.target.closest('[data-mks]');
    if (!b) return;
    const act = b.dataset.mks;
    if (act === 'create') {
      $('#mkShare').classList.add('hidden');
      R.go('stream/themes');
      $('#themeCreate').click();
    } else if (act === 'edit') {
      location.href = R.editor(shareId);
    } else if (act === 'export') {
      const a = document.createElement('a');
      a.href = `/api/themes/${shareId}/export?key=${encodeURIComponent(R.key)}`;
      a.download = `${shareId}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else if (act === 'site') {
      R.openUrl(data.submit);
    }
  }

  // ------------------------------------------------------------------ branchements
  function bind() {
    if (!$('#mkGrid')) return;
    $('#mkGrid').addEventListener('click', onClick);
    $('#mkState').addEventListener('click', onClick);
    $('#mkModal').addEventListener('click', (e) => {
      if (e.target === $('#mkModal')) return closeModal();
      onClick(e);
    });
    $('#mkmClose').addEventListener('click', closeModal);
    $('#mkmKinds').addEventListener('click', (e) => {
      const b = e.target.closest('[data-kind]');
      if (!b || !liveTheme || b.dataset.kind === liveKind) return;
      liveKind = b.dataset.kind;
      mountLive();
    });
    $('#mkmSample').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sample]');
      if (!b || !live) return;
      sample = b.dataset.sample;
      $$('#mkmSample button').forEach((k) => k.classList.toggle('on', k === b));
      live.view.update(sampleData());
      if (liveKind === 'alerts') live.view.enter(live.comp.enter || 'slide');
    });
    $('#mkTags').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tag]');
      if (!b) return;
      tag = b.dataset.tag;
      render();
    });
    $('#mkScope').addEventListener('click', (e) => {
      const b = e.target.closest('[data-scope]');
      if (!b) return;
      scope = b.dataset.scope;
      render();
    });
    $('#mkSort').addEventListener('change', (e) => {
      sort = e.target.value;
      try {
        localStorage.setItem('rlui-mksort', sort);
      } catch {}
      render();
    });
    $('#mkSearch').addEventListener('input', (e) => {
      q = e.target.value;
      if (data) render();
    });
    $('#mkRefresh').addEventListener('click', () => load(true));
    $('#mkSite').addEventListener('click', () => data && data.site && R.openUrl(data.site));
    $('#mkSubmit').addEventListener('click', async () => {
      if (!data) await load(false);
      share(null);
    });
    $('#mkShare').addEventListener('click', (e) => {
      if (e.target === $('#mkShare')) $('#mkShare').classList.add('hidden');
      onShareClick(e);
    });
    $('#mkShare').addEventListener('change', (e) => {
      if (e.target.id === 'mksTheme') share(e.target.value);
    });
    $('#mksClose').addEventListener('click', () => $('#mkShare').classList.add('hidden'));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#mkModal').classList.contains('hidden')) closeModal();
      else if (!$('#mkShare').classList.contains('hidden')) $('#mkShare').classList.add('hidden');
    });
    window.addEventListener('resize', fit);
  }
  bind();

  R.market = {
    // la galerie n'est lue en ligne que lorsqu'on l'ouvre
    show() {
      if (!data && !loading) load(false);
    },
    // la liste des thèmes installés a changé (installation, suppression, thème choisi)
    async sync() {
      if (!data || loading) return;
      const r = await api('/api/market');
      if (Array.isArray(r.themes)) data = r;
      render();
    },
    async share(id) {
      if (!data) await load(false);
      share(id);
    },
    // fiche d'un thème demandée par un lien « Installer dans RL-UI » (le catalogue est relu : le thème peut être tout neuf)
    async open(id) {
      if (!data || !data.themes.some((x) => x.id === id)) {
        loading = false;
        await load(!!data);
      }
      if (data.themes.some((x) => x.id === id)) openModal(id);
      else if (data.ok) toast(t('s.mk.unknown'), 'err');
    },
  };
})();
