// Tableau de bord RL-UI
(function () {
  const KEY = document.querySelector('meta[name="ot-key"]').content;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = OT.esc;
  const isApp = OT.params.has('app');
  if (isApp) document.body.classList.add('in-app');

  let D = null; // état complet (tableau de bord)
  let S = null; // état public (stats de session)
  let prevCounts = null;
  let historyScope = 'session';
  let historyDirty = true;
  let obsScenes = null;
  let built = false;

  const TYPES = [
    ['win', 'Victoire'],
    ['loss', 'Défaite'],
    ['overtime', 'Overtime'],
    ['ot_win', 'Victoire en OT'],
    ['ot_loss', 'Défaite en OT'],
    ['streak', 'Série de victoires'],
  ];
  const TYPE_NAME = Object.fromEntries(TYPES);
  const CATS = [
    ['ranked', 'Classé (1v1, 2v2, 3v3, extra classés)'],
    ['casual', 'Occasionnel'],
    ['extra', 'Modes extra et événements (Rumble, Hoops, LTM…)'],
    ['tournament', 'Tournois'],
    ['private', 'Parties privées / LAN'],
    ['offline', 'Hors-ligne (contre des bots)'],
    ['unknown', 'Mode non détecté (partie en ligne)'],
  ];
  const OVERLAYS = [
    { id: 'counter', name: 'Compteur V/D', w: 1000, h: 220, desc: 'Victoires / défaites, winrate, série, bilan OT et badge OVERTIME en direct.' },
    { id: 'alerts', name: 'Alertes plein écran', w: 1920, h: 1080, desc: 'VICTOIRE, DÉFAITE, OVERTIME, OT gagné/perdu et séries, avec sons.' },
    { id: 'history', name: 'Dernières parties', w: 700, h: 90, desc: 'Les 10 derniers résultats (options : ?n=5&order=old&bare=1).' },
    { id: 'summary', name: 'Récap de session', w: 1920, h: 1080, desc: 'Carte de fin de stream : bilan, winrate, meilleure série, MVP…' },
  ];

  // ------------------------------------------------------------------ outils
  function api(path, opts = {}) {
    const sep = path.includes('?') ? '&' : '?';
    return fetch(`${path}${sep}key=${encodeURIComponent(KEY)}`, opts)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok && !j.error) j.error = `Erreur ${r.status}`;
        if (!r.ok) j.ok = false;
        return j;
      })
      .catch(() => ({ ok: false, error: 'Tracker injoignable' }));
  }
  const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  function toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  function confirmBox(text, yes = 'Confirmer') {
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
    toast('Copié dans le presse-papiers', 'ok');
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
    return same ? `Aujourd'hui ${fmtHour(ts)}` : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${fmtHour(ts)}`;
  }
  function fmtDur(sec) {
    if (!sec) return '—';
    const m = Math.round(sec / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${pad(m % 60)}` : `${m} min`;
  }
  function fmtAgo(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'à l\'instant';
    if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
    return `il y a ${Math.round(s / 3600)} h`;
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
  const baseUrl = () => `http://127.0.0.1:${D ? D.port : location.port}`;

  function resPill(r) {
    const cls = ['res', r.result, r.ot || r.overtime ? 'ot' : '', r.abandon ? 'ab' : '', r.manual ? 'man' : ''].join(' ');
    const lbl = r.result === 'W' ? (D && D.settings.overlay.labelWin) || 'V' : (D && D.settings.overlay.labelLoss) || 'D';
    const title = r.manual ? 'Ajout manuel' : r.score || (Number.isFinite(r.scoreFor) ? `${r.scoreFor}-${r.scoreAgainst}` : '');
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
    if (r.ok === false) toast(r.error || 'Rien à retirer', 'err');
  });
  $('#newSessionBtn').addEventListener('click', async () => {
    if (await confirmBox('Démarrer une nouvelle session ? Les compteurs repartent à 0 (l\'historique est conservé).', 'Nouvelle session')) {
      await post('/api/action/new-session');
      toast('Nouvelle session démarrée', 'ok');
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
    if (r.ok === false) toast(r.error || 'Réglage refusé', 'err');
    else if (!quiet) toast('Réglage enregistré', 'ok');
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
      el.value = 'Appuie sur la combinaison…';
    });
    el.addEventListener('blur', () => {
      el.classList.remove('rec');
      if (el.value === 'Appuie sur la combinaison…') el.value = el.dataset.prev || '';
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
          <div class="url"><input readonly data-url="${o.id}" /><button class="btn small" data-copy="${o.id}">Copier</button><button class="btn small ghost" data-open="${o.id}">Ouvrir</button></div>
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
      if (r.disabled) toast('Cette alerte est désactivée', 'err');
    });

    // Tableau des alertes
    $('#alertTable').innerHTML = TYPES.map(
      ([t, n]) => `
      <div class="a-row" data-type="${t}">
        <input type="checkbox" data-set="alerts.enabled.${t}" title="Activer" />
        <span class="nm">${esc(n)}</span>
        <input data-set="alerts.texts.${t}" />
        <label class="dur"><input type="number" min="1.5" max="20" step="0.5" data-set="alerts.duration.${t}" /> s</label>
        <div class="snd"><span data-snd="${t}">Son intégré</span><button class="btn small ghost" data-upload="${t}" title="Choisir un son">Son…</button><button class="btn small ghost hidden" data-unsound="${t}" title="Revenir au son intégré">✕</button></div>
        <button class="btn icon small" data-test="${t}" title="Tester">▶</button>
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
        toast('Son intégré rétabli', 'ok');
      }
    });

    // Actions OBS
    $('#obsTable').innerHTML =
      TYPES.map(
        ([t, n]) => `
      <div class="o-row" data-type="${t}">
        <span class="nm">${esc(n)}</span>
        <select data-set="obs.actions.${t}.type">
          <option value="none">Rien</option>
          <option value="source">Afficher une source</option>
          <option value="scene">Changer de scène</option>
        </select>
        <input data-set="obs.actions.${t}.scene" list="dl-scenes" placeholder="Scène" />
        <input data-set="obs.actions.${t}.source" list="dl-src-${t}" placeholder="Source" />
        <label class="dur"><input type="number" min="0" max="120" data-set="obs.actions.${t}.duration" title="Durée (s), 0 = pas de retour" /></label>
        <label class="ret"><input type="checkbox" data-set="obs.actions.${t}.returnBack" /> retour scène</label>
        <button class="btn icon small" data-obstest="${t}" title="Tester">▶</button>
        <datalist id="dl-src-${t}"></datalist>
      </div>`
      ).join('') + '<datalist id="dl-scenes"></datalist>';
    $('#obsTable').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-obstest]');
      if (!b) return;
      const r = await post('/api/action/test', { type: b.dataset.obstest, obs: true });
      if (r.ok === false) toast(r.error || 'Échec', 'err');
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
      if (await confirmBox('Supprimer cette partie de l\'historique ?', 'Supprimer')) {
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
        toast(r.ok ? 'Merci ! Ton compte est mémorisé.' : 'Joueur introuvable', r.ok ? 'ok' : 'err');
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
      toast('Calibrage réinitialisé', 'ok');
    });
    $('#regenKey').addEventListener('click', async () => {
      if (!(await confirmBox('Générer une nouvelle clé ? Les boutons Stream Deck existants devront être mis à jour.', 'Régénérer'))) return;
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
    if (D.settings.paused) out.push('<span class="chip warn"><b>TRACKER EN PAUSE</b></span>');
    out.push(chip(st.rl === 'live' ? 'live' : st.rl === 'running' ? 'ok' : '', 'Rocket League', st.rl === 'live' ? 'en partie' : st.rl === 'running' ? 'lancé' : 'fermé'));
    const cfg = st.rlConfig;
    let apiCls = '';
    let apiTxt = 'en attente du jeu';
    if (cfg && cfg.known && !cfg.enabled) {
      apiCls = 'err';
      apiTxt = 'désactivée';
    } else if (st.api.state === 'live') {
      apiCls = 'live';
      apiTxt = `en direct (${st.api.transport === 'tcp' ? 'TCP' : 'WebSocket'})`;
    } else if (st.api.state === 'waiting') {
      apiCls = 'ok';
      apiTxt = 'connectée';
    } else if (st.rl !== 'closed') {
      apiCls = 'warn';
      apiTxt = 'non joignable';
    }
    out.push(chip(apiCls, 'Stats API', apiTxt));
    out.push(st.account ? chip('ok', 'Compte', `${st.account.name} · ${st.account.platform}`) : chip('warn', 'Compte', 'non détecté'));
    if (D.settings.obs.enabled) {
      const o = st.obs.state;
      out.push(chip(o === 'connected' ? 'ok' : o === 'connecting' ? 'warn' : 'err', st.obs.name || 'OBS', o === 'connected' ? 'connecté' : o === 'connecting' ? 'connexion…' : 'erreur'));
    }
    if (D.live && D.live.inMatch && D.live.overtime) out.push('<span class="chip ot"><b>OVERTIME</b></span>');
    $('#statusChips').innerHTML = out.join('');
    $('#pauseBtn').textContent = D.settings.paused ? 'Reprendre' : 'Pause';
    $('#versionInfo').textContent = `RL-UI ${D.version} · par Zoxam`;
    $('#portInfo').textContent = `Serveur : port ${D.port}`;
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
    k.textContent = s.streak > 0 ? `🔥 ${s.streak} victoire${s.streak > 1 ? 's' : ''}` : s.streak < 0 ? `${-s.streak} défaite${s.streak < -1 ? 's' : ''}` : '—';
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
      $('#kMmrLbl').parentElement.title = `MMR ${mm.name} : valeur réelle lue quand tu lances une recherche, estimée entre-temps (≈)`;
    } else {
      km.textContent = '—';
      $('#kMmrLbl').textContent = 'MMR';
    }
    $('#lastStrip').innerHTML = s.last.length ? s.last.slice(-20).map(resPill).join('') : '<span class="muted small">Aucune partie pour l\'instant — lance une game !</span>';
    $('#sessStart').textContent = `depuis ${fmtDate(s.startedAt)}${s.timePlayedSec ? ` · ${fmtDur(s.timePlayedSec)} de jeu` : ''}`;
  }

  function mmrCell(m) {
    if (!m.mmr || !Number.isFinite(m.mmr.delta)) return '';
    const d = Math.round(m.mmr.delta);
    const exact = m.mmr.status === 'exact';
    const title = exact ? 'Valeur réelle' : m.mmr.status === 'grouped' ? 'Valeur réelle répartie sur plusieurs parties' : 'Estimation (valeur réelle à la prochaine recherche)';
    return `<span class="mmr-d ${d > 0 ? 'up' : d < 0 ? 'down' : ''}" title="${title}">${exact ? '' : '≈'}${d > 0 ? '+' : ''}${d}</span>`;
  }

  function renderLive() {
    const L = D.live;
    const card = $('#liveCard');
    if (!L || (!L.inMatch && !L.ended)) {
      const rl = D.status.rl;
      const last = D.sessionMatches[0];
      card.innerHTML = `
        <div class="live-status"><span class="dot"></span><span class="t">Partie en direct</span></div>
        <div class="live-empty">
          <div class="big">${rl === 'closed' ? 'Rocket League fermé' : 'En attente d\'une partie'}</div>
          <div>${rl === 'closed' ? 'Lance le jeu : le tracker se connecte tout seul.' : 'Lance une partie : victoire, défaite et overtime seront détectés automatiquement.'}</div>
          ${last ? `<div class="small">Dernière partie : ${last.result === 'W' ? 'victoire' : 'défaite'}${Number.isFinite(last.scoreFor) && !last.manual ? ` ${last.scoreFor}-${last.scoreAgainst}` : ''}${last.overtime ? ' en overtime' : ''} · ${fmtAgo(last.endedAt)}</div>` : ''}
        </div>`;
      return;
    }
    const t0 = L.teams.find((t) => t.num === 0) || { name: 'Bleu', score: 0 };
    const t1 = L.teams.find((t) => t.num === 1) || { name: 'Orange', score: 0 };
    const meTag = (n) => (L.myTeam === n ? '<span class="me-tag">TOI</span>' : '');
    const clock = L.overtime
      ? `<div class="clock ot"><b>${OT.fmtClock(L.time, true) || '+0:00'}</b><span>Overtime</span></div>`
      : `<div class="clock"><b>${OT.fmtClock(L.time) || '5:00'}</b><span>${L.inMatch ? 'restant' : 'terminé'}</span></div>`;
    const col = (n) =>
      L.players
        .filter((p) => p.team === n)
        .map((p) => `<div class="pl ${p.isMe ? 'me' : ''}"><span class="nm">${esc(p.name)}</span><span class="sc" title="Score · buts · passes · arrêts">${p.score} · ${p.goals}/${p.assists}/${p.saves}</span></div>`)
        .join('');
    const notes = [];
    if (D.settings.paused) notes.push('<div class="live-note warn">Tracker en pause : cette partie ne sera pas comptée.</div>');
    else if (!L.counted) notes.push(`<div class="live-note warn">${esc(L.playlist.name)} : mode non compté (Réglages → Parties comptées).</div>`);
    if (L.identityState === 'spectator') notes.push('<div class="live-note">Tu n\'es pas dans cette partie (spectateur) : elle ne sera pas comptée.</div>');
    if (L.me && L.me.via === 'camera') notes.push('<div class="live-note">Identifié via la caméra. Si ce n\'est pas toi, choisis ton pseudo dans Réglages.</div>');
    const res = L.result
      ? `<div class="result-banner ${L.result.result}">${L.result.result === 'W' ? 'Victoire' : 'Défaite'}${L.result.overtime ? ' en overtime' : ''}${L.result.abandon ? ' (abandon)' : ''} · ${L.result.scoreFor}-${L.result.scoreAgainst}</div>`
      : '';
    card.innerHTML = `
      <div class="live-status">
        <span class="dot ${L.inMatch ? 'on' : ''}"></span>
        <span class="t">${L.inMatch ? 'En direct' : 'Partie terminée'}</span>
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
      <h3>Qui es-tu dans cette partie ?</h3>
      <div class="muted">Ton compte n'a pas été reconnu automatiquement. Clique sur ton pseudo : il sera mémorisé pour les prochaines parties.</div>
      <div class="pick">${L.players.map((p) => `<button class="btn ${p.team === 0 ? '' : 'ghost'}" data-pick="${esc(p.key)}">${esc(p.name)}</button>`).join('')}</div>`;
  }

  function renderSetup() {
    const st = D.status;
    const cfg = st.rlConfig;
    const items = [];
    const apiOff = cfg && cfg.known && !cfg.enabled;
    if (apiOff) items.push('<li><b>La Stats API est désactivée dans Rocket League.</b> <button class="btn small primary" id="setupEnable">Activer</button> puis relance le jeu.</li>');
    else if (cfg && !cfg.known) items.push('<li><b>Configuration de Rocket League introuvable.</b> Lance le jeu une fois, ou active l\'API depuis les Réglages.</li>');
    if (!st.logFound) items.push('<li><b>Journal du jeu introuvable</b> (Documents\\My Games\\Rocket League). Lance Rocket League une fois pour que ton compte soit reconnu.</li>');
    const card = $('#setupCard');
    if (!items.length) return card.classList.add('hidden');
    card.classList.remove('hidden');
    card.innerHTML = `<h3>À faire pour que le tracking marche</h3><ol>${items.join('')}</ol>`;
    const b = $('#setupEnable');
    if (b) b.onclick = enableApi;
  }

  function matchRow(m) {
    const tags = [];
    if (m.overtime) tags.push('<span class="tag ot">OT</span>');
    if (m.mvp) tags.push('<span class="tag mvp">MVP</span>');
    if (m.abandon) tags.push('<span class="tag">ABANDON</span>');
    if (m.manual) tags.push('<span class="tag">MANUEL</span>');
    const score = Number.isFinite(m.scoreFor) && !m.manual ? `${m.scoreFor}-${m.scoreAgainst}` : '';
    return `<div class="m-row">
      ${resPill(m)}
      <div class="info"><b>${esc(m.playlistName || '')}${tags.join('')}</b><span>${esc(m.arena || '')}${m.me ? `${m.arena ? ' · ' : ''}${m.me.goals} but${m.me.goals > 1 ? 's' : ''}, ${m.me.saves} arrêt${m.me.saves > 1 ? 's' : ''}` : ''}</span></div>
      <span class="sc">${score} ${mmrCell(m)}</span>
      <span class="when">${fmtHour(m.endedAt)} <button class="del" data-del="${esc(m.id)}" title="Supprimer">×</button></span>
    </div>`;
  }

  function renderSessionList() {
    const list = D.sessionMatches;
    $('#sessCount').textContent = list.length ? `${list.length} partie${list.length > 1 ? 's' : ''}` : '';
    $('#sessionList').innerHTML = list.length ? list.map(matchRow).join('') : '<div class="empty">Les parties de la session apparaîtront ici.</div>';
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
    horizontal: { w: 1000, h: 220, label: '1000 × 220', desc: 'Victoires / défaites, winrate, série, bilan OT, MMR et badge OVERTIME en direct.' },
    vertical: { w: 340, h: 720, label: '340 × 720', desc: 'Même compteur en colonne, à placer sur un côté de l\'écran.' },
    boost: { w: 1920, h: 1080, label: 'plein écran', desc: 'Source plein écran au-dessus du jeu : se cale à gauche de la jauge de boost, à la couleur de ton équipe.' },
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
      if (el) el.textContent = ovs[o.id] ? `● ${ovs[o.id]} source${ovs[o.id] > 1 ? 's' : ''} OBS connectée${ovs[o.id] > 1 ? 's' : ''}` : '';
    });
    const cs = D.settings.alerts.customSounds || {};
    TYPES.forEach(([t]) => {
      const lab = $(`[data-snd="${t}"]`);
      if (!lab) return;
      lab.textContent = cs[t] ? `Perso : ${cs[t]}` : 'Son intégré';
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
          <div class="thumb">${thumb}${on ? '<span class="pill ok">Actif</span>' : ''}</div>
          <div class="info">
            <b>${esc(t.name)}</b>
            <span class="muted small">${t.builtin ? 'Intégré' : 'Perso'}${t.author ? ` · par ${esc(t.author)}` : ''} · v${esc(t.version)}</span>
            ${t.description ? `<span class="desc">${esc(t.description)}</span>` : ''}
          </div>
          <div class="acts">
            ${on ? '' : '<button class="btn small primary" data-tact="use">Utiliser</button>'}
            <button class="btn small" data-tact="custom">Personnaliser</button>
            ${t.builtin ? '' : '<button class="btn small ghost" data-tact="folder">Dossier</button>'}
            <button class="btn small ghost" data-tact="export">Exporter</button>
            ${t.builtin ? '' : '<button class="btn small ghost danger" data-tact="del">Supprimer</button>'}
          </div>
        </div>`;
      })
      .join('');
  }

  async function onThemeClick(e) {
    const b = e.target.closest('[data-tact]');
    if (!b) return;
    const id = b.closest('[data-theme]').dataset.theme;
    const t = D.themes.list.find((x) => x.id === id);
    const act = b.dataset.tact;
    if (act === 'use') {
      await post('/api/settings', { overlay: { themePack: id } });
      toast(`Thème « ${t.name} » appliqué`, 'ok');
    } else if (act === 'custom') {
      const r = await post(`/api/themes/${id}/duplicate`, { name: `${t.name} perso` });
      toast(r.ok ? 'Copie créée : modifie ses fichiers, les overlays suivent en direct' : r.error || 'Échec', r.ok ? 'ok' : 'err');
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
      if (!(await confirmBox(`Supprimer le thème « ${t.name} » et ses fichiers ?`, 'Supprimer'))) return;
      const r = await api(`/api/themes/${id}`, { method: 'DELETE' });
      toast(r.ok ? 'Thème supprimé' : 'Échec', r.ok ? 'ok' : 'err');
    }
  }

  function pickTheme() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.zip,application/zip';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      if (f.size > 60 * 1024 * 1024) return toast('Fichier trop lourd (60 Mo max)', 'err');
      const r = await api('/api/themes/install', { method: 'POST', body: await f.arrayBuffer() });
      if (!r.ok) return toast(r.error || 'Thème invalide', 'err');
      toast(`Thème « ${r.name} » installé${r.refused && r.refused.length ? ` (${r.refused.length} fichier(s) ignoré(s))` : ''}`, 'ok');
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
      if (f.size > 8 * 1024 * 1024) return toast('Fichier trop lourd (8 Mo max)', 'err');
      const ext = (f.name.split('.').pop() || 'mp3').toLowerCase();
      const r = await api(`/api/sounds/${type}?ext=${encodeURIComponent(ext)}`, { method: 'POST', body: await f.arrayBuffer() });
      toast(r.ok ? `Son « ${TYPE_NAME[type]} » remplacé` : r.error || 'Échec', r.ok ? 'ok' : 'err');
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
      el.textContent = 'Désactivé';
    } else if (o.state === 'connected') {
      el.className = 'pill ok';
      el.textContent = `${o.name} connecté${o.version ? ` · ${o.version}` : ''}`;
      if (!obsScenes) loadObsScenes(true);
    } else if (o.state === 'connecting') {
      el.className = 'pill wait';
      el.textContent = 'Connexion…';
    } else {
      el.className = 'pill err';
      el.textContent = o.error || 'Erreur';
    }
  }
  async function loadObsScenes(quiet) {
    const r = await api('/api/obs/scenes');
    if (!r.ok) {
      if (quiet !== true) toast(r.error || 'Logiciel de stream non connecté', 'err');
      return;
    }
    obsScenes = r.scenes;
    $('#dl-scenes').innerHTML = obsScenes.map((s) => `<option value="${esc(s.name)}"></option>`).join('');
    TYPES.forEach(([t]) => fillSourceList(t));
    if (quiet !== true) toast(`${obsScenes.length} scène${obsScenes.length > 1 ? 's' : ''} trouvée${obsScenes.length > 1 ? 's' : ''}`, 'ok');
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
      <div class="kpi"><span>Total (toutes sessions)</span><b>${a.wins}V - ${a.losses}D</b></div>
      <div class="kpi"><span>Winrate global</span><b>${a.played ? `${a.winRate}%` : '—'}</b></div>
      <div class="kpi ot"><span>Overtime (V-D)</span><b>${a.otWins}-${a.otLosses}</b></div>
      <div class="kpi"><span>Meilleure série</span><b>${a.bestWinStreak}</b></div>
      <div class="bypl">${a.byPlaylist.map((p) => `<span class="pl-chip"><b>${esc(p.name)}</b> ${p.wins}V-${p.losses}D · ${p.winRate}%</span>`).join('')}</div>`;
    const rows = (h.matches || []).map((m) => {
      const tags = `${m.overtime ? '<span class="tag ot">OT</span>' : ''}${m.mvp ? '<span class="tag mvp">MVP</span>' : ''}${m.abandon ? '<span class="tag">ABANDON</span>' : ''}${m.manual ? '<span class="tag">MANUEL</span>' : ''}`;
      const me = m.me ? `${m.me.goals} · ${m.me.assists} · ${m.me.saves} · ${m.me.shots}` : '';
      return `<tr>
        <td>${fmtDate(m.endedAt)}</td>
        <td><span class="badge ${m.result}">${m.result === 'W' ? 'Victoire' : 'Défaite'}</span>${tags}</td>
        <td>${Number.isFinite(m.scoreFor) && !m.manual ? `${m.scoreFor} - ${m.scoreAgainst}` : '—'}</td>
        <td>${mmrCell(m) || '—'}</td>
        <td>${esc(m.playlistName || '')}</td>
        <td>${esc(m.arena || '')}</td>
        <td>${m.durationSec ? fmtDur(m.durationSec) : '—'}</td>
        <td>${me}</td>
        <td><button class="del" data-del="${esc(m.id)}" title="Supprimer">×</button></td>
      </tr>`;
    });
    $('#histBody').innerHTML = rows.join('') || '<tr><td colspan="9" class="empty">Aucune partie.</td></tr>';
  }

  // ------------------------------------------------------------------ réglages
  async function enableApi() {
    const r = await post('/api/statsapi/enable');
    if (r.ok) return toast('Stats API activée : redémarre Rocket League', 'ok');
    if (r.needsAdmin && (await confirmBox('Le dossier du jeu est protégé. Réessayer avec les droits administrateur (fenêtre Windows de confirmation) ?', 'Réessayer'))) {
      const r2 = await post('/api/statsapi/enable', { elevated: true });
      return toast(r2.ok ? 'Stats API activée : redémarre Rocket League' : 'Échec', r2.ok ? 'ok' : 'err');
    }
    toast(r.error || 'Impossible de modifier la configuration', 'err');
  }

  function renderSettings() {
    const st = D.status;
    const acct = st.account;
    $('#identityInfo').innerHTML = acct
      ? `<div class="ok">Compte détecté dans le journal du jeu : <b>${esc(acct.name)}</b> (${esc(acct.platform)})</div><code>${esc(acct.id)}</code>`
      : `<div class="wr">Aucun compte détecté pour l'instant.</div><div class="muted">Lance Rocket League : le compte connecté est lu dans son journal. Sinon, indique ton pseudo ci-dessous.</div>`;
    const ids = D.settings.identity.knownIds;
    $('#knownIds').innerHTML = ids.length
      ? `<div class="muted small">Comptes reconnus comme « toi » :</div>${ids.map((id) => `<div class="kid"><code>${esc(id)}</code><button class="btn small ghost" data-forget="${esc(id)}">Oublier</button></div>`).join('')}`
      : '';

    const c = st.rlConfig;
    if (c) {
      const inst = c.installs.length ? c.installs.map((i) => `${esc(i.platform)} : <code>${esc(i.dir)}</code>`).join('<br>') : '<span class="wr">Installation non trouvée (Steam / Epic)</span>';
      const eff = c.effective;
      $('#rlInfo').innerHTML = `
        <div class="${c.enabled ? 'ok' : c.known ? 'bad' : 'wr'}">${c.enabled ? `API activée · ${eff.PacketSendRate} mise(s) à jour/s` : c.known ? 'API désactivée (PacketSendRate = 0)' : 'Fichier de configuration non trouvé'}</div>
        <div>Ports : TCP <b>${eff.Port}</b> · WebSocket <b>${eff.WebPort}</b></div>
        <div>Connexion : <b>${st.api.state === 'live' ? 'reçoit des données' : st.api.state === 'waiting' ? 'connectée' : 'pas de connexion'}</b>${st.api.messages ? ` · ${st.api.messages} messages reçus` : ''}</div>
        <div class="muted small">${inst}</div>`;
    }
    const known = (D.mmr && D.mmr.known) || [];
    $('#mmrInfo').innerHTML = known.length
      ? known
          .map((k) => `<div><b>${esc(k.name)}</b> : ${k.mmr} MMR <span class="muted small">(lu ${fmtDate(k.at).toLowerCase()})</span></div>`)
          .join('')
      : `<div class="wr">Aucune valeur réelle pour l'instant.</div><div class="muted">Lance une recherche de partie classée toi-même : ton MMR apparaîtra ici.</div>`;
    $('#hotkeyErrors').textContent = (D.hotkeyErrors || []).length ? `Raccourci indisponible (déjà utilisé ?) : ${D.hotkeyErrors.join(', ')}` : '';

    const b = baseUrl();
    const k = encodeURIComponent(D.settings.apiKey);
    const urls = [
      ['+1 victoire', `${b}/api/action/win?key=${k}`],
      ['+1 victoire (+ alerte)', `${b}/api/action/win?key=${k}&alert=1`],
      ['+1 défaite', `${b}/api/action/loss?key=${k}`],
      ['Annuler', `${b}/api/action/undo?key=${k}`],
      ['Pause / reprise', `${b}/api/action/toggle-pause?key=${k}`],
      ['Nouvelle session', `${b}/api/action/new-session?key=${k}`],
      ['Texte « 12 - 5 »', `${b}/api/text/record`],
      ['Texte MMR (+45)', `${b}/api/text/mmrsession`],
    ];
    $('#apiUrls').innerHTML = urls
      .map(([n, u]) => `<div class="url-row"><span>${esc(n)}</span><input readonly value="${esc(u)}" /><button class="btn small" data-copyurl="${esc(u)}">Copier</button></div>`)
      .join('');
    $('#textDir').textContent = D.textDir;
    $('#lanInfo').innerHTML = D.settings.lanAccess
      ? D.lanAddresses.length
        ? `Sur le PC de stream : ${D.lanAddresses.map((ip) => `<code>http://${esc(ip)}:${D.port}/overlay/…</code>`).join(' ou ')}`
        : 'Aucune adresse réseau trouvée.'
      : `Overlays accessibles uniquement sur ce PC (http://127.0.0.1:${D.port}).`;
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
    $('#statusChips').innerHTML = '<span class="chip err"><b>Connexion au tracker perdue…</b></span>';
  });
  OT.connect({ role: 'dashboard', key: KEY });
  setInterval(() => D && renderLive(), 30000);
})();
