'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');
const { TwitchChat, parseIrc, matchCommand, chatSafe } = require('../core/twitch');

test('chat : lecture des messages IRC de Twitch (tags, auteur, texte)', () => {
  const m = parseIrc('@badge-info=;display-name=Viewer\\s1;id=abc-123 :viewer1!viewer1@viewer1.tmi.twitch.tv PRIVMSG #zoxam :!wl stp');
  assert.strictEqual(m.command, 'PRIVMSG');
  assert.deepStrictEqual(m.params, ['#zoxam', '!wl stp']);
  assert.strictEqual(m.tags['display-name'], 'Viewer 1');
  assert.strictEqual(m.tags.id, 'abc-123');
  assert.strictEqual(parseIrc('PING :tmi.twitch.tv').params[0], 'tmi.twitch.tv');
});

test('chat : commandes, alias et commandes désactivées', () => {
  const cmds = [
    { name: 'wl', aliases: 'record, !score', enabled: true },
    { name: 'ot', aliases: '', enabled: false },
  ];
  assert.strictEqual(matchCommand('!WL', cmds).name, 'wl');
  assert.strictEqual(matchCommand('!score please', cmds).name, 'wl');
  assert.strictEqual(matchCommand('!ot', cmds), null);
  assert.strictEqual(matchCommand('hello !wl', cmds), null);
  assert.strictEqual(chatSafe('a\r\nPRIVMSG #x :pirate'), 'a PRIVMSG #x :pirate');
});

test('chat : connexion par code, puis réponse à !wl dans le chat (faux Twitch)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlui-tw-'));
  const irc = new WebSocketServer({ port: 0 });
  await new Promise((r) => irc.on('listening', r));
  const received = [];
  let sock;
  irc.on('connection', (ws) => {
    sock = ws;
    ws.on('message', (raw) => {
      const line = raw.toString();
      received.push(line);
      if (line.startsWith('JOIN ')) ws.send(`@room-id=1 :tmi.twitch.tv ROOMSTATE ${line.slice(5)}\r\n`);
    });
  });
  let polls = 0;
  const fetchImpl = async (url, opts = {}) => {
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (url.endsWith('/oauth2/device')) return json(200, { device_code: 'DEV', user_code: 'ABCD-EFGH', verification_uri: 'https://www.twitch.tv/activate', expires_in: 600, interval: 5 });
    if (url.endsWith('/oauth2/token')) return ++polls < 2 ? json(400, { message: 'authorization_pending' }) : json(200, { access_token: 'tok', refresh_token: 'ref' });
    if (url.endsWith('/oauth2/validate')) {
      assert.strictEqual(opts.headers.Authorization, 'OAuth tok');
      return json(200, { login: 'zoxam', user_id: '42' });
    }
    throw new Error(url);
  };
  const settings = { chat: { enabled: true, channel: '', cooldown: 30, commands: [{ name: 'wl', aliases: '', enabled: true, text: '' }] } };
  const chat = new TwitchChat({ dataDir: dir, getSettings: () => settings, render: () => 'Zoxam: 12W - 5L', fetchImpl, clientId: 'test', ircUrl: `ws://127.0.0.1:${irc.address().port}`, pollMs: 30 });

  const st = await chat.startLogin();
  assert.strictEqual(st.code, 'ABCD-EFGH');
  await waitFor(() => chat.state === 'connected');
  assert.ok(received.includes('PASS oauth:tok'));
  assert.ok(received.includes('JOIN #zoxam'));
  assert.ok(!JSON.stringify(chat.status()).includes('tok'), 'le jeton ne sort jamais vers les pages');
  assert.ok(fs.existsSync(path.join(dir, 'twitch-auth.json')));

  sock.send('@display-name=Viewer;id=m1 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #zoxam :!wl\r\n');
  sock.send('@display-name=Viewer;id=m2 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #zoxam :!wl\r\n'); // délai : ignoré
  await waitFor(() => received.some((l) => l.includes('PRIVMSG #zoxam :')));
  await new Promise((r) => setTimeout(r, 100));
  const replies = received.filter((l) => l.includes('PRIVMSG #zoxam :'));
  assert.deepStrictEqual(replies, ['@reply-parent-msg-id=m1 PRIVMSG #zoxam :Zoxam: 12W - 5L']);

  chat.logout();
  assert.ok(!fs.existsSync(path.join(dir, 'twitch-auth.json')));
  irc.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function waitFor(fn, ms = 4000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('délai dépassé');
    await new Promise((r) => setTimeout(r, 20));
  }
}
