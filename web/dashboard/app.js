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

  function resPill(r) {
    const cls = ['res', r.result, r.ot || r.overtime ? 'ot' : '', r.abandon ? 'ab' : '', r.manual ? 'man' : ''].join(' ');
    const lbl = r.result === 'W' ? (D && D.settings.overlay.labelWin) || t('lbl.w') : (D && D.settings.overlay.labelLoss) || t('lbl.l');
    const title = r.manual ? t('manual') : r.score || (Number.isFinite(r.scoreFor) ? `${r.scoreFor}-${r.scoreAgainst}` : '');
    return `<span class="${cls}" title="${esc(title)}">${esc(lbl)}</span>`;
  }

  // ------------------------------------------------------------------ onglets
  function showTab(name) {
    $$('.side button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
    try {
      localStorage.setItem('rlui-tab', name);
    } catch {}
    if (name === 'history') loadHistory();
    if (name === 'stream') layoutPreviews();
  }
  $$('.side button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

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
  }

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

    // Parties comptées
    $('#countingForm').innerHTML = CATS.map(([k, label]) => `<label class="check"><input type="checkbox" data-set="counting.${k}" /> ${esc(label)}</label>`).join('');

    // Overlays
    $('#overlayGrid').innerHTML = OVERLAYS.map(
      (o) => `
      <div class="ov" data-ov="${o.id}">
        <div class="pv"><iframe data-w="${o.w}" data-h="${o.h}" loading="lazy"></iframe></div>
        <div class="body">
          <div class="title"><b>${esc(o.name)}</b><span>${o.w} × ${o.h}</span></div>
          <div class="desc">${esc(o.desc)} <span class="live-dot" data-live="${o.id}"></span></div>
          <div class="url"><input readonly data-url="${o.id}" /><button class="btn small" data-copy="${o.id}">${esc(t('d.copy'))}</button><button class="btn small ghost" data-open="${o.id}">${esc(t('d.open'))}</button></div>
        </div>
      </div>`
    ).join('');
    $('#overlayGrid').addEventListener('click', (e) => {
      const c = e.target.closest('[data-copy]');
      if (c) copy($(`[data-url="${c.dataset.copy}"]`).value);
      const o = e.target.closest('[data-open]');
      if (o) post('/api/open', { target: 'url', url: $(`[data-url="${o.dataset.open}"]`).value });
    });
    $('#previewSound').addEventListener('change', () => setPreviewSrc(true));
    new ResizeObserver(layoutPreviews).observe($('#overlayGrid'));

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

    // Historique
    $('#histScope').addEventListener('click', (e) => {
      const b = e.target.closest('[data-scope]');
      if (!b) return;
      historyScope = b.dataset.scope;
      $$('#histScope button').forEach((x) => x.classList.toggle('on', x === b));
      loadHistory(true);
    });
    document.addEventListener('click', async (e) => {
      const d = e.target.closest('[data-del]');
      if (!d) return;
      if (await confirmBox(t('d.deleteMatchQ'), t('d.delete'))) {
        await api(`/api/matches/${encodeURIComponent(d.dataset.del)}`, { method: 'DELETE' });
        historyDirty = true;
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

    let tab = 'session';
    try {
      tab = localStorage.getItem('rlui-tab') || 'session';
    } catch {}
    if (!$(`#tab-${tab}`)) tab = 'session';
    showTab(tab);
  }

  // ------------------------------------------------------------------ rendu
  function chip(cls, label, value) {
    return `<span class="chip ${cls}">${esc(label)} : <b>${esc(value)}</b></span>`;
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
    const C = 2 * Math.PI * 50;
    $('#arcW').setAttribute('stroke-dasharray', s.played ? `${(C * s.wins) / s.played} ${C}` : `0 ${C}`);
    $('#arcL').setAttribute('stroke-dasharray', s.played && s.losses ? `${C} 0` : `0 ${C}`);
    const k = $('#kStreak');
    k.className = s.streak > 0 ? 'hot' : s.streak < 0 ? 'cold' : '';
    k.textContent = s.streak > 0 ? `🔥 ${tn('d.nWins', s.streak)}` : s.streak < 0 ? tn('d.nLosses', -s.streak) : '—';
    $('#kBest').textContent = s.bestWinStreak;
    $('#kOt').textContent = `${s.otWins}-${s.otLosses}`;
    $('#kMvp').textContent = s.mvps;
    $('#kGas').textContent = `${s.myGoals} · ${s.myAssists} · ${s.mySaves}`;
    const mm = s.mmr && s.mmr.primary;
    const km = $('#kMmr');
    if (mm) {
      const d = Math.round(mm.delta || 0);
      km.innerHTML = `${mm.current != null ? `${mm.current} ` : ''}<span class="mmr-d ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${mm.approx ? '≈' : ''}${d > 0 ? '+' : ''}${d}</span>`;
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

  function renderSetup() {
    const st = D.status;
    const cfg = st.rlConfig;
    const items = [];
    const apiOff = cfg && cfg.known && !cfg.enabled;
    if (apiOff) items.push(`<li>${t('d.setupApiOff', { btn: `<button class="btn small primary" id="setupEnable">${esc(t('d.enable'))}</button>` })}</li>`);
    else if (cfg && !cfg.known) items.push(`<li>${t('d.setupNoCfg')}</li>`);
    if (!st.logFound) items.push(`<li>${t('d.setupNoLog')}</li>`);
    const card = $('#setupCard');
    if (!items.length) return card.classList.add('hidden');
    card.classList.remove('hidden');
    card.innerHTML = `<h3>${esc(t('d.setupTitle'))}</h3><ol>${items.join('')}</ol>`;
    const b = $('#setupEnable');
    if (b) b.onclick = enableApi;
  }

  function matchRow(m) {
    const tags = [];
    if (m.overtime) tags.push('<span class="tag ot">OT</span>');
    if (m.mvp) tags.push('<span class="tag mvp">MVP</span>');
    if (m.abandon) tags.push(`<span class="tag">${esc(t('d.tagAbandon'))}</span>`);
    if (m.manual) tags.push(`<span class="tag">${esc(t('d.tagManual'))}</span>`);
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

  // ------------------------------------------------------------------ overlays / aperçus
  let lastSrcSig = '';
  function setPreviewSrc(force) {
    const sig = `${D.port}|${$('#previewSound').checked}`;
    if (!force && sig === lastSrcSig) return;
    lastSrcSig = sig;
    $$('#overlayGrid .ov').forEach((ov) => {
      const id = ov.dataset.ov;
      const url = `${baseUrl()}/overlay/${id}`;
      $(`[data-url="${id}"]`, ov).value = url;
      const extra = id === 'alerts' && !$('#previewSound').checked ? '&mute=1' : '';
      $('iframe', ov).src = `${url}?preview=1${extra}`;
    });
    layoutPreviews();
  }
  function layoutPreviews() {
    $$('#overlayGrid .pv').forEach((pv) => {
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
      f.style.left = `${(pv.clientWidth - cw * k) / 2 - cx * k}px`;
      f.style.top = `${(pv.clientHeight - ch * k) / 2 - cy * k}px`;
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
    const ov = $('#overlayGrid .ov[data-ov="counter"]');
    if (!ov) return;
    const f = $('iframe', ov);
    const crop = layout === 'boost' ? '1330,690,590,390' : '';
    if (f.dataset.w !== String(dims.w) || f.dataset.h !== String(dims.h) || (f.dataset.crop || '') !== crop) {
      f.dataset.w = dims.w;
      f.dataset.h = dims.h;
      f.dataset.crop = crop;
      layoutPreviews();
    }
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
    const cur = D.settings.overlay.themePack || 'classique';
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

  // ------------------------------------------------------------------ historique
  async function loadHistory(force) {
    if (!$('#tab-history').classList.contains('active')) return;
    if (!force && !historyDirty) return;
    historyDirty = false;
    const h = await api(`/api/history?scope=${historyScope}&limit=1000`);
    const a = D.allTime;
    $('#allTime').innerHTML = `
      <div class="kpi"><span>${esc(t('d.totalAll'))}</span><b>${a.wins}${esc(LW())} - ${a.losses}${esc(LL())}</b></div>
      <div class="kpi"><span>${esc(t('d.globalWr'))}</span><b>${a.played ? `${a.winRate}%` : '—'}</b></div>
      <div class="kpi ot"><span>${esc(t('d.otwl'))}</span><b>${a.otWins}-${a.otLosses}</b></div>
      <div class="kpi"><span>${esc(t('d.best'))}</span><b>${a.bestWinStreak}</b></div>
      <div class="bypl">${a.byPlaylist.map((p) => `<span class="pl-chip"><b>${esc(p.name)}</b> ${p.wins}${esc(LW())}-${p.losses}${esc(LL())} · ${p.winRate}%</span>`).join('')}</div>`;
    const rows = (h.matches || []).map((m) => {
      const tags = `${m.overtime ? '<span class="tag ot">OT</span>' : ''}${m.mvp ? '<span class="tag mvp">MVP</span>' : ''}${m.abandon ? `<span class="tag">${esc(t('d.tagAbandon'))}</span>` : ''}${m.manual ? `<span class="tag">${esc(t('d.tagManual'))}</span>` : ''}`;
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
    if (changed('settings', D.settings)) syncInputs();
    renderChips();
    if (changed('setup', [D.status.rlConfig, D.status.logFound])) renderSetup();
    if (changed('identity', D.live && D.live.needsIdentity ? D.live.players : null)) renderIdentity();
    renderLive();
    if (changed('matches', [D.sessionMatches, D.settings.overlay.labelWin, D.settings.overlay.labelLoss])) renderSessionList();
    if (changed('logs', D.logs.length && D.logs[D.logs.length - 1])) renderLogs();
    if (changed('stream', [D.port, D.status.overlays, D.settings.alerts.customSounds])) renderStream();
    if (changed('layout', D.settings.overlay.layout)) renderLayout();
    if (changed('themes', [D.themes, D.settings.overlay.themePack])) renderThemes();
    renderObs();
    if (changed('settingsView', [D.status.account, D.status.rlConfig, D.status.api.state, D.hotkeyErrors, D.settings, D.textDir, D.lanAddresses, D.port, D.mmr && D.mmr.known])) renderSettings();
    if (historyDirty) loadHistory();
  }

  let lastMatches = -1;
  OT.on('dashboard', (d) => {
    if (d.settings.language && d.settings.language !== OT.lang) return location.reload();
    const n = d.sessionMatches.length + (d.allTime ? d.allTime.played : 0);
    if (n !== lastMatches) historyDirty = true;
    lastMatches = n;
    D = d;
    renderAll();
  });
  OT.on('state', (s) => {
    S = s;
    renderScore();
  });
  OT.on('close', () => {
    $('#statusChips').innerHTML = `<span class="chip err"><b>${esc(t('d.lost'))}</b></span>`;
  });
  OT.connect({ role: 'dashboard', key: KEY });
  setInterval(() => D && renderLive(), 30000);
})();
