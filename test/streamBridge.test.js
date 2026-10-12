'use strict';
// Pont vers le logiciel de stream, testé contre de faux serveurs OBS (obs-websocket v5) et Streamlabs (JSON-RPC)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { WebSocketServer } = require('ws');
const { StreamBridge, obsAuthString } = require('../core/streamBridge');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(20);
  }
  return false;
};

function settings(obs) {
  const action = (type = 'none', extra = {}) => ({ type, scene: '', source: '', duration: 0.15, returnBack: true, ...extra });
  return {
    obs: {
      enabled: true,
      software: 'obs',
      host: '127.0.0.1',
      port: 0,
      password: '',
      slPort: 0,
      slToken: '',
      actions: { win: action(), loss: action(), overtime: action(), ot_win: action(), ot_loss: action(), streak: action() },
      ...obs,
    },
  };
}

// ---- faux OBS
function fakeObs(password) {
  const log = [];
  const state = { scene: 'Jeu', inputs: {}, items: { Jeu: [{ sceneItemId: 7, sourceName: 'Cam hype', enabled: false }], Victoire: [] } };
  const wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (ws) => {
    const salt = 'sel';
    const challenge = 'defi';
    ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.9.9', rpcVersion: 1, authentication: password ? { salt, challenge } : undefined } }));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.op === 1) {
        if (password && m.d.authentication !== obsAuthString(password, salt, challenge)) return ws.close(4009);
        return ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      }
      if (m.op !== 6) return;
      const { requestType: t, requestId, requestData: d } = m.d;
      log.push(t);
      let data = {};
      if (t === 'GetCurrentProgramScene') data = { currentProgramSceneName: state.scene };
      if (t === 'SetCurrentProgramScene') state.scene = d.sceneName;
      if (t === 'GetSceneItemId') data = { sceneItemId: (state.items[d.sceneName].find((i) => i.sourceName === d.sourceName) || {}).sceneItemId };
      if (t === 'SetSceneItemEnabled') state.items[d.sceneName].find((i) => i.sceneItemId === d.sceneItemId).enabled = d.sceneItemEnabled;
      if (t === 'GetSceneList') data = { currentProgramSceneName: state.scene, scenes: [{ sceneName: 'Victoire' }, { sceneName: 'Jeu' }] };
      if (t === 'GetSceneItemList') data = { sceneItems: state.items[d.sceneName].map((i) => ({ sourceName: i.sourceName })) };
      let okStatus = true;
      if (t === 'GetSceneItemId' && !state.items[d.sceneName].some((i) => i.sourceName === d.sourceName)) okStatus = false;
      if (t === 'GetVideoSettings') data = { baseWidth: 2560, baseHeight: 1440 };
      if (t === 'GetInputList') data = { inputs: Object.keys(state.inputs).map((inputName) => ({ inputName, inputKind: 'browser_source' })) };
      if (t === 'CreateInput') {
        state.inputs[d.inputName] = d.inputSettings;
        state.items[d.sceneName].push({ sceneItemId: 100 + state.items[d.sceneName].length, sourceName: d.inputName, enabled: true });
      }
      if (t === 'SetInputSettings') Object.assign(state.inputs[d.inputName], d.inputSettings);
      if (t === 'CreateSceneItem') state.items[d.sceneName].push({ sceneItemId: 100 + state.items[d.sceneName].length, sourceName: d.sourceName, enabled: true });
      if (!okStatus) return ws.send(JSON.stringify({ op: 7, d: { requestType: t, requestId, requestStatus: { result: false, code: 600, comment: 'No source was found' } } }));
      ws.send(JSON.stringify({ op: 7, d: { requestType: t, requestId, requestStatus: { result: true, code: 100 }, responseData: data } }));
    });
  });
  return new Promise((r) => wss.on('listening', () => r({ wss, port: wss.address().port, state, log })));
}

