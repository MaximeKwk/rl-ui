'use strict';
// Situations inhabituelles : retour dans une partie quittée, fin de partie sans vainqueur annoncé,
// identité inconnue à la sortie, spectateur… et le journal des décisions (« pourquoi ce n'est pas compté »).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../core/store');
const { Tracker, buildRecord } = require('../core/tracker');
const { buildScenario, DEFAULT_ME } = require('../tools/scenarios');

const tmpDirs = [];
const stores = [];
test.after(() => {
  for (const st of stores) st.flush();
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function setup({ account = DEFAULT_ME, playlist = 11, settings = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-rel-'));
  tmpDirs.push(dir);
  const store = new Store(dir);
  stores.push(store);
  store.patchSettings(settings);
  let clock = 1_000_000;
  const logWatcher = { account: account ? { ...account, platform: 'Steam' } : null, playlistFor: () => playlist };
  const tracker = new Tracker({ store, logWatcher, now: () => clock });
  const out = { results: [], corrected: [], decisions: [], logs: [] };
  tracker.on('result', (r) => out.results.push(r));
  tracker.on('corrected', (r, prev) => out.corrected.push({ r, prev }));
  tracker.on('decision', (d) => out.decisions.push(d));
  tracker.on('log', (l) => out.logs.push(l));
  const play = (sc, until = null) => {
    const base = clock;
    for (const e of sc.events) {
      if (until && e.event === until) break;
      clock = base + e.t * 1000;
      tracker.handle(e.event, JSON.parse(JSON.stringify(e.data)));
    }
    clock += 1000;
  };
  const last = () => out.decisions[out.decisions.length - 1];
  return { store, tracker, out, play, last, advance: (ms) => (clock += ms) };
}

const P = (name, id, team, shortcut, score = 0) => ({ Name: name, PrimaryId: id, TeamNum: team, Shortcut: shortcut, Score: score });
const TEAMS = (a, b) => [{ TeamNum: 0, Score: a, Name: 'Bleu' }, { TeamNum: 1, Score: b, Name: 'Orange' }];

// ------------------------------------------------------------------ retour dans une partie quittée
test('retour dans une partie classée quittée : l\'abandon est remplacé par le vrai résultat', () => {
  const { out, play, store } = setup();
  const guid = 'REJOIN01';
  play(buildScenario('abandon', { guid }));
  assert.strictEqual(out.results.length, 1);
  assert.strictEqual(out.results[0].abandon, true);
  assert.strictEqual(out.results[0].result, 'L');
  const session = out.results[0].sessionId;

  play(buildScenario('win', { guid }));
  assert.strictEqual(store.data.matches.length, 1, 'toujours une seule partie');
  const r = store.data.matches[0];
  assert.strictEqual(r.id, guid);
  assert.strictEqual(r.result, 'W');
  assert.strictEqual(r.abandon, false);
  assert.strictEqual(r.scoreFor, 3);
  assert.strictEqual(r.sessionId, session, 'reste dans sa session');
  assert.strictEqual(out.results.length, 1, 'pas de second « result »');
  assert.strictEqual(out.corrected.length, 1);
  assert.strictEqual(out.corrected[0].prev.result, 'L');
  assert.strictEqual(out.corrected[0].prev.abandon, true);
});

test('retour dans une partie quittée puis quittée à nouveau : l\'abandon reste, sans doublon', () => {
  const { out, play, store } = setup();
  const guid = 'REJOIN02';
  play(buildScenario('abandon', { guid }));
  play(buildScenario('abandon', { guid }));
  assert.strictEqual(store.data.matches.length, 1);
  assert.strictEqual(store.data.matches[0].abandon, true);
  assert.strictEqual(out.corrected.length, 0);
});

test('partie finie normalement puis événements rejoués : le résultat n\'est pas touché', () => {
  const { out, play, store } = setup();
  const guid = 'REPLAY01';
  play(buildScenario('win', { guid }));
  play(buildScenario('loss', { guid }));
  assert.strictEqual(store.data.matches.length, 1);
  assert.strictEqual(store.data.matches[0].result, 'W');
  assert.strictEqual(out.corrected.length, 0);
});

test('retour dans une partie occasionnelle quittée (non comptée) : elle compte à la fin', () => {
  const { out, play, last } = setup({ playlist: 2 });
  const guid = 'REJOIN03';
  play(buildScenario('abandon', { guid }));
  assert.strictEqual(out.results.length, 0);
  assert.strictEqual(last().code, 'left');
  play(buildScenario('loss', { guid }));
  assert.strictEqual(out.results.length, 1);
  assert.strictEqual(out.results[0].abandon, false);
  assert.strictEqual(last().code, 'counted');
  assert.strictEqual(last().id, guid, 'même entrée de journal');
});

// ------------------------------------------------------------------ fin de partie sans vainqueur annoncé
test('MatchEnded sans vainqueur et score encore à égalité : le résultat arrive avec l\'état suivant', () => {
  const { out, tracker } = setup();
  const players = [P('Zoxam', DEFAULT_ME.id, 0, 1), P('Rival', 'Epic|aaaa|0', 1, 2)];
  tracker.handle('MatchCreated', { MatchGuid: 'NOWIN1' });
  tracker.handle('UpdateState', { MatchGuid: 'NOWIN1', Players: players, Game: { TimeSeconds: 0, bOvertime: true, Teams: TEAMS(1, 1) } });
  tracker.handle('MatchEnded', { MatchGuid: 'NOWIN1' });
  assert.strictEqual(out.results.length, 0, 'rien tant que le vainqueur est inconnu');
  tracker.handle('UpdateState', { MatchGuid: 'NOWIN1', Players: players, Game: { TimeSeconds: 12, bOvertime: true, bHasWinner: true, Winner: 'Bleu', Teams: TEAMS(2, 1) } });
  assert.strictEqual(out.results.length, 1);
  assert.strictEqual(out.results[0].result, 'W');
  assert.strictEqual(out.results[0].overtime, true);
  assert.strictEqual(out.results[0].scoreFor, 2);
});

test('vainqueur jamais connu : décision « no-winner », corrigeable en choisissant le résultat', () => {
  const { out, tracker, last } = setup();
  const players = [P('Zoxam', DEFAULT_ME.id, 0, 1), P('Rival', 'Epic|aaaa|0', 1, 2)];
  tracker.handle('MatchCreated', { MatchGuid: 'NOWIN2' });
  tracker.handle('UpdateState', { MatchGuid: 'NOWIN2', Players: players, Game: { TimeSeconds: 0, bOvertime: false, Teams: TEAMS(1, 1) } });
  tracker.handle('MatchEnded', { MatchGuid: 'NOWIN2' });
  tracker.handle('MatchDestroyed', { MatchGuid: 'NOWIN2' });
  assert.strictEqual(out.results.length, 0);
  const d = last();
  assert.strictEqual(d.outcome, 'skipped');
  assert.strictEqual(d.code, 'no-winner');
  assert.deepStrictEqual(d.needs, ['result']);
  const rec = buildRecord(d.draft, { result: 'W' });
  assert.strictEqual(rec.result, 'W');
  assert.strictEqual(rec.me.name, 'Zoxam');
});

// ------------------------------------------------------------------ identité
test('identité inconnue à la sortie de la partie : le résultat reste récupérable', () => {
  const { out, play, last } = setup({ account: null, settings: { identity: { useCameraTarget: false } } });
  play(buildScenario('otwin'));
  assert.strictEqual(out.results.length, 0);
  const d = last();
  assert.strictEqual(d.code, 'identity');
  assert.deepStrictEqual(d.needs, ['player']);
  assert.ok(d.players.length >= 4);
  const me = d.players.find((p) => p.name === 'Zoxam');
  const rec = buildRecord(d.draft, { player: me.key });
  assert.strictEqual(rec.result, 'W');
  assert.strictEqual(rec.overtime, true);
  assert.strictEqual(rec.scoreFor, 3);
  assert.strictEqual(rec.scoreAgainst, 2);
  assert.strictEqual(rec.identity, 'manual');
  assert.strictEqual(rec.me.id, DEFAULT_ME.id);
  const other = d.players.find((p) => p.team === 1);
  assert.strictEqual(buildRecord(d.draft, { player: other.key }).result, 'L');
});

test('reconnu par la caméra alors que le compte du jeu est absent : compté, mais signalé comme douteux', () => {
  const { out, tracker, last } = setup({ playlist: 6, settings: { counting: { private: true } } });
  const players = [P('ProA', 'Epic|aaaa|0', 0, 1, 300), P('ProB', 'Epic|bbbb|0', 1, 2, 100)];
  const state = (time, a, b) => ({
    MatchGuid: 'SPEC1',
    Players: players,
    Game: { TimeSeconds: time, bOvertime: false, Teams: TEAMS(a, b), bHasTarget: true, Target: { Name: 'ProA', Shortcut: 1, TeamNum: 0 } },
  });
  tracker.handle('MatchCreated', { MatchGuid: 'SPEC1' });
  for (let i = 0; i < 12; i++) tracker.handle('UpdateState', state(200 - i, 1, 0));
  tracker.handle('MatchEnded', { MatchGuid: 'SPEC1', WinnerTeamNum: 0 });
  tracker.handle('MatchDestroyed', { MatchGuid: 'SPEC1' });
  assert.strictEqual(out.results.length, 1);
  assert.strictEqual(last().via, 'camera');
  assert.strictEqual(last().accountAbsent, true, 'le journal prévient : peut-être un spectateur');
});

test('spectateur (caméra libre) : décision « spectator », corrigeable en choisissant un joueur', () => {
  const { out, play, last } = setup({ playlist: 6, settings: { counting: { private: true } } });
  play(buildScenario('spectate'));
  assert.strictEqual(out.results.length, 0);
  assert.strictEqual(last().code, 'spectator');
  assert.deepStrictEqual(last().needs, ['player']);
});

test('sans compte connu, la caméra identifie toujours le joueur', () => {
  const { out, play, last } = setup({ account: null });
  play(buildScenario('win'));
  assert.strictEqual(out.results.length, 1);
  assert.strictEqual(out.results[0].identity, 'camera');
  assert.strictEqual(last().accountAbsent, false);
});

// ------------------------------------------------------------------ journal des décisions
test('journal : une victoire donne une décision « counted »', () => {
  const { play, last, out } = setup();
  const sc = buildScenario('otwin');
  play(sc);
  assert.strictEqual(out.decisions.length, 1);
  const d = last();
  assert.strictEqual(d.outcome, 'counted');
  assert.strictEqual(d.code, 'counted');
  assert.strictEqual(d.id, sc.guid);
  assert.strictEqual(d.result, 'W');
  assert.strictEqual(d.overtime, true);
  assert.deepStrictEqual(d.score, [3, 2]);
  assert.strictEqual(d.myTeam, 0);
  assert.strictEqual(d.playlistId, 11);
  assert.strictEqual(d.how, 'ended');
});

test('journal : suivi en pause', () => {
  const { play, last, out } = setup({ settings: { paused: true } });
  play(buildScenario('win'));
  assert.strictEqual(out.results.length, 0);
  const d = last();
  assert.strictEqual(d.outcome, 'skipped');
  assert.strictEqual(d.code, 'paused');
  assert.deepStrictEqual(d.needs, []);
  const rec = buildRecord(d.draft, {});
  assert.strictEqual(rec.result, 'W');
  assert.strictEqual(rec.scoreFor, 3);
  assert.strictEqual(rec.identity, 'account');
});

test('journal : mode exclu (partie privée)', () => {
  const { play, last } = setup({ playlist: 6 });
  play(buildScenario('loss'));
  const d = last();
  assert.strictEqual(d.code, 'mode-off');
  assert.strictEqual(d.category, 'private');
  assert.strictEqual(buildRecord(d.draft, {}).result, 'L');
});

test('journal : partie quittée en occasionnel (non comptée par réglage), corrigeable en défaite', () => {
  const { play, last } = setup({ playlist: 2 });
  play(buildScenario('abandon'));
  const d = last();
  assert.strictEqual(d.code, 'left');
  assert.deepStrictEqual(d.needs, []);
  const rec = buildRecord(d.draft, {});
  assert.strictEqual(rec.result, 'L');
  assert.strictEqual(rec.abandon, true);
});

test('journal : partie quittée en classé = comptée, marquée abandon', () => {
  const { play, last } = setup();
  play(buildScenario('abandon'));
  const d = last();
  assert.strictEqual(d.outcome, 'counted');
  assert.strictEqual(d.abandon, true);
  assert.strictEqual(d.result, 'L');
});

test('journal : partie quittée avant le coup d\'envoi', () => {
  const { tracker, last, out } = setup();
  tracker.handle('MatchCreated', { MatchGuid: 'EARLY1' });
  tracker.handle('UpdateState', { MatchGuid: 'EARLY1', Players: [P('Zoxam', DEFAULT_ME.id, 0, 1)], Game: { TimeSeconds: 300, bOvertime: false, Teams: TEAMS(0, 0) } });
  tracker.handle('MatchDestroyed', { MatchGuid: 'EARLY1' });
  assert.strictEqual(out.results.length, 0);
  assert.strictEqual(last().code, 'not-started');
  assert.strictEqual(last().draft, null, 'rien à compter');
});

test('journal : l\'entraînement ne remplit pas le journal', () => {
  const { play, out } = setup({ playlist: 9 });
  play(buildScenario('win', { guid: null }));
  assert.strictEqual(out.decisions.length, 0);
});

test('journal : mode exclu prioritaire sur l\'identité inconnue', () => {
  const { play, last } = setup({ account: null, playlist: 6, settings: { identity: { useCameraTarget: false } } });
  play(buildScenario('win'));
  assert.strictEqual(last().code, 'mode-off');
  assert.deepStrictEqual(last().needs, ['player']);
});

// ------------------------------------------------------------------ événements tardifs
test('événements tardifs après la fin d\'une partie non comptée : pas de défaite fantôme', () => {
  const { out, play, tracker, store } = setup({ settings: { paused: true } });
  const sc = buildScenario('win');
  play(sc);
  assert.strictEqual(out.results.length, 0);
  store.patchSettings({ paused: false });
  // un état tardif de la partie déjà terminée, puis la partie suivante démarre
  tracker.handle('UpdateState', {
    MatchGuid: sc.guid,
    Players: [P('Zoxam', DEFAULT_ME.id, 0, 1)],
    Game: { TimeSeconds: 0, bOvertime: false, Teams: TEAMS(3, 1) },
  });
  tracker.handle('MatchCreated', { MatchGuid: 'NEXT1' });
  assert.strictEqual(out.results.length, 0, 'aucun abandon inventé');
});

// ------------------------------------------------------------------ connexion perdue
test('connexion au jeu perdue puis app fermée : la partie en cours est close proprement', () => {
  const { out, play, tracker, last } = setup();
  play(buildScenario('abandon'), 'MatchDestroyed');
  tracker.onDisconnected();
  tracker.shutdown();
  assert.strictEqual(out.results.length, 1);
  assert.strictEqual(out.results[0].reason, 'lost');
  assert.strictEqual(out.results[0].abandon, true);
  assert.strictEqual(last().outcome, 'counted');
});

test('app fermée alors que le jeu tourne encore : rien n\'est inventé', () => {
  const { out, play, tracker } = setup();
  play(buildScenario('loss'), 'MatchEnded');
  tracker.shutdown();
  assert.strictEqual(out.results.length, 0);
});

// ------------------------------------------------------------------ cœur : journal, « compter quand même », rapport
function coreSetup(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-core-'));
  tmpDirs.push(dir);
  const { Core } = require('../core');
  const core = new Core({ dataDir: dir, documentsDir: dir, webDir: path.join(__dirname, '..', 'web') });
  core.server.broadcast = () => {};
  core.obs.trigger = async () => {};
  core.store.patchSettings(settings);
  core.logWatcher.account = { ...DEFAULT_ME, platform: 'Steam' };
  let playlist = 11;
  core.logWatcher.playlistFor = () => playlist;
  let clock = Date.now() - 3600e3;
  core.tracker.now = () => clock;
  core.store.session.startedAt = clock - 1000; // la session suit l'horloge du test
  const play = (sc) => {
    const base = clock;
    for (const e of sc.events) {
      clock = base + e.t * 1000;
      core.tracker.handle(e.event, JSON.parse(JSON.stringify(e.data)));
    }
    clock += 1000;
  };
  const done = () => {
    core.tracker.shutdown();
    clearTimeout(core._changeTimer);
    clearTimeout(core._casterTimer);
    core.store.flush();
  };
  return { core, play, done, now: () => clock, setPlaylist: (p) => (playlist = p), advance: (ms) => (clock += ms) };
}

test('cœur : une partie en pause est expliquée, puis comptée en un clic avec ses vraies données', () => {
  const { core, play, done } = coreSetup({ paused: true });
  play(buildScenario('otwin'));
  assert.strictEqual(core.sessionStats().wins, 0);
  let d = core.diagnostic();
  assert.strictEqual(d.journal.length, 1);
  const e = d.journal[0];
  assert.strictEqual(e.outcome, 'skipped');
  assert.strictEqual(e.code, 'paused');
  assert.strictEqual(e.canFix, true);
  assert.deepStrictEqual(e.needs, []);
  assert.ok(e.why.length > 10);
  assert.ok(e.trace.length > 5, 'trace technique présente');
  assert.strictEqual(core.diagSummary().notice.id, e.id, 'avis pour l\'accueil');
  assert.ok(!JSON.stringify(d).includes(DEFAULT_ME.id), 'aucun identifiant de compte envoyé à la page');

  const r = core.countSkipped(e.id);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.result, 'W');
  const st = core.sessionStats();
  assert.strictEqual(st.wins, 1);
  assert.strictEqual(st.otWins, 1);
  const rec = core.store.getMatch(e.id);
  assert.strictEqual(rec.scoreFor, 3);
  assert.strictEqual(rec.fixed, true);
  assert.ok(rec.mmr, 'estimation de MMR posée');
  d = core.diagnostic();
  assert.strictEqual(d.journal[0].canFix, false);
  assert.strictEqual(d.journal[0].result, 'W');
  assert.strictEqual(core.diagSummary().notice, null);
  assert.strictEqual(core.countSkipped(e.id).ok, false, 'pas deux fois');
  done();
});

test('cœur : identité inconnue, « c\'était moi » compte la partie et mémorise le compte', () => {
  const { core, play, done } = coreSetup({ identity: { useCameraTarget: false } });
  core.logWatcher.account = null;
  play(buildScenario('loss'));
  const e = core.diagnostic().journal[0];
  assert.strictEqual(e.code, 'identity');
  assert.deepStrictEqual(e.needs, ['player']);
  assert.strictEqual(core.countSkipped(e.id).ok, false, 'il faut choisir le joueur');
  const me = e.players.find((p) => p.name === 'Zoxam');
  const r = core.countSkipped(e.id, { player: me.i });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.result, 'L');
  assert.ok(core.store.settings.identity.knownIds.includes(DEFAULT_ME.id));
  done();
});

test('cœur : une partie comptée après coup est rangée à sa place et dans sa session', () => {
  const { core, play, done, advance, now } = coreSetup();
  core.store.patchSettings({ paused: true });
  play(buildScenario('win'));
  const skipped = core.diagnostic().journal[0];
  core.store.patchSettings({ paused: false });
  play(buildScenario('loss'));
  const first = core.store.data.currentSessionId;
  core.action('new-session');
  core.store.session.startedAt = now();
  advance(60e3);
  play(buildScenario('win'));
  const r = core.countSkipped(skipped.id);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.inSession, false, 'elle appartient à la session précédente');
  const ms = core.store.data.matches;
  assert.deepStrictEqual(ms.map((m) => m.result), ['W', 'L', 'W']);
  assert.strictEqual(ms[0].id, skipped.id);
  assert.strictEqual(ms[0].sessionId, first);
  assert.strictEqual(core.sessionStats().wins, 1, 'la session en cours ne bouge pas');
  done();
});

