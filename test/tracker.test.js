'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../core/store');
const { Tracker } = require('../core/tracker');
const { computeStats } = require('../core/stats');
const { buildScenario, DEFAULT_ME } = require('../tools/scenarios');

const tmpDirs = [];
const stores = [];
test.after(() => {
  for (const st of stores) st.flush();
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function setup({ account = DEFAULT_ME, playlist = 11, settings = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-test-'));
  tmpDirs.push(dir);
  const store = new Store(dir);
  stores.push(store);
  store.patchSettings(settings);
  let clock = 1_000_000;
  const logWatcher = {
    account: account ? { ...account, platform: 'Steam' } : null,
    playlistFor: () => playlist,
  };
  const tracker = new Tracker({ store, logWatcher, now: () => clock });
  const out = { results: [], overtimes: [], goals: [], logs: [] };
  tracker.on('result', (r) => out.results.push(r));
  tracker.on('overtime', (o) => out.overtimes.push(o));
  tracker.on('goal', (g) => out.goals.push(g));
  tracker.on('log', (l) => out.logs.push(l));
  const play = (sc) => {
    const base = clock;
    for (const e of sc.events) {
      clock = base + e.t * 1000;
      tracker.handle(e.event, JSON.parse(JSON.stringify(e.data)));
    }
    clock += 1000;
  };
  return { store, tracker, out, play, advance: (ms) => (clock += ms) };
}

test('victoire classique 3-1', () => {
  const { out, play, store } = setup();
  play(buildScenario('win'));
  assert.strictEqual(out.results.length, 1);
  const r = out.results[0];
  assert.strictEqual(r.result, 'W');
  assert.strictEqual(r.overtime, false);
  assert.strictEqual(r.scoreFor, 3);
  assert.strictEqual(r.scoreAgainst, 1);
  assert.strictEqual(r.playlistName, '2v2 Ranked');
  assert.strictEqual(r.identity, 'account');
  assert.strictEqual(out.overtimes.length, 0);
  assert.strictEqual(computeStats(store.sessionMatches()).wins, 1);
});

test('équipe orange : le résultat suit mon équipe', () => {
  const { out, play } = setup();
  play(buildScenario('loss', { myTeam: 1 }));
  assert.strictEqual(out.results.length, 1);
  // Les buts du scénario sont donnés pour l'équipe 0/1 : équipe orange = inversé
  const r = out.results[0];
  assert.strictEqual(r.myTeam, 1);
  assert.strictEqual(r.result, 'W'); // l'équipe 1 gagne 2-1 dans ce scénario
  assert.strictEqual(r.scoreFor, 2);
  assert.strictEqual(r.scoreAgainst, 1);
});

test('défaite 1-2', () => {
  const { out, play } = setup();
  play(buildScenario('loss'));
  assert.strictEqual(out.results[0].result, 'L');
  assert.strictEqual(out.results[0].scoreFor, 1);
  assert.strictEqual(out.results[0].scoreAgainst, 2);
});

test('victoire en overtime : alerte OT puis résultat OT', () => {
  const { out, play } = setup();
  play(buildScenario('otwin'));
  assert.strictEqual(out.overtimes.length, 1, 'une alerte overtime');
  assert.strictEqual(out.results.length, 1);
  const r = out.results[0];
  assert.strictEqual(r.result, 'W');
  assert.strictEqual(r.overtime, true);
  assert.strictEqual(r.scoreFor, 3);
  assert.strictEqual(r.scoreAgainst, 2);
  assert.ok(r.otSeconds >= 30, `durée OT ${r.otSeconds}`);
});

test('défaite en overtime', () => {
  const { out, play } = setup();
  play(buildScenario('otloss'));
  assert.strictEqual(out.overtimes.length, 1);
  assert.strictEqual(out.results[0].result, 'L');
  assert.strictEqual(out.results[0].overtime, true);
  assert.strictEqual(out.results[0].scoreAgainst, 2);
});

test('abandon en classé = défaite (réglage par défaut)', () => {
  const { out, play } = setup();
  play(buildScenario('abandon'));
  assert.strictEqual(out.results.length, 1);
  assert.strictEqual(out.results[0].result, 'L');
  assert.strictEqual(out.results[0].abandon, true);
});

test('abandon en occasionnel non compté (réglage par défaut)', () => {
  const { out, play } = setup({ playlist: 2 });
  play(buildScenario('abandon'));
  assert.strictEqual(out.results.length, 0);
});

test('abandon compté si "toujours"', () => {
  const { out, play } = setup({ playlist: 2, settings: { abandonAsLoss: 'always' } });
  play(buildScenario('abandon'));
  assert.strictEqual(out.results.length, 1);
  assert.strictEqual(out.results[0].abandon, true);
});

test('forfait adverse = victoire', () => {
  const { out, play } = setup();
  play(buildScenario('ffwin'));
  assert.strictEqual(out.results.length, 1);
  assert.strictEqual(out.results[0].result, 'W');
});

test('spectateur : rien n\'est compté', () => {
  const { out, play, tracker } = setup({ playlist: 6, settings: { counting: { private: true } } });
  play(buildScenario('spectate'));
  assert.strictEqual(out.results.length, 0);
  assert.strictEqual(out.overtimes.length, 0);
  assert.strictEqual(tracker.live().inMatch, false);
});

test('partie privée ignorée par défaut', () => {
  const { out, play } = setup({ playlist: 6 });
  play(buildScenario('otwin'));
  assert.strictEqual(out.results.length, 0);
  assert.strictEqual(out.overtimes.length, 0);
});

test('hors-ligne (pas de MatchGuid, pas de playlist) ignoré par défaut', () => {
  const { out, play } = setup({ playlist: null });
  play(buildScenario('win', { guid: null }));
  assert.strictEqual(out.results.length, 0);
});

test('pas de double comptage si MatchEnded est rejoué', () => {
  const { out, play, tracker } = setup();
  const sc = buildScenario('win');
  play(sc);
  tracker.handle('MatchEnded', { MatchGuid: sc.guid, WinnerTeamNum: 0 });
  play(sc);
  assert.strictEqual(out.results.length, 1);
});

test('identification par pseudo quand le log est indisponible', () => {
  const { out, play } = setup({ account: null, settings: { identity: { names: ['zoxam'] } } });
  play(buildScenario('win'));
  assert.strictEqual(out.results.length, 1);
  assert.strictEqual(out.results[0].identity, 'name');
});

test('identification par la caméra (Target) en dernier recours', () => {
  const { out, play, store } = setup({ account: null });
  play(buildScenario('win'));
  assert.strictEqual(out.results.length, 1);
  assert.strictEqual(out.results[0].identity, 'camera');
  assert.strictEqual(store.settings.identity.knownIds.length, 0, 'la caméra ne mémorise pas');
});

test('identité inconnue : résultat en attente puis choix manuel', () => {
  const { out, tracker, store } = setup({ account: null, settings: { identity: { useCameraTarget: false } } });
  const sc = buildScenario('otwin');
  let clock = 0;
  for (const e of sc.events) {
    if (e.event === 'MatchDestroyed') break;
    tracker.handle(e.event, JSON.parse(JSON.stringify(e.data)));
    clock++;
  }
  assert.strictEqual(out.results.length, 0);
  const live = tracker.live();
  assert.strictEqual(live.needsIdentity, true);
  const me = live.players.find((p) => p.name === 'Zoxam');
  tracker.setIdentity(me.key);
  assert.strictEqual(out.results.length, 1);
  assert.strictEqual(out.results[0].identity, 'manual');
  assert.ok(store.settings.identity.knownIds.includes(DEFAULT_ME.id), 'id mémorisé');
});

test('le but en or est pris en compte même si MatchEnded arrive avant UpdateState', () => {
  const { out, play } = setup();
  play(buildScenario('quickot'));
  assert.strictEqual(out.results[0].scoreFor, 1);
  assert.strictEqual(out.results[0].scoreAgainst, 0);
  assert.strictEqual(out.results[0].overtime, true);
});

test('MVP calculé', () => {
  const { out, play } = setup();
  play(buildScenario('win', { teamSize: 1 }));
  assert.strictEqual(out.results[0].mvp, true);
});

test('pause : rien n\'est compté', () => {
  const { out, play } = setup({ settings: { paused: true } });
  play(buildScenario('otwin'));
  assert.strictEqual(out.results.length, 0);
  assert.strictEqual(out.overtimes.length, 0);
});

test('connexion en plein overtime : pas d\'alerte OT tardive', () => {
  const { out, tracker } = setup();
  tracker.handle('UpdateState', {
    MatchGuid: 'ABC',
    Players: [{ Name: 'Zoxam', PrimaryId: DEFAULT_ME.id, TeamNum: 0, Shortcut: 1, Score: 0 }],
    Game: { Teams: [{ TeamNum: 0, Score: 1, Name: 'Blue' }, { TeamNum: 1, Score: 1, Name: 'Orange' }], TimeSeconds: 74, bOvertime: true },
  });
  assert.strictEqual(out.overtimes.length, 0);
  tracker.handle('GoalScored', { MatchGuid: 'ABC', Scorer: { Name: 'X', TeamNum: 1 } });
  tracker.handle('MatchEnded', { MatchGuid: 'ABC', WinnerTeamNum: 1 });
  assert.strictEqual(out.results.length, 1);
  assert.strictEqual(out.results[0].result, 'L');
  assert.strictEqual(out.results[0].overtime, true);
  assert.strictEqual(out.results[0].scoreAgainst, 2);
});

test('série et stats de session', () => {
  const { play, store } = setup();
  for (const k of ['win', 'otwin', 'loss', 'win', 'win', 'otloss']) play(buildScenario(k));
  const s = computeStats(store.sessionMatches());
  assert.strictEqual(s.wins, 4);
  assert.strictEqual(s.losses, 2);
  assert.strictEqual(s.otWins, 1);
  assert.strictEqual(s.otLosses, 1);
  assert.strictEqual(s.bestWinStreak, 2);
  assert.strictEqual(s.streak, -1);
  assert.strictEqual(s.winRate, 67);
});

test('nouvelle session automatique après inactivité', () => {
  const { play, store, advance } = setup();
  play(buildScenario('win'));
  const first = store.data.currentSessionId;
  advance(7 * 3600e3);
  play(buildScenario('loss'));
  assert.notStrictEqual(store.data.currentSessionId, first);
  assert.strictEqual(store.sessionMatches().length, 1);
});

test('faux GoalScored de fin de replay (buteur vide) ignoré même hors replay', () => {
  const { tracker } = setup();
  const base = { MatchGuid: 'G', Players: [{ Name: 'Zoxam', PrimaryId: DEFAULT_ME.id, TeamNum: 1, Shortcut: 1 }], Game: { TimeSeconds: 100, bOvertime: true, Teams: [{ TeamNum: 0, Score: 1, Name: 'Bleu' }, { TeamNum: 1, Score: 1, Name: 'Orange' }] } };
  tracker.handle('UpdateState', base);
  tracker.handle('GoalScored', { MatchGuid: 'G', GoalSpeed: 0, GoalTime: 0, Scorer: { Name: '', Shortcut: 0, TeamNum: 0 } });
  const live = tracker.live();
  assert.strictEqual(live.teams[0].score, 1);
  assert.strictEqual(tracker.match.winnerHint, null);
});

test('PlaylistId envoyé par le jeu prioritaire sur le log', () => {
  const { out, play } = setup({ playlist: 2 });
  play(buildScenario('win', { playlistId: 13 }));
  assert.strictEqual(out.results[0].playlistName, '3v3 Ranked');
  assert.strictEqual(out.results[0].ranked, true);
});

test('partie privée détectée par PlaylistId du jeu : ignorée', () => {
  const { out, play } = setup({ playlist: null });
  play(buildScenario('otwin', { playlistId: 6 }));
  assert.strictEqual(out.results.length, 0);
  assert.strictEqual(out.overtimes.length, 0);
});

test('données réelles (format capturé sur le jeu) : UpdateState avec Target et PlaylistId', () => {
  const { tracker } = setup({ account: null, playlist: null });
  const us = {
    MatchGuid: '32BE65BE11F1BCBDC93AA89E0A64CABC',
    Players: [
      { Name: 'Nitro_42', PrimaryId: 'Steam|76561190000000002|0', Shortcut: 1, TeamNum: 0, Score: 338, Goals: 1, Shots: 1, Assists: 2, Saves: 0, Touches: 36, CarTouches: 16, Demos: 0, Loadout: ['Body_Octane'], bHasCar: true, Speed: 32.6, Boost: 17 },
      { Name: 'Coequipier', PrimaryId: 'Steam|76561190000000003|0', Shortcut: 2, TeamNum: 0, Score: 200, Goals: 2 },
      { Name: 'Adversaire', PrimaryId: 'Epic|0123456789abcdef0123456789abcdef|0', Shortcut: 5, TeamNum: 1, Score: 150, Goals: 1 },
    ],
    Game: {
      Teams: [
        { Name: 'Bleu', TeamNum: 0, Score: 3, ColorPrimary: '1873FF', ColorSecondary: 'E5E5E5' },
        { Name: 'Orange', TeamNum: 1, Score: 1, ColorPrimary: 'C26418', ColorSecondary: 'E5E5E5' },
      ],
      PlaylistId: 11,
      TimeSeconds: 216,
      bOvertime: false,
      Ball: { Speed: 16.8, TeamNum: 0 },
      bReplay: false,
      bHasWinner: false,
      Winner: '',
      Arena: 'TrainStation_Night_P',
      bHasTarget: true,
      Target: { Name: 'Nitro_42', Shortcut: 1, TeamNum: 0 },
    },
  };
  for (let i = 0; i < 5; i++) tracker.handle('UpdateState', us);
  const live = tracker.live();
  assert.strictEqual(live.playlist.name, '2v2 Ranked');
  assert.strictEqual(live.arena, 'TrainStation Night');
  assert.strictEqual(live.me.name, 'Nitro_42');
  assert.strictEqual(live.me.via, 'camera');
  assert.strictEqual(live.teams[0].score, 3);
});

test('nouvelle partie (autre guid) pendant une partie non finie = abandon de la précédente', () => {
  const { out, tracker } = setup();
  const base = { Players: [{ Name: 'Zoxam', PrimaryId: DEFAULT_ME.id, TeamNum: 0, Shortcut: 1 }], Game: { TimeSeconds: 200, bOvertime: false, Teams: [] } };
  tracker.handle('MatchCreated', { MatchGuid: 'A' });
  tracker.handle('RoundStarted', { MatchGuid: 'A' });
  tracker.handle('UpdateState', { MatchGuid: 'A', ...base });
  tracker.handle('MatchCreated', { MatchGuid: 'B' });
  assert.strictEqual(out.results.length, 1);
  assert.strictEqual(out.results[0].abandon, true);
  assert.strictEqual(out.results[0].id, 'A');
});
