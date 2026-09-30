'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { CasterFeed } = require('../core/caster');
const { buildScenario } = require('../tools/scenarios');

function run(kind, opts = {}) {
  const feed = new CasterFeed();
  const out = { events: [], ended: [], states: [] };
  feed.on('event', (e) => out.events.push(e));
  feed.on('ended', (e) => out.ended.push(e));
  const sc = buildScenario(kind, { teamSize: 3, ...opts });
  for (const e of sc.events) {
    if (e.event === 'MatchDestroyed') out.beforeDestroy = JSON.parse(JSON.stringify(feed.state()));
    feed.handle(e.event, e.data);
  }
  return { feed, out, sc };
}

test('caster : tous les joueurs, score, boost et joueur suivi', () => {
  const feed = new CasterFeed();
  const sc = buildScenario('win', { teamSize: 3 });
  const upd = sc.events.find((e) => e.event === 'UpdateState');
  feed.handle('MatchCreated', { MatchGuid: 'G1' });
  feed.handle('UpdateState', upd.data);
  const m = feed.state();
  assert.strictEqual(m.active, true);
  assert.strictEqual(m.players.length, 6);
  assert.strictEqual(m.players.filter((p) => p.team === 0).length, 3);
  assert.strictEqual(m.players[0].boost, 33);
  assert.ok(m.target && m.target.startsWith('0:'));
  assert.strictEqual(m.teams[0].color, '#1873FF');
});

test('caster : buts (le faux but de fin de replay est ignoré), fin de partie et vainqueur', () => {
  const { out, feed } = run('win');
  const goals = out.events.filter((e) => e.kind === 'goal');
  assert.strictEqual(goals.length, 4, 'les 4 vrais buts, sans les faux buts de replay');
  assert.ok(goals.every((g) => g.scorer && g.speed > 0));
  assert.deepStrictEqual(out.ended.map((e) => e.winner), [0]);
  assert.strictEqual(feed.state().ended, true);
  assert.strictEqual(feed.state().winner, 0);
  // le tableau final reste affiché un moment après la fermeture de la partie
  assert.strictEqual(feed.state().active, true);
});

test('caster : partie en spectateur (aucun joueur local) suivie normalement', () => {
  const { out, feed } = run('spectate');
  assert.strictEqual(out.ended.length, 1);
  assert.strictEqual(feed.state().teams[0].score, 1);
});

test('caster : statfeed (démolition) transmis, événements courants filtrés', () => {
  const feed = new CasterFeed();
  const ev = [];
  feed.on('event', (e) => ev.push(e));
  feed.handle('StatfeedEvent', { EventName: 'Demolish', Type: 'Démolition', MainTarget: { Name: 'A', TeamNum: 0 }, SecondaryTarget: { Name: 'B', TeamNum: 1 } });
  feed.handle('StatfeedEvent', { EventName: 'Shot', Type: 'Tir', MainTarget: { Name: 'A', TeamNum: 0 } });
  feed.handle('StatfeedEvent', { EventName: 'MVP', Type: 'MVP', MainTarget: { Name: 'A', TeamNum: 0 } });
  assert.deepStrictEqual(ev.map((e) => [e.label, e.main, e.secondary]), [['Démolition', 'A', 'B']]);
  assert.strictEqual(feed.state().mvp, '0:A');
});

test('caster : série comptée automatiquement, inversion des côtés', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlui-caster-'));
  const { Core } = require('../core');
  const core = new Core({ dataDir: dir, documentsDir: dir, webDir: path.join(__dirname, '..', 'web') });
  core.server.broadcast = () => {};
  core.store.patchSettings({ caster: { names: ['Nova', ''], bestOf: 3 } });
  core.caster.emit('ended', { winner: 1 });
  let st = core.casterState();
  assert.deepStrictEqual(st.series.wins, [0, 1]);
  assert.strictEqual(st.match.teams[0].name, 'Nova');
  core.casterAction('swap');
  st = core.casterState();
  assert.deepStrictEqual(st.series.wins, [1, 0]);
  assert.strictEqual(st.match.teams[1].name, 'Nova');
  core.caster.emit('ended', { winner: 0 });
  core.caster.emit('ended', { winner: 0 }); // série déjà gagnée (BO3) : plus rien ne bouge
  assert.deepStrictEqual(core.casterState().series.wins, [2, 0]);
  assert.strictEqual(core.casterState().series.done, true);
  core.casterAction('reset');
  assert.deepStrictEqual(core.casterState().series.wins, [0, 0]);
  core.store.flush();
  clearTimeout(core._casterTimer);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('caster : logos et photos (formats, remplacement, inversion des côtés)', () => {
  const { CasterAssets } = require('../core/casterAssets');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlui-ca-'));
  const a = new CasterAssets(dir);
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const n1 = a.save('logo', 0, png, 'png');
  assert.ok(a.logoUrl(0).endsWith(n1));
  assert.strictEqual(a.logoUrl(1), null);
  assert.throws(() => a.save('logo', 1, png, 'exe'), /format/);
  a.save('photo', 'Nova', png, 'jpg');
  assert.ok(a.photoUrl('NOVA'), 'photo retrouvée quelle que soit la casse');
  a.save('photo', 'Nova', png, 'png');
  assert.strictEqual(fs.readdirSync(dir).filter((f) => f.startsWith('photo-')).length, 1, "l'ancienne photo est supprimée");
  a.swapLogos();
  assert.strictEqual(a.logoUrl(0), null);
  assert.ok(a.logoUrl(1).endsWith(n1));
  assert.strictEqual(a.file('../caster.json'), null);
  assert.ok(new CasterAssets(dir).photoUrl('nova'), "l'index est conservé");
  fs.rmSync(dir, { recursive: true, force: true });
});
