'use strict';
// Statistiques au-delà du compteur : bilans de session, séries, comparaison de sessions, évolution du MMR.
// Tout se calcule à partir des parties déjà gardées sur ce PC (rien n'est envoyé nulle part).

const { computeStats } = require('./stats');
const { describePlaylist, playlistLabel } = require('./playlists');

const DAY = 24 * 3600e3;
const RANGES = { '7d': 7 * DAY, '30d': 30 * DAY, '90d': 90 * DAY };
const round1 = (n) => Math.round(n * 10) / 10;
const pct = (w, n) => (n ? Math.round((w / n) * 100) : null);

// Clé d'un mode : l'identifiant de playlist quand il est connu, sinon la catégorie (saisie manuelle, hors-ligne…)
function modeKey(r) {
  if (r.manual) return 'manual';
  return r.playlistId != null ? String(r.playlistId) : `cat:${r.category || 'unknown'}`;
}

// Sélection des parties : période (session | 7d | 30d | 90d | all) puis mode.
function select(store, { range = 'session', mode = 'all', now = Date.now() } = {}) {
  let list;
  if (range === 'session') list = store.sessionMatches();
  else if (RANGES[range]) list = store.data.matches.filter((m) => m.endedAt >= now - RANGES[range]);
  else list = store.data.matches;
  const modes = modesOf(list);
  if (mode && mode !== 'all') list = list.filter((m) => modeKey(m) === String(mode));
  return { list, modes };
}

function modesOf(list) {
  const map = new Map();
  for (const m of list) {
    const k = modeKey(m);
    const e = map.get(k) || { key: k, name: playlistLabel(m), played: 0, wins: 0, losses: 0 };
    e.played++;
    if (m.result === 'W') e.wins++;
    else e.losses++;
    map.set(k, e);
  }
  return [...map.values()].map((e) => ({ ...e, winRate: pct(e.wins, e.played) })).sort((a, b) => b.played - a.played);
}

// Rang de chaque partie dans sa session (1 = première partie de la session)
function positions(list) {
  const seen = new Map();
  return list.map((m) => {
    const n = (seen.get(m.sessionId) || 0) + 1;
    seen.set(m.sessionId, n);
    return n;
  });
}

const BUCKETS = [
  [1, 3],
  [4, 6],
  [7, 10],
  [11, Infinity],
];

// Séries de résultats, dans l'ordre : [{ result, n, from, to }]
function streaks(list) {
  const out = [];
  for (const m of list) {
    const last = out[out.length - 1];
    if (last && last.result === m.result) {
      last.n++;
      last.to = m.endedAt;
    } else out.push({ result: m.result, n: 1, from: m.endedAt, to: m.endedAt });
  }
  return out;
}

// Vue d'ensemble d'une liste de parties (dans l'ordre chronologique)
function overview(list) {
  const st = computeStats(list);
  delete st.last;
  const withMe = list.filter((m) => m.me);
  const avg = (f) => (withMe.length ? round1(withMe.reduce((s, m) => s + (m.me[f] || 0), 0) / withMe.length) : null);
  const scored = list.filter((m) => Number.isFinite(m.scoreFor) && !m.manual);

  // après une victoire / après une défaite (dans la même session)
  const after = { W: { played: 0, wins: 0 }, L: { played: 0, wins: 0 } };
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    if (prev.sessionId !== list[i].sessionId) continue;
    after[prev.result].played++;
    if (list[i].result === 'W') after[prev.result].wins++;
  }

  // parties serrées (un but d'écart) et larges (trois buts ou plus)
  const close = scored.filter((m) => Math.abs(m.scoreFor - m.scoreAgainst) === 1 && !m.abandon);
  const wide = scored.filter((m) => Math.abs(m.scoreFor - m.scoreAgainst) >= 3 && !m.abandon);
  const wl = (rs) => ({ played: rs.length, wins: rs.filter((m) => m.result === 'W').length, winRate: pct(rs.filter((m) => m.result === 'W').length, rs.length) });

  // au fil de la session : est-ce que ça baisse après beaucoup de parties ?
  const pos = positions(list);
  const byPosition = BUCKETS.map(([a, b]) => {
    const rs = list.filter((m, i) => pos[i] >= a && pos[i] <= b);
    return { from: a, to: Number.isFinite(b) ? b : null, ...wl(rs) };
  });

  const runs = streaks(list);
  const best = (r) => runs.filter((s) => s.result === r).sort((x, y) => y.n - x.n || y.to - x.to)[0] || null;

  return {
    ...st,
    firstAt: list.length ? list[0].endedAt : null,
    lastAt: list.length ? list[list.length - 1].endedAt : null,
    goalDiff: st.goalsFor - st.goalsAgainst,
    perMatch: { goals: avg('goals'), assists: avg('assists'), saves: avg('saves'), shots: avg('shots'), score: avg('score') },
    shotPct: st.myShots ? Math.round((st.myGoals / st.myShots) * 100) : null,
    afterWin: { ...after.W, winRate: pct(after.W.wins, after.W.played) },
    afterLoss: { ...after.L, winRate: pct(after.L.wins, after.L.played) },
    close: wl(close),
    wide: wl(wide),
    overtime: { played: st.otWins + st.otLosses, wins: st.otWins, winRate: pct(st.otWins, st.otWins + st.otLosses) },
    byPosition,
    bestWin: best('W'),
    worstLoss: best('L'),
    results: list.slice(-60).map((m) => ({ r: m.result, ot: !!m.overtime, ab: !!m.abandon, at: m.endedAt, s: Number.isFinite(m.scoreFor) && !m.manual ? `${m.scoreFor}-${m.scoreAgainst}` : '' })),
  };
}

