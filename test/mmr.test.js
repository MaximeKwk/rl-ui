'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../core/store');
const { MmrTracker } = require('../core/mmr');
const { LogSession, parseOpenTime, RlLogWatcher } = require('../core/rlLogWatcher');

const ACC = 'Steam|76561190000000002|0';
const tmpDirs = [];
const stores = [];
test.after(() => {
  for (const st of stores) st.flush();
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function setup(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-mmr-'));
  tmpDirs.push(dir);
  const store = new Store(dir);
  stores.push(store);
  store.patchSettings(settings);
  const mmr = new MmrTracker(store);
  let n = 0;
  const match = (result, endedAt, playlistId = 11) => {
    const r = store.addMatch({ id: `m${++n}`, endedAt, startedAt: endedAt - 300e3, result, playlistId, me: { id: ACC, name: 'Nitro_42' } });
    mmr.onMatch(r);
    return r;
  };
  const sample = (value, at, playlist = 11) => mmr.onSample({ accountId: ACC, playlist, mmr: value, mu: (value - 100) / 20, at });
  return { store, mmr, match, sample };
}

const block = (secs, mu, playlists = '11', party = 1, count = 1) =>
  [
    `[${secs}] Matchmaking: OnlineGameMatchmaking_X::RecordStart`,
    `[${secs}] Matchmaking: Pre-divide PartyLeaderMMR: ${mu}`,
    `[${secs}] Matchmaking: Post-divide PartyLeaderMMR: ${mu}`,
    `[${secs}] Matchmaking: PartyLeaderTier=(10)`,
    `[${secs}] Matchmaking: StartMatchmaking at 2026-09-30 10:29:42 in EU9,EU5 for playlists ${playlists} on game server `,
    `[${secs}] Matchmaking: Creating RPC_StartMatchmaking_X`,
    `[${secs}] Matchmaking: PreferredRegions.Length=(12) PreferredPlaylists.Length=(${count}) Party.GetOrderedPartyMemberIDs().Length=(${party})`,
  ];

test('date d\'ouverture du log (FR, US, ambiguë)', () => {
  const ref = new Date(2026, 8, 30, 15, 0, 0).getTime();
  assert.strictEqual(parseOpenTime('30/09/2026 14:07:07', ref), new Date(2026, 8, 30, 14, 7, 7).getTime());
  assert.strictEqual(parseOpenTime('09/30/26 14:07:07', ref), new Date(2026, 8, 30, 14, 7, 7).getTime());
  // 05/09 : 5 septembre (proche) plutôt que 9 mai
  const ref2 = new Date(2026, 8, 5, 20, 0, 0).getTime();
  assert.strictEqual(parseOpenTime('05/09/2026 18:00:00', ref2), new Date(2026, 8, 5, 18, 0, 0).getTime());
  assert.strictEqual(parseOpenTime('pas une date', ref), null);
});

test('bloc de matchmaking -> MMR réel daté', () => {
  const sess = new LogSession(new Date(2026, 8, 30, 15, 0, 0).getTime());
  const out = [];
  const lines = [
    'Log: Log file open, 30/09/2026 14:07:07',
    '[0014.43] Party: HandleLocalPlayerLoginStatusChanged PlayerName=Nitro_42 PlayerID=Steam|76561190000000002|0 LoginStatus=LS_LoggedIn IsPrimary=True IsInParty=False',
    ...block('0054.84', '29.3723'),
    ...block('0100.00', '30.0000', '1,2,3', 1, 3), // plusieurs playlists : ignoré
  ];
  for (const l of lines) out.push(...sess.feed(l));
  const s = out.filter((e) => e.type === 'mmr');
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].mmr, 687.4);
  assert.strictEqual(s[0].playlist, 11);
  assert.strictEqual(s[0].accountId, ACC);
  assert.strictEqual(s[0].partySize, 1);
  assert.strictEqual(s[0].at, new Date(2026, 8, 30, 14, 7, 7).getTime() + 54840);
});

