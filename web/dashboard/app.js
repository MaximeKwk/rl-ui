// Tableau de bord RL-UI
(function () {
  const KEY = document.querySelector('meta[name="ot-key"]').content;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = OT.esc;
  const t = OT.t;
  const tn = OT.tn;
  const tr = OT.t; // même chose que t(), là où une variable locale s'appelle t
  const isApp = OT.params.has('app');
  if (isApp) document.body.classList.add('in-app');

  let D = null; // état complet (tableau de bord)
  let S = null; // état public (stats de session)
  let prevCounts = null;
  let historyScope = 'session';
  let historyDirty = true;
  let obsScenes = null;
  let built = false;

  const TYPES = ['win', 'loss', 'overtime', 'ot_win', 'ot_loss', 'streak'].map((k) => [k, t(`type.${k}`)]);
  const TYPE_NAME = Object.fromEntries(TYPES);
  const CATS = ['ranked', 'casual', 'extra', 'tournament', 'private', 'offline', 'unknown'].map((k) => [k, t(`cat.${k}`)]);
  const OVERLAYS = [
    { id: 'counter', name: t('o.counter'), w: 1000, h: 220, desc: t('o.counterDesc') },
    { id: 'alerts', name: t('o.alerts'), w: 1920, h: 1080, desc: t('o.alertsDesc') },
    { id: 'history', name: t('o.history'), w: 700, h: 90, desc: t('o.historyDesc') },
    { id: 'summary', name: t('o.summary'), w: 1920, h: 1080, desc: t('o.summaryDesc') },
  ];

  // ------------------------------------------------------------------ outils
  function api(path, opts = {}) {
    const sep = path.includes('?') ? '&' : '?';
    return fetch(`${path}${sep}key=${encodeURIComponent(KEY)}`, opts)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok && !j.error) j.error = t('d.err', { n: r.status });
        if (!r.ok) j.ok = false;
        return j;
      })
      .catch(() => ({ ok: false, error: t('d.unreachable') }));
  }
  const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  function toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  function confirmBox(text, yes = t('d.confirm')) {
    return new Promise((resolve) => {
      $('#modalText').textContent = text;
      $('#modalYes').textContent = yes;
      $('#modal').classList.remove('hidden');
      const done = (v) => {
        $('#modal').classList.add('hidden');
        $('#modalYes').onclick = $('#modalNo').onclick = null;
        resolve(v);
      };
      $('#modalYes').onclick = () => done(true);
      $('#modalNo').onclick = () => done(false);
    });
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(t('d.copied'), 'ok');
  }

  const pad = (n) => String(n).padStart(2, '0');
  function fmtHour(ts) {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fmtDate(ts) {
    const d = new Date(ts);
    const today = new Date();
    const same = d.toDateString() === today.toDateString();
    return same ? t('d.today', { h: fmtHour(ts) }) : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${fmtHour(ts)}`;
  }
  function fmtDur(sec) {
    if (!sec) return '—';
    const m = Math.round(sec / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${pad(m % 60)}` : `${m} min`;
  }
  function fmtAgo(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return t('d.now');
    if (s < 3600) return t('d.minAgo', { n: Math.round(s / 60) });
    return t('d.hAgo', { n: Math.round(s / 3600) });
  }
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  function makePatch(path, value) {
    const keys = path.split('.');
    const root = {};
    let o = root;
    keys.slice(0, -1).forEach((k) => (o = o[k] = {}));
    o[keys[keys.length - 1]] = value;
    return root;
  }
  const LW = () => (D && D.settings.overlay.labelWin) || t('lbl.w');
  const LL = () => (D && D.settings.overlay.labelLoss) || t('lbl.l');
  const baseUrl = () => `http://127.0.0.1:${D ? D.port : location.port}`;

  // Outils communs aux autres scripts du tableau de bord (stats.js)
  window.RLUI = { $, $$, esc, t, tn, api, toast, confirmBox, pad, fmtHour, fmtDate, fmtDur, LW, LL, key: KEY, resPill: (r) => resPill(r), state: () => D };

  function resPill(r) {
    const cls = ['res', r.result, r.ot || r.overtime ? 'ot' : '', r.abandon ? 'ab' : '', r.manual ? 'man' : ''].join(' ');
    const lbl = r.result === 'W' ? (D && D.settings.overlay.labelWin) || t('lbl.w') : (D && D.settings.overlay.labelLoss) || t('lbl.l');
    const title = r.manual ? t('manual') : r.score || (Number.isFinite(r.scoreFor) ? `${r.scoreFor}-${r.scoreAgainst}` : '');
    return `<span class="${cls}" title="${esc(title)}">${esc(lbl)}</span>`;
  }

  // ------------------------------------------------------------------ onglets
  // Une entrée du menu peut réunir plusieurs sections : une section porte data-with="<entrée>"
  // (les commandes Twitch sont rangées sous « Stream », avec les actions OBS).
  function showTab(name) {
    const own = $(`#tab-${name}`);
    const entry = (own && own.dataset.with) || name;
    // tous les onglets partagent la même zone de défilement : on repart du haut en changeant d'onglet
    const cur = $('.tab.active');
    if (!cur || (cur.dataset.with || cur.id.slice(4)) !== entry) $('main').scrollTop = 0;
    $$('.side button[data-tab]').forEach((b) => {
      const on = b.dataset.tab === entry;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${entry}` || t.dataset.with === entry));
    try {
      localStorage.setItem('rlui-tab', entry);
    } catch {}
    if (entry === 'history') {
      loadHistory();
      if (window.RLUI.stats) window.RLUI.stats.show();
    }
    if (entry === 'diag') loadDiag();
    if (entry === 'stream' || entry === 'session') layoutPreviews();
    if (entry === 'caster') layoutCasterPv();
    // section demandée rangée sous une autre entrée : on l'amène à l'écran
    if (own && entry !== name) own.scrollIntoView({ block: 'start' });
  }
  $$('.side button[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ------------------------------------------------------------------ menu réduit / déplié
  function setNav(open) {
    document.body.classList.toggle('nav-open', open);
    $('#navToggle').setAttribute('aria-expanded', String(open));
    // menu déplié : le nom est affiché ; réduit : il sert d'infobulle, on le donne aussi aux lecteurs d'écran
    $$('.side button').forEach((b) => {
      const lbl = $(open ? '.lbl:not(.when-closed)' : '.lbl:not(.when-open)', b);
      if (lbl) b.setAttribute('aria-label', lbl.textContent);
    });
  }
  {
    let open = false;
    try {
      open = localStorage.getItem('rlui-nav') === 'open';
    } catch {}
    setNav(open);
    $('#navToggle').addEventListener('click', () => {
      const next = !document.body.classList.contains('nav-open');
      setNav(next);
      try {
        localStorage.setItem('rlui-nav', next ? 'open' : 'closed');
      } catch {}
      // la largeur utile change : les aperçus se recalent
      layoutPreviews();
      layoutCasterPv();
    });
  }

  // ------------------------------------------------------------------ thème clair / sombre
  // Réglage app.theme : « system » (suit le système), « light » ou « dark ». Le bouton du menu bascule
  // vers l'inverse de ce qui est affiché ; « Comme mon système » se choisit dans les Réglages.
  const THEMES = ['system', 'light', 'dark'];
  function applyTheme(theme) {
    document.documentElement.dataset.theme = THEMES.includes(theme) ? theme : 'system';
  }
  function shownTheme() {
    const th = document.documentElement.dataset.theme;
    if (th === 'light' || th === 'dark') return th;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  $('#themeToggle').addEventListener('click', () => {
    const next = shownTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    saveSetting('app.theme', next, true);
  });

  // ------------------------------------------------------------------ actions
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const r = await post(`/api/action/${b.dataset.act}`);
    if (r.ok === false) toast(r.error || t('d.nothing'), 'err');
  });
  $('#newSessionBtn').addEventListener('click', async () => {
    if (await confirmBox(t('d.newSessionQ'), t('d.newSession'))) {
      await post('/api/action/new-session');
      toast(t('d.newSessionDone'), 'ok');
    }
  });

  // ------------------------------------------------------------------ réglages (liaison automatique)
  function readInput(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number' || el.type === 'range' || el.dataset.type === 'number') return Number(el.value);
    if (el.dataset.type === 'list-number') return el.value.split(/[,; ]+/).map(Number).filter((n) => n > 0);
    if (el.dataset.type === 'list') return el.value.split(',').map((s) => s.trim()).filter(Boolean);
    return el.value;
  }
  function writeInput(el, v) {
    if (document.activeElement === el && el.type !== 'checkbox') return;
    if (el.type === 'checkbox') el.checked = !!v;
    else if (Array.isArray(v)) el.value = v.join(', ');
    else el.value = v == null ? '' : v;
  }
  let saveTimers = {};
  async function saveSetting(path, value, quiet = false) {
    const r = await post('/api/settings', makePatch(path, value));
    if (r.ok === false) toast(r.error || t('d.refused'), 'err');
    else if (!quiet) toast(t('d.saved'), 'ok');
  }
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-set]');
    if (!el || el.classList.contains('hotkey')) return;
    clearTimeout(saveTimers[el.dataset.set]);
    saveSetting(el.dataset.set, readInput(el), el.type === 'range' || el.type === 'color');
  });
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-set]');
    if (!el || !(el.type === 'range' || el.type === 'color')) return;
    clearTimeout(saveTimers[el.dataset.set]);
    saveTimers[el.dataset.set] = setTimeout(() => saveSetting(el.dataset.set, readInput(el), true), 120);
  });
  function syncInputs() {
    $$('[data-set]').forEach((el) => {
      if (el.classList.contains('rec')) return;
      writeInput(el, getPath(D.settings, el.dataset.set));
    });
    syncPicks();
  }
  // Choix segmentés : <div class="seg" data-choice="chemin.du.réglage"><button data-val="valeur">…
  function syncPicks() {
    $$('[data-choice]').forEach((g) => {
      const v = String(getPath(D.settings, g.dataset.choice));
      $$('button[data-val]', g).forEach((b) => {
        b.classList.toggle('on', b.dataset.val === v);
        b.setAttribute('aria-pressed', String(b.dataset.val === v));
      });
    });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-choice] button[data-val]');
    if (!b) return;
    const g = b.closest('[data-choice]');
    $$('button[data-val]', g).forEach((x) => x.classList.toggle('on', x === b));
    saveSetting(g.dataset.choice, b.dataset.val, true);
  });

  // Raccourcis : capture de la combinaison
  const CODE_KEYS = {
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Space: 'Space', Enter: 'Enter', Backspace: 'Backspace',
    Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Tab: 'Tab',
    NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec', NumpadEnter: 'Enter',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`',
  };
  function accelFrom(e) {
    let key = null;
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
    else if (/^Numpad\d$/.test(e.code)) key = `num${e.code.slice(6)}`;
    else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
    else key = CODE_KEYS[e.code] || null;
    if (!key) return null;
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    if (!mods.length && !/^F\d/.test(key) && !/^num/.test(key)) return null; // exige un modificateur
    return [...mods, key].join('+');
  }
  $$('input.hotkey').forEach((el) => {
    el.addEventListener('focus', () => {
      el.classList.add('rec');
      el.dataset.prev = el.value;
      el.value = t('d.pressKeys');
    });
    el.addEventListener('blur', () => {
      el.classList.remove('rec');
      if (el.value === t('d.pressKeys')) el.value = el.dataset.prev || '';
    });
    el.addEventListener('keydown', (e) => {
      e.preventDefault();
      if (e.key === 'Escape') return el.blur();
      if (e.key === 'Delete' || (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey)) {
        el.value = '';
        saveSetting(el.dataset.set, '');
        return el.blur();
      }
      const acc = accelFrom(e);
      if (!acc) return;
      el.value = acc;
      el.classList.remove('rec');
      saveSetting(el.dataset.set, acc);
      el.blur();
    });
  });

  // ------------------------------------------------------------------ construction unique
  function buildOnce() {
    if (built) return;
    built = true;

    bindDiag();

    // Parties comptées
    $('#countingForm').innerHTML = CATS.map(([k, label]) => `<label class="check"><input type="checkbox" data-set="counting.${k}" /> ${esc(label)}</label>`).join('');

    // Overlays
    // chaque overlay a sa carte (aperçu, taille, lien), posée dans son emplacement data-ovslot
    OVERLAYS.forEach((o) => {
      $(`[data-ovslot="${o.id}"]`).innerHTML = `
      <div class="ov" data-ov="${o.id}">
        <div class="pv"><iframe data-w="${o.w}" data-h="${o.h}" loading="lazy"></iframe></div>
        <div class="body">
          <div class="title"><b>${esc(o.name)}</b><span>${o.w} × ${o.h}</span></div>
          <div class="desc">${esc(o.desc)} <span class="live-dot" data-live="${o.id}"></span></div>
          <div class="url"><input readonly data-url="${o.id}" /><button class="btn small primary" data-copy="${o.id}">${esc(t('d.copy'))}</button><button class="btn small ghost" data-open="${o.id}">${esc(t('d.open'))}</button></div>
        </div>
      </div>`;
    });
    $('#tab-stream').addEventListener('click', (e) => {
      const c = e.target.closest('[data-copy]');
      if (c) copy($(`[data-url="${c.dataset.copy}"]`).value);
      const o = e.target.closest('[data-open]');
      if (o) post('/api/open', { target: 'url', url: $(`[data-url="${o.dataset.open}"]`).value });
      const tab = e.target.closest('[data-ovtab], [data-ovgo]');
      if (tab) showOvTab(tab.dataset.ovtab || tab.dataset.ovgo);
    });
    $('#previewSound').addEventListener('change', () => setPreviewSrc(true));
    $('#homeOverlays').addEventListener('click', goCounter);
    new ResizeObserver(layoutPreviews).observe($('#tab-stream'));
    new ResizeObserver(layoutPreviews).observe($('#tab-session'));
    {
      let ovTab = 'counter';
      try {
        ovTab = localStorage.getItem('rlui-ovtab') || 'counter';
      } catch {}
      showOvTab(ovTab);
    }

    // Thèmes
    $('#themeGrid').addEventListener('click', onThemeClick);
    $('#themeFolder').addEventListener('click', () => post('/api/open', { target: 'themes' }));
    $('#themeInstall').addEventListener('click', pickTheme);

    // Tests d'alertes
    $('#testRow').innerHTML = TYPES.map(([t, n]) => `<button class="btn t-${t}" data-test="${t}">${esc(n)}</button>`).join('');
    $('#testRow').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-test]');
      if (!b) return;
      const r = await post('/api/action/test', { type: b.dataset.test, obs: $('#testObs').checked });
      if (r.disabled) toast(t('d.disabledAlert'), 'err');
    });

    // Tableau des alertes
    $('#alertTable').innerHTML = TYPES.map(
      ([t, n]) => `
      <div class="a-row" data-type="${t}">
        <input type="checkbox" data-set="alerts.enabled.${t}" title="${esc(tr('d.enable'))}" />
        <span class="nm">${esc(n)}</span>
        <input data-set="alerts.texts.${t}" placeholder="${esc(tr(`alert.${t}`))}" title="${esc(tr('d.defaultText', { t: tr(`alert.${t}`) }))}" />
        <label class="dur"><input type="number" min="1.5" max="20" step="0.5" data-set="alerts.duration.${t}" /> s</label>
        <div class="snd"><span data-snd="${t}">${esc(tr('d.builtinSound'))}</span><button class="btn small ghost" data-upload="${t}" title="${esc(tr('d.pickSound'))}">${esc(tr('d.sound'))}</button><button class="btn small ghost hidden" data-unsound="${t}" title="${esc(tr('d.revertSound'))}">✕</button></div>
        <button class="btn icon small" data-test="${t}" title="${esc(tr('d.test'))}">▶</button>
      </div>`
    ).join('');
    $('#alertTable').addEventListener('click', async (e) => {
      const tb = e.target.closest('[data-test]');
      if (tb) post('/api/action/test', { type: tb.dataset.test, obs: false });
      const up = e.target.closest('[data-upload]');
      if (up) pickSound(up.dataset.upload);
      const un = e.target.closest('[data-unsound]');
      if (un) {
        await api(`/api/sounds/${un.dataset.unsound}`, { method: 'DELETE' });
        toast(t('d.soundReverted'), 'ok');
      }
    });

    // Actions OBS
    $('#obsTable').innerHTML =
      TYPES.map(
        ([t, n]) => `
      <div class="o-row" data-type="${t}">
        <span class="nm">${esc(n)}</span>
        <select data-set="obs.actions.${t}.type">
          <option value="none">${esc(tr('d.none'))}</option>
          <option value="source">${esc(tr('d.showSource'))}</option>
          <option value="scene">${esc(tr('d.switchScene'))}</option>
        </select>
        <input data-set="obs.actions.${t}.scene" list="dl-scenes" placeholder="${esc(tr('d.scene'))}" />
        <input data-set="obs.actions.${t}.source" list="dl-src-${t}" placeholder="${esc(tr('d.source'))}" />
        <label class="dur"><input type="number" min="0" max="120" data-set="obs.actions.${t}.duration" title="${esc(tr('d.durTip'))}" /></label>
        <label class="ret"><input type="checkbox" data-set="obs.actions.${t}.returnBack" /> ${esc(tr('d.backScene'))}</label>
        <button class="btn icon small" data-obstest="${t}" title="${esc(tr('d.test'))}">▶</button>
        <datalist id="dl-src-${t}"></datalist>
      </div>`
      ).join('') + '<datalist id="dl-scenes"></datalist>';
    $('#obsTable').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-obstest]');
      if (!b) return;
      const r = await post('/api/action/test', { type: b.dataset.obstest, obs: true });
      if (r.ok === false) toast(r.error || t('d.failed'), 'err');
    });
    $('#obsTable').addEventListener('change', (e) => {
      if (e.target.matches('[data-set$=".scene"]')) fillSourceList(e.target.closest('.o-row').dataset.type);
    });
    $('#obsRefresh').addEventListener('click', loadObsScenes);

    // Commandes du chat
    $('#chatAuth').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-chat]');
      if (!b) return;
      if (b.dataset.chat === 'activate') return post('/api/open', { target: 'url', url: (D.chat && D.chat.uri) || 'https://www.twitch.tv/activate' });
      const r = await post(`/api/chat/${b.dataset.chat}`);
      if (r.ok === false) toast(r.error || t('d.failed'), 'err');
    });
    $('#chatTable').addEventListener('change', (e) => {
      if (e.target.closest('[data-cmd]')) saveCommands();
    });
    $('#chatTable').addEventListener('click', (e) => {
      const d = e.target.closest('[data-cmddel]');
      if (!d) return;
      d.closest('[data-cmd]').remove();
      saveCommands();
    });
    $('#chatAdd').addEventListener('click', () => {
      const list = [...(D.settings.chat.commands || []), { name: `cmd${(D.settings.chat.commands || []).length + 1}`, aliases: '', enabled: true, text: 'RL-UI' }];
      saveSetting('chat.commands', list);
    });

    // Mode caster
    $('#casterCopy').addEventListener('click', () => copy($('#casterUrl').value));
    $('#casterOpen').addEventListener('click', () => post('/api/open', { target: 'url', url: $('#casterUrl').value }));
    document.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-cs]');
      if (!b) return;
      const r = await post(`/api/caster/${b.dataset.cs}`);
      if (r.ok === false) toast(r.error || t('d.failed'), 'err');
    });
    $$('[data-csname]').forEach((el) =>
      el.addEventListener('change', () => {
        const names = [$('#csName0').value.trim(), $('#csName1').value.trim()];
        saveSetting('caster.names', names);
      })
    );
    new ResizeObserver(layoutCasterPv).observe($('.caster-pv'));
    document.addEventListener('click', async (e) => {
      const up = e.target.closest('[data-img]');
      if (up) return pickImage(up.dataset.img, up.dataset.key);
      const rm = e.target.closest('[data-imgdel]');
      if (rm) {
        const q = rm.dataset.imgdel === 'logo' ? `team=${rm.dataset.key}` : `name=${encodeURIComponent(rm.dataset.key)}`;
        await api(`/api/caster/${rm.dataset.imgdel}?${q}`, { method: 'DELETE' });
      }
    });
    $('#photoAdd').addEventListener('click', () => {
      const n = $('#photoName').value.trim();
      if (!n) return $('#photoName').focus();
      pickImage('photo', n, () => ($('#photoName').value = ''));
    });

    // Historique
    $('#histScope').addEventListener('click', (e) => {
      const b = e.target.closest('[data-scope]');
      if (!b) return;
      historyScope = b.dataset.scope;
      $$('#histScope button').forEach((x) => x.classList.toggle('on', x === b));
      loadHistory(true);
    });
    $('#homeRecap').addEventListener('click', () => {
      if (window.RLUI.stats) window.RLUI.stats.open('sessions');
      showTab('history');
    });
    $('#histCsv').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = `/api/history.csv?scope=${historyScope}&key=${encodeURIComponent(KEY)}`;
      a.download = 'rl-ui-matches.csv';
      a.click();
    });
    document.addEventListener('click', async (e) => {
      const d = e.target.closest('[data-del]');
      if (!d) return;
      if (await confirmBox(t('d.deleteMatchQ'), t('d.delete'))) {
        await api(`/api/matches/${encodeURIComponent(d.dataset.del)}`, { method: 'DELETE' });
        historyDirty = true;
        if (window.RLUI.stats) window.RLUI.stats.dirty();
        loadHistory(true);
      }
    });

    // Identité / réglages divers
    document.addEventListener('click', async (e) => {
      const p = e.target.closest('[data-pick]');
      if (p) {
        const r = await post('/api/identity', { key: p.dataset.pick });
        toast(r.ok ? t('d.thanks') : t('d.noPlayer'), r.ok ? 'ok' : 'err');
      }
      const f = e.target.closest('[data-forget]');
      if (f) post('/api/identity/forget', { id: f.dataset.forget });
      const cu = e.target.closest('[data-copyurl]');
      if (cu) copy(cu.dataset.copyurl);
    });
    $('#enableApiBtn').addEventListener('click', enableApi);
    $('#openRlCfg').addEventListener('click', () => post('/api/open', { target: 'rlconfig' }));
    $('#openTextDir').addEventListener('click', () => post('/api/open', { target: 'text' }));
    $('#openDataDir').addEventListener('click', () => post('/api/open', { target: 'data' }));
    $('#boostReset').addEventListener('click', async () => {
      await post('/api/settings', { overlay: { boostScale: 1, boostX: 0, boostY: 0 } });
      toast(t('d.calReset'), 'ok');
    });
    $('#regenKey').addEventListener('click', async () => {
      if (!(await confirmBox(t('d.regenQ'), t('d.regen')))) return;
      const bytes = crypto.getRandomValues(new Uint8Array(9));
      const key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      await post('/api/settings', { apiKey: key });
      location.reload();
    });
    if (!isApp) $('#appCard').classList.add('hidden');
    // Assistant de démarrage
    $('#onbNext').addEventListener('click', () => onbGo(1));
    $('#onbBack').addEventListener('click', () => onbGo(-1));
    $('#onbSkip').addEventListener('click', () => onbClose(true));
    $('#onbReopen').addEventListener('click', () => onbOpen(0));
    $('#onb').addEventListener('click', async (e) => {
      const c = e.target.closest('[data-onbcopy]');
      if (c) copy(c.dataset.onbcopy);
      const l = e.target.closest('[data-onblang]');
      if (l && l.dataset.onblang !== D.settings.language) {
        try {
          localStorage.setItem('rlui-onb', '1'); // après le rechargement, on reprend à l'étape suivante
        } catch {}
        await post('/api/settings', { language: l.dataset.onblang });
      } else if (l) onbGo(1);
      const th = e.target.closest('[data-onbtheme]');
      if (th) await post('/api/settings', { overlay: { themePack: th.dataset.onbtheme } });
      const ly = e.target.closest('[data-onblayout]');
      if (ly) await post('/api/settings', { overlay: { layout: ly.dataset.onblayout } });
      const tb = e.target.closest('[data-onbtab]');
      if (tb) {
        onbClose(true);
        showTab(tb.dataset.onbtab);
      }
    });
    {
      let resume = null;
      try {
        resume = localStorage.getItem('rlui-onb');
      } catch {}
      if (resume != null) onbOpen(Number(resume) || 0);
      else if (!D.settings.app.onboarded) onbOpen(0);
    }
    document.addEventListener('click', async (e) => {
      const u = e.target.closest('[data-upd]');
      if (!u) return;
      const act = u.dataset.upd;
      if (act === 'download') return post('/api/open', { target: 'url', url: D.update.url });
      if (act === 'check') toast(t('d.up.checking'));
      const r = await post(`/api/update/${act}`);
      if (r.ok === false) toast(r.error || t('d.failed'), 'err');
      else if (act === 'check' && r.update && r.update.state === 'none') toast(t('d.up.none', { v: D.version }), 'ok');
    });

    let tab = 'session';
    try {
      tab = localStorage.getItem('rlui-tab') || 'session';
    } catch {}
    if (!$(`#tab-${tab}`)) tab = 'session';
    showTab(tab);
  }

  // ------------------------------------------------------------------ rendu
  function chip(cls, label, value) {
    return `<span class="chip ${cls}"><span class="k">${esc(label)}</span> <b>${esc(value)}</b></span>`;
  }

  function renderChips() {
    const st = D.status;
    const out = [];
    if (D.settings.paused) out.push(`<span class="chip warn"><b>${esc(t('d.paused'))}</b></span>`);
    out.push(chip(st.rl === 'live' ? 'live' : st.rl === 'running' ? 'ok' : '', 'Rocket League', t(st.rl === 'live' ? 'd.inMatch' : st.rl === 'running' ? 'd.running' : 'd.closed')));
    const cfg = st.rlConfig;
    let apiCls = '';
    let apiTxt = t('d.waitingGame');
    if (cfg && cfg.known && !cfg.enabled) {
      apiCls = 'err';
      apiTxt = t('d.disabled');
    } else if (st.api.state === 'live') {
      apiCls = 'live';
      apiTxt = t('d.live', { t: st.api.transport === 'tcp' ? 'TCP' : 'WebSocket' });
    } else if (st.api.state === 'waiting') {
      apiCls = 'ok';
      apiTxt = t('d.connected');
    } else if (st.rl !== 'closed') {
      apiCls = 'warn';
      apiTxt = t('d.unreachableApi');
    }
    out.push(chip(apiCls, 'Stats API', apiTxt));
    out.push(st.account ? chip('ok', t('d.account'), `${st.account.name} · ${st.account.platform}`) : chip('warn', t('d.account'), t('d.notDetected')));
    if (D.settings.obs.enabled) {
      const o = st.obs.state;
      out.push(chip(o === 'connected' ? 'ok' : o === 'connecting' ? 'warn' : 'err', st.obs.name || 'OBS', t(o === 'connected' ? 'd.connected' : o === 'connecting' ? 'd.connecting' : 'd.error')));
    }
    if (D.live && D.live.inMatch && D.live.overtime) out.push('<span class="chip ot"><b>OVERTIME</b></span>');
    $('#statusChips').innerHTML = out.join('');
    $('#pauseBtn').textContent = t(D.settings.paused ? 'd.resume' : 'd.pause');
    $('#versionInfo').textContent = `RL-UI ${D.version} · ${t('d.byZoxam')}`;
    $('#portInfo').textContent = t('d.serverPort', { p: D.port });
  }

  function setCount(id, v, kind) {
    const el = $(id);
    const old = Number(el.textContent);
    el.textContent = v;
    if (prevCounts && v > old) {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
  }

  function renderScore() {
    if (!S) return;
    const s = S.session;
    setCount('#cWins', s.wins);
    setCount('#cLosses', s.losses);
    prevCounts = { w: s.wins, l: s.losses };
    $('#cWr').textContent = s.played ? `${s.winRate}%` : '—';
    // barre victoires / défaites proportionnelle (vide tant qu'aucune partie n'est jouée)
    $('#barW').style.flexGrow = s.played ? s.wins : 0;
    $('#barL').style.flexGrow = s.played ? s.losses : 0;
    const k = $('#kStreak');
    k.className = s.streak > 0 ? 'hot' : s.streak < 0 ? 'cold' : '';
    k.textContent = s.streak > 0 ? tn('d.nWins', s.streak) : s.streak < 0 ? tn('d.nLosses', -s.streak) : '—';
    $('#kBest').textContent = s.bestWinStreak;
    $('#kOt').textContent = `${s.otWins}-${s.otLosses}`;
    $('#kMvp').textContent = s.mvps;
    $('#kGas').textContent = `${s.myGoals} · ${s.myAssists} · ${s.mySaves}`;
    const mm = s.mmr && s.mmr.primary;
    const km = $('#kMmr');
    if (mm) {
      const d = Math.round(mm.delta || 0);
      // variation nulle : on n'affiche que la valeur (sinon « 1204 0 » se lit mal)
      const dTxt = d !== 0 || mm.current == null ? `<span class="mmr-d ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${mm.approx ? '≈' : ''}${d > 0 ? '+' : ''}${d}</span>` : '';
      km.innerHTML = `${mm.current != null ? `${mm.current} ` : ''}${dTxt}`;
      $('#kMmrLbl').textContent = 'MMR';
      $('#kMmrLbl').parentElement.title = t('d.mmrTip', { name: mm.name });
    } else {
      km.textContent = '—';
      $('#kMmrLbl').textContent = 'MMR';
    }
    $('#lastStrip').innerHTML = s.last.length ? s.last.slice(-20).map(resPill).join('') : `<span class="muted small">${esc(t('d.noMatchYet'))}</span>`;
    $('#sessStart').textContent = `${t('d.since', { d: fmtDate(s.startedAt).replace(/^./, (c) => c.toLowerCase()) })}${s.timePlayedSec ? ` · ${t('d.played', { t: fmtDur(s.timePlayedSec) })}` : ''}`;
  }

  function mmrCell(m) {
    if (!m.mmr || !Number.isFinite(m.mmr.delta)) return '';
    const d = Math.round(m.mmr.delta);
    const exact = m.mmr.status === 'exact';
    const title = t(exact ? 'd.mmrExact' : m.mmr.status === 'grouped' ? 'd.mmrGrouped' : 'd.mmrEst');
    return `<span class="mmr-d ${d > 0 ? 'up' : d < 0 ? 'down' : ''}" title="${title}">${exact ? '' : '≈'}${d > 0 ? '+' : ''}${d}</span>`;
  }

  function renderLive() {
    const L = D.live;
    const card = $('#liveCard');
    if (!L || (!L.inMatch && !L.ended)) {
      const rl = D.status.rl;
      const last = D.sessionMatches[0];
      card.innerHTML = `
        <div class="live-status"><span class="dot"></span><span class="t">${esc(t('d.liveMatch'))}</span></div>
        <div class="live-empty">
          <div class="big">${esc(t(rl === 'closed' ? 'd.rlClosed' : 'd.waitingMatch'))}</div>
          <div>${esc(t(rl === 'closed' ? 'd.launchGame' : 'd.launchMatch'))}</div>
          ${last ? `<div class="small">${esc(t('d.lastMatch', { r: `${t(last.result === 'W' ? 'd.victory' : 'd.defeat')}${Number.isFinite(last.scoreFor) && !last.manual ? ` ${last.scoreFor}-${last.scoreAgainst}` : ''}${last.overtime ? t('d.inOt') : ''} · ${fmtAgo(last.endedAt)}` }))}</div>` : ''}
        </div>`;
      return;
    }
    const t0 = L.teams.find((x) => x.num === 0) || { name: t('team.blue'), score: 0 };
    const t1 = L.teams.find((x) => x.num === 1) || { name: t('team.orange'), score: 0 };
    const meTag = (n) => (L.myTeam === n ? `<span class="me-tag">${esc(t('d.you'))}</span>` : '');
    const clock = L.overtime
      ? `<div class="clock ot"><b>${OT.fmtClock(L.time, true) || '+0:00'}</b><span>Overtime</span></div>`
      : `<div class="clock"><b>${OT.fmtClock(L.time) || '5:00'}</b><span>${esc(t(L.inMatch ? 'd.remaining' : 'd.ended'))}</span></div>`;
    const col = (n) =>
      L.players
        .filter((p) => p.team === n)
        .map((p) => `<div class="pl ${p.isMe ? 'me' : ''}"><span class="nm">${esc(p.name)}</span><span class="sc" title="${esc(t('d.plTip'))}">${p.score} · ${p.goals}/${p.assists}/${p.saves}</span></div>`)
        .join('');
    const notes = [];
    if (D.settings.paused) notes.push(`<div class="live-note warn">${esc(t('d.pausedNote'))}</div>`);
    else if (!L.counted) notes.push(`<div class="live-note warn">${esc(t('d.notCounted', { pl: L.playlist.name }))}</div>`);
    if (L.identityState === 'spectator') notes.push(`<div class="live-note">${esc(t('d.spectator'))}</div>`);
    if (L.me && L.me.via === 'camera') notes.push(`<div class="live-note">${esc(t('d.viaCamera'))}</div>`);
    const res = L.result
      ? `<div class="result-banner ${L.result.result}">${esc(t(L.result.result === 'W' ? 'd.Victory' : 'd.Defeat'))}${L.result.overtime ? esc(t('d.inOt')) : ''}${L.result.abandon ? esc(t('d.abandoned')) : ''} · ${L.result.scoreFor}-${L.result.scoreAgainst}</div>`
      : '';
    card.innerHTML = `
      <div class="live-status">
        <span class="dot ${L.inMatch ? 'on' : ''}"></span>
        <span class="t">${esc(t(L.inMatch ? 'd.liveNow' : 'd.matchEnded'))}</span>
        <span class="sub">${esc(L.playlist.name)}${L.arena ? ` · ${esc(L.arena)}` : ''}</span>
      </div>
      <div class="live-score">
        <div class="team t0"><span class="n">${esc(t0.name)} ${meTag(0)}</span><span class="s">${t0.score}</span></div>
        ${clock}
        <div class="team t1"><span class="n">${meTag(1)} ${esc(t1.name)}</span><span class="s">${t1.score}</span></div>
      </div>
      <div class="players"><div class="col t0">${col(0)}</div><div class="col t1">${col(1)}</div></div>
      ${notes.join('')}${res}`;
  }

  function renderIdentity() {
    const L = D.live;
    const card = $('#identityCard');
    if (!L || !L.needsIdentity) return card.classList.add('hidden');
    card.classList.remove('hidden');
    card.innerHTML = `
      <h3>${esc(t('d.whoAreYou'))}</h3>
      <div class="muted">${esc(t('d.whoHelp'))}</div>
      <div class="pick">${L.players.map((p) => `<button class="btn ${p.team === 0 ? '' : 'ghost'}" data-pick="${esc(p.key)}">${esc(p.name)}</button>`).join('')}</div>`;
  }

  // Premiers pas : trois étapes, cochées dès qu'elles sont faites. Les deux premières sont nécessaires
  // au suivi (la carte reste tant qu'elles manquent) ; la troisième se masque si on n'utilise pas OBS.
  function renderSetup() {
    const st = D.status;
    const cfg = st.rlConfig;
    const apiOff = cfg && cfg.known && !cfg.enabled;
    const noCfg = cfg && !cfg.known;
    const inObs = Object.values(st.overlays || {}).some((n) => n > 0);
    const steps = [
      {
        label: t('d.stepApi'),
        done: !apiOff && !noCfg,
        help: apiOff ? t('d.setupApiOff', { btn: `<button class="btn small primary" id="setupEnable">${esc(t('d.enable'))}</button>` }) : t('d.setupNoCfg'),
      },
      { label: t('d.stepLog'), done: !!st.logFound, help: t('d.setupNoLog') },
      {
        label: t('d.stepObs'),
        done: inObs,
        optional: true,
        help: `${esc(t('d.stepObsHelp'))} <button class="btn small primary" id="setupObs">${esc(t('d.stepObsBtn'))}</button>`,
      },
    ];
    let hidden = false;
    try {
      hidden = localStorage.getItem('rlui-steps') === 'hidden';
    } catch {}
    const todo = steps.filter((s) => !s.done);
    const card = $('#setupCard');
    if (!todo.length || (hidden && todo.every((s) => s.optional))) return card.classList.add('hidden');
    card.classList.remove('hidden');
    const next = todo[0];
    const canHide = todo.every((s) => s.optional);
    card.innerHTML = `
      <div class="card-head">
        <h3>${esc(t('d.stepsTitle'))}</h3>
        <span class="muted small">${esc(t('d.stepsCount', { n: steps.length - todo.length, t: steps.length }))}${canHide ? ` · <button class="link" id="setupHide">${esc(t('d.stepsHide'))}</button>` : ''}</span>
      </div>
      <ol class="steps-list">${steps
        .map(
          (s, i) => `
        <li class="step ${s.done ? 'done' : s === next ? 'now' : ''}">
          <span class="n" aria-hidden="true">${s.done ? '<svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10" /></svg>' : i + 1}</span>
          <div><div class="lbl">${esc(s.label)}</div>${s.done ? '' : `<div class="detail">${s.help}</div>`}</div>
        </li>`
        )
        .join('')}</ol>`;
    const b = $('#setupEnable');
    if (b) b.onclick = enableApi;
    const o = $('#setupObs');
    if (o) o.onclick = () => goCounter();
    const h = $('#setupHide');
    if (h) {
      h.onclick = () => {
        try {
          localStorage.setItem('rlui-steps', 'hidden');
        } catch {}
        card.classList.add('hidden');
      };
    }
  }
  // Ouvre Overlays → Compteur (lien OBS, réglages)
  function goCounter() {
    showTab('stream');
    showOvTab('counter');
  }

  function matchRow(m) {
    const tags = [];
    if (m.overtime) tags.push('<span class="tag ot">OT</span>');
    if (m.mvp) tags.push('<span class="tag mvp">MVP</span>');
    if (m.abandon) tags.push(`<span class="tag">${esc(t('d.tagAbandon'))}</span>`);
    const score = Number.isFinite(m.scoreFor) && !m.manual ? `${m.scoreFor}-${m.scoreAgainst}` : '';
    return `<div class="m-row">
      ${resPill(m)}
      <div class="info"><b>${esc(m.playlistName || '')}${tags.join('')}</b><span>${esc(m.arena || '')}${m.me ? `${m.arena ? ' · ' : ''}${tn('d.goals', m.me.goals)}, ${tn('d.saves', m.me.saves)}` : ''}</span></div>
      <span class="sc">${score} ${mmrCell(m)}</span>
      <span class="when">${fmtHour(m.endedAt)} <button class="del" data-del="${esc(m.id)}" title="${esc(t('d.delete'))}">×</button></span>
    </div>`;
  }

  function renderSessionList() {
    const list = D.sessionMatches;
    $('#sessCount').textContent = list.length ? tn('d.nMatches', list.length) : '';
    $('#sessionList').innerHTML = list.length ? list.map(matchRow).join('') : `<div class="empty">${esc(t('d.sessEmpty'))}</div>`;
  }

  function renderLogs() {
    $('#logList').innerHTML = [...D.logs]
      .reverse()
      .map((l) => {
        const d = new Date(l.at);
        return `<div class="${l.level}"><time>${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}</time><span>${esc(l.msg)}</span></div>`;
      })
      .join('');
  }

  // ------------------------------------------------------------------ diagnostic
  const DG_ICON = {
    ok: '<path d="M7 12.5l3.2 3.2L17 9" />',
    warn: '<path d="M12 7v6M12 16.6v.2" />',
    bad: '<path d="M8.5 8.5l7 7M15.5 8.5l-7 7" />',
    idle: '<path d="M8 12h8" />',
  };
  const DG_FIX = { 'enable-api': 'd.dg.enable', resume: 'd.dg.resume', counting: 'd.dg.toSettings', identity: 'd.dg.toSettings', overlays: 'd.dg.toOverlays' };

  // Bilan de santé : un point par maillon de la détection, avec ce qu'il faut faire si ça coince
  function renderDiagChecks() {
    const dg = D.diag;
    const lvl = $('#dgLevel');
    lvl.className = `pill ${dg.level === 'ok' ? 'ok' : dg.level === 'bad' ? 'err' : 'wait'}`;
    lvl.textContent = t(`d.dg.${dg.level}`);
    $('#dgChecks').innerHTML = dg.checks
      .map(
        (c) => `
      <li class="dg-check ${c.level}">
        <span class="dg-ic" role="img" aria-label="${esc(t(`d.dg.${c.level}`))}"><svg viewBox="0 0 24 24" aria-hidden="true">${DG_ICON[c.level] || DG_ICON.idle}</svg></span>
        <div>
          <b>${esc(c.title)}</b>
          <p>${esc(c.detail)}</p>
          ${c.fix && DG_FIX[c.fix] && c.level !== 'ok' ? `<button class="btn small" data-dgdo="${esc(c.fix)}">${esc(t(DG_FIX[c.fix]))}</button>` : ''}
        </div>
      </li>`
      )
      .join('');
    // pastille sur l'entrée du menu : un point de contrôle bloquant, ou une partie non comptée à regarder
    const b = $('.side button[data-tab="diag"]');
    b.classList.toggle('dot-bad', dg.level === 'bad');
    b.classList.toggle('dot-warn', dg.level !== 'bad' && !!dg.notice);
  }

  const dgScore = (e) => (e.score ? (e.mySide ? e.score : `${t('team.blue')} ${e.score} ${t('team.orange')}`) : '');

  // Avis sur l'accueil : la dernière partie vue n'a pas été comptée
  function renderNotice() {
    const n = D.diag.notice;
    const card = $('#noticeCard');
    if (!n) return card.classList.add('hidden');
    card.classList.remove('hidden');
    const direct = n.canFix && !n.needs.length;
    card.innerHTML = `
      <div class="notice-txt">
        <b>${esc(t('d.dg.noticeTitle'))}</b>
        <span class="muted">${esc([n.mode, dgScore(n), n.when].filter(Boolean).join(' · '))}</span>
        <p>${esc(n.why)}</p>
      </div>
      <div class="head-actions">
        <button class="link" data-dgnotice="hide">${esc(t('d.dg.noticeHide'))}</button>
        ${direct ? `<button class="btn" data-dgnotice="why">${esc(t('d.dg.noticeWhy'))}</button><button class="btn primary" data-dgnotice="count">${esc(t(n.leftDraft ? 'd.dg.countLoss' : 'd.dg.count'))}</button>` : `<button class="btn primary" data-dgnotice="why">${esc(t(n.canFix ? 'd.dg.noticeChoose' : 'd.dg.noticeWhy'))}</button>`}
      </div>`;
  }

  // Journal des parties vues (lu à la demande : il porte la trace technique de chaque partie)
  let DG = null;
  let dgRev = -1;
  let dgBusy = false;
  async function loadDiag() {
    if (dgBusy) return;
    dgBusy = true;
    const r = await api('/api/diagnostic');
    dgBusy = false;
    if (!r || !Array.isArray(r.journal)) return;
    dgRev = r.rev;
    DG = r;
    if (changed('dgJournal', r.journal)) renderDiagJournal();
  }

  function dgEntry(e) {
    const kind = e.removed ? 'rm' : e.result ? e.result : 'no';
    const fix = [];
    if (e.canFix) {
      if (e.needs.includes('player')) {
        const group = (team) => {
          const ps = e.players.filter((p) => p.team === team);
          return ps.length ? `<optgroup label="${esc(t(team === 0 ? 'team.blue' : 'team.orange'))}">${ps.map((p) => `<option value="${p.i}">${esc(p.name)}</option>`).join('')}</optgroup>` : '';
        };
        fix.push(`<select data-dgplayer aria-label="${esc(t('d.dg.who'))}"><option value="">${esc(t('d.dg.who'))}</option>${group(0)}${group(1)}</select>`);
      }
      if (e.needs.includes('result')) {
        fix.push(`<button class="btn small" data-dgfix="W">${esc(t('d.dg.asWin'))}</button><button class="btn small" data-dgfix="L">${esc(t('d.dg.asLoss'))}</button>`);
      } else {
        fix.push(`<button class="btn small primary" data-dgfix="">${esc(t(e.leftDraft ? 'd.dg.countLoss' : 'd.dg.count'))}</button>`);
      }
    } else if (e.warn && e.recorded) {
      fix.push(`<button class="btn small" data-dgremove>${esc(t('d.dg.remove'))}</button>`);
    }
    const trace = (e.trace || []).map((l) => `<span>${String(l.t.toFixed(1)).padStart(6)} s</span> ${esc(l.text)}`).join('\n');
    return `
      <article class="dg-entry ${kind}" data-dgid="${esc(e.id)}">
        <header>
          <span class="dg-badge ${kind}">${esc(e.label)}</span>
          <b>${esc(e.mode)}</b>
          <span class="sc">${esc(dgScore(e))}</span>
          <time>${esc(e.when)}</time>
        </header>
        <p>${esc(e.why)}</p>
        ${e.warn ? `<p class="dg-warn">${esc(e.warn)}</p>` : ''}
        ${fix.length ? `<div class="dg-fix">${fix.join('')}</div>` : ''}
        ${trace ? `<details class="dg-trace"><summary>${esc(t('d.dg.trace'))}</summary><p class="muted small">${esc(t('d.dg.traceHelp'))}</p><pre>${trace}</pre></details>` : ''}
      </article>`;
  }

  function renderDiagJournal() {
    const list = DG ? DG.journal : [];
    $('#dgCount').textContent = list.length ? tn('d.dg.nSeen', list.length) : '';
    // on garde ce qui est ouvert ou choisi pendant le rafraîchissement
    const open = new Set($$('#dgJournal details[open]').map((d) => d.closest('[data-dgid]').dataset.dgid));
    const picked = new Map($$('#dgJournal select[data-dgplayer]').map((s) => [s.closest('[data-dgid]').dataset.dgid, s.value]));
    $('#dgJournal').innerHTML = list.length ? list.map(dgEntry).join('') : `<div class="empty">${esc(t('d.dg.empty'))}</div>`;
    for (const el of $$('#dgJournal [data-dgid]')) {
      if (open.has(el.dataset.dgid)) $('details', el).open = true;
      const sel = $('select[data-dgplayer]', el);
      if (sel && picked.get(el.dataset.dgid)) sel.value = picked.get(el.dataset.dgid);
    }
  }

  async function dgCount(id, body) {
    const r = await post('/api/diagnostic/count', { id, ...body });
    if (!r.ok) return toast(r.error || t('d.failed'), 'err');
    const word = t(r.result === 'W' ? 'type.win' : 'type.loss');
    toast(t(r.inSession ? 'd.dg.done' : 'd.dg.doneOld', { r: word }), 'ok');
    loadDiag();
  }

  async function dgReport() {
    try {
      const r = await fetch(`/api/diagnostic/report?key=${encodeURIComponent(KEY)}`);
      if (!r.ok) throw new Error(String(r.status));
      return await r.text();
    } catch {
      toast(t('d.dg.reportFail'), 'err');
      return null;
    }
  }

  function bindDiag() {
    $('#dgJournal').addEventListener('click', async (e) => {
      const entry = e.target.closest('[data-dgid]');
      if (!entry) return;
      const id = entry.dataset.dgid;
      const fix = e.target.closest('[data-dgfix]');
      if (fix) {
        const body = {};
        const sel = $('select[data-dgplayer]', entry);
        if (sel) {
          if (sel.value === '') {
            sel.focus();
            return toast(t('d.dg.pickFirst'), 'err');
          }
          body.player = Number(sel.value);
        }
        if (fix.dataset.dgfix) body.result = fix.dataset.dgfix;
        return dgCount(id, body);
      }
      if (e.target.closest('[data-dgremove]') && (await confirmBox(t('d.dg.removeQ'), t('d.dg.remove')))) {
        await api(`/api/matches/${encodeURIComponent(id)}`, { method: 'DELETE' });
        loadDiag();
      }
    });
    $('#dgChecks').addEventListener('click', (e) => {
      const b = e.target.closest('[data-dgdo]');
      if (!b) return;
      const act = b.dataset.dgdo;
      if (act === 'enable-api') enableApi();
      else if (act === 'resume') post('/api/action/resume');
      else if (act === 'overlays') showTab('stream');
      else showTab('settings');
    });
    $('#noticeCard').addEventListener('click', (e) => {
      const b = e.target.closest('[data-dgnotice]');
      const n = D && D.diag.notice;
      if (!b || !n) return;
      if (b.dataset.dgnotice === 'hide') post('/api/diagnostic/dismiss', { id: n.id });
      else if (b.dataset.dgnotice === 'count') dgCount(n.id, {});
      else showTab('diag');
    });
    $('#dgCopy').addEventListener('click', async () => {
      const text = await dgReport();
      if (text == null) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast(t('d.dg.reportCopied'), 'ok');
    });
    $('#dgSave').addEventListener('click', async () => {
      const text = await dgReport();
      if (text == null) return;
      const d = new Date();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      a.download = `rl-ui-diagnostic-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  // ------------------------------------------------------------------ overlays / aperçus
  let lastSrcSig = '';
  function setPreviewSrc(force) {
    const sig = `${D.port}|${$('#previewSound').checked}`;
    if (!force && sig === lastSrcSig) return;
    lastSrcSig = sig;
    $$('#tab-stream .ov').forEach((ov) => {
      const id = ov.dataset.ov;
      const url = `${baseUrl()}/overlay/${id}`;
      $(`[data-url="${id}"]`, ov).value = url;
      const extra = id === 'alerts' && !$('#previewSound').checked ? '&mute=1' : '';
      $('iframe', ov).src = `${url}?preview=1${extra}`;
    });
    $('#homePv').src = `${baseUrl()}/overlay/counter?preview=1`;
    layoutPreviews();
  }
  // Sous-onglets de la page Overlays : compteur, alertes, autres overlays, thèmes
  function showOvTab(name) {
    if (!$(`[data-ovpane="${name}"]`)) name = 'counter';
    $$('#ovTabs button').forEach((b) => b.classList.toggle('on', b.dataset.ovtab === name));
    $$('[data-ovpane]').forEach((p) => p.classList.toggle('hidden', p.dataset.ovpane !== name));
    try {
      localStorage.setItem('rlui-ovtab', name);
    } catch {}
    layoutPreviews(); // un aperçu caché n'a pas de taille : on le recale quand il apparaît
  }
  function layoutPreviews() {
    $$('#tab-stream .pv, #tab-session .pv').forEach((pv) => {
      if (!pv.clientWidth) return;
      const f = $('iframe', pv);
      const w = Number(f.dataset.w);
      const h = Number(f.dataset.h);
      // zone à montrer (ex. coin de la jauge de boost pour le compteur "boost")
      const crop = (f.dataset.crop || '').split(',').map(Number);
      const [cx, cy, cw, ch] = crop.length === 4 && crop.every(Number.isFinite) ? crop : [0, 0, w, h];
      const k = Math.min(pv.clientWidth / cw, pv.clientHeight / ch) || 0.2;
      f.style.width = `${w}px`;
      f.style.height = `${h}px`;
      f.style.transform = `scale(${k})`;
      // zone centrée ; si la page de l'overlay est plus grande que le cadre, elle le remplit jusqu'aux bords
      // (la jauge de boost est dans un coin : sans ça, il resterait une bande vide à côté)
      const fill = (box, size, at) => (size * k > box ? Math.min(0, Math.max(box - size * k, at)) : at);
      f.style.left = `${fill(pv.clientWidth, w, (pv.clientWidth - cw * k) / 2 - cx * k)}px`;
      f.style.top = `${fill(pv.clientHeight, h, (pv.clientHeight - ch * k) / 2 - cy * k)}px`;
    });
  }
  // Taille conseillée du compteur selon sa disposition
  const COUNTER_DIMS = {
    horizontal: { w: 1000, h: 220, label: '1000 × 220', desc: t('o.counterDesc') },
    vertical: { w: 340, h: 720, label: '340 × 720', desc: t('o.counterV') },
    boost: { w: 1920, h: 1080, label: t('o.fullscreen'), desc: t('o.counterB') },
  };
  function renderLayout() {
    const layout = D.settings.overlay.layout || 'horizontal';
    $('#boostOpts').classList.toggle('hidden', layout !== 'boost');
    const dims = COUNTER_DIMS[layout] || COUNTER_DIMS.horizontal;
    const ov = $('#tab-stream .ov[data-ov="counter"]');
    if (!ov) return;
    const crop = layout === 'boost' ? '1330,690,590,390' : '';
    // les deux aperçus du compteur : celui de la page Overlays et celui de l'accueil
    let moved = false;
    for (const f of [$('iframe', ov), $('#homePv')]) {
      if (f.dataset.w !== String(dims.w) || f.dataset.h !== String(dims.h) || (f.dataset.crop || '') !== crop) {
        f.dataset.w = dims.w;
        f.dataset.h = dims.h;
        f.dataset.crop = crop;
        moved = true;
      }
    }
    if (moved) layoutPreviews();
    $('.title span', ov).textContent = dims.label;
    $('.desc', ov).firstChild.textContent = `${dims.desc} `;
  }

  function renderStream() {
    setPreviewSrc(false);
    const ovs = D.status.overlays || {};
    OVERLAYS.forEach((o) => {
      const el = $(`[data-live="${o.id}"]`);
      if (el) el.textContent = ovs[o.id] ? tn('o.sources', ovs[o.id]) : '';
    });
    // accueil : le compteur est-il affiché dans OBS ?
    const live = ovs.counter > 0;
    const pill = $('#homeObs');
    pill.className = `pill ${live ? 'ok' : 'wait'}`;
    pill.textContent = t(live ? 'd.inObs' : 'd.notInObs');
    const cs = D.settings.alerts.customSounds || {};
    TYPES.forEach(([t]) => {
      const lab = $(`[data-snd="${t}"]`);
      if (!lab) return;
      lab.textContent = cs[t] ? tr('d.customSound', { f: cs[t] }) : tr('d.builtinSound');
      $(`[data-unsound="${t}"]`).classList.toggle('hidden', !cs[t]);
    });
  }

  // ------------------------------------------------------------------ thèmes
  function renderThemes() {
    const list = (D.themes && D.themes.list) || [];
    const cur = D.settings.overlay.themePack || 'signature';
    const active = list.find((x) => x.id === cur);
    $('#ovThemeName').textContent = active ? active.name : cur;
    $('#homeTheme').textContent = t('d.themeIs', { n: active ? active.name : cur });
    $('#themeGrid').innerHTML = list
      .map((t) => {
        const c = t.colors || {};
        const sw = [c.win || '#2ef2a0', c.loss || '#ff4d6d', c.ot || '#ffb020'];
        const thumb = t.hasPreview
          ? `<img src="/themes/${esc(t.id)}/preview.png" alt="" loading="lazy" />`
          : `<div class="sw">${sw.map((x) => `<i style="background:${esc(x)}"></i>`).join('')}</div>`;
        const on = t.id === cur;
        return `
        <div class="th${on ? ' on' : ''}" data-theme="${esc(t.id)}">
          <div class="thumb">${thumb}${on ? `<span class="pill ok">${esc(tr('d.active'))}</span>` : ''}</div>
          <div class="info">
            <b>${esc(t.name)}</b>
            <span class="muted small">${esc(tr(t.builtin ? 'd.builtin' : 'd.custom'))}${t.author ? ` · ${esc(tr('d.byAuthor', { a: t.author }))}` : ''} · v${esc(t.version)}</span>
            ${t.description ? `<span class="desc">${esc(t.description)}</span>` : ''}
          </div>
          <div class="acts">
            ${on ? '' : `<button class="btn small primary" data-tact="use">${esc(tr('d.use'))}</button>`}
            <button class="btn small" data-tact="custom">${esc(tr('d.customize'))}</button>
            ${t.builtin ? '' : `<button class="btn small ghost" data-tact="folder">${esc(tr('d.folder'))}</button>`}
            <button class="btn small ghost" data-tact="export">${esc(tr('d.export'))}</button>
            ${t.builtin ? '' : `<button class="btn small ghost danger" data-tact="del">${esc(tr('d.delete'))}</button>`}
          </div>
        </div>`;
      })
      .join('');
  }

  async function onThemeClick(e) {
    const b = e.target.closest('[data-tact]');
    if (!b) return;
    const id = b.closest('[data-theme]').dataset.theme;
    const th = D.themes.list.find((x) => x.id === id);
    const act = b.dataset.tact;
    if (act === 'use') {
      await post('/api/settings', { overlay: { themePack: id } });
      toast(t('d.themeApplied', { n: th.name }), 'ok');
    } else if (act === 'custom') {
      const r = await post(`/api/themes/${id}/duplicate`, { name: t('d.customCopyName', { n: th.name }) });
      toast(r.ok ? t('d.copyCreated') : r.error || t('d.failed'), r.ok ? 'ok' : 'err');
    } else if (act === 'folder') {
      post('/api/open', { target: `theme:${id}` });
    } else if (act === 'export') {
      const a = document.createElement('a');
      a.href = `/api/themes/${id}/export?key=${encodeURIComponent(KEY)}`;
      a.download = `${id}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else if (act === 'del') {
      if (!(await confirmBox(t('d.deleteThemeQ', { n: th.name }), t('d.delete')))) return;
      const r = await api(`/api/themes/${id}`, { method: 'DELETE' });
      toast(r.ok ? t('d.themeDeleted') : t('d.failed'), r.ok ? 'ok' : 'err');
    }
  }

  function pickTheme() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.zip,application/zip';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      if (f.size > 60 * 1024 * 1024) return toast(t('d.tooBig60'), 'err');
      const r = await api('/api/themes/install', { method: 'POST', body: await f.arrayBuffer() });
      if (!r.ok) return toast(r.error || t('d.badTheme'), 'err');
      toast(`${t('d.themeInstalled', { n: r.name })}${r.refused && r.refused.length ? t('d.ignoredFiles', { n: r.refused.length }) : ''}`, 'ok');
    };
    inp.click();
  }

  function pickSound(type) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.mp3,.wav,.ogg,.m4a,audio/*';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      if (f.size > 8 * 1024 * 1024) return toast(t('d.tooBig8'), 'err');
      const ext = (f.name.split('.').pop() || 'mp3').toLowerCase();
      const r = await api(`/api/sounds/${type}?ext=${encodeURIComponent(ext)}`, { method: 'POST', body: await f.arrayBuffer() });
      toast(r.ok ? t('d.soundReplaced', { n: TYPE_NAME[type] }) : r.error || t('d.failed'), r.ok ? 'ok' : 'err');
    };
    inp.click();
  }

  // ------------------------------------------------------------------ logiciel de stream (OBS / Streamlabs)
  let lastSoftware = null;
  function renderObs() {
    const o = D.status.obs;
    const sw = D.settings.obs.software === 'streamlabs' ? 'streamlabs' : 'obs';
    if (sw !== lastSoftware) {
      lastSoftware = sw;
      obsScenes = null;
      $('#swObs').classList.toggle('hidden', sw !== 'obs');
      $('#swStreamlabs').classList.toggle('hidden', sw !== 'streamlabs');
    }
    const el = $('#obsState');
    if (!D.settings.obs.enabled) {
      el.className = 'pill';
      el.textContent = t('d.obsOff');
    } else if (o.state === 'connected') {
      el.className = 'pill ok';
      el.textContent = `${t('d.obsConnected', { n: o.name })}${o.version ? ` · ${o.version}` : ''}`;
      if (!obsScenes) loadObsScenes(true);
    } else if (o.state === 'connecting') {
      el.className = 'pill wait';
      el.textContent = t('d.obsConnecting');
    } else {
      el.className = 'pill err';
      el.textContent = o.error || t('d.obsError');
    }
  }
  async function loadObsScenes(quiet) {
    const r = await api('/api/obs/scenes');
    if (!r.ok) {
      if (quiet !== true) toast(r.error || t('d.swNotConnected'), 'err');
      return;
    }
    obsScenes = r.scenes;
    $('#dl-scenes').innerHTML = obsScenes.map((s) => `<option value="${esc(s.name)}"></option>`).join('');
    TYPES.forEach(([t]) => fillSourceList(t));
    if (quiet !== true) toast(tn('d.scenesFound', obsScenes.length), 'ok');
  }
  function fillSourceList(type) {
    if (!obsScenes) return;
    const scene = $(`.o-row[data-type="${type}"] [data-set$=".scene"]`).value;
    const sc = obsScenes.find((s) => s.name === scene);
    const srcs = sc ? sc.sources : [...new Set(obsScenes.flatMap((s) => s.sources))];
    $(`#dl-src-${type}`).innerHTML = srcs.map((s) => `<option value="${esc(s)}"></option>`).join('');
  }

  // ------------------------------------------------------------------ assistant de démarrage
  const ONB_STEPS = 5;
  let onbStep = -1; // -1 = fermé
  function onbOpen(step = 0) {
    onbStep = step;
    try {
      localStorage.setItem('rlui-onb', String(step));
    } catch {}
    $('#onb').classList.remove('hidden');
    renderOnb();
  }
  function onbClose(done) {
    onbStep = -1;
    $('#onb').classList.add('hidden');
    try {
      localStorage.removeItem('rlui-onb');
    } catch {}
    if (done && !D.settings.app.onboarded) post('/api/settings', { app: { onboarded: true } });
  }
  function onbGo(d) {
    const n = onbStep + d;
    if (n >= ONB_STEPS) return onbClose(true);
    onbOpen(Math.max(0, n));
  }

  function renderOnb() {
    if (onbStep < 0 || !D) return;
    const st = D.status;
    const cfg = st.rlConfig;
    const ok = (v, yes, no) => `<div class="onb-check ${v ? 'ok' : 'todo'}"><i>${v ? '✓' : '•'}</i><span>${yes && v ? yes : no}</span></div>`;
    const url = (id, extra = '') => `${baseUrl()}/overlay/${id}${extra}`;
    const urlRow = (label, u, size) => `<div class="onb-url"><b>${esc(label)}</b><span class="muted small">${esc(size)}</span><input readonly value="${esc(u)}" /><button class="btn small" data-onbcopy="${esc(u)}">${esc(t('d.copy'))}</button></div>`;
    let html = '';
    switch (onbStep) {
      case 0:
        html = `<h2>${esc(t('o.welcome'))}</h2><p>${esc(t('o.welcomeText'))}</p>
          <div class="onb-langs">${['en', 'fr'].map((l) => `<button class="btn ${D.settings.language === l ? 'primary' : ''}" data-onblang="${l}">${l === 'en' ? 'English' : 'Français'}</button>`).join('')}</div>`;
        break;
      case 1: {
        const apiOk = cfg && cfg.enabled;
        const live = st.api.state === 'live' || st.api.state === 'waiting';
        html = `<h2>${esc(t('o.rlTitle'))}</h2><p>${esc(t('o.rlText'))}</p>
          ${ok(apiOk, t('o.apiOn'), cfg && cfg.known ? t('o.apiOff') : t('o.apiUnknown'))}
          ${ok(!!st.account, st.account ? t('o.acctOk', { n: st.account.name }) : '', t('o.acctTodo'))}
          ${ok(live, t('o.connOk'), t('o.connTodo'))}
          ${apiOk ? '' : `<div class="actions"><button class="btn primary small" id="onbApi">${esc(t('o.enableApi'))}</button></div>`}
          <p class="muted small">${esc(t('o.rlNote'))}</p>`;
        break;
      }
      case 2:
        html = `<h2>${esc(t('o.obsTitle'))}</h2><p>${t('o.obsText')}</p>
          ${urlRow(t('o.counter'), url('counter'), '1000 × 220')}
          ${urlRow(t('o.alerts'), url('alerts'), '1920 × 1080')}
          <p class="muted small">${t('o.obsAudio')}</p>`;
        break;
      case 3: {
        const cur = D.settings.overlay.themePack || 'signature';
        const layout = D.settings.overlay.layout || 'horizontal';
        html = `<h2>${esc(t('o.lookTitle'))}</h2><p>${esc(t('o.lookText'))}</p>
          <div class="onb-themes">${((D.themes && D.themes.list) || [])
            .filter((x) => x.builtin && x.hasPreview)
            .map((x) => `<button class="onb-th${x.id === cur ? ' on' : ''}" data-onbtheme="${esc(x.id)}"><img src="/themes/${esc(x.id)}/preview.png" alt="" /><span>${esc(x.name)}</span></button>`)
            .join('')}</div>
          <div class="onb-layouts">${['horizontal', 'vertical', 'boost'].map((l) => `<button class="btn small ${layout === l ? 'primary' : ''}" data-onblayout="${l}">${esc(t(`o.layout.${l}`))}</button>`).join('')}</div>`;
        break;
      }
      case 4:
        html = `<h2>${esc(t('o.doneTitle'))}</h2><p>${esc(t('o.doneText'))}</p>
          <div class="onb-more">
            <button class="onb-card" data-onbtab="caster"><b>${esc(t('o.moreCaster'))}</b><span>${esc(t('o.moreCasterText'))}</span></button>
            <button class="onb-card" data-onbtab="twitch"><b>${esc(t('o.moreChat'))}</b><span>${esc(t('o.moreChatText'))}</span></button>
            <button class="onb-card" data-onbtab="settings"><b>${esc(t('o.moreDeck'))}</b><span>${esc(t('o.moreDeckText'))}</span></button>
          </div>`;
        break;
    }
    $('#onbBody').innerHTML = html;
    $('#onbDots').innerHTML = Array.from({ length: ONB_STEPS }, (_, i) => `<i class="${i === onbStep ? 'on' : i < onbStep ? 'done' : ''}"></i>`).join('');
    $('#onbSkip').textContent = t('o.skip');
    $('#onbBack').textContent = t('o.back');
    $('#onbBack').classList.toggle('hidden', onbStep === 0);
    $('#onbNext').textContent = t(onbStep === ONB_STEPS - 1 ? 'o.finish' : 'o.next');
    const b = $('#onbApi');
    if (b) b.onclick = enableApi;
  }

  // ------------------------------------------------------------------ commandes du chat
  const BUILTIN_CMDS = ['wl', 'mmr', 'last', 'streak', 'ot'];
  function renderChat() {
    const c = D.chat || { available: false, state: 'off' };
    const el = $('#chatState');
    el.className = `pill ${c.state === 'connected' ? 'ok' : c.state === 'error' ? 'err' : c.state === 'off' ? '' : 'wait'}`;
    el.textContent = t(`d.tw.st.${c.state}`);
    let html;
    if (!c.available) html = `<div class="wr">${esc(t('d.tw.unavailable'))}</div>`;
    else if (c.state === 'code')
      html = `<div>${esc(t('d.tw.codeHelp'))}</div><div class="tw-code">${esc(c.code)}</div><div class="actions"><button class="btn primary small" data-chat="activate">${esc(t('d.tw.openActivate'))}</button><button class="btn ghost small" data-chat="logout">${esc(t('d.tw.cancel'))}</button></div>`;
    else if (c.login)
      html = `<div class="ok">${t('d.tw.as', { n: `<b>${esc(c.login)}</b>`, c: `<b>#${esc(c.channel)}</b>` })}</div><div class="actions"><button class="btn ghost small" data-chat="reconnect">${esc(t('d.tw.reconnect'))}</button><button class="btn ghost small danger" data-chat="logout">${esc(t('d.tw.logout'))}</button></div>`;
    else html = `${c.error ? `<div class="wr">${esc(t(c.error === 'expired' ? 'd.tw.expired' : c.error === 'auth' ? 'd.tw.authLost' : 'd.tw.error', { e: c.error }))}</div>` : ''}<div class="actions"><button class="btn primary" data-chat="login">${esc(t('d.tw.login'))}</button></div>`;
    $('#chatAuth').innerHTML = html;
  }

  async function renderChatTable() {
    const list = D.settings.chat.commands || [];
    const pv = await api('/api/chat/preview');
    const resp = {};
    for (const r of (pv && pv.responses) || []) resp[r.name] = r.text;
    $('#chatTable').innerHTML = list
      .map(
        (c, i) => `<div class="c-row" data-cmd="${i}">
          <input type="checkbox" class="c-on" ${c.enabled !== false ? 'checked' : ''} title="${esc(t('d.enable'))}" />
          <label class="c-name">!<input class="c-n" value="${esc(c.name)}" maxlength="30" /></label>
          <input class="c-al" value="${esc(c.aliases || '')}" placeholder="${esc(t('d.tw.aliases'))}" />
          <input class="c-tx" value="${esc(c.text || '')}" placeholder="${esc(BUILTIN_CMDS.includes(c.name) ? t(`chat.${c.name}`) : '')}" />
          ${BUILTIN_CMDS.includes(c.name) ? '<span></span>' : `<button class="btn icon small ghost" data-cmddel="${i}" title="${esc(t('d.delete'))}">×</button>`}
          <div class="c-pv muted small">→ ${esc(resp[c.name] || '')}</div>
        </div>`
      )
      .join('');
  }

  function saveCommands() {
    const list = $$('#chatTable [data-cmd]').map((row) => ({
      name: row.querySelector('.c-n').value.trim().replace(/^!/, '').toLowerCase() || 'cmd',
      aliases: row.querySelector('.c-al').value.trim(),
      enabled: row.querySelector('.c-on').checked,
      text: row.querySelector('.c-tx').value.trim(),
    }));
    saveSetting('chat.commands', list);
  }

  // ------------------------------------------------------------------ mises à jour
  function renderUpdate() {
    const u = D.update || { state: 'idle', mode: 'dev' };
    const bar = $('#updateBar');
    let html = '';
    if (u.state === 'ready') html = `<span>${esc(t('d.up.ready', { v: u.version }))}</span><button class="btn small primary" data-upd="install">${esc(t('d.up.restart'))}</button>`;
    else if (u.state === 'manual') html = `<span>${esc(t('d.up.available', { v: u.version }))}</span><button class="btn small primary" data-upd="download">${esc(t('d.up.download'))}</button>`;
    else if (u.state === 'downloading') html = `<span class="muted">${esc(t('d.up.downloading', { p: u.percent || 0 }))}</span>`;
    bar.innerHTML = html;
    bar.classList.toggle('hidden', !html);

    const info = $('#updateInfo');
    const store = u.mode === 'store';
    $('#autoUpdateRow').classList.toggle('hidden', store || u.mode === 'dev');
    $('#startWinRow').classList.toggle('hidden', store);
    if (store) info.innerHTML = `<div class="muted small">${esc(t('d.up.storeStartup'))}</div><span class="muted small">${esc(t('d.up.store'))}</span>`;
    else if (u.mode === 'dev') info.innerHTML = `<span class="muted small">${esc(t('d.up.dev'))}</span>`;
    else {
      const line =
        u.state === 'error' ? `<span class="wr small">${esc(t('d.up.error', { e: u.error || '' }))}</span>`
        : u.state === 'none' ? `<span class="ok small">${esc(t('d.up.none', { v: D.version }))}</span>`
        : u.state === 'checking' ? `<span class="muted small">${esc(t('d.up.checking'))}</span>`
        : '';
      info.innerHTML = `<div class="actions"><button class="btn ghost small" data-upd="check">${esc(t('d.up.check'))}</button>${line}</div>`;
    }
  }

  // ------------------------------------------------------------------ mode caster
  let C = null; // état du mode caster
  let lastImgSig = '';
  function layoutCasterPv() {
    const box = $('.caster-pv');
    const f = $('#casterPv');
    if (!box || !f) return;
    const k = box.clientWidth / 1920 || 0.3;
    f.style.transform = `scale(${k})`;
    box.style.height = `${Math.round(1080 * k)}px`;
  }

  // thème de l'overlay caster : le même que les autres overlays, ou un autre
  function renderCasterTheme() {
    const sel = $('#casterTheme');
    const list = (D.themes && D.themes.list) || [];
    const main = list.find((x) => x.id === (D.settings.overlay.themePack || 'signature'));
    sel.innerHTML =
      `<option value="">${esc(t('d.cs.sameTheme', { n: main ? main.name : 'Classic' }))}</option>` +
      list.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
    const cur = D.settings.caster.themePack || '';
    sel.value = list.some((x) => x.id === cur) ? cur : '';
  }

  function renderCasterStatic() {
    const url = `${baseUrl()}/overlay/caster`;
    if ($('#casterUrl').value !== url) {
      $('#casterUrl').value = url;
      $('#casterPv').src = `${url}?preview=1&demo=1`;
      layoutCasterPv();
    }
    const ovs = D.status.overlays || {};
    $('#casterLive').textContent = ovs.caster ? tn('o.sources', ovs.caster) : '';
    const c = D.settings.caster;
    for (const i of [0, 1]) {
      const el = $(`#csName${i}`);
      if (document.activeElement !== el) el.value = (c.names && c.names[i]) || '';
    }
    // fréquence de la Stats API : 30/s conseillé pour des barres de boost fluides
    const cfg = D.status.rlConfig;
    const rate = cfg && cfg.effective ? Number(cfg.effective.PacketSendRate) || 0 : 0;
    $('#casterRate').innerHTML =
      rate >= 20
        ? `<div class="ok">${esc(t('d.cs.rateOk', { n: rate }))}</div>`
        : `<div class="wr">${esc(t('d.cs.rateLow', { n: rate }))}</div><div class="actions"><button class="btn small primary" id="casterFluid">${esc(t('d.cs.rateBtn'))}</button></div>`;
    const fb = $('#casterFluid');
    if (fb) fb.onclick = setFluid;
    const b = baseUrl();
    const k = encodeURIComponent(D.settings.apiKey);
    const urls = [
      [t('d.cs.u.win0'), `${b}/api/caster/win-0?key=${k}`],
      [t('d.cs.u.win1'), `${b}/api/caster/win-1?key=${k}`],
      [t('d.cs.u.unwin0'), `${b}/api/caster/unwin-0?key=${k}`],
      [t('d.cs.u.unwin1'), `${b}/api/caster/unwin-1?key=${k}`],
      [t('d.cs.u.swap'), `${b}/api/caster/swap?key=${k}`],
      [t('d.cs.u.reset'), `${b}/api/caster/reset?key=${k}`],
    ];
    $('#casterUrls').innerHTML = urls
      .map(([n, u]) => `<div class="url-row"><span>${esc(n)}</span><input readonly value="${esc(u)}" /><button class="btn small" data-copyurl="${esc(u)}">${esc(t('d.copy'))}</button></div>`)
      .join('');
  }

  function pickImage(kind, key, done) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.png,.jpg,.jpeg,.webp,.gif,.svg,image/*';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) return toast(t('d.cs.imgBig'), 'err');
      const ext = (f.name.split('.').pop() || 'png').toLowerCase();
      const q = kind === 'logo' ? `team=${key}` : `name=${encodeURIComponent(key)}`;
      const r = await api(`/api/caster/${kind}?${q}&ext=${encodeURIComponent(ext)}`, { method: 'POST', body: await f.arrayBuffer() });
      if (r.ok === false) return toast(r.error || t('d.failed'), 'err');
      toast(t(kind === 'logo' ? 'd.cs.logoSaved' : 'd.cs.photoSaved'), 'ok');
      if (done) done();
    };
    inp.click();
  }

  function renderCasterImages() {
    const m = C.match;
    const thumb = (url, cls) => (url ? `<img class="${cls}" src="${esc(url)}" alt="" />` : `<div class="${cls} empty"></div>`);
    $('#casterLogos').innerHTML = [0, 1]
      .map(
        (i) => `<div class="logo-pick c${i}">${thumb(m.teams[i].logo, 'lg')}<button class="btn small" data-img="logo" data-key="${i}">${esc(t('d.cs.logo'))}</button>${m.teams[i].logo ? `<button class="btn small ghost" data-imgdel="logo" data-key="${i}">✕</button>` : ''}</div>`
      )
      .join('');
    // joueurs de la partie en cours + photos déjà enregistrées
    const byName = new Map();
    for (const p of m.players) byName.set(p.name.toLowerCase(), { name: p.name, url: p.photo, team: p.team });
    for (const ph of C.photos || []) if (!byName.has(ph.name)) byName.set(ph.name, { name: ph.name, url: ph.url, team: null });
    const list = [...byName.values()];
    $('#casterPhotos').innerHTML = list.length
      ? list
          .map(
            (p) => `<div class="ph${p.team != null ? ` c${p.team}` : ''}">${thumb(p.url, 'av')}<b>${esc(p.name)}</b><div class="acts"><button class="btn small" data-img="photo" data-key="${esc(p.name)}">${esc(t('d.cs.photo'))}</button>${p.url ? `<button class="btn small ghost" data-imgdel="photo" data-key="${esc(p.name)}">✕</button>` : ''}</div></div>`
          )
          .join('')
      : `<div class="empty">${esc(t('d.cs.noPlayers'))}</div>`;
  }

  async function setFluid() {
    const r = await post('/api/statsapi/enable', { rate: 30 });
    if (r.ok) return toast(t('d.cs.rateDone'), 'ok');
    if (r.needsAdmin && (await confirmBox(t('d.adminQ'), t('d.retry')))) {
      const r2 = await post('/api/statsapi/enable', { rate: 30, elevated: true });
      return toast(r2.ok ? t('d.cs.rateDone') : t('d.failed'), r2.ok ? 'ok' : 'err');
    }
    toast(r.error || t('d.cfgFail'), 'err');
  }

  function renderCaster() {
    if (!C || !D) return;
    const m = C.match;
    const ser = C.series;
    // série
    const team = (i) => {
      const tm = m.teams[i];
      return `<div class="sr c${i}"><b>${esc(tm.name)}</b><div class="sw"><button class="btn icon small" data-cs="unwin-${i}">−</button><span>${ser.wins[i]}</span><button class="btn icon small" data-cs="win-${i}">+</button></div></div>`;
    };
    $('#casterSeries').innerHTML = `${team(0)}<div class="vs">${ser.bestOf > 1 ? esc(t('d.cs.game', { n: ser.game, b: ser.bestOf })) : esc(t('d.cs.single'))}</div>${team(1)}`;
    for (const i of [0, 1]) $(`#csName${i}`).placeholder = m.teams[i].name;
    const imgSig = JSON.stringify([m.teams.map((x) => x.logo), m.players.map((p) => [p.name, p.photo, p.team]), C.photos, OT.lang]);
    if (imgSig !== lastImgSig) {
      lastImgSig = imgSig;
      renderCasterImages();
    }
    // partie en direct
    $('#casterClock').textContent = m.active ? `${m.teams[0].score} - ${m.teams[1].score} · ${OT.fmtClock(m.time, m.overtime) || ''}${m.replay ? ` · ${t('c.replay')}` : ''}` : '';
    if (!m.active || !m.players.length) {
      $('#casterPlayers').innerHTML = `<div class="empty">${esc(t('d.cs.noMatch'))}</div>`;
      return;
    }
    const rows = m.players
      .map(
        (p) => `<tr class="c${p.team}${p.key === m.target ? ' tgt' : ''}"><td>${esc(p.name)}</td><td><div class="mini"><i style="width:${p.boost}%"></i></div>${p.demolished ? 'DEMO' : p.boost}</td><td>${p.score}</td><td>${p.goals}</td><td>${p.assists}</td><td>${p.saves}</td><td>${p.shots}</td><td>${p.demos}</td></tr>`
      )
      .join('');
    const head = ['', 'Boost', t('c.score'), t('c.goals'), t('c.assists'), t('c.saves'), t('c.shots'), t('c.demos')].map((h) => `<th>${esc(h)}</th>`).join('');
    $('#casterPlayers').innerHTML = `<table class="table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ------------------------------------------------------------------ historique
  async function loadHistory(force) {
    if (!$('#tab-history').classList.contains('active')) return;
    if (!force && !historyDirty) return;
    historyDirty = false;
    const h = await api(`/api/history?scope=${historyScope}&limit=1000`);
    const rows = (h.matches || []).map((m) => {
      const tags = `${m.overtime ? '<span class="tag ot">OT</span>' : ''}${m.mvp ? '<span class="tag mvp">MVP</span>' : ''}${m.abandon ? `<span class="tag">${esc(t('d.tagAbandon'))}</span>` : ''}`;
      const me = m.me ? `${m.me.goals} · ${m.me.assists} · ${m.me.saves} · ${m.me.shots}` : '';
      return `<tr>
        <td>${fmtDate(m.endedAt)}</td>
        <td><span class="badge ${m.result}">${esc(t(m.result === 'W' ? 'd.Victory' : 'd.Defeat'))}</span>${tags}</td>
        <td>${Number.isFinite(m.scoreFor) && !m.manual ? `${m.scoreFor} - ${m.scoreAgainst}` : '—'}</td>
        <td>${mmrCell(m) || '—'}</td>
        <td>${esc(m.playlistName || '')}</td>
        <td>${esc(m.arena || '')}</td>
        <td>${m.durationSec ? fmtDur(m.durationSec) : '—'}</td>
        <td>${me}</td>
        <td><button class="del" data-del="${esc(m.id)}" title="${esc(t('d.delete'))}">×</button></td>
      </tr>`;
    });
    $('#histBody').innerHTML = rows.join('') || `<tr><td colspan="9" class="empty">${esc(t('d.noMatches'))}</td></tr>`;
  }

  // ------------------------------------------------------------------ réglages
  async function enableApi() {
    const r = await post('/api/statsapi/enable');
    if (r.ok) return toast(t('d.apiEnabled'), 'ok');
    if (r.needsAdmin && (await confirmBox(t('d.adminQ'), t('d.retry')))) {
      const r2 = await post('/api/statsapi/enable', { elevated: true });
      return toast(r2.ok ? t('d.apiEnabled') : t('d.failed'), r2.ok ? 'ok' : 'err');
    }
    toast(r.error || t('d.cfgFail'), 'err');
  }

  function renderSettings() {
    const st = D.status;
    const acct = st.account;
    $('#identityInfo').innerHTML = acct
      ? `<div class="ok">${t('d.acctDetected', { n: esc(acct.name), p: esc(acct.platform) })}</div><code>${esc(acct.id)}</code>`
      : `<div class="wr">${esc(t('d.noAcct'))}</div><div class="muted">${esc(t('d.noAcctHelp'))}</div>`;
    const ids = D.settings.identity.knownIds;
    $('#knownIds').innerHTML = ids.length
      ? `<div class="muted small">${esc(t('d.knownAccts'))}</div>${ids.map((id) => `<div class="kid"><code>${esc(id)}</code><button class="btn small ghost" data-forget="${esc(id)}">${esc(t('d.forget'))}</button></div>`).join('')}`
      : '';

    const c = st.rlConfig;
    if (c) {
      const inst = c.installs.length ? c.installs.map((i) => `${esc(i.platform)} : <code>${esc(i.dir)}</code>`).join('<br>') : `<span class="wr">${esc(t('d.noInstall'))}</span>`;
      const eff = c.effective;
      $('#rlInfo').innerHTML = `
        <div class="${c.enabled ? 'ok' : c.known ? 'bad' : 'wr'}">${c.enabled ? t('d.apiOn', { n: eff.PacketSendRate }) : t(c.known ? 'd.apiOffCfg' : 'd.cfgMissing')}</div>
        <div>${t('d.ports', { t: eff.Port, w: eff.WebPort })}</div>
        <div>${t('d.conn', { s: t(st.api.state === 'live' ? 'd.receiving' : st.api.state === 'waiting' ? 'd.connected' : 'd.noConn') })}${st.api.messages ? t('d.msgs', { n: st.api.messages }) : ''}</div>
        <div class="muted small">${inst}</div>`;
    }
    const known = (D.mmr && D.mmr.known) || [];
    $('#mmrInfo').innerHTML = known.length
      ? known
          .map((k) => `<div><b>${esc(k.name)}</b> : ${k.mmr} MMR <span class="muted small">${esc(t('d.mmrRead', { d: fmtDate(k.at).toLowerCase() }))}</span></div>`)
          .join('')
      : `<div class="wr">${esc(t('d.noMmr'))}</div><div class="muted">${esc(t('d.noMmrHelp'))}</div>`;
    $('#hotkeyErrors').textContent = (D.hotkeyErrors || []).length ? t('d.hotkeyErr', { k: D.hotkeyErrors.join(', ') }) : '';

    const b = baseUrl();
    const k = encodeURIComponent(D.settings.apiKey);
    const urls = [
      [t('d.u.win'), `${b}/api/action/win?key=${k}`],
      [t('d.u.winAlert'), `${b}/api/action/win?key=${k}&alert=1`],
      [t('d.u.loss'), `${b}/api/action/loss?key=${k}`],
      [t('d.u.undo'), `${b}/api/action/undo?key=${k}`],
      [t('d.u.pause'), `${b}/api/action/toggle-pause?key=${k}`],
      [t('d.u.new'), `${b}/api/action/new-session?key=${k}`],
      [t('d.u.text'), `${b}/api/text/record`],
      [t('d.u.mmr'), `${b}/api/text/mmrsession`],
    ];
    $('#apiUrls').innerHTML = urls
      .map(([n, u]) => `<div class="url-row"><span>${esc(n)}</span><input readonly value="${esc(u)}" /><button class="btn small" data-copyurl="${esc(u)}">${esc(t('d.copy'))}</button></div>`)
      .join('');
    $('#textDir').textContent = D.textDir;
    $('#lanInfo').innerHTML = D.settings.lanAccess
      ? D.lanAddresses.length
        ? t('d.lanOn', { u: D.lanAddresses.map((ip) => `<code>http://${esc(ip)}:${D.port}/overlay/…</code>`).join(t('d.or')) })
        : esc(t('d.noLan'))
      : esc(t('d.lanOff', { p: D.port }));
  }

  // ------------------------------------------------------------------ boucle principale
  // On ne redessine une zone que si ses données ont changé (évite de perdre un clic pendant un rafraîchissement)
  const memo = {};
  function changed(key, data) {
    const sig = JSON.stringify(data);
    if (memo[key] === sig) return false;
    memo[key] = sig;
    return true;
  }
  function renderAll() {
    if (!D) return;
    buildOnce();
    if (changed('settings', D.settings)) {
      syncInputs();
      applyTheme(D.settings.app.theme);
    }
    renderChips();
    if (changed('setup', [D.status.rlConfig, D.status.logFound, D.status.overlays])) renderSetup();
    if (changed('identity', D.live && D.live.needsIdentity ? D.live.players : null)) renderIdentity();
    renderLive();
    if (changed('matches', [D.sessionMatches, D.settings.overlay.labelWin, D.settings.overlay.labelLoss])) renderSessionList();
    if (changed('logs', D.logs.length && D.logs[D.logs.length - 1])) renderLogs();
    if (changed('dgChecks', [D.diag.checks, D.diag.level, !!D.diag.notice])) renderDiagChecks();
    if (changed('dgNotice', D.diag.notice)) renderNotice();
    // le journal des parties vues se relit quand il a bougé, si la page Diagnostic est à l'écran
    if (D.diag.rev !== dgRev && $('#tab-diag').classList.contains('active')) loadDiag();
    if (changed('stream', [D.port, D.status.overlays, D.settings.alerts.customSounds])) renderStream();
    if (changed('layout', D.settings.overlay.layout)) renderLayout();
    if (changed('themes', [D.themes, D.settings.overlay.themePack])) renderThemes();
    if (changed('casterTheme', [D.themes, D.settings.overlay.themePack, D.settings.caster.themePack, D.settings.language])) renderCasterTheme();
    renderObs();
    if (changed('update', [D.update, D.version])) renderUpdate();
    if (changed('chat', D.chat)) renderChat();
    if (onbStep >= 0 && changed('onb', [D.status, D.settings.overlay, D.settings.language, D.themes])) renderOnb();
    if (changed('chatCmds', [D.settings.chat.commands, D.sessionMatches.length, D.settings.language])) renderChatTable();
    if (changed('caster', [D.port, D.status.overlays, D.settings.caster, D.status.rlConfig, D.settings.apiKey])) renderCasterStatic();
    if (changed('settingsView', [D.status.account, D.status.rlConfig, D.status.api.state, D.hotkeyErrors, D.settings, D.textDir, D.lanAddresses, D.port, D.mmr && D.mmr.known])) renderSettings();
    if (historyDirty) loadHistory();
  }

  let lastMatches = -1;
  OT.on('dashboard', (d) => {
    if (d.settings.language && d.settings.language !== OT.lang) return location.reload();
    const n = d.sessionMatches.length + (d.allTime ? d.allTime.played : 0);
    const moved = n !== lastMatches;
    if (moved) historyDirty = true;
    lastMatches = n;
    D = d;
    if (moved && window.RLUI.stats) window.RLUI.stats.dirty();
    renderAll();
  });
  OT.on('caster', (c) => {
    C = c;
    renderCaster();
  });
  OT.on('state', (s) => {
    S = s;
    renderScore();
  });
  OT.on('close', () => {
    $('#statusChips').innerHTML = `<span class="chip err"><b>${esc(t('d.lost'))}</b></span>`;
  });
  OT.connect({ role: 'dashboard', key: KEY, topics: ['caster'] });
  setInterval(() => D && renderLive(), 30000);
})();