// Variation de MMR d'une liste de parties, par mode suivi
function mmrOf(list) {
  const map = new Map();
  for (const m of list) {
    if (!m.mmr || !m.mmr.key) continue;
    const e = map.get(m.mmr.key) || { key: m.mmr.key, playlist: m.mmr.playlist, name: describePlaylist(m.mmr.playlist).name, delta: 0, games: 0, approx: false, start: null, end: null };
    if (e.start == null && m.mmr.before != null) e.start = m.mmr.before;
    if (m.mmr.after != null) e.end = m.mmr.after;
    e.delta += m.mmr.delta || 0;
    e.games++;
    if (m.mmr.status !== 'exact' && m.mmr.status !== 'grouped') e.approx = true;
    map.set(m.mmr.key, e);
  }
  return [...map.values()].map((e) => ({ ...e, delta: round1(e.delta), start: e.start != null ? Math.round(e.start) : null, end: e.end != null ? Math.round(e.end) : null })).sort((a, b) => b.games - a.games);
}

// Résumé d'une session (une ligne de la liste, et la base des comparaisons)
function sessionSummary(session, list) {
  const st = computeStats(list);
  const withMe = list.filter((m) => m.me);
  const per = (f) => (withMe.length ? round1(withMe.reduce((s, m) => s + (m.me[f] || 0), 0) / withMe.length) : null);
  const mmr = mmrOf(list);
  const modes = modesOf(list);
  return {
    id: session.id,
    startedAt: list.length ? Math.min(session.startedAt, list[0].startedAt || list[0].endedAt) : session.startedAt,
    endedAt: list.length ? list[list.length - 1].endedAt : session.startedAt,
    played: st.played,
    wins: st.wins,
    losses: st.losses,
    winRate: st.played ? st.winRate : null,
    bestWinStreak: st.bestWinStreak,
    worstLossStreak: st.worstLossStreak,
    otWins: st.otWins,
    otLosses: st.otLosses,
    mvps: st.mvps,
    goalsFor: st.goalsFor,
    goalsAgainst: st.goalsAgainst,
    goals: per('goals'),
    assists: per('assists'),
    saves: per('saves'),
    shots: per('shots'),
    timePlayedSec: st.timePlayedSec,
    mmrDelta: mmr.length ? round1(mmr.reduce((s, e) => s + e.delta, 0)) : null,
    mmrApprox: mmr.some((e) => e.approx),
    mmr,
    mode: modes.length ? modes[0].name : '',
    modes: modes.length,
  };
}

// Sessions qui ont au moins une partie, de la plus récente à la plus ancienne
function sessions(store, { limit = 100 } = {}) {
  const by = new Map();
  for (const m of store.data.matches) {
    if (!by.has(m.sessionId)) by.set(m.sessionId, []);
    by.get(m.sessionId).push(m);
  }
  const known = new Map(store.data.sessions.map((s) => [s.id, s]));
  const out = [];
  for (const [id, list] of by) {
    // (les très vieilles sessions ne sont plus dans la liste : leurs parties suffisent à les décrire)
    const sess = known.get(id) || { id, startedAt: list[0].startedAt || list[0].endedAt };
    out.push(sessionSummary(sess, list));
  }
  out.sort((a, b) => b.endedAt - a.endedAt);
  const cur = store.data.currentSessionId;
  return { current: cur, total: out.length, sessions: out.slice(0, limit).map((s) => ({ ...s, current: s.id === cur })), average: average(out) };
}

// « Ma moyenne » : la session type, sur toutes les sessions jouées
function average(list) {
  const n = list.length;
  if (!n) return null;
  const mean = (f, only = () => true) => {
    const vs = list.filter(only).map((s) => s[f]).filter((v) => v != null);
    return vs.length ? round1(vs.reduce((a, b) => a + b, 0) / vs.length) : null;
  };
  const wins = list.reduce((s, x) => s + x.wins, 0);
  const played = list.reduce((s, x) => s + x.played, 0);
  return {
    id: 'average',
    sessions: n,
    played: mean('played'),
    wins: mean('wins'),
    losses: mean('losses'),
    winRate: pct(wins, played),
    bestWinStreak: mean('bestWinStreak'),
    worstLossStreak: mean('worstLossStreak'),
    mvps: mean('mvps'),
    goals: mean('goals'),
    assists: mean('assists'),
    saves: mean('saves'),
    shots: mean('shots'),
    timePlayedSec: Math.round(mean('timePlayedSec') || 0),
    mmrDelta: mean('mmrDelta'),
  };
}