test('une partie entre deux files : variation exacte', () => {
  const { sample, match, mmr, store } = setup();
  sample(687.4, 1000);
  const r = match('W', 2000);
  assert.strictEqual(r.mmr.status, 'estimated');
  assert.strictEqual(r.mmr.delta, 10); // estimation par défaut
  assert.strictEqual(r.mmr.before, 687.4);
  sample(702.6, 3000);
  const m = store.getMatch(r.id);
  assert.strictEqual(m.mmr.status, 'exact');
  assert.strictEqual(m.mmr.delta, 15.2);
  assert.strictEqual(m.mmr.after, 702.6);
  assert.deepStrictEqual(mmr.d.pending[`${ACC}|11`], []);
});

test('mise à jour en retard : cumul réparti sur les deux parties', () => {
  const { sample, match, store } = setup();
  const M = 60e3; // durées réalistes : une partie dure plusieurs minutes
  sample(1000, 0);
  const a = match('W', 6 * M);
  sample(1000, 6.5 * M); // relance trop rapide : pas encore mis à jour
  assert.strictEqual(store.getMatch(a.id).mmr.status, 'estimated');
  const b = match('L', 13 * M);
  sample(1001, 13.5 * M); // +15 puis -14
  const ma = store.getMatch(a.id).mmr;
  const mb = store.getMatch(b.id).mmr;
  assert.strictEqual(ma.status, 'grouped');
  assert.ok(ma.delta > 0 && mb.delta < 0, `${ma.delta} / ${mb.delta}`);
  assert.strictEqual(Math.round((ma.delta + mb.delta) * 10) / 10, 1);
  assert.strictEqual(mb.after, 1001);
});

test('variation d\'une seule partie quand deux sont en attente', () => {
  const { sample, match, store } = setup();
  sample(1000, 1000);
  const a = match('W', 2000);
  const b = match('W', 3000);
  sample(1015, 2500); // file lancée entre les deux (log en retard) : ne concerne que A
  assert.strictEqual(store.getMatch(a.id).mmr.status, 'exact');
  assert.strictEqual(store.getMatch(b.id).mmr.status, 'estimated');
});

test('estimation apprise sur tes vraies variations', () => {
  const { sample, match } = setup();
  sample(1000, 1000);
  match('W', 2000);
  sample(1016, 3000);
  match('L', 4000);
  sample(1002, 5000);
  const w = match('W', 6000);
  const l = match('L', 7000);
  assert.strictEqual(w.mmr.delta, 16);
  assert.strictEqual(w.mmr.learned, true);
  assert.strictEqual(l.mmr.delta, -14);
});

test('sans valeur réelle (pas chef de groupe) : estimation seulement', () => {
  const { match, mmr } = setup({ mmr: { defaultDelta: 10 } });
  const r = match('L', 2000);
  assert.strictEqual(r.mmr.delta, -10);
  assert.strictEqual(r.mmr.before, null);
  const sum = mmr.summary([r], { accountId: ACC });
  assert.strictEqual(sum.primary.delta, -10);
  assert.strictEqual(sum.primary.approx, true);
  assert.strictEqual(sum.primary.current, null);
});

test('premier MMR connu après des parties : elles restent estimées', () => {
  const { sample, match, mmr, store } = setup();
  const a = match('W', 2000);
  sample(1200, 3000);
  assert.deepStrictEqual(mmr.d.pending[`${ACC}|11`], []);
  sample(1212, 4000);
  assert.strictEqual(store.getMatch(a.id).mmr.status, 'estimated');
});

test('bilan de session et MMR actuel', () => {
  const { sample, match, mmr, store } = setup();
  sample(1100, 1000);
  match('W', 2000);
  sample(1112, 3000);
  match('W', 4000); // pas encore de valeur réelle après celle-ci
  const s = mmr.summary(store.sessionMatches(), { accountId: ACC });
  assert.strictEqual(s.primary.name, '2v2 Ranked');
  assert.strictEqual(s.primary.delta, 24); // 12 exact + 12 estimé
  assert.strictEqual(s.primary.approx, true);
  assert.strictEqual(s.primary.current, 1124);
  assert.strictEqual(s.primary.currentApprox, true);
});

test('occasionnel ignoré par défaut, pris en compte si activé', () => {
  const { match } = setup();
  assert.strictEqual(match('W', 2000, 2).mmr, undefined);
  const b = setup({ mmr: { includeCasual: true } });
  assert.ok(b.match('W', 2000, 2).mmr);
});