test('cœur : retour dans une partie quittée, compteurs et MMR suivent le vrai résultat', () => {
  const { core, play, done } = coreSetup();
  const alerts = [];
  core._alert = (type) => alerts.push(type);
  const guid = 'COREJOIN1';
  play(buildScenario('abandon', { guid }));
  assert.strictEqual(core.sessionStats().losses, 1);
  assert.ok(core.store.getMatch(guid).mmr.delta < 0);
  play(buildScenario('win', { guid }));
  const st = core.sessionStats();
  assert.strictEqual(st.wins, 1);
  assert.strictEqual(st.losses, 0);
  const rec = core.store.getMatch(guid);
  assert.ok(rec.mmr.delta > 0, 'estimation refaite pour une victoire');
  const k = rec.mmr.key;
  assert.deepStrictEqual(core.mmr.d.pending[k], [guid], 'une seule fois en attente');
  assert.deepStrictEqual(alerts, ['win'], 'l\'abandon n\'alerte pas (réglage par défaut), la victoire oui');
  const e = core.diagnostic().journal;
  assert.strictEqual(e.length, 1);
  assert.strictEqual(e[0].result, 'W');
  done();
});

test('cœur : partie retirée de l\'historique = notée comme telle dans le journal', () => {
  const { core, play, done } = coreSetup();
  const sc = buildScenario('win');
  play(sc);
  core.deleteMatch(sc.guid);
  const e = core.diagnostic().journal[0];
  assert.strictEqual(e.removed, true);
  assert.strictEqual(e.canFix, false);
  done();
});

