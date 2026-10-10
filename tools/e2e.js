#!/usr/bin/env node
'use strict';
// Test de bout en bout : faux Rocket League (simulateur) -> tracker sans interface -> API HTTP / WebSocket / fichiers texte.
//   node tools/e2e.js [--object] [--transport tcp|ws|auto]

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const transport = args.includes('--transport') ? args[args.indexOf('--transport') + 1] : 'auto';
const asObject = args.includes('--object');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-ui-e2e-'));
const docs = path.join(tmp, 'docs');
const cfgDir = path.join(docs, 'My Games', 'Rocket League', 'TAGame', 'Config');
const logDir = path.join(docs, 'My Games', 'Rocket League', 'TAGame', 'Logs');
fs.mkdirSync(cfgDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
fs.writeFileSync(path.join(cfgDir, 'TAStatsAPI.ini'), '[TAGame.MatchStatsExporter_TA]\r\nPort=59123\r\nWebPort=59124\r\nPacketSendRate=1\r\n');
const dataDir = path.join(tmp, 'data');
const PORT = 5890;
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'data.json'), JSON.stringify({ settings: { port: PORT, stats: { transport } } }));

const get = (p) =>
  new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${PORT}${p}`, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      })
      .on('error', reject);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => {
  console.error(`✖ ${msg}`);
  cleanup(1);
};
const ok = (cond, msg) => (cond ? console.log(`✔ ${msg}`) : fail(msg));

const env = { ...process.env, RLUI_DATA: dataDir, RLUI_DOCS: docs };
const app = spawn(process.execPath, [path.join(root, 'tools', 'headless.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let appOut = '';
app.stdout.on('data', (d) => (appOut += d));
app.stderr.on('data', (d) => (appOut += d));
let sim = null;

function cleanup(code) {
  try {
    app.kill();
  } catch {}
  try {
    sim && sim.kill();
  } catch {}
  if (code) console.error('--- sortie du tracker ---\n' + appOut);
  setTimeout(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
    process.exit(code);
  }, 300);
}

(async () => {
  for (let i = 0; i < 50 && !appOut.includes('tableau de bord'); i++) await sleep(100);
  ok(appOut.includes(`127.0.0.1:${PORT}`), `tracker démarré sur ${PORT}`);

  // Un overlay connecté en WebSocket doit recevoir les alertes
  const alerts = [];
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  ws.on('message', (m) => {
    const msg = JSON.parse(m);
    if (msg.type === 'alert') alerts.push(msg.alert.type);
  });
  await new Promise((r) => ws.on('open', r));

  const simArgs = [path.join(root, 'tools', 'simulator.js'), 'win', 'otwin', 'loss', 'abandon', '--tcp', '59123', '--ws', '59124', '--speed', '60', '--gap', '1', '--log', path.join(logDir, 'Launch.log')];
  if (asObject) simArgs.push('--object');
  sim = spawn(process.execPath, simArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  let simOut = '';
  sim.stdout.on('data', (d) => (simOut += d));
  await new Promise((r) => sim.on('exit', r));
  await sleep(2200);

  const st = JSON.parse((await get('/api/state')).body);
  const s = st.session;
  ok(s.wins === 2 && s.losses === 2, `session 2V - 2D (obtenu ${s.wins}V - ${s.losses}D)`);
  ok(s.otWins === 1, 'une victoire en overtime');
  ok(s.abandons === 1, 'un abandon compté en défaite (classé)');
  ok(st.status.account === 'Zoxam', 'compte détecté dans Launch.log');
  ok(alerts.join(',') === 'win,overtime,ot_win,loss', `alertes reçues : ${alerts.join(',')}`);

  const unauth = await get('/api/dashboard');
  ok(unauth.status === 401, 'API protégée sans clé');
  const settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'data.json'), 'utf8')).settings;
  const dash = JSON.parse((await get(`/api/dashboard?key=${settings.apiKey}`)).body);
  ok(dash.sessionMatches[1].playlistName === '2v2 Ranked', `playlist lue dans le log : ${dash.sessionMatches[1].playlistName}`);
  const conn = dash.logs.map((l) => l.msg).find((m) => m.startsWith('Connected to the Stats API')) || '';
  const expected = { tcp: '(TCP)', ws: '(WebSocket)', auto: '(' }[transport];
  ok(conn.includes(expected), `transport utilisé : ${conn}`);

  // MMR : 1100 -> +15 +15 -13 -13 (abandon) = 1104, lu dans le journal à chaque recherche
  const mm = st.session.mmr && st.session.mmr.primary;
  ok(mm && mm.current === 1104 && mm.delta === 4 && !mm.approx, `MMR de session : ${mm && `${mm.current} (${mm.delta > 0 ? '+' : ''}${mm.delta})${mm.approx ? ' ≈' : ''}`}`);
  const deltas = dash.sessionMatches.map((m) => m.mmr && `${m.mmr.status}:${m.mmr.delta}`).reverse().join(' ');
  ok(deltas === 'exact:15 exact:15 exact:-13 exact:-13', `variations par partie : ${deltas}`);
  const mmrTxt = (await get('/api/text/mmrsession')).body;
  ok(mmrTxt === '+4', `/api/text/mmrsession = ${mmrTxt}`);

  const rec = (await get('/api/text/record')).body;
  ok(rec === '2 - 2', `/api/text/record = ${rec}`);
  const txt = fs.readFileSync(path.join(dataDir, 'texte', 'record.txt'), 'utf8');
  ok(txt === '2 - 2', 'fichier texte record.txt');

  const r1 = JSON.parse((await get(`/api/action/win?key=${settings.apiKey}`)).body);
  ok(r1.stats.wins === 3, 'action +1 victoire (Stream Deck)');
  const r2 = JSON.parse((await get(`/api/action/undo?key=${settings.apiKey}`)).body);
  ok(r2.stats.wins === 2, 'annuler la dernière partie');

  // Diagnostic : une entrée par partie vue, avec sa raison et sa trace ; rapport sans la clé d'accès
  const diag = JSON.parse((await get(`/api/diagnostic?key=${settings.apiKey}`)).body);
  ok(diag.journal.length === 4 && diag.journal.every((e) => e.outcome === 'counted' && e.why && e.trace.length > 3), `diagnostic : 4 parties vues et expliquées (${diag.journal.length})`);
  ok(diag.checks.some((c) => c.id === 'account' && c.level === 'ok') && diag.checks.some((c) => c.id === 'log' && c.level === 'ok'), 'diagnostic : compte et journal du jeu au vert');
  const report = (await get(`/api/diagnostic/report?key=${settings.apiKey}`)).body;
  ok(report.includes('RL-UI') && report.includes('decision: counted') && !report.includes(settings.apiKey), 'rapport de diagnostic sans la clé d\'accès');
  ok((await get('/api/diagnostic')).status === 401, 'diagnostic protégé sans clé');

  // Statistiques : vue d'ensemble de la session, sessions, courbe de MMR, export
  const stv = JSON.parse((await get(`/api/stats?range=session&key=${settings.apiKey}`)).body);
  ok(stv.overview.played === 4 && stv.overview.wins === 2 && stv.overview.overtime.played === 1 && stv.modes[0].played === 4, `statistiques : vue d'ensemble de la session (${stv.overview.wins}-${stv.overview.losses})`);
  const sl = JSON.parse((await get(`/api/sessions?key=${settings.apiKey}`)).body);
  ok(sl.sessions.length === 1 && sl.sessions[0].current && sl.sessions[0].played === 4 && Math.round(sl.sessions[0].mmrDelta) === 4, 'statistiques : la session et sa variation de MMR');
  const sd = JSON.parse((await get(`/api/sessions/${sl.sessions[0].id}?key=${settings.apiKey}`)).body);
  ok(sd.overview.results.length === 4 && sd.player === 'Zoxam', 'statistiques : bilan détaillé de la session');
  const ms = JSON.parse((await get(`/api/stats/mmr?range=all&key=${settings.apiKey}`)).body);
  ok(ms.series.length === 1 && ms.series[0].points.length >= 5 && ms.series[0].current === 1104, `statistiques : courbe du MMR (${ms.series[0] && ms.series[0].points.length} points)`);
  const csvText = (await get(`/api/history.csv?scope=all&key=${settings.apiKey}`)).body;
  ok(csvText.trim().split('\r\n').length === 5, 'export CSV : une ligne par partie');

  const page = await get('/overlay/counter');
  ok(page.status === 200 || page.status === 404, 'route overlay');

  // Sécurité : un site web ouvert dans le navigateur ne doit pas pouvoir lire le flux en direct
  const wsFrom = (origin) =>
    new Promise((r) => {
      const c = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, origin ? { headers: { Origin: origin } } : {});
      c.on('message', () => {
        c.close();
        r(true);
      });
      c.on('error', () => r(false));
      c.on('close', () => r(false));
      setTimeout(() => r(false), 2000);
    });
  ok((await wsFrom(`http://127.0.0.1:${PORT}`)) === true, 'WebSocket : nos propres pages acceptées');
  ok((await wsFrom('https://evil.example')) === false, 'WebSocket : un site extérieur est refusé');

  // Langue : anglais par défaut, passage en français
  ok(/lang="en"/.test(page.body), 'overlay servi en anglais par défaut');
  await fetch(`http://127.0.0.1:${PORT}/api/settings?key=${settings.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'fr' }) });
  const dashFr = JSON.parse((await get(`/api/dashboard?key=${settings.apiKey}`)).body);
  ok(dashFr.sessionMatches[1].playlistName === '2v2 Classé', `en français : ${dashFr.sessionMatches[1].playlistName}`);
  ok(/lang="fr"/.test((await get('/overlay/counter')).body), 'overlay servi en français');
  console.log(`\nTout est OK (${transport}${asObject ? ', Data objet' : ', Data chaîne'})`);
  ws.close();
  cleanup(0);
})().catch((e) => fail(e.stack));
