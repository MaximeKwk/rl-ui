'use strict';
// Mode caster (spectateur) : état complet de la partie observée, pour l'overlay des casteurs.
// Indépendant du tracker V/D : tous les joueurs, boost, stats, joueur suivi, buts et statfeed.

const { EventEmitter } = require('events');

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const color = (c) => (c ? `#${String(c).replace('#', '').slice(0, 6)}` : '');
const pkey = (p) => (p ? `${num(p.TeamNum, 9)}:${p.Name || ''}` : '');
// Événements du statfeed déjà montrés ailleurs (bannière de but, tableau final) ou trop fréquents
// durée du tableau final après la fermeture de la partie
const POSTGAME_MS = 25000;
const QUIET_FEED = new Set(['Goal', 'Assist', 'Shot', 'Win', 'MVP', 'Clear', 'Center', 'PoolShot', 'LowFive', 'HighFive']);

class CasterFeed extends EventEmitter {
  constructor() {
    super();
    this.reset();
  }

  reset(guid = null) {
    clearTimeout(this._hideTimer);
    this.guid = guid;
    this.match = {
      active: false,
      guid,
      arena: '',
      playlistId: null,
      time: 300,
      overtime: false,
      replay: false,
      ended: false,
      winner: null,
      mvp: null,
      teams: [
        { num: 0, name: '', score: 0, color: '' },
        { num: 1, name: '', score: 0, color: '' },
      ],
      players: [],
      target: null,
      ball: { speed: 0, team: null },
      updatedAt: 0,
    };
    this.counted = false;
  }

  handle(event, d) {
    d = d && typeof d === 'object' ? d : {};
    const guid = d.MatchGuid || (d.Game && d.Game.MatchGuid) || null;
    const m = this.match;
    switch (event) {
      case 'MatchCreated':
      case 'MatchInitialized':
        if (guid !== this.guid || m.ended) this.reset(guid);
        this.match.active = true;
        this._changed();
        break;
      case 'UpdateState':
        if (guid && this.guid && guid !== this.guid && !m.active) this.reset(guid);
        this._update(d);
        break;
      case 'ClockUpdatedSeconds':
        m.time = num(d.TimeSeconds, m.time);
        m.overtime = !!d.bOvertime;
        this._changed();
        break;
      case 'GoalReplayStart':
        m.replay = true;
        this._changed();
        break;
      case 'GoalReplayEnd':
      case 'CountdownBegin':
      case 'RoundStarted':
        m.replay = false;
        this._changed();
        break;
      case 'GoalScored':
        this._goal(d);
        break;
      case 'StatfeedEvent':
        this._feed(d);
        break;
      case 'MatchEnded':
        m.ended = true;
        m.winner = d.WinnerTeamNum != null ? num(d.WinnerTeamNum) : m.winner;
        this._changed();
        if (!this.counted && (m.winner === 0 || m.winner === 1)) {
          this.counted = true;
          this.emit('ended', { winner: m.winner, guid: this.guid, teams: m.teams });
        }
        break;
      case 'PodiumStart':
        m.ended = true;
        this._changed();
        break;
      case 'MatchDestroyed':
        // partie terminée : on laisse le tableau final à l'écran un moment avant de tout masquer
        clearTimeout(this._hideTimer);
        if (m.ended) {
          this._hideTimer = setTimeout(() => {
            if (this.match === m) {
              m.active = false;
              this._changed();
            }
          }, POSTGAME_MS);
          if (this._hideTimer.unref) this._hideTimer.unref();
        } else {
          m.active = false;
          this._changed();
        }
        break;
      default:
        break;
    }
  }

  // Le jeu est fermé / la connexion est perdue
  onDisconnected() {
    this.match.active = false;
    this._changed();
  }

  _update(d) {
    const m = this.match;
    const g = d.Game || {};
    m.active = true;
    m.updatedAt = Date.now();
    if (g.Arena) m.arena = g.Arena;
    if (g.PlaylistId != null) m.playlistId = num(g.PlaylistId, null);
    if (Array.isArray(g.Teams) && g.Teams.length) {
      for (const t of g.Teams) {
        const n = num(t.TeamNum);
        if (n !== 0 && n !== 1) continue;
        m.teams[n] = { num: n, name: t.Name || '', score: num(t.Score), color: color(t.ColorPrimary) };
      }
    }
    if (g.TimeSeconds != null) m.time = num(g.TimeSeconds, m.time);
    if (typeof g.bOvertime === 'boolean') m.overtime = g.bOvertime;
    if (typeof g.bReplay === 'boolean') m.replay = g.bReplay;
    if (g.Ball) m.ball = { speed: num(g.Ball.Speed), team: g.Ball.TeamNum === 0 || g.Ball.TeamNum === 1 ? g.Ball.TeamNum : null };
    m.target = g.bHasTarget && g.Target && g.Target.Name ? pkey(g.Target) : null;
    if (g.bHasWinner && g.Winner) {
      const w = m.teams.find((t) => t.name === g.Winner);
      if (w) m.winner = w.num;
    }
    if (Array.isArray(d.Players)) {
      m.players = d.Players.filter((p) => p && p.Name != null)
        .map((p) => ({
          key: pkey(p),
          name: String(p.Name),
          team: num(p.TeamNum),
          boost: Math.max(0, Math.min(100, Math.round(num(p.Boost)))),
          speed: Math.round(num(p.Speed)),
          supersonic: !!p.bSupersonic,
          boosting: !!p.bBoosting,
          demolished: !!p.bDemolished,
          score: num(p.Score),
          goals: num(p.Goals),
          shots: num(p.Shots),
          assists: num(p.Assists),
          saves: num(p.Saves),
          touches: num(p.Touches),
          demos: num(p.Demos),
        }))
        .sort((a, b) => a.team - b.team || a.name.localeCompare(b.name));
    }
    this._changed();
  }

  _goal(d) {
    const s = d.Scorer || {};
    // faux but envoyé par le jeu à la fin de chaque replay (buteur vide)
    if (!s.Name) return;
    const a = d.Assister && d.Assister.Name ? d.Assister : null;
    this.emit('event', {
      kind: 'goal',
      team: num(s.TeamNum),
      scorer: s.Name,
      assister: a ? a.Name : null,
      speed: Math.round(num(d.GoalSpeed)),
      time: num(d.GoalTime),
    });
  }

  _feed(d) {
    const name = String(d.EventName || '');
    const main = d.MainTarget && d.MainTarget.Name ? d.MainTarget : null;
    if (name === 'MVP' && main) {
      this.match.mvp = pkey(main);
      this._changed();
    }
    if (!main || QUIET_FEED.has(name)) return;
    const sec = d.SecondaryTarget && d.SecondaryTarget.Name ? d.SecondaryTarget : null;
    this.emit('event', {
      kind: 'feed',
      event: name,
      label: String(d.Type || name),
      team: num(main.TeamNum),
      main: main.Name,
      secondary: sec ? sec.Name : null,
      secondaryTeam: sec ? num(sec.TeamNum) : null,
    });
  }

  _changed() {
    this.emit('update');
  }

  state() {
    return this.match;
  }
}

module.exports = { CasterFeed };
