'use strict';
// Générateur de parties réalistes au format Stats API (pour les tests et le simulateur).

const crypto = require('crypto');

const DEFAULT_ME = { name: 'Zoxam', id: 'Steam|76561190000000001|0' };

// Chaque scénario : buts [secondeDeJeu, équipe] ; ot: but en prolongation [secondeOT, équipe]
const SCENARIOS = {
  win: { goals: [[260, 0], [190, 1], [120, 0], [45, 0]], desc: 'Victoire 3-1' },
  loss: { goals: [[250, 1], [140, 0], [30, 1]], desc: 'Défaite 1-2' },
  otwin: { goals: [[230, 0], [150, 1], [90, 1], [12, 0]], ot: [37, 0], desc: 'Victoire en overtime 3-2' },
  otloss: { goals: [[200, 1], [66, 0]], ot: [81, 1], desc: 'Défaite en overtime 1-2' },
  abandon: { goals: [[240, 1]], leaveAt: 170, desc: 'Abandon en cours de partie (0-1)' },
  ffwin: { goals: [[250, 0], [200, 0], [150, 0]], forfeitAt: 120, forfeitWinner: 0, desc: 'Les adversaires déclarent forfait' },
  spectate: { goals: [[200, 0]], spectate: true, desc: 'Spectateur (non compté)' },
  quick: { goals: [[4, 0]], length: 8, desc: 'Victoire rapide (démo)' },
  quickot: { goals: [], length: 4, ot: [3, 0], desc: 'Overtime rapide (démo)' },
};