test('cœur : le journal survit à un redémarrage (et reste corrigeable)', () => {
  const { core, play, done } = coreSetup({ paused: true });
  play(buildScenario('loss'));
  done();
  const { Core } = require('../core');
  const again = new Core({ dataDir: core.dataDir, documentsDir: core.dataDir, webDir: path.join(__dirname, '..', 'web') });
  again.server.broadcast = () => {};
  const e = again.diagnostic().journal[0];
  assert.strictEqual(e.code, 'paused');
  assert.strictEqual(again.countSkipped(e.id).ok, true);
  assert.strictEqual(again.store.data.matches.length, 1);
  clearTimeout(again._changeTimer);
  again.store.flush();
});

test('cœur : bilan de santé et rapport, sans donnée sensible', () => {
  const { core, play, done } = coreSetup({ paused: true });
  core.store.patchSettings({ obs: { password: 'SECRET-OBS' } });
  play(buildScenario('win'));
  core.log('!wl demandé par viewer42', 'info', 'chat');
  const checks = core.diagSummary().checks;
  const by = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.deepStrictEqual(Object.keys(by), ['game', 'api', 'log', 'account', 'counting', 'mmr', 'overlays', 'last']);
  assert.strictEqual(by.counting.level, 'warn');
  assert.strictEqual(by.counting.fix, 'resume');
  assert.strictEqual(by.log.level, 'bad');
  assert.strictEqual(by.last.level, 'warn');
  assert.strictEqual(core.diagSummary().level, 'bad');
  const rep = core.diagnosticReport();
  assert.ok(rep.includes('RL-UI'));
  assert.ok(rep.includes('decision: not counted (paused)'), 'trace technique incluse');
  for (const secret of [core.store.settings.apiKey, 'SECRET-OBS', DEFAULT_ME.id, 'viewer42', 'Turbo', os.homedir()]) {
    assert.ok(!rep.includes(secret), `le rapport ne contient pas ${secret}`);
  }
  done();
});
