'use strict';
// Statistiques : vue d'ensemble, séries, sessions comparables, évolution du MMR, export.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../core/store');
const { MmrTracker } = require('../core/mmr');
const insights = require('../core/insights');

const ACC = 'Steam|76561190000000002|0';
const tmpDirs = [];
const stores = [];
test.after(() => {
  for (const st of stores) st.flush();
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const T0 = Date.UTC(2026, 8, 1, 18, 0, 0);
const MIN = 60e3;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-ins-'));
  tmpDirs.push(dir);
  const store = new Store(dir);
  stores.push(store);
  store.session.startedAt = T0;
  const mmr = new MmrTracker(store);
  let n = 0;
  let t = T0;
  // une partie : résultat 'W' | 'L', options { sf, sa, ot, ab, pl, me, gap (minutes avant la partie) }
  const add = (result, o = {}) => {
    t += (o.gap != null ? o.gap : 2) * MIN + 6 * MIN;
    const sf = o.sf != null ? o.sf : result === 'W' ? 3 : 1;
    const sa = o.sa != null ? o.sa : result === 'W' ? 1 : 2;
    const r = store.addMatch({
      id: `m${++n}`,
      startedAt: t - 6 * MIN,
      endedAt: t,
      durationSec: 360,
      result,
      overtime: !!o.ot,
      abandon: !!o.ab,
      scoreFor: sf,
      scoreAgainst: sa,
      playlistId: o.pl != null ? o.pl : 11,
      category: 'ranked',
      ranked: true,
      mvp: !!o.mvp,
      me: { id: ACC, name: 'Nitro_42', goals: o.goals != null ? o.goals : 1, assists: 1, saves: 2, shots: 4, score: 300 },
    });
    mmr.onMatch(r);
    return r;
  };
  const newSession = (gapHours = 20) => {
    t += gapHours * 3600e3;
    const s = store.newSession();
    s.startedAt = t;
    return s;
  };
  const sample = (value, playlist = 11) => {
    t += 30e3;
    mmr.onSample({ accountId: ACC, playlist, mmr: value, mu: (value - 100) / 20, at: t });
  };
  return { store, mmr, add, newSession, sample, now: () => t };
}

test('vue d\'ensemble : bilan, moyennes par partie, après une victoire / une défaite', () => {
  const { store, add } = setup();
  for (const r of ['W', 'W', 'L', 'W', 'L', 'L']) add(r);
  const o = insights.overview(store.data.matches);
  assert.strictEqual(o.wins, 3);
  assert.strictEqual(o.losses, 3);
  assert.strictEqual(o.winRate, 50);
  assert.strictEqual(o.bestWinStreak, 2);
  assert.strictEqual(o.worstLossStreak, 2);
  assert.strictEqual(o.streak, -2);
  assert.strictEqual(o.perMatch.goals, 1);
  assert.strictEqual(o.perMatch.saves, 2);
  assert.strictEqual(o.shotPct, 25);
  // après une victoire : W→W, W→L, W→L = 1 sur 3 ; après une défaite : L→W, L→L = 1 sur 2
  assert.deepStrictEqual([o.afterWin.played, o.afterWin.wins, o.afterWin.winRate], [3, 1, 33]);
  assert.deepStrictEqual([o.afterLoss.played, o.afterLoss.wins, o.afterLoss.winRate], [2, 1, 50]);
  assert.strictEqual(o.bestWin.n, 2);
  assert.strictEqual(o.worstLoss.n, 2);
  assert.strictEqual(o.results.length, 6);
  assert.strictEqual(o.results[5].r, 'L');
});

test('vue d\'ensemble : parties serrées, larges, prolongations', () => {
  const { store, add } = setup();
  add('W', { sf: 2, sa: 1 });
  add('W', { sf: 5, sa: 1 });
  add('L', { sf: 1, sa: 2, ot: true });
  add('L', { sf: 0, sa: 4 });
  add('L', { sf: 0, sa: 1, ab: true }); // une partie quittée n'est ni serrée ni large
  const o = insights.overview(store.data.matches);
  assert.deepStrictEqual([o.close.played, o.close.wins, o.close.winRate], [2, 1, 50]);
  assert.deepStrictEqual([o.wide.played, o.wide.wins], [2, 1]);
  assert.deepStrictEqual([o.overtime.played, o.overtime.wins, o.overtime.winRate], [1, 0, 0]);
  assert.strictEqual(o.goalDiff, 8 - 9);
});

test('au fil de la session : le rang de la partie repart à 1 à chaque session', () => {
  const { store, add, newSession } = setup();
  for (const r of ['W', 'W', 'W', 'L', 'L']) add(r);
  newSession();
  for (const r of ['L', 'W', 'W', 'L']) add(r);
  const o = insights.overview(store.data.matches);
  // parties 1 à 3 : WWW + LWW = 5 victoires sur 6 ; parties 4 à 6 : LL + L = 0 sur 3
  assert.deepStrictEqual([o.byPosition[0].played, o.byPosition[0].wins, o.byPosition[0].winRate], [6, 5, 83]);
  assert.deepStrictEqual([o.byPosition[1].played, o.byPosition[1].wins], [3, 0]);
  assert.strictEqual(o.byPosition[3].played, 0);
  assert.strictEqual(o.byPosition[3].winRate, null);
  // « après une victoire » ne saute pas d'une session à l'autre : la paire L (fin) → L (début) n'est pas comptée
  assert.strictEqual(o.afterLoss.played, 2);
});

test('sélection par période et par mode', () => {
  const { store, add, newSession, now } = setup();
  add('W');
  add('L', { pl: 13 });
  newSession(24 * 10);
  add('W');
  add('W', { pl: 13 });
  const all = insights.select(store, { range: 'all', now: now() });
  assert.strictEqual(all.list.length, 4);
  assert.deepStrictEqual(all.modes.map((m) => [m.key, m.played]), [['11', 2], ['13', 2]]);
  assert.strictEqual(all.modes[0].name, '2v2 Ranked');
  const week = insights.select(store, { range: '7d', now: now() });
  assert.strictEqual(week.list.length, 2);
  const sess = insights.select(store, { range: 'session', now: now() });
  assert.strictEqual(sess.list.length, 2);
  const threes = insights.select(store, { range: 'all', mode: '13', now: now() });
  assert.deepStrictEqual(threes.list.map((m) => m.result), ['L', 'W']);
  assert.strictEqual(threes.modes.length, 2, 'la liste des modes reste complète quand on filtre');
});

test('sessions : résumés du plus récent au plus ancien, et « ma moyenne »', () => {
  const { store, add, newSession, sample } = setup();
  sample(1000);
  for (const r of ['W', 'W', 'L']) add(r);
  sample(1012);
  newSession();
  for (const r of ['L', 'L', 'L', 'W']) add(r, { goals: 2 });
  sample(990);
  newSession(); // session vide : elle n'apparaît pas
  const r = insights.sessions(store);
  assert.strictEqual(r.total, 2);
  const [b, a] = r.sessions;
  assert.deepStrictEqual([a.played, a.wins, a.losses, a.winRate, a.bestWinStreak], [3, 2, 1, 67, 2]);
  assert.deepStrictEqual([b.played, b.wins, b.losses, b.winRate, b.worstLossStreak], [4, 1, 3, 25, 3]);
  assert.strictEqual(Math.round(a.mmrDelta), 12, 'variation réelle répartie sur les parties');
  assert.strictEqual(Math.round(b.mmrDelta), -22);
  assert.strictEqual(a.mmrApprox, false);
  assert.strictEqual(b.goals, 2);
  assert.strictEqual(a.mode, '2v2 Ranked');
  assert.strictEqual(a.timePlayedSec, 3 * 360);
  assert.ok(b.startedAt > a.endedAt);
  const avg = r.average;
  assert.strictEqual(avg.sessions, 2);
  assert.strictEqual(avg.played, 3.5);
  assert.strictEqual(avg.winRate, 43, '3 victoires sur 7');
  assert.strictEqual(Math.round(avg.mmrDelta), -5);
});

test('détail d\'une session', () => {
  const { store, add } = setup();
  for (const r of ['W', 'L', 'W']) add(r);
  const d = insights.sessionDetail(store, store.data.currentSessionId);
  assert.strictEqual(d.summary.current, true);
  assert.strictEqual(d.summary.played, 3);
  assert.strictEqual(d.overview.results.length, 3);
  assert.strictEqual(d.modes[0].played, 3);
  assert.strictEqual(insights.sessionDetail(store, 'nope'), null);
});

test('évolution du MMR : vraies valeurs + valeur après chaque partie, estimation marquée', () => {
  const { store, mmr, add, sample, now } = setup();
  sample(1000);
  add('W');
  sample(1015);
  add('L');
  sample(1004);
  add('W'); // pas encore de vraie valeur : estimation
  const [s] = insights.mmrSeries(store, mmr, { accountId: ACC, now: now() });
  assert.strictEqual(s.name, '2v2 Ranked');
  assert.strictEqual(s.start, 1000);
  assert.strictEqual(s.points[0].mmr, 1000);
  const last = s.points[s.points.length - 1];
  assert.strictEqual(last.approx, true);
  assert.strictEqual(s.currentApprox, true);
  assert.ok(s.current > 1004);
  assert.strictEqual(s.max >= 1015, true);
  assert.strictEqual(s.delta, s.current - 1000);
  for (let i = 1; i < s.points.length; i++) assert.ok(s.points[i].at >= s.points[i - 1].at, 'ordre chronologique');
  // un autre compte : rien
  assert.strictEqual(insights.mmrSeries(store, mmr, { accountId: 'Epic|x|0', now: now() }).length, 0);
});

test('évolution du MMR : la période garde le point de départ d\'avant', () => {
  const { store, mmr, add, sample, newSession, now } = setup();
  sample(900);
  add('W');
  sample(915);
  newSession(24 * 20);
  add('W');
  sample(930);
  const [s] = insights.mmrSeries(store, mmr, { accountId: ACC, range: '7d', now: now() });
  assert.strictEqual(s.start, 915, 'valeur connue juste avant la période');
  assert.strictEqual(s.delta, 15);
  assert.ok(s.points.every((p) => p.at >= now() - 7 * 24 * 3600e3));
});

test('export CSV : en-tête, une ligne par partie, cellules protégées', () => {
  const { store, add } = setup();
  add('W', { ot: true });
  const r = add('L');
  r.arena = '=HYPERLINK("http://x")';
  const text = insights.csv(store.data.matches);
  const lines = text.replace(/^﻿/, '').trim().split('\r\n');
  assert.strictEqual(lines.length, 3);
  assert.ok(lines[0].startsWith('date,result,overtime'));
  assert.ok(lines[1].includes(',W,1,0,3,1,2v2 Ranked,1,'));
  assert.ok(lines[2].includes('"\'=HYPERLINK(""http://x"")"'), 'pas de formule exécutable dans un tableur');
});
