'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { JsonFramer, decodeEnvelope } = require('../core/jsonFramer');
const { parseLine, RlLogWatcher } = require('../core/rlLogWatcher');
const { parseIni, setIniValues, readStatsIni } = require('../core/rlConfig');
const { describePlaylist } = require('../core/playlists');

test('framer : objets concaténés, découpés n\'importe où', () => {
  const msgs = [
    { Event: 'UpdateState', Data: JSON.stringify({ Game: { Arena: 'Stadium_P', Teams: [{ Name: 'Bleu {1}' }] } }) },
    { Event: 'GoalScored', Data: JSON.stringify({ Scorer: { Name: 'Zo"x}am\\' } }) },
    { Event: 'MatchEnded', Data: { WinnerTeamNum: 1 } },
  ];
  const stream = Buffer.from(msgs.map((m) => JSON.stringify(m)).join('') + '\n');
  for (const size of [1, 3, 7, 50, stream.length]) {
    const f = new JsonFramer();
    const got = [];
    for (let i = 0; i < stream.length; i += size) got.push(...f.push(stream.subarray(i, i + size)));
    assert.strictEqual(got.length, 3, `taille ${size}`);
    const env = got.map(decodeEnvelope);
    assert.strictEqual(env[0].data.Game.Teams[0].Name, 'Bleu {1}');
    assert.strictEqual(env[1].data.Scorer.Name, 'Zo"x}am\\');
    assert.strictEqual(env[2].data.WinnerTeamNum, 1);
  }
});

test('framer : caractères UTF-8 coupés entre deux paquets', () => {
  const s = Buffer.from(JSON.stringify({ Event: 'X', Data: { Name: 'Kaydöp ⚡🔥' } }));
  const f = new JsonFramer();
  const out = [];
  for (let i = 0; i < s.length; i++) out.push(...f.push(s.subarray(i, i + 1)));
  assert.strictEqual(decodeEnvelope(out[0]).data.Name, 'Kaydöp ⚡🔥');
});

test('framer : ignore le bruit entre les objets', () => {
  const f = new JsonFramer();
  const out = f.push('\0\r\n {"Event":"A","Data":"{}"}\0{"Event":"B","Data":""}  ');
  assert.deepStrictEqual(out.map((o) => decodeEnvelope(o).event), ['A', 'B']);
});

test('enveloppe invalide', () => {
  assert.strictEqual(decodeEnvelope('{"nope":1}'), null);
  assert.strictEqual(decodeEnvelope('pas du json'), null);
  assert.deepStrictEqual(decodeEnvelope('{"Event":"A","Data":"pas du json"}').data, {});
});

test('log : compte local', () => {
  const ev = parseLine('[0015.83] Party: HandleLocalPlayerLoginStatusChanged PlayerName=Zoxam PlayerID=Steam|76561190000000001|0 LoginStatus=LS_LoggedIn IsPrimary=True IsInParty=False');
  assert.deepStrictEqual(ev, { type: 'account', name: 'Zoxam', id: 'Steam|76561190000000001|0', status: 'LS_LoggedIn', primary: true });
  const ev2 = parseLine('[0015.93] Party: HandleLocalPlayerLoginStatusChanged PlayerName=Le Boss 2 PlayerID=Epic|0f0f0f0f0f0f4f0f8f0f0f0f0f0f0f0f|0 LoginStatus=LS_LoggedIn IsPrimary=True IsInParty=True');
  assert.strictEqual(ev2.name, 'Le Boss 2');
  assert.strictEqual(ev2.id, 'Epic|0f0f0f0f0f0f4f0f8f0f0f0f0f0f0f0f|0');
});

test('log : playlist', () => {
  assert.deepStrictEqual(parseLine('[1047.74] DevOnline: Set rich presence to: Double in Farmstead (Pitched) 5:00 (0 - 0) data: Playlist-11').id, 11);
  assert.strictEqual(parseLine('[1041.11] JoinGame: StartJoin Reservation=((ServerName="EU9-bb65b430-Ballistic",Playlist=13,Region="EU")').id, 13);
  assert.strictEqual(parseLine('[1041.86] Party: HandlePartyJoinGame MatchSettings=((ServerName="EU9",PlaylistId=10,CustomPassword="X")').id, 10);
  assert.strictEqual(parseLine('[0019.95] DevOnline: WebRequest_X_35 SEND: https://rl-cdn.psyonix.com/Playlists/Images/x.jpg'), null);
  assert.strictEqual(parseLine('[0017.28] XPGatedPlaylists: Not currently in a party.'), null);
  assert.deepStrictEqual(parseLine('DevOnline: Set rich presence to: Menu principal data: Menu').type, 'presence');
});

