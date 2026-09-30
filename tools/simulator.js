#!/usr/bin/env node
'use strict';
// Faux Rocket League : rejoue des parties au format de la Stats API (TCP + WebSocket).
//
//   node tools/simulator.js otwin win loss --speed 15
//   node tools/simulator.js --interactive          (tape : win, loss, otwin, otloss, abandon, ffwin, quick, quickot)
//
// Options : --tcp 49123 --ws 49124 --speed 10 --object (Data en objet au lieu d'une chaîne JSON)
//           --log <Launch.log> (écrit aussi le journal du jeu : compte, playlist et MMR à chaque recherche)
//           --playlist 11 --team 0 --gap 3 (secondes entre deux parties) --no-wait
//           --mmr 1100 (MMR de départ) --win 15 --lose 13 (variations) --lag (le MMR de la file suit avec un match de retard)

const net = require('net');
const fs = require('fs');
const readline = require('readline');
const { WebSocketServer } = require('ws');
const { buildScenario, SCENARIOS, DEFAULT_ME } = require('./scenarios');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, v && !v.startsWith('--') ? 2 : 1);
  return v && !v.startsWith('--') ? v : true;
};
const TCP = Number(opt('tcp', 49123));
const WSP = Number(opt('ws', 49124));
const SPEED = Number(opt('speed', 10));
const AS_OBJECT = !!opt('object', false);
const LOG = opt('log', null);
const PLAYLIST = Number(opt('playlist', 11));
const TEAM = Number(opt('team', 0));
const GAP = Number(opt('gap', 3));
const NO_WAIT = !!opt('no-wait', false);
const INTERACTIVE = !!opt('interactive', false);
const QUIT = !!opt('quit', false);
let MMR = Number(opt('mmr', 1100));
const WIN_GAIN = Number(opt('win', 15));
const LOSS_DROP = Number(opt('lose', 13));
const LAG = !!opt('lag', false);
const queue = args.filter((a) => !a.startsWith('--'));

const tcpClients = new Set();
const wsClients = new Set();

const tcp = net.createServer((sock) => {
  tcpClients.add(sock);
  log(`client TCP connecté (${tcpClients.size + wsClients.size})`);
  sock.on('close', () => tcpClients.delete(sock));
  sock.on('error', () => {});
});
tcp.listen(TCP, '127.0.0.1', () => log(`TCP en écoute sur ${TCP}`));

const wss = new WebSocketServer({ host: '127.0.0.1', port: WSP }, () => log(`WebSocket en écoute sur ${WSP}`));
wss.on('connection', (ws) => {
  wsClients.add(ws);
  log(`client WebSocket connecté (${tcpClients.size + wsClients.size})`);
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => {});
});

function log(...a) {
  console.log('[sim]', ...a);
}

// Comme le jeu : un nouveau Launch.log à chaque lancement, daté, puis "[secondes] ligne"
const logStart = Math.floor(Date.now() / 1000) * 1000;
const pad2 = (n) => String(n).padStart(2, '0');
function logLine(line) {
  if (!LOG) return;
  const secs = (Date.now() - logStart) / 1000;
  fs.appendFileSync(LOG, `[${secs.toFixed(2).padStart(7, '0')}] ${line}\r\n`, 'latin1');
}

if (LOG) {
  const d = new Date(logStart);
  const stamp = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  fs.writeFileSync(LOG, `Log: Log file open, ${stamp}\r\nLog: GPsyonixBuildID simulateur\r\n`, 'latin1');
  logLine(`Party: HandleLocalPlayerLoginStatusChanged PlayerName=${DEFAULT_ME.name} PlayerID=${DEFAULT_ME.id} LoginStatus=LS_LoggedIn IsPrimary=True IsInParty=False`);
  logLine('DevOnline: Set rich presence to: Menu principal data: Menu');
}