// ---- faux Streamlabs Desktop
function fakeStreamlabs(token) {
  const state = { active: 's1', visible: false, calls: [] };
  const scenes = [
    { _type: 'HELPER', resourceId: 'Scene["s1"]', id: 's1', name: 'Jeu' },
    { _type: 'HELPER', resourceId: 'Scene["s2"]', id: 's2', name: 'Victoire' },
  ];
  const server = http.createServer();
  const wss = new WebSocketServer({ server, path: '/api/websocket' });
  wss.on('connection', (ws) => {
    let authed = false;
    ws.on('message', (raw) => {
      for (const line of String(raw).split('\n').filter(Boolean)) {
        const m = JSON.parse(line);
        const { resource, args } = m.params;
        state.calls.push(`${resource}.${m.method}`);
        const reply = (result) => ws.send(JSON.stringify({ id: m.id, jsonrpc: '2.0', result }));
        const fail = (message) => ws.send(JSON.stringify({ id: m.id, jsonrpc: '2.0', error: { code: -32603, message } }));
        if (m.method === 'auth') {
          if (args[0] !== token) return fail('INTERNAL_JSON_RPC_ERROR Invalid token');
          authed = true;
          return reply(true);
        }
        if (!authed) return fail('INTERNAL_JSON_RPC_ERROR Authorization required. Use TcpServerService.auth(token) method');
        if (m.method === 'getScenes') return reply(scenes);
        if (m.method === 'activeSceneId') return reply(state.active);
        if (m.method === 'makeSceneActive') {
          state.active = args[0];
          return reply(true);
        }
        if (m.method === 'getItems') {
          return reply(resource === 'Scene["s1"]' ? [{ _type: 'HELPER', resourceId: 'SceneItem["s1","i1","src1"]', sceneItemId: 'i1', sourceId: 'src1', name: 'Cam hype', visible: state.visible }] : []);
        }
        if (m.method === 'createAndAddSource' && resource === 'Scene["s1"]') {
          state.added = { name: args[0], type: args[1], settings: args[2] };
          return reply({ sceneItemId: 'i2', sourceId: 'src2', name: args[0] });
        }
        if (m.method === 'updateSettings' && resource === 'Source["src1"]') {
          state.updated = args[0];
          return reply(null);
        }
        if (m.method === 'setVisibility' && resource === 'SceneItem["s1","i1","src1"]') {
          state.visible = args[0];
          return reply(null);
        }
        fail('méthode inconnue');
      }
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, wss, port: server.address().port, state })));
}

test('OBS : mot de passe, source affichée puis masquée, scène avec retour', async () => {
  const fake = await fakeObs('secret');
  const s = settings({ port: fake.port, password: 'secret' });
  s.obs.actions.overtime = { type: 'source', scene: 'Jeu', source: 'Cam hype', duration: 0.15, returnBack: true };
  s.obs.actions.win = { type: 'scene', scene: 'Victoire', source: '', duration: 0.15, returnBack: true };
  const b = new StreamBridge(() => s);
  b.apply();
  assert.ok(await waitFor(() => b.state === 'connected'), `état ${b.state} ${b.error}`);
  assert.strictEqual(b.status.name, 'OBS');
  assert.strictEqual(await b.trigger('overtime'), true);
  assert.strictEqual(fake.state.items.Jeu[0].enabled, true);
  assert.ok(await waitFor(() => fake.state.items.Jeu[0].enabled === false), 'source masquée après la durée');
  assert.strictEqual(await b.trigger('ot_win'), true, 'OT gagné sans action -> action de victoire');
  assert.strictEqual(fake.state.scene, 'Victoire');
  assert.ok(await waitFor(() => fake.state.scene === 'Jeu'), 'retour à la scène précédente');
  const list = await b.listScenes();
  assert.deepStrictEqual(list.scenes.map((x) => x.name), ['Jeu', 'Victoire']);
  b.stop();
  fake.wss.close();
});

test('OBS : mauvais mot de passe', async () => {
  const fake = await fakeObs('secret');
  const b = new StreamBridge(() => settings({ port: fake.port, password: 'faux' }));
  b.apply();
  assert.ok(await waitFor(() => b.state === 'error'));
  assert.match(b.error, /password/i);
  b.stop();
  fake.wss.close();
});

test('Streamlabs : jeton, source et scène', async () => {
  const fake = await fakeStreamlabs('jeton-123');
  const s = settings({ software: 'streamlabs', slPort: fake.port, slToken: 'jeton-123' });
  s.obs.actions.overtime = { type: 'source', scene: 'Jeu', source: 'Cam hype', duration: 0.15, returnBack: true };
  s.obs.actions.win = { type: 'scene', scene: 'Victoire', source: '', duration: 0.15, returnBack: true };
  const b = new StreamBridge(() => s);
  b.apply();
  assert.ok(await waitFor(() => b.state === 'connected'), `état ${b.state} ${b.error}`);
  assert.strictEqual(b.status.name, 'Streamlabs');
  assert.strictEqual(await b.trigger('overtime'), true);
  assert.strictEqual(fake.state.visible, true);
  assert.ok(await waitFor(() => fake.state.visible === false), 'source masquée après la durée');
  assert.strictEqual(await b.trigger('win'), true);
  assert.strictEqual(fake.state.active, 's2');
  assert.ok(await waitFor(() => fake.state.active === 's1'), 'retour à la scène précédente');
  const list = await b.listScenes();
  assert.strictEqual(list.current, 'Jeu');
  assert.deepStrictEqual(list.scenes.map((x) => `${x.name}:${x.sources.join('+')}`), ['Jeu:Cam hype', 'Victoire:']);
  b.stop();
  fake.wss.close();
  fake.server.close();
});