test('partie supprimée : retirée de l\'attente', () => {
  const { sample, match, mmr } = setup();
  sample(1000, 1000);
  const a = match('W', 2000);
  mmr.forget(a.id);
  assert.deepStrictEqual(mmr.d.pending[`${ACC}|11`], []);
});

test('journaux du jeu présents sur ce PC : MMR cohérents et datés', { skip: !fs.existsSync(path.join(os.homedir(), 'Documents', 'My Games', 'Rocket League', 'TAGame', 'Logs')) }, async () => {
  const w = new RlLogWatcher({ documentsDir: path.join(os.homedir(), 'Documents') });
  const samples = await w.scanBackups({ maxFiles: 20 });
  if (!samples.length) return; // aucune recherche lancée depuis ce PC dans les journaux conservés
  for (const s of samples) {
    assert.ok(s.mmr > 0 && s.mmr < 3000, `MMR ${s.mmr}`);
    assert.ok(/^\w+\|[^|]+\|\d+$/.test(s.accountId), s.accountId);
    assert.ok(Number.isFinite(s.at) && s.at > Date.UTC(2015, 0, 1) && s.at < Date.now() + 60e3, `date ${s.at}`);
  }
  assert.ok(samples.every((s, i) => i === 0 || s.at >= samples[i - 1].at), 'ordre chronologique');
});

test('cas réel : grosse variation sans rapport avec les parties suivies, puis défaite bien attribuée', () => {
  const { store, match, sample } = setup();
  const T = Date.UTC(2026, 9, 1, 0, 0, 0);
  sample(1201.7, T - 30 * 3600e3); // la veille
  const w = match('W', T - 3600e3); // victoire
  const l1 = match('L', T - 3000e3); // défaite
  sample(1257.2, T); // +55.5 : des parties ont été jouées sans RL-UI entre-temps
  const l2 = match('L', T + 390e3); // défaite, et nouvelle file 20 s après
  sample(1248, T + 410e3);
  assert.strictEqual(store.getMatch(l2.id).mmr.delta, -9.2);
  assert.strictEqual(store.getMatch(l2.id).mmr.status, 'exact');
  assert.strictEqual(store.getMatch(w.id).mmr.status, 'unknown', 'les +55.5 ne sont pas mis sur une seule victoire');
  assert.ok(store.getMatch(l1.id).mmr.delta < 0, 'une défaite reste négative');
});

test('file relancée tout de suite : la variation arrive à la file suivante et va à la bonne partie', () => {
  const { store, match, sample } = setup();
  const T = Date.UTC(2026, 8, 29, 19, 0, 0);
  sample(1209.8, T);
  const a = match('L', T + 330e3); // défaite, file relancée 30 s après : le serveur n'a pas encore compté
  sample(1209.8, T + 360e3); // inchangé
  const b = match('L', T + 800e3); // 2e défaite
  sample(1190.8, T + 840e3); // -19 : les deux défaites d'un coup
  const da = store.getMatch(a.id).mmr;
  const db = store.getMatch(b.id).mmr;
  assert.ok(da.delta < 0 && db.delta < 0, `${da.delta} / ${db.delta}`);
  assert.strictEqual(Math.round((da.delta + db.delta) * 10) / 10, -19);
});

test('partie finie depuis longtemps : toujours comptée dans la valeur suivante', () => {
  const { store, match, sample } = setup();
  const T = Date.UTC(2026, 8, 29, 18, 0, 0);
  sample(1184.5, T);
  const a = match('L', T + 400e3);
  const b = match('L', T + 900e3);
  sample(1162.7, T + 3600e3); // une heure plus tard : -21.8 pour les deux défaites
  assert.strictEqual(store.getMatch(a.id).mmr.status, 'grouped');
  assert.strictEqual(store.getMatch(b.id).mmr.status, 'grouped');
});

test('estimation par défaut : ±10, et l\'ancien réglage 12 passe à 10', () => {
  const { match } = setup();
  assert.strictEqual(match('W', 2000).mmr.delta, 10);
  assert.strictEqual(match('L', 3000).mmr.delta, -10);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-mmr-'));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ settings: { mmr: { defaultDelta: 12 } } }));
  const old = new Store(dir);
  stores.push(old);
  assert.strictEqual(old.settings.mmr.defaultDelta, 10);
});
