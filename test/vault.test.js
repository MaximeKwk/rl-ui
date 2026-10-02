'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeVault } = require('../core/vault');
const { Store } = require('../core/store');
const { TwitchChat } = require('../core/twitch');

// faux chiffrement réversible (dans l'application : DPAPI de Windows via Electron)
const fake = {
  encrypt: (s) => Buffer.from([...s].reverse().join(''), 'utf8').toString('base64'),
  decrypt: (b) => [...Buffer.from(b, 'base64').toString('utf8')].reverse().join(''),
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rlui-vault-'));

test('coffre : les mots de passe OBS / Streamlabs ne sont jamais écrits en clair', () => {
  const dir = tmp();
  const vault = makeVault(fake);
  const st = new Store(dir, { vault });
  st.patchSettings({ obs: { password: 'MotDePasseOBS', slToken: 'jeton-streamlabs-123' } });
  st.flush();
  st._write();
  const disk = fs.readFileSync(path.join(dir, 'data.json'), 'utf8');
  assert.ok(!disk.includes('MotDePasseOBS') && !disk.includes('jeton-streamlabs-123'), 'rien en clair sur le disque');
  assert.ok(disk.includes('enc:v1:'));
  assert.strictEqual(st.settings.obs.password, 'MotDePasseOBS', 'en mémoire, la valeur reste utilisable');
  const again = new Store(dir, { vault });
  assert.strictEqual(again.settings.obs.password, 'MotDePasseOBS');
  assert.strictEqual(again.settings.obs.slToken, 'jeton-streamlabs-123');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('coffre : les secrets en clair d\'une ancienne version sont chiffrés au démarrage', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ settings: { obs: { password: 'ancien' } } }));
  const st = new Store(dir, { vault: makeVault(fake) });
  assert.strictEqual(st.settings.obs.password, 'ancien');
  assert.ok(!fs.readFileSync(path.join(dir, 'data.json'), 'utf8').includes('"ancien"'));
  // sans chiffrement disponible (autre PC / autre compte) : illisible, donc vide plutôt que du charabia
  assert.strictEqual(new Store(dir).settings.obs.password, '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('coffre : la connexion Twitch est chiffrée sur le disque', () => {
  const dir = tmp();
  const vault = makeVault(fake);
  const settings = { chat: { enabled: true, channel: '', commands: [] } };
  const chat = new TwitchChat({ dataDir: dir, getSettings: () => settings, render: () => '', vault, clientId: 'x' });
  chat._saveAuth({ access_token: 'secret-token', refresh_token: 'secret-refresh', login: 'zoxam' });
  const disk = fs.readFileSync(path.join(dir, 'twitch-auth.json'), 'utf8');
  assert.ok(!disk.includes('secret-token') && !disk.includes('secret-refresh'));
  const again = new TwitchChat({ dataDir: dir, getSettings: () => settings, render: () => '', vault, clientId: 'x' });
  assert.strictEqual(again.auth.access_token, 'secret-token');
  assert.strictEqual(again.auth.login, 'zoxam');
  fs.rmSync(dir, { recursive: true, force: true });
});
