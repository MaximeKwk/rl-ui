// Page Statistiques du tableau de bord : vue d'ensemble d'une période, sessions comparées, image à partager.
// Les calculs sont faits par l'app (core/insights.js) ; ici on ne fait qu'afficher.
(function () {
  const R = window.RLUI;
  const { $, $$, esc, t, tn, api, toast, pad, fmtHour, fmtDur } = R;
  const NS = 'http://www.w3.org/2000/svg';
  const loc = () => (OT.lang === 'fr' ? 'fr-FR' : 'en-US');

  let tab = 'overview';
  let range = '30d';
  let mode = 'all';
  let mmrPick = null; // mode affiché sur la courbe quand « tous les modes » est choisi
  let stats = null;
  let series = [];
  let sess = null; // liste des sessions
  let picked = null; // session affichée
  let detail = null;
  let cmp = 'prev';
  const stale = { overview: true, sessions: true };
  let seq = 0;

  try {
    tab = localStorage.getItem('rlui-sttab') || tab;
    range = localStorage.getItem('rlui-strange') || range;
  } catch {}

  // ------------------------------------------------------------------ outils d'affichage
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const svg = (tag, attrs = {}) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const num = (v, digits = 0) => (v == null ? '—' : Number(v).toLocaleString(loc(), { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  const signed = (v, digits = 0) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), digits)}`);
  const pctTxt = (v) => (v == null ? '—' : OT.lang === 'fr' ? `${v} %` : `${v}%`);
  const day = (ts, opts = {}) => {
    const d = new Date(ts);
    const o = { weekday: opts.weekday === false ? undefined : 'short', day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString(loc(), o);
  };
  const dayTime = (ts) => `${day(ts, { weekday: false })} ${fmtHour(ts)}`;
  const wl = (w, l) => `${w} ${R.LW()} – ${l} ${R.LL()}`;
  const rec = (w, l) => `${w}–${l}`; // bilan court, pour les tuiles

  // Tuile : un chiffre, son nom, une précision
  function tile(label, value, sub = '', cls = '') {
    return `<div class="st-tile ${cls}"><span>${esc(label)}</span><b>${value}</b>${sub ? `<i>${sub}</i>` : ''}</div>`;
  }
  // Variation : le sens se lit à la flèche autant qu'à la couleur
  function delta(v, { digits = 0, unit = '' } = {}) {
    if (v == null) return '<span class="st-delta flat">—</span>';
    const r = Number(v.toFixed(digits));
    if (!r) return `<span class="st-delta flat">${esc(t('d.st.same'))}</span>`;
    return `<span class="st-delta ${r > 0 ? 'up' : 'down'}"><span aria-hidden="true">${r > 0 ? '▲' : '▼'}</span> ${esc(signed(r, digits))}${unit ? ` ${esc(unit)}` : ''}</span>`;
  }
  // Jauge horizontale : une part sur 100
  const meter = (p) => `<span class="st-meter" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, p || 0))}%"></i></span>`;

  // ------------------------------------------------------------------ sous-onglets
  function showTab(name) {
    if (!$(`[data-stpane="${name}"]`)) name = 'overview';
    tab = name;
    $$('#stTabs button').forEach((b) => b.classList.toggle('on', b.dataset.sttab === name));
    $$('[data-stpane]').forEach((p) => p.classList.toggle('hidden', p.dataset.stpane !== name));
    try {
      localStorage.setItem('rlui-sttab', name);
    } catch {}
    refresh();
  }

  function visible() {
    return $('#tab-history').classList.contains('active');
  }

  function refresh() {
    if (!visible()) return;
    if (tab === 'overview' && stale.overview) loadOverview();
    if (tab === 'sessions' && stale.sessions) loadSessions();
  }

  // ------------------------------------------------------------------ vue d'ensemble
  async function loadOverview() {
    stale.overview = false;
    const mine = ++seq;
    $('#stBody').classList.add('loading');
    const [s, m] = await Promise.all([api(`/api/stats?range=${range}&mode=${encodeURIComponent(mode)}`), api(`/api/stats/mmr?range=${range}`)]);
    if (mine !== seq) return; // une demande plus récente est partie entre-temps
    $('#stBody').classList.remove('loading');
    if (!s || !s.overview) return;
    // le mode choisi n'existe plus sur cette période : retour à « tous les modes »
    if (mode !== 'all' && !s.modes.some((x) => x.key === mode)) {
      mode = 'all';
      return loadOverview();
    }
    stats = s;
    series = (m && m.series) || [];
    renderOverview();
  }

  function renderOverview() {
    const o = stats.overview;
    $$('#stRange button').forEach((b) => b.classList.toggle('on', b.dataset.range === range));
    const sel = $('#stMode');
    sel.innerHTML = `<option value="all">${esc(t('d.st.allModes'))}</option>${stats.modes.map((m) => `<option value="${esc(m.key)}">${esc(t('d.st.modeN', { name: m.name, n: m.played }))}</option>`).join('')}`;
    sel.value = mode;
    sel.classList.toggle('hidden', stats.modes.length < 2 && mode === 'all');

    const empty = !o.played;
    $('#stEmpty').classList.toggle('hidden', !empty);
    $('#stBody').classList.toggle('hidden', empty);
    $('#stScope').textContent = empty ? '' : tn('d.st.scope', o.played, { a: day(o.firstAt), b: day(o.lastAt) });
    if (empty) {
      $('#stEmpty').textContent = t(range === 'session' ? 'd.st.empty.session' : 'd.st.empty.range');
      return;
    }

    // tuiles
    // la même variation que sous la courbe (valeur actuelle moins valeur de départ de la période)
    const sr = currentSeries();
    const mmrTile = sr
      ? tile(t('d.st.mmr'), `${sr.currentApprox ? '≈ ' : ''}${esc(signed(sr.delta))}`, esc(t('d.st.mmrNow', { pl: sr.name, v: num(sr.current) })), sr.delta > 0 ? 'up' : sr.delta < 0 ? 'down' : '')
      : tile(t('d.st.mmr'), '—', esc(t('d.st.mmrNone')));
    $('#stTiles').innerHTML = [
      tile(t('d.st.record'), esc(rec(o.wins, o.losses)), esc(wl(o.wins, o.losses))),
      tile(t('d.st.winrate'), esc(pctTxt(o.winRate)), meter(o.winRate)),
      mmrTile,
      tile(t('d.st.bestStreak'), num(o.bestWinStreak), esc(tn('d.st.winsRow', o.bestWinStreak))),
      tile(t('d.st.goalDiff'), esc(signed(o.goalDiff)), esc(t('d.st.goalsFA', { f: num(o.goalsFor), a: num(o.goalsAgainst) }))),
      tile(t('d.st.time'), esc(fmtDur(o.timePlayedSec)), o.mvps ? `${esc(t('d.st.mvp'))} × ${num(o.mvps)}` : ''),
    ].join('');

    renderMmr();
    renderStreaks(o);
    renderModes();
    renderPositions(o);

    const pm = o.perMatch;
    $('#stPerMatch').innerHTML = [
      tile(t('d.st.goals'), num(pm.goals, 1), esc(t('d.st.perMatch'))),
      tile(t('d.st.assists'), num(pm.assists, 1), esc(t('d.st.perMatch'))),
      tile(t('d.st.saves'), num(pm.saves, 1), esc(t('d.st.perMatch'))),
      tile(t('d.st.shots'), num(pm.shots, 1), esc(t('d.st.perMatch'))),
      tile(t('d.st.shotPct'), esc(pctTxt(o.shotPct)), meter(o.shotPct)),
      tile(t('d.st.mvp'), num(o.mvps), esc(tn('d.st.mvpOf', o.wins))),
    ].join('');
  }

  // ---- séries
  function renderStreaks(o) {
    const now = o.streak;
    $('#stStreakNow').textContent = now > 0 ? tn('d.st.nowW', now) : now < 0 ? tn('d.st.nowL', -now) : '';
    const rate = (x) => (x.played >= 3 ? `${meter(x.winRate)}<b>${esc(pctTxt(x.winRate))}</b><i>${esc(`${x.wins} / ${x.played}`)}</i>` : `<i>${esc(t('d.st.noData'))}</i>`);
    const run = (s) => (s ? `<b>${num(s.n)}</b><i>${esc(s.from === s.to || day(s.from) === day(s.to) ? day(s.to) : `${day(s.from, { weekday: false })} → ${day(s.to, { weekday: false })}`)}</i>` : '<b>—</b>');
    const rows = [
      [t('d.st.longestW'), run(o.bestWin), 'run'],
      [t('d.st.longestL'), run(o.worstLoss), 'run'],
      [t('d.st.afterW'), rate(o.afterWin), ''],
      [t('d.st.afterL'), rate(o.afterLoss), ''],
      [t('d.st.close'), rate(o.close), ''],
      [t('d.st.ot'), rate(o.overtime), ''],
    ];
    // lecture en une phrase, seulement quand l'écart est net et l'échantillon suffisant
    let note = '';
    if (o.afterWin.played >= 8 && o.afterLoss.played >= 8) {
      const d = o.afterWin.winRate - o.afterLoss.winRate;
      if (d >= 12) note = t('d.st.tiltUp');
      else if (d <= -12) note = t('d.st.tiltDown');
    }
    $('#stStreaks').innerHTML = `
      <div class="st-strip" role="img" aria-label="${esc(t('d.st.lastN', { n: o.results.length }))}">${o.results.map((r) => R.resPill({ result: r.r, ot: r.ot, abandon: r.ab, score: r.s })).join('')}</div>
      <p class="muted small st-strip-cap">${esc(t('d.st.lastN', { n: o.results.length }))}</p>
      <dl class="st-rows">${rows.map(([k, v, c]) => `<div class="${c}"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>
      ${note ? `<p class="st-note">${esc(note)}</p>` : ''}`;
  }

  // ---- par mode : une barre par mode, la part de parties gagnées
  function renderModes() {
    const list = stats.modes;
    $('#stModes').innerHTML = `<div class="st-bars">${list
      .slice(0, 8)
      .map(
        (m) => `
      <button type="button" class="st-bar ${mode === m.key ? 'on' : ''}" data-stmode="${esc(m.key)}" title="${esc(wl(m.wins, m.losses))}">
        <span class="nm">${esc(m.name)}</span>
        ${meter(m.winRate)}
        <span class="vl">${esc(tn('d.st.modeRow', m.played, { p: m.winRate }))}</span>
      </button>`
      )
      .join('')}</div>`;
  }

  // ---- au fil de la session : colonnes par rang de la partie
  function renderPositions(o) {
    const cols = o.byPosition;
    const label = (c) => (c.to ? t('d.st.pos', { a: c.from, b: c.to }) : t('d.st.posLast', { a: c.from }));
    let note = '';
    const first = cols[0];
    const late = cols[3];
    if (first.played >= 8 && late.played >= 8) {
      const d = first.winRate - late.winRate;
      if (d >= 10) note = t('d.st.posDrop', { a: first.winRate, b: late.winRate });
      else if (d <= -10) note = t('d.st.posRise', { a: first.winRate, b: late.winRate });
    }
    $('#stPos').innerHTML = `
      <div class="st-cols">${cols
        .map(
          (c) => `
        <div class="st-col ${c.played ? '' : 'none'}" title="${esc(c.played ? `${c.wins} / ${c.played}` : '')}">
          <span class="vbar"><b>${esc(c.played ? pctTxt(c.winRate) : '—')}</b><i aria-hidden="true" style="height:${c.played ? Math.max(3, Math.round(c.winRate * 0.9)) : 0}px"></i></span>
          <span class="nm">${esc(label(c))}</span>
          <span class="ct">${esc(tn('d.st.posN', c.played))}</span>
        </div>`
        )
        .join('')}</div>
      ${note ? `<p class="st-note">${esc(note)}</p>` : ''}`;
  }

  // ---- évolution du MMR : une courbe, un point par partie
  function currentSeries() {
    if (!series.length) return null;
    if (mode !== 'all') return series.find((s) => String(s.playlist) === mode) || null;
    return series.find((s) => String(s.playlist) === mmrPick) || series[0];
  }

  function renderMmr() {
    const pick = $('#stMmrMode');
    const many = mode === 'all' && series.length > 1;
    pick.classList.toggle('hidden', !many);
    const s = currentSeries();
    if (many) {
      pick.innerHTML = series.map((x) => `<option value="${esc(String(x.playlist))}">${esc(x.name)}</option>`).join('');
      pick.value = String(s.playlist);
    }
    const host = $('#stMmr');
    host.textContent = '';
    if (!s) {
      host.appendChild(el('p', 'muted st-chart-empty', t('d.st.mmrEmpty')));
      return;
    }
    const head = el('div', 'st-mmr-head');
    const cur = el('div', 'st-mmr-now');
    cur.appendChild(el('b', '', `${s.currentApprox ? '≈ ' : ''}${num(s.current)}`));
    cur.appendChild(el('span', 'muted', `${s.name} · ${t('d.st.mmrCurrent')}`));
    head.appendChild(cur);
    const side = el('div', 'st-mmr-side');
    side.innerHTML = `${delta(s.delta)} <span class="muted small">${esc(t('d.st.mmrOver'))}</span><span class="muted small sep">${esc(t('d.st.mmrPeak', { v: num(s.max) }))} · ${esc(t('d.st.mmrLow', { v: num(s.min) }))}</span>`;
    head.appendChild(side);
    host.appendChild(head);
    if (s.points.length < 2) {
      host.appendChild(el('p', 'muted st-chart-empty', t('d.st.mmrFew')));
      return;
    }
    drawLine(host, s);

    // les mêmes valeurs en tableau (lecteurs d'écran, ou pour qui préfère les chiffres)
    const det = el('details', 'st-values');
    det.appendChild(el('summary', '', t('d.st.values')));
    const table = el('table', 'table');
    table.innerHTML = `<thead><tr><th>${esc(t('d.st.thDate'))}</th><th>MMR</th><th>${esc(t('d.st.thNote'))}</th></tr></thead>`;
    const body = el('tbody');
    for (const p of [...s.points].reverse().slice(0, 80)) {
      const tr = el('tr');
      tr.appendChild(el('td', '', dayTime(p.at)));
      tr.appendChild(el('td', '', num(p.mmr)));
      tr.appendChild(el('td', '', p.approx ? t('d.st.mmrEst') : t('d.st.mmrReal')));
      body.appendChild(tr);
    }
    table.appendChild(body);
    const wrap = el('div', 'table-wrap');
    wrap.appendChild(table);
    det.appendChild(wrap);
    host.appendChild(det);
  }

  // Pas « rond » pour les graduations (1, 2, 5 × 10ⁿ)
  function niceStep(span, count) {
    const raw = span / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }

  function drawLine(host, s) {
    const pts = s.points;
    const box = el('div', 'st-chart');
    host.appendChild(box);
    const W = Math.max(320, box.clientWidth || 600);
    const H = 230;
    const pad0 = { l: 46, r: 14, t: 14, b: 28 };
    const lo0 = Math.min(...pts.map((p) => p.mmr));
    const hi0 = Math.max(...pts.map((p) => p.mmr));
    const step = niceStep(Math.max(20, hi0 - lo0), 4);
    const lo = Math.floor(lo0 / step) * step;
    const hi = Math.max(lo + step, Math.ceil(hi0 / step) * step);
    const x = (i) => pad0.l + (i * (W - pad0.l - pad0.r)) / (pts.length - 1);
    const y = (v) => pad0.t + (1 - (v - lo) / (hi - lo)) * (H - pad0.t - pad0.b);

    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', tabindex: '0' });
    root.setAttribute('aria-label', t('d.st.mmrAria', { pl: s.name, a: num(pts[0].mmr), b: num(pts[pts.length - 1].mmr), max: num(s.max), min: num(s.min) }));
    // graduations : traits fins, discrets
    for (let v = lo; v <= hi + 1e-6; v += step) {
      root.appendChild(svg('line', { x1: pad0.l, x2: W - pad0.r, y1: y(v), y2: y(v), class: 'grid' }));
      const tx = svg('text', { x: pad0.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' });
      tx.textContent = num(v);
      root.appendChild(tx);
    }
    // dates : début, milieu, fin
    const marks = pts.length > 12 ? [0, Math.floor((pts.length - 1) / 2), pts.length - 1] : [0, pts.length - 1];
    marks.forEach((i, k) => {
      const tx = svg('text', { x: x(i), y: H - 8, 'text-anchor': k === 0 ? 'start' : k === marks.length - 1 ? 'end' : 'middle', class: 'tick' });
      tx.textContent = day(pts[i].at, { weekday: false });
      root.appendChild(tx);
    });
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.mmr).toFixed(1)}`).join(' ');
    root.appendChild(svg('path', { d: `${d} L${x(pts.length - 1).toFixed(1)} ${y(lo)} L${x(0).toFixed(1)} ${y(lo)} Z`, class: 'area' }));
    root.appendChild(svg('path', { d, class: 'line' }));
    // dernier point : plein si la valeur est réelle, creux si c'est une estimation
    const last = pts[pts.length - 1];
    root.appendChild(svg('circle', { cx: x(pts.length - 1), cy: y(last.mmr), r: 5, class: `end ${last.approx ? 'approx' : ''}` }));
    // survol : un repère vertical trouve la partie la plus proche
    const cross = svg('line', { y1: pad0.t, y2: H - pad0.b, class: 'cross', visibility: 'hidden' });
    const dot = svg('circle', { r: 5, class: 'dot', visibility: 'hidden' });
    root.appendChild(cross);
    root.appendChild(dot);
    box.appendChild(root);
    const tip = el('div', 'st-tip hidden');
    box.appendChild(tip);

    let at = -1;
    const show = (i) => {
      at = Math.max(0, Math.min(pts.length - 1, i));
      const p = pts[at];
      cross.setAttribute('x1', x(at));
      cross.setAttribute('x2', x(at));
      cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(at));
      dot.setAttribute('cy', y(p.mmr));
      dot.setAttribute('visibility', 'visible');
      tip.textContent = '';
      tip.appendChild(el('b', '', `${p.approx ? '≈ ' : ''}${num(p.mmr)}`));
      const prev = at > 0 ? pts[at - 1].mmr : null;
      if (prev != null && Math.round(p.mmr - prev)) tip.appendChild(el('span', `chg ${p.mmr > prev ? 'up' : 'down'}`, `${p.mmr > prev ? '▲' : '▼'} ${signed(Math.round(p.mmr - prev))}`));
      tip.appendChild(el('i', '', `${dayTime(p.at)}${p.result ? ` · ${t(p.result === 'W' ? 'd.Victory' : 'd.Defeat')}` : ''}${p.approx ? ` · ${t('d.st.mmrEst')}` : ''}`));
      tip.classList.remove('hidden');
      const left = x(at) > W / 2;
      tip.style.left = left ? '' : `${x(at) + 12}px`;
      tip.style.right = left ? `${W - x(at) + 12}px` : '';
      tip.style.top = `${Math.max(4, Math.min(H - 70, y(p.mmr) - 30))}px`;
    };
    const hide = () => {
      at = -1;
      cross.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
      tip.classList.add('hidden');
    };
    root.addEventListener('pointermove', (e) => {
      const r = root.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      show(Math.round(((px - pad0.l) / (W - pad0.l - pad0.r)) * (pts.length - 1)));
    });
    root.addEventListener('pointerleave', hide);
    root.addEventListener('blur', hide);
    root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        show(at < 0 ? pts.length - 1 : at + (e.key === 'ArrowRight' ? 1 : -1));
      } else if (e.key === 'Escape') hide();
    });
  }

  // ------------------------------------------------------------------ sessions
  async function loadSessions() {
    stale.sessions = false;
    const r = await api('/api/sessions?limit=200');
    if (!r || !Array.isArray(r.sessions)) return;
    sess = r;
    if (!picked || !sess.sessions.some((s) => s.id === picked)) picked = sess.sessions.length ? sess.sessions[0].id : null;
    renderSessList();
    loadDetail();
  }

  function renderSessList() {
    const list = sess.sessions;
    $('#stSessCount').textContent = list.length ? tn('d.st.nSessions', sess.total) : '';
    $('#stSessList').innerHTML = list.length
      ? list
          .map(
            (s) => `
        <button type="button" class="sess-row ${s.id === picked ? 'on' : ''}" data-sid="${esc(s.id)}" aria-pressed="${s.id === picked}">
          <span class="when"><b>${esc(day(s.startedAt))}</b>${s.current ? `<em>${esc(t('d.st.current'))}</em>` : ''}<i>${esc(fmtHour(s.startedAt))} · ${esc(fmtDur(s.timePlayedSec))}${s.mode ? ` · ${esc(s.mode)}` : ''}</i></span>
          <span class="rec"><b>${s.wins}–${s.losses}</b><i>${esc(pctTxt(s.winRate))}</i></span>
          <span class="mm">${s.mmrDelta != null ? delta(Math.round(s.mmrDelta)) : ''}</span>
        </button>`
          )
          .join('')
      : `<div class="empty">${esc(t('d.st.sessEmpty'))}</div>`;
  }

  async function loadDetail() {
    const host = $('#stSessDetail');
    if (!picked) {
      host.innerHTML = '';
      detail = null;
      return;
    }
    const d = await api(`/api/sessions/${encodeURIComponent(picked)}`);
    if (!d || !d.summary) return;
    detail = d;
    renderDetail();
  }

  // À quoi comparer : la session d'avant, ma moyenne, ou une autre session
  function compareTarget() {
    const list = sess.sessions;
    const i = list.findIndex((s) => s.id === picked);
    if (cmp === 'prev') return list[i + 1] || null;
    if (cmp === 'average') return sess.average;
    return list.find((s) => s.id === cmp && s.id !== picked) || list[i + 1] || null;
  }

  function renderDetail() {
    const s = detail.summary;
    const o = detail.overview;
    const host = $('#stSessDetail');
    const others = sess.sessions.filter((x) => x.id !== s.id);
    const i = sess.sessions.findIndex((x) => x.id === s.id);
    const hasPrev = !!sess.sessions[i + 1];
    if (cmp === 'prev' && !hasPrev) cmp = 'average';
    const b = others.length ? compareTarget() : null;
    const opts = [
      hasPrev ? `<option value="prev">${esc(t('d.st.cmpPrev'))}</option>` : '',
      sess.average && sess.average.sessions > 1 ? `<option value="average">${esc(t('d.st.cmpAvg', { n: sess.average.sessions }))}</option>` : '',
      ...others.slice(0, 60).map((x) => `<option value="${esc(x.id)}">${esc(`${day(x.startedAt)} · ${x.wins}–${x.losses}`)}</option>`),
    ].join('');

    const rows = b
      ? [
          [t('d.st.cmpPlayed'), s.played, b.played, { digits: b.id === 'average' ? 1 : 0, neutral: true }],
          [t('d.st.winrate'), s.winRate, b.winRate, { pct: true }],
          [t('d.st.bestStreak'), s.bestWinStreak, b.bestWinStreak, { digits: b.id === 'average' ? 1 : 0 }],
          [t('d.st.cmpGoals'), s.goals, b.goals, { digits: 1 }],
          [t('d.st.cmpAssists'), s.assists, b.assists, { digits: 1 }],
          [t('d.st.cmpSaves'), s.saves, b.saves, { digits: 1 }],
          [t('d.st.cmpMmr'), s.mmrDelta != null ? Math.round(s.mmrDelta) : null, b.mmrDelta != null ? Math.round(b.mmrDelta) : null, { sign: true }],
          [t('d.st.time'), s.timePlayedSec, b.timePlayedSec, { dur: true, neutral: true }],
        ]
      : [];
    const cell = (v, o2) => (v == null ? '—' : o2.pct ? pctTxt(v) : o2.dur ? fmtDur(v) : o2.sign ? signed(v) : num(v, o2.digits || 0));
    const diff = (a, c, o2) => {
      if (a == null || c == null) return '<span class="st-delta flat">—</span>';
      if (o2.dur) {
        const m = Math.round((a - c) / 60);
        return m ? `<span class="st-delta flat">${esc(`${m > 0 ? '+' : '−'}${fmtDur(Math.abs(m) * 60)}`)}</span>` : `<span class="st-delta flat">${esc(t('d.st.same'))}</span>`;
      }
      const html = delta(a - c, { digits: o2.pct || o2.sign ? 0 : o2.digits || 0, unit: o2.pct ? 'pts' : '' });
      return o2.neutral ? html.replace(/st-delta (up|down)/, 'st-delta flat') : html;
    };
    const mm = s.mmr[0] || null;

    host.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div>
            <h3>${esc(t('d.st.sessTitle', { d: day(s.startedAt) }))}${s.current ? ` <span class="tag">${esc(t('d.st.current'))}</span>` : ''}</h3>
            <p class="muted small">${esc(tn('d.st.sessSub', s.played, { a: fmtHour(s.startedAt), b: fmtHour(s.endedAt) }))}${detail.modes.length ? ` · ${esc(detail.modes.map((m) => m.name).slice(0, 3).join(', '))}` : ''}</p>
          </div>
          <button class="btn primary" id="stShare">${esc(t('d.st.share'))}</button>
        </div>
        <div class="st-tiles">
          ${tile(t('d.st.record'), esc(rec(s.wins, s.losses)), esc(tn('d.nMatches', s.played)))}
          ${tile(t('d.st.winrate'), esc(pctTxt(s.winRate)), meter(s.winRate))}
          ${mm ? tile(t('d.st.mmr'), `${mm.approx ? '≈ ' : ''}${esc(signed(Math.round(s.mmrDelta)))}`, esc(mm.end != null ? `${mm.name}, ${num(mm.end)}` : mm.name), s.mmrDelta > 0 ? 'up' : s.mmrDelta < 0 ? 'down' : '') : tile(t('d.st.mmr'), '—', esc(t('d.st.mmrNone')))}
          ${tile(t('d.st.bestStreak'), num(s.bestWinStreak), esc(tn('d.st.winsRow', s.bestWinStreak)))}
          ${tile(t('d.otwl'), `${s.otWins}-${s.otLosses}`, s.mvps ? `${esc(t('d.st.mvp'))} × ${num(s.mvps)}` : '')}
          ${tile(t('d.st.time'), esc(fmtDur(s.timePlayedSec)), esc(t('d.st.goalsFA', { f: num(s.goalsFor), a: num(s.goalsAgainst) })))}
        </div>
        <div class="st-strip" role="img" aria-label="${esc(t('d.st.lastN', { n: o.results.length }))}">${o.results.map((r) => R.resPill({ result: r.r, ot: r.ot, abandon: r.ab, score: r.s })).join('')}</div>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>${esc(t('d.st.compare'))}</h3>
          ${others.length ? `<select id="stCompare" aria-label="${esc(t('d.st.compare'))}">${opts}</select>` : ''}
        </div>
        ${
          b
            ? `<div class="table-wrap"><table class="table st-cmp">
            <thead><tr><th></th><th>${esc(t('d.st.cmpThis'))}</th><th>${esc(b.id === 'average' ? t('d.st.cmpAvg', { n: b.sessions }) : day(b.startedAt))}</th><th>${esc(t('d.st.cmpDiff'))}</th></tr></thead>
            <tbody>${rows.map(([k, a, c, o2]) => `<tr><th scope="row">${esc(k)}</th><td><b>${esc(cell(a, o2))}</b></td><td>${esc(cell(c, o2))}</td><td>${diff(a, c, o2)}</td></tr>`).join('')}</tbody>
          </table></div>`
            : `<p class="muted">${esc(t('d.st.cmpNone'))}</p>`
        }
      </div>`;
    const sel = $('#stCompare');
    if (sel) sel.value = [...sel.options].some((x) => x.value === cmp) ? cmp : sel.options[0].value;
  }

  // ------------------------------------------------------------------ image à partager
  const LOOKS = {
    dark: { bg: '#0e1316', plate: '#1a2226', well: '#10171a', line: '#2a353a', text: '#e8eeef', muted: '#97a6aa', faint: '#7e8f94', win: '#8bd95a', onWin: '#0f2406', loss: '#f2685f', onLoss: '#2a0b09', accent: '#2fd2c6', violet: '#a996ff', ot: '#e8a33d' },
    light: { bg: '#e7eeee', plate: '#ffffff', well: '#f1f5f5', line: '#d3dedf', text: '#152023', muted: '#55666a', faint: '#6b7c80', win: '#357f18', onWin: '#ffffff', loss: '#cf3a32', onLoss: '#ffffff', accent: '#0b7f7a', violet: '#6a4be8', ot: '#9a5b00' },
  };
  let look = 'dark';

  async function drawCard() {
    const c = $('#shareCanvas');
    const g = c.getContext('2d');
    const P = LOOKS[look];
    const s = detail.summary;
    const o = detail.overview;
    const W = 1200;
    const H = 630;
    try {
      await Promise.all([document.fonts.load("700 100px 'Unbounded'"), document.fonts.load("600 24px 'Onest'")]);
    } catch {}
    const NUM = "'Unbounded', sans-serif";
    const UI = "'Onest', sans-serif";
    const text = (str, x, y, font, color, align = 'left') => {
      g.font = font;
      g.fillStyle = color;
      g.textAlign = align;
      g.textBaseline = 'alphabetic';
      g.fillText(str, x, y);
      return g.measureText(str).width;
    };
    const rr = (x, y, w, h, r) => {
      g.beginPath();
      g.roundRect(x, y, w, h, r);
    };

    g.clearRect(0, 0, W, H);
    g.fillStyle = P.bg;
    g.fillRect(0, 0, W, H);

    // la plaque : arrondie, coin supérieur droit coupé, le ballon dans la lucarne (la signature RL-UI)
    const x0 = 36;
    const y0 = 36;
    const x1 = W - 36;
    const y1 = H - 36;
    const r = 30;
    const cut = 78;
    g.beginPath();
    g.moveTo(x0 + r, y0);
    g.lineTo(x1 - cut, y0);
    g.lineTo(x1, y0 + cut);
    g.lineTo(x1, y1 - r);
    g.arcTo(x1, y1, x1 - r, y1, r);
    g.lineTo(x0 + r, y1);
    g.arcTo(x0, y1, x0, y1 - r, r);
    g.lineTo(x0, y0 + r);
    g.arcTo(x0, y0, x0 + r, y0, r);
    g.closePath();
    g.fillStyle = P.plate;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = P.line;
    g.stroke();
    g.beginPath();
    g.arc(x1 - 16, y0 + 16, 24, 0, Math.PI * 2);
    g.fillStyle = P.violet;
    g.fill();

    // en-tête : logo, nom, date
    g.save();
    g.translate(78, 70);
    g.scale(0.44, 0.44);
    g.lineJoin = 'round';
    g.lineWidth = 10;
    g.strokeStyle = P.accent;
    g.stroke(new Path2D('M27 9H47L91 53V73A18 18 0 0 1 73 91H27A18 18 0 0 1 9 73V27A18 18 0 0 1 27 9Z'));
    g.beginPath();
    g.arc(85, 15, 13, 0, Math.PI * 2);
    g.fillStyle = P.violet;
    g.fill();
    g.restore();
    text('RL-UI', 134, 101, `700 24px ${NUM}`, P.text);
    text(new Date(s.startedAt).toLocaleDateString(loc(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), x1 - 110, 100, `500 22px ${UI}`, P.muted, 'right');

    // titre
    text(t('d.st.cardTitle'), 80, 172, `600 22px ${UI}`, P.muted);
    const who = [$('#shareName').checked ? detail.player : '', s.mode].filter(Boolean).join(' · ');
    if (who) text(who, 80, 210, `600 30px ${UI}`, P.text);

    // le bilan en grand
    let x = 78;
    const base = 352;
    x += text(String(s.wins), x, base, `700 132px ${NUM}`, P.win);
    x += text(R.LW(), x + 10, base, `700 34px ${UI}`, P.muted) + 36;
    rr(x, base - 56, 36, 10, 5);
    g.fillStyle = P.faint;
    g.fill();
    x += 36 + 26;
    x += text(String(s.losses), x, base, `700 132px ${NUM}`, P.loss);
    x += text(R.LL(), x + 10, base, `700 34px ${UI}`, P.muted) + 10;

    // à droite : winrate et MMR, calés sur le bord droit (la taille s'adapte à la place qui reste)
    const showMmr = $('#shareMmr').checked && s.mmrDelta != null;
    const d = showMmr ? Math.round(s.mmrDelta) : 0;
    const mm = s.mmr[0];
    const right = [[pctTxt(s.winRate), t('d.st.winrate').toLowerCase(), P.text]];
    if (showMmr) right.push([`${s.mmrApprox ? '≈ ' : ''}${signed(d)}`, mm && mm.end != null ? `MMR · ${num(mm.end)}` : 'MMR', d > 0 ? P.win : d < 0 ? P.loss : P.text]);
    const room = x1 - 44 - (x + 40);
    let size = 60;
    const width = (sz) => {
      g.font = `700 ${sz}px ${NUM}`;
      return right.reduce((w, [v]) => w + g.measureText(v).width, 0) + (right.length - 1) * 48;
    };
    while (size > 34 && width(size) > room) size -= 2;
    let rx = x1 - 44;
    for (const [v, label, color] of [...right].reverse()) {
      const w = text(v, rx, 316, `700 ${size}px ${NUM}`, color, 'right');
      text(label, rx, 352, `500 22px ${UI}`, P.muted, 'right');
      rx -= w + 48;
    }

    // tuiles
    const tiles = [
      [t('d.st.cardBest'), String(s.bestWinStreak)],
      [t('d.st.cardOt'), `${s.otWins}-${s.otLosses}`],
      ['MVP', String(s.mvps)],
      [t('d.st.cardGas'), `${o.myGoals} · ${o.myAssists} · ${o.mySaves}`],
    ];
    const tw = (x1 - 44 - 80 - 3 * 16) / 4;
    tiles.forEach(([k, v], i) => {
      const tx = 80 + i * (tw + 16);
      rr(tx, 392, tw, 92, 14);
      g.fillStyle = P.well;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = P.line;
      g.stroke();
      text(k, tx + 18, 424, `500 18px ${UI}`, P.muted);
      text(v, tx + 18, 466, `600 28px ${NUM}`, P.text);
    });

    // les parties, dans l'ordre
    const res = o.results.slice(-22);
    res.forEach((m, i) => {
      const px = 80 + i * 32;
      rr(px, 514, 26, 38, 7);
      g.fillStyle = m.r === 'W' ? P.win : P.loss;
      g.globalAlpha = m.ab ? 0.5 : 1;
      g.fill();
      if (m.ot) {
        g.fillStyle = P.ot;
        rr(px, 514, 26, 6, [7, 7, 0, 0]);
        g.fill();
      }
      text(m.r === 'W' ? R.LW() : R.LL(), px + 13, 541, `700 16px ${UI}`, m.r === 'W' ? P.onWin : P.onLoss, 'center');
      g.globalAlpha = 1;
    });
    text('github.com/MaximeKwk/rl-ui', x1 - 44, 542, `500 17px ${UI}`, P.faint, 'right');
  }

  function openShare() {
    if (!detail) return;
    $('#shareModal').classList.remove('hidden');
    drawCard();
    $('#shareCopy').focus();
  }
  const closeShare = () => {
    $('#shareModal').classList.add('hidden');
    const b = $('#stShare');
    if (b) b.focus();
  };
  const cardBlob = () => new Promise((resolve) => $('#shareCanvas').toBlob(resolve, 'image/png'));
  const cardName = () => {
    const d = new Date(detail.summary.startedAt);
    return `rl-ui-session-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.png`;
  };

  // ------------------------------------------------------------------ événements
  $('#stTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sttab]');
    if (b) showTab(b.dataset.sttab);
  });
  $('#stRange').addEventListener('click', (e) => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    range = b.dataset.range;
    try {
      localStorage.setItem('rlui-strange', range);
    } catch {}
    $$('#stRange button').forEach((x) => x.classList.toggle('on', x === b));
    loadOverview();
  });
  $('#stMode').addEventListener('change', (e) => {
    mode = e.target.value;
    loadOverview();
  });
  $('#stMmrMode').addEventListener('change', (e) => {
    mmrPick = e.target.value;
    renderMmr();
  });
  // une barre « par mode » sert aussi de filtre (un second clic revient à tous les modes)
  $('#stModes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-stmode]');
    if (!b) return;
    mode = mode === b.dataset.stmode ? 'all' : b.dataset.stmode;
    loadOverview();
  });
  $('#stSessList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sid]');
    if (!b || b.dataset.sid === picked) return;
    picked = b.dataset.sid;
    cmp = 'prev';
    renderSessList();
    loadDetail();
  });
  $('#stSessDetail').addEventListener('change', (e) => {
    if (e.target.id !== 'stCompare') return;
    cmp = e.target.value;
    renderDetail();
  });
  $('#stSessDetail').addEventListener('click', (e) => {
    if (e.target.closest('#stShare')) openShare();
  });
  $('#shareClose').addEventListener('click', closeShare);
  $('#shareModal').addEventListener('click', (e) => {
    if (e.target.id === 'shareModal') closeShare();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#shareModal').classList.contains('hidden')) closeShare();
  });
  $('#shareName').addEventListener('change', drawCard);
  $('#shareMmr').addEventListener('change', drawCard);
  $('#shareLook').addEventListener('click', (e) => {
    const b = e.target.closest('[data-look]');
    if (!b) return;
    look = b.dataset.look;
    $$('#shareLook button').forEach((x) => x.classList.toggle('on', x === b));
    drawCard();
  });
  $('#shareCopy').addEventListener('click', async () => {
    try {
      const blob = await cardBlob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast(t('d.st.copied'), 'ok');
    } catch {
      toast(t('d.st.copyFail'), 'err');
    }
  });
  $('#shareSave').addEventListener('click', async () => {
    const blob = await cardBlob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = cardName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  // la courbe est dessinée à la largeur de sa carte : on la refait si la fenêtre change
  let rz = null;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (visible() && tab === 'overview' && stats && stats.overview.played) renderMmr();
    }, 150);
  });

  R.stats = {
    // la page devient visible
    show() {
      showTab(tab);
    },
    // ouvrir directement un sous-onglet (depuis l'accueil : le bilan de la session en cours)
    open(name) {
      tab = name;
      if (name === 'sessions') {
        picked = null; // la plus récente = la session en cours
        stale.sessions = true;
      }
    },
    // des parties ont bougé : tout est à relire (tout de suite si la page est à l'écran)
    dirty() {
      stale.overview = stale.sessions = true;
      refresh();
    },
  };
  if (visible()) R.stats.show();
})();