// Lancement d'une recherche : le jeu écrit le MMR (μ) du chef de groupe pour la playlist choisie
let pendingDelta = 0;
function logQueue() {
  const mu = ((MMR - 100) / 20).toFixed(4);
  logLine('Matchmaking: OnlineGameMatchmaking_X::RecordStart');
  logLine(`Matchmaking: Pre-divide PartyLeaderMMR: ${mu}`);
  logLine(`Matchmaking: Post-divide PartyLeaderMMR: ${mu}`);
  logLine('Matchmaking: PartyLeaderTier=(16)');
  logLine(`Matchmaking: StartMatchmaking at 2026-09-30 10:00:00 in EU9,EU5 for playlists ${PLAYLIST} on game server `);
  logLine('Matchmaking: PreferredRegions.Length=(2) PreferredPlaylists.Length=(1) Party.GetOrderedPartyMemberIDs().Length=(1)');
}
function applyResult(sc) {
  if (sc.kind === 'spectate') return;
  const end = sc.events.find((e) => e.event === 'MatchEnded');
  const won = end ? end.data.WinnerTeamNum === sc.myTeam : false; // sans MatchEnded = abandon = défaite
  const delta = won ? WIN_GAIN : -LOSS_DROP;
  if (LAG) {
    // mise à jour en retard : la file suivante montre encore l'ancien MMR
    MMR += pendingDelta;
    pendingDelta = delta;
  } else MMR += delta;
}

function send(event, data) {
  // Le jeu envoie Data sous forme de chaîne JSON, sans séparateur entre les messages
  const msg = JSON.stringify({ Event: event, Data: AS_OBJECT ? data : JSON.stringify(data) });
  for (const s of tcpClients) s.write(msg);
  for (const w of wsClients) if (w.readyState === 1) w.send(msg);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function play(kind) {
  const sc = buildScenario(kind, { myTeam: TEAM, playlistId: PLAYLIST });
  log(`▶ ${kind} — ${sc.desc} (MMR en file : ${MMR})`);
  logQueue();
  await sleep(200);
  logLine(`JoinGame: StartJoin Reservation=((ServerName="SIM-EU",Playlist=${PLAYLIST},Region="EU",ReservationID="${sc.guid || 'X'}"))`);
  let last = 0;
  for (const e of sc.events) {
    const wait = ((e.t - last) * 1000) / SPEED;
    last = e.t;
    if (wait > 0) await sleep(wait);
    if (e.event === 'RoundStarted' || e.event === 'MatchEnded') {
      logLine(`DevOnline: Set rich presence to: Double in Stadium 5:00 (0 - 0) data: Playlist-${PLAYLIST}`);
    }
    send(e.event, e.data);
    if (e.event === 'MatchEnded') log(`  fin : vainqueur équipe ${e.data.WinnerTeamNum}`);
    if (e.event === 'ClockUpdatedSeconds' && e.data.bOvertime && e.data.TimeSeconds === 0) log('  OVERTIME');
  }
  logLine('DevOnline: Set rich presence to: Menu principal data: Menu');
  applyResult(sc);
  log(`■ ${kind} terminé`);
}

async function waitClient() {
  if (NO_WAIT) return;
  while (!tcpClients.size && !wsClients.size) await sleep(200);
  await sleep(300);
}

(async () => {
  for (const k of queue) {
    if (!SCENARIOS[k]) {
      console.error(`Scénario inconnu : ${k}. Disponibles : ${Object.keys(SCENARIOS).join(', ')}`);
      process.exit(1);
    }
  }
  await waitClient();
  for (const k of queue) {
    await play(k);
    await sleep((GAP * 1000) / Math.max(1, SPEED / 5));
  }
  if (INTERACTIVE) {
    const rl = readline.createInterface({ input: process.stdin });
    log(`Scénarios : ${Object.keys(SCENARIOS).join(', ')} (Entrée pour lancer, "q" pour quitter)`);
    let busy = false;
    rl.on('line', async (line) => {
      const k = line.trim();
      if (k === 'q') process.exit(0);
      if (!SCENARIOS[k]) return log(`inconnu : ${k}`);
      if (busy) return log('une partie est déjà en cours');
      busy = true;
      await play(k);
      busy = false;
    });
  } else if (QUIT || queue.length) {
    // une dernière recherche, pour que le jeu donne le MMR après la dernière partie
    if (queue.length) logQueue();
    await sleep(500);
    process.exit(0);
  }
})();