test('Streamlabs : jeton refusé', async () => {
  const fake = await fakeStreamlabs('bon');
  const b = new StreamBridge(() => settings({ software: 'streamlabs', slPort: fake.port, slToken: 'mauvais' }));
  b.apply();
  assert.ok(await waitFor(() => b.state === 'error'));
  assert.strictEqual(b.error, 'Streamlabs token rejected');
  b.stop();
  fake.wss.close();
  fake.server.close();
});

test('Streamlabs : source introuvable signalée dans le journal', async () => {
  const fake = await fakeStreamlabs('t');
  const s = settings({ software: 'streamlabs', slPort: fake.port, slToken: 't' });
  s.obs.actions.loss = { type: 'source', scene: 'Jeu', source: 'Inexistante', duration: 1, returnBack: true };
  const b = new StreamBridge(() => s);
  const logs = [];
  b.on('log', (m) => logs.push(m));
  b.apply();
  assert.ok(await waitFor(() => b.state === 'connected'));
  assert.strictEqual(await b.trigger('loss'), false);
  assert.match(logs[0], /Source “Inexistante” not found/);
  b.stop();
  fake.wss.close();
  fake.server.close();
});

test('OBS : ajouter un overlay comme source navigateur, puis le mettre à jour sans doublon', async () => {
  const fake = await fakeObs('');
  const b = new StreamBridge(() => settings({ port: fake.port }));
  b.apply();
  assert.ok(await waitFor(() => b.state === 'connected'));
  const src = { name: 'RL-UI Counter', url: 'http://127.0.0.1:5757/overlay/counter', width: 1000, height: 220 };
  const r1 = await b.addBrowserSource(src);
  assert.deepStrictEqual(r1, { scene: 'Jeu', created: true, width: 1000, height: 220 });
  assert.deepStrictEqual(fake.state.inputs['RL-UI Counter'], { url: src.url, width: 1000, height: 220, reroute_audio: false });
  assert.ok(fake.state.items.Jeu.some((i) => i.sourceName === 'RL-UI Counter'));
  // la même source dans une autre scène : adresse mise à jour, posée dans la scène affichée, pas recréée
  fake.state.scene = 'Victoire';
  const r2 = await b.addBrowserSource({ ...src, url: 'http://127.0.0.1:5999/overlay/counter' });
  assert.strictEqual(r2.created, false);
  assert.strictEqual(fake.state.inputs['RL-UI Counter'].url, 'http://127.0.0.1:5999/overlay/counter');
  assert.strictEqual(fake.state.items.Victoire.filter((i) => i.sourceName === 'RL-UI Counter').length, 1);
  assert.strictEqual(fake.log.filter((t) => t === 'CreateInput').length, 1);
  // alertes : taille du canevas d'OBS, son renvoyé vers OBS
  const r3 = await b.addBrowserSource({ name: 'RL-UI Alerts', url: 'http://127.0.0.1:5757/overlay/alerts', width: 1920, height: 1080, audio: true, canvas: true });
  assert.deepStrictEqual([r3.width, r3.height], [2560, 1440]);
  assert.strictEqual(fake.state.inputs['RL-UI Alerts'].reroute_audio, true);
  b.stop();
  fake.wss.close();
});

test('Streamlabs : ajouter un overlay, ou mettre à jour la source du même nom', async () => {
  const fake = await fakeStreamlabs('t');
  const b = new StreamBridge(() => settings({ software: 'streamlabs', slPort: fake.port, slToken: 't' }));
  b.apply();
  assert.ok(await waitFor(() => b.state === 'connected'));
  const r = await b.addBrowserSource({ name: 'RL-UI Counter', url: 'http://127.0.0.1:5757/overlay/counter', width: 1000, height: 220 });
  assert.strictEqual(r.created, true);
  assert.deepStrictEqual(fake.state.added, { name: 'RL-UI Counter', type: 'browser_source', settings: { url: 'http://127.0.0.1:5757/overlay/counter', width: 1000, height: 220 } });
  const r2 = await b.addBrowserSource({ name: 'Cam hype', url: 'http://x/', width: 10, height: 10 });
  assert.strictEqual(r2.created, false);
  assert.deepStrictEqual(fake.state.updated, { url: 'http://x/', width: 10, height: 10 });
  b.stop();
  fake.wss.close();
  fake.server.close();
});

test('ajouter un overlay sans logiciel connecté : erreur claire', async () => {
  const s = settings({ enabled: false });
  const b = new StreamBridge(() => s);
  b.apply();
  await assert.rejects(() => b.addBrowserSource({ name: 'x', url: 'http://x/', width: 1, height: 1 }), /OBS/);
});