test('log watcher : lecture initiale + suivi + relance du jeu', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-log-'));
  const file = path.join(dir, 'Launch.log');
  fs.writeFileSync(
    file,
    [
      '[0010.00] Log: hello',
      '[0015.27] Party: HandleLocalPlayerLoginStatusChanged PlayerName=Nitro_42 PlayerID=Steam|76561190000000002|0 LoginStatus=LS_LoggedIn IsPrimary=True IsInParty=False',
      '[0020.00] DevOnline: Set rich presence to: Double in X 5:00 (0 - 0) data: Playlist-11',
      '[0400.00] DevOnline: Set rich presence to: Menu principal data: Menu',
      '',
    ].join('\r\n'),
    'latin1'
  );
  const w = new RlLogWatcher({ logPath: file, pollMs: 50 });
  w.start();
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(w.account.name, 'Nitro_42');
  // retour au menu : la playlist précédente est oubliée
  assert.strictEqual(w.playlist, null);
  assert.strictEqual(w.playlistFor(Date.now()), null);
  fs.appendFileSync(file, '[0420.00] JoinGame: StartJoin Reservation=((ServerName="EU",Playlist=10,Region="EU")\r\n');
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(w.playlistFor(Date.now()), 10);
  // relance du jeu : nouveau fichier plus petit
  fs.writeFileSync(file, '[0015.00] Party: HandleLocalPlayerLoginStatusChanged PlayerName=Zoxam PlayerID=Steam|1|0 LoginStatus=LS_LoggedIn IsPrimary=True IsInParty=False\r\n');
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(w.account.name, 'Zoxam');
  w.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ini : lecture et modification en préservant les commentaires', () => {
  const src = [
    '[TAGame.MatchStatsExporter_TA]',
    '',
    '; Port tcp',
    'Port=49123',
    '',
    '; How many times per second',
    'PacketSendRate=0',
    '',
    '[IniVersion]',
    '0=1789671498.000000',
    '',
  ].join('\r\n');
  const out = setIniValues(src, 'TAGame.MatchStatsExporter_TA', { Port: 49123, WebPort: 49124, PacketSendRate: 10 });
  const ini = parseIni(out);
  assert.strictEqual(ini['TAGame.MatchStatsExporter_TA'].PacketSendRate, '10');
  assert.strictEqual(ini['TAGame.MatchStatsExporter_TA'].WebPort, '49124');
  assert.strictEqual(ini.IniVersion['0'], '1789671498.000000');
  assert.ok(out.includes('; Port tcp'));
  assert.ok(out.includes('\r\n'));
  const created = parseIni(setIniValues('', 'TAGame.MatchStatsExporter_TA', { PacketSendRate: 10 }));
  assert.strictEqual(created['TAGame.MatchStatsExporter_TA'].PacketSendRate, '10');
});

test('ini du jeu réel (si Rocket League est installé)', { skip: !fs.existsSync('C:\\Program Files (x86)\\Steam\\steamapps\\common\\rocketleague\\TAGame\\Config\\DefaultStatsAPI.ini') }, () => {
  const c = readStatsIni('C:\\Program Files (x86)\\Steam\\steamapps\\common\\rocketleague\\TAGame\\Config\\DefaultStatsAPI.ini');
  assert.strictEqual(c.section, true);
  assert.ok(c.Port > 0);
});

test('playlists', () => {
  assert.strictEqual(describePlaylist(11).name, '2v2 Classé');
  assert.strictEqual(describePlaylist(11).ranked, true);
  assert.strictEqual(describePlaylist(2).cat, 'casual');
  assert.strictEqual(describePlaylist(999).cat, 'extra');
  assert.strictEqual(describePlaylist(null, true).cat, 'unknown');
  assert.strictEqual(describePlaylist(null, false).cat, 'offline');
});