function sessionDetail(store, id) {
  const list = store.data.matches.filter((m) => m.sessionId === id);
  if (!list.length) return null;
  const sess = store.data.sessions.find((s) => s.id === id) || { id, startedAt: list[0].startedAt || list[0].endedAt };
  const named = [...list].reverse().find((m) => m.me && m.me.name);
  return { summary: { ...sessionSummary(sess, list), current: id === store.data.currentSessionId }, overview: overview(list), modes: modesOf(list), player: named ? named.me.name : '' };
}

// ---------------------------------------------------------------- évolution du MMR
// Une courbe par mode suivi : les vraies valeurs lues dans le journal du jeu, complétées par la valeur
// après chaque partie quand elle est connue (approx = estimation en attente de la vraie valeur).
function mmrSeries(store, mmr, { accountId = null, range = 'all', now = Date.now(), maxPoints = 400 } = {}) {
  // (session = depuis le début de la session en cours)
  const from = range === 'session' ? store.session.startedAt : RANGES[range] ? now - RANGES[range] : 0;
  const accountOf = (key) => String(key).slice(0, String(key).lastIndexOf('|'));
  const keys = new Map();
  const push = (key, playlist, p) => {
    if (accountId && accountOf(key) !== accountId) return;
    if (!mmr.tracks(playlist)) return;
    if (!keys.has(key)) keys.set(key, { key, playlist, name: describePlaylist(playlist).name, points: [] });
    keys.get(key).points.push(p);
  };
  for (const s of mmr.d.samples) push(s.key, s.playlist, { at: s.at, mmr: round1(s.mmr), real: true });
  for (const m of store.data.matches) {
    if (!m.mmr || !m.mmr.key || m.mmr.after == null) continue;
    const sure = m.mmr.status === 'exact' || m.mmr.status === 'grouped';
    push(m.mmr.key, m.mmr.playlist, { at: m.endedAt, mmr: round1(m.mmr.after), real: sure, approx: !sure, result: m.result });
  }
  const out = [];
  for (const s of keys.values()) {
    s.points.sort((a, b) => a.at - b.at);
    const all = s.points;
    let pts = all.filter((p) => p.at >= from);
    if (!pts.length) continue;
    // le point juste avant la période sert de départ : la variation affichée couvre toute la période
    const before = all.filter((p) => p.at < from).pop();
    const start = before ? before.mmr : pts[0].mmr;
    if (pts.length > maxPoints) {
      const step = pts.length / maxPoints;
      pts = Array.from({ length: maxPoints }, (_, i) => pts[Math.min(pts.length - 1, Math.round(i * step))]).concat(pts[pts.length - 1]);
    }
    const vals = pts.map((p) => p.mmr);
    const cur = mmr.current(s.key);
    out.push({
      key: s.key,
      playlist: s.playlist,
      name: s.name,
      points: pts,
      start: Math.round(start),
      current: cur ? Math.round(cur.value) : Math.round(vals[vals.length - 1]),
      currentApprox: !!(cur && cur.pending),
      min: Math.round(Math.min(...vals)),
      max: Math.round(Math.max(...vals)),
      peakAt: pts[vals.indexOf(Math.max(...vals))].at,
      delta: Math.round((cur ? cur.value : vals[vals.length - 1]) - start),
    });
  }
  return out.sort((a, b) => b.points[b.points.length - 1].at - a.points[a.points.length - 1].at);
}

// ---------------------------------------------------------------- export
function csv(list) {
  const cols = ['date', 'result', 'overtime', 'left', 'score_for', 'score_against', 'mode', 'ranked', 'arena', 'duration_sec', 'mvp', 'goals', 'assists', 'saves', 'shots', 'mmr_change', 'mmr_after', 'mmr_status'];
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    // (un tableur ne doit jamais prendre une cellule pour une formule)
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = list.map((m) =>
    [
      new Date(m.endedAt).toISOString(),
      m.result,
      m.overtime ? 1 : 0,
      m.abandon ? 1 : 0,
      m.manual ? '' : m.scoreFor,
      m.manual ? '' : m.scoreAgainst,
      playlistLabel(m),
      m.ranked ? 1 : 0,
      m.arena || '',
      m.durationSec || '',
      m.mvp ? 1 : 0,
      m.me ? m.me.goals : '',
      m.me ? m.me.assists : '',
      m.me ? m.me.saves : '',
      m.me ? m.me.shots : '',
      m.mmr ? m.mmr.delta : '',
      m.mmr && m.mmr.after != null ? m.mmr.after : '',
      m.mmr ? m.mmr.status : '',
    ]
      .map(esc)
      .join(',')
  );
  return `﻿${cols.join(',')}\r\n${rows.join('\r\n')}\r\n`;
}

module.exports = { select, overview, modesOf, modeKey, streaks, mmrOf, sessions, sessionDetail, sessionSummary, average, mmrSeries, csv };