function buildScenario(kind, opts = {}) {
  const sc = SCENARIOS[kind];
  if (!sc) throw new Error(`Scénario inconnu : ${kind}`);
  const me = { ...DEFAULT_ME, ...(opts.me || {}) };
  const myTeam = opts.myTeam ?? 0;
  const guid = opts.guid === null ? null : opts.guid || crypto.randomBytes(16).toString('hex').toUpperCase();
  const rate = opts.rate ?? 1; // UpdateState par seconde de jeu
  const length = sc.length ?? 300;
  const mode = opts.teamSize ?? 2;

  // Joueurs
  const players = [];
  let shortcut = 1;
  const mk = (name, id, team) => ({
    Name: name,
    PrimaryId: id,
    Shortcut: shortcut++,
    TeamNum: team,
    Score: 0,
    Goals: 0,
    Shots: 0,
    Assists: 0,
    Saves: 0,
    Touches: 0,
    CarTouches: 0,
    Demos: 0,
  });
  if (!sc.spectate) players.push(mk(me.name, me.id, myTeam));
  const mates = ['Turbo', 'Kickoff', 'Pinch', 'Wavedash', 'Aerial', 'Demo'];
  let mi = 0;
  const epic = () => `Epic|${crypto.randomBytes(16).toString('hex')}|0`;
  while (players.filter((p) => p.TeamNum === myTeam).length < mode) players.push(mk(mates[mi++], epic(), myTeam));
  while (players.filter((p) => p.TeamNum === 1 - myTeam).length < mode) players.push(mk(mates[mi++], epic(), 1 - myTeam));

  // Noms d'équipe localisés comme dans le jeu en français
  const teams = [
    { Name: 'Bleu', TeamNum: 0, Score: 0, ColorPrimary: '1873FF', ColorSecondary: 'E5E5E5' },
    { Name: 'Orange', TeamNum: 1, Score: 0, ColorPrimary: 'C26418', ColorSecondary: 'E5E5E5' },
  ];

  const events = [];
  let t = 0; // secondes "réelles" depuis le début
  const push = (event, data = {}) => events.push({ t, event, data: guid ? { MatchGuid: guid, ...data } : { ...data } });
  let time = length;
  let overtime = false;
  let winnerName = '';
  let hasWinner = false;

  const state = () => ({
    Players: players.map((p) => ({ ...p, Speed: 0, Boost: 33, bBoosting: false, bOnGround: true, bOnWall: false, bPowersliding: false, bDemolished: false, bSupersonic: false })),
    Game: {
      Teams: teams.map((x) => ({ ...x })),
      ...(opts.playlistId != null ? { PlaylistId: opts.playlistId } : {}),
      TimeSeconds: time,
      bOvertime: overtime,
      Ball: { Speed: 0, TeamNum: 255 },
      bReplay: false,
      bHasWinner: hasWinner,
      Winner: winnerName,
      Arena: 'Stadium_P',
      bHasTarget: !sc.spectate,
      ...(sc.spectate ? {} : { Target: { Name: me.name, Shortcut: players[0].Shortcut, TeamNum: myTeam } }),
    },
  });

  const scorer = (team) => {
    const cands = players.filter((p) => p.TeamNum === team);
    return cands[Math.floor((t * 7) % cands.length)] || cands[0];
  };

  const goal = (team) => {
    const s = scorer(team);
    s.Goals++;
    s.Score += 100;
    s.Shots++;
    const mate = players.find((p) => p.TeamNum === team && p !== s);
    if (mate && t % 2 === 0) {
      mate.Assists++;
      mate.Score += 50;
    }
    const opp = players.find((p) => p.TeamNum !== team);
    if (opp) {
      opp.Saves += t % 3 === 0 ? 1 : 0;
      opp.Score += 10;
    }
    teams[team].Score++;
    push('GoalScored', {
      GoalSpeed: 92.4,
      GoalTime: 300 - time,
      ImpactLocation: { X: 0, Y: team === 0 ? 5120 : -5120, Z: 320 },
      Scorer: { Name: s.Name, Shortcut: s.Shortcut, TeamNum: team },
      BallLastTouch: { Player: { Name: s.Name, Shortcut: s.Shortcut, TeamNum: team }, Speed: 92.4 },
      ...(mate && t % 2 === 0 ? { Assister: { Name: mate.Name, Shortcut: mate.Shortcut, TeamNum: team } } : {}),
    });
    push('StatfeedEvent', { EventName: 'Goal', Type: 'But', MainTarget: { Name: s.Name, Shortcut: s.Shortcut, TeamNum: team } });
  };

  push('MatchCreated');
  push('MatchInitialized');
  t += 1;
  push('UpdateState', state());
  t += 2;
  push('CountdownBegin');
  t += 3;
  push('RoundStarted');

  const goals = new Map(sc.goals.map(([s, team]) => [s, team]));
  const tick = () => {
    push('ClockUpdatedSeconds', { TimeSeconds: time, bOvertime: overtime });
    if (rate > 0 && Math.round(t * rate) % Math.max(1, Math.round(rate)) === 0) push('UpdateState', state());
  };

  let ended = false;
  while (!ended) {
    t += 1;
    if (!overtime) time -= 1;
    else time += 1;
    tick();
    if (rate > 1) for (let i = 1; i < rate; i++) push('UpdateState', state());

    if (!overtime && goals.has(time)) {
      goal(goals.get(time));
      push('UpdateState', state());
      t += 1;
      push('GoalReplayStart');
      t += 5;
      // Comme le vrai jeu : faux GoalScored (buteur vide) à la fin du replay
      push('GoalScored', {
        GoalSpeed: 0,
        GoalTime: 0,
        ImpactLocation: { X: 0, Y: 5120, Z: 320 },
        Scorer: { Name: '', Shortcut: 0, TeamNum: 0 },
        BallLastTouch: { Player: { Name: '', Shortcut: 0, TeamNum: 0 }, Speed: 0 },
      });
      push('GoalReplayEnd');
      push('CountdownBegin');
      t += 3;
      push('RoundStarted');
    }
    if (sc.leaveAt != null && time === sc.leaveAt) {
      t += 1;
      push('MatchDestroyed');
      return { events, guid, me, myTeam, desc: sc.desc, kind };
    }
    if (sc.forfeitAt != null && time === sc.forfeitAt) {
      hasWinner = true;
      winnerName = teams[sc.forfeitWinner].Name;
      t += 1;
      push('MatchEnded', { WinnerTeamNum: sc.forfeitWinner });
      break;
    }
    if (!overtime && time <= 0) {
      if (teams[0].Score === teams[1].Score && sc.ot) {
        overtime = true;
        time = 0;
        t += 1;
        push('ClockUpdatedSeconds', { TimeSeconds: 0, bOvertime: true });
        push('UpdateState', state());
        push('CountdownBegin');
        t += 3;
        push('RoundStarted');
      } else {
        const w = teams[0].Score > teams[1].Score ? 0 : 1;
        hasWinner = true;
        winnerName = teams[w].Name;
        t += 1;
        push('MatchEnded', { WinnerTeamNum: w });
        break;
      }
    }
    if (overtime && sc.ot && time === sc.ot[0]) {
      goal(sc.ot[1]);
      hasWinner = true;
      winnerName = teams[sc.ot[1]].Name;
      t += 0.2;
      push('MatchEnded', { WinnerTeamNum: sc.ot[1] });
      break;
    }
    if (t > 2000) ended = true;
  }
  // Podium + écran de fin
  t += 1;
  push('UpdateState', state());
  t += 2;
  push('PodiumStart');
  push('StatfeedEvent', { EventName: 'MVP', Type: 'MVP', MainTarget: pickMvp(players, hasWinner ? teams.findIndex((x) => x.Name === winnerName) : 0) });
  t += 1;
  push('UpdateState', state());
  t += 6;
  push('MatchDestroyed');
  return { events, guid, me, myTeam, desc: sc.desc, kind };
}

function pickMvp(players, team) {
  const best = players.filter((p) => p.TeamNum === team).sort((a, b) => b.Score - a.Score)[0];
  return best ? { Name: best.Name, Shortcut: best.Shortcut, TeamNum: best.TeamNum } : null;
}

module.exports = { buildScenario, SCENARIOS, DEFAULT_ME };
