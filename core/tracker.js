'use strict';
// Machine à états d'une partie Rocket League à partir des événements de la Stats API.
// Émet : 'live' (état courant), 'overtime', 'goal', 'result' (partie enregistrée), 'identity', 'log'.

const { EventEmitter } = require('events');
const crypto = require('crypto');
const { describePlaylist } = require('./playlists');

const norm = (s) =>
  String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function isRealId(id) {
  if (!id) return false;
  const parts = String(id).split('|');
  return !/^unknown$/i.test(parts[0]) && parts[1] && parts[1] !== '0';
}

function sameId(a, b) {
  if (!a || !b) return false;
  if (String(a).toLowerCase() === String(b).toLowerCase()) return true;
  const ua = String(a).split('|')[1];
  const ub = String(b).split('|')[1];
  return !!ua && ua !== '0' && ua.toLowerCase() === String(ub || '').toLowerCase();
}

function playerKey(p) {
  if (isRealId(p.PrimaryId)) return p.PrimaryId;
  return `bot:${p.TeamNum}:${p.Shortcut}:${p.Name}`;
}

function prettyArena(a) {
  if (!a) return '';
  return String(a)
    .replace(/_p$/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

class Tracker extends EventEmitter {
  constructor({ store, logWatcher = null, now = () => Date.now() }) {
    super();
    this.store = store;
    this.logWatcher = logWatcher;
    this.now = now;
    this.match = null;
    this._liveTimer = null;
    this._lostTimer = null;
  }

  get settings() {
    return this.store.settings;
  }

  handle(event, data) {
    try {
      clearTimeout(this._lostTimer);
      this._handle(event, data && typeof data === 'object' ? data : {});
    } catch (e) {
      this.emit('log', `Erreur tracker (${event}) : ${e.message}`);
    }
    this._touch();
  }

  _handle(event, d) {
    const guid = d.MatchGuid || (d.Game && d.Game.MatchGuid) || null;
    switch (event) {
      case 'MatchCreated':
        this._ensure(guid, true).seenStart = true;
        break;
      case 'MatchInitialized':
        this._ensure(guid).seenStart = true;
        break;
      case 'CountdownBegin':
      case 'RoundStarted': {
        const m = this._ensure(guid);
        m.progressed = true;
        m.inReplay = false;
        break;
      }
      case 'UpdateState':
        this._onUpdate(d, guid);
        break;
      case 'ClockUpdatedSeconds':
        this._clock(this._ensure(guid), d.TimeSeconds, d.bOvertime);
        break;
      case 'GoalScored':
        this._onGoal(d, guid);
        break;
      case 'GoalReplayStart':
        this._ensure(guid).inReplay = true;
        break;
      case 'GoalReplayEnd':
        if (this.match) this.match.inReplay = false;
        break;
      case 'MatchEnded':
        this._onEnded(d, guid);
        break;
      case 'PodiumStart':
        if (this.match) {
          const m = this.match;
          m.podium = true;
          if (!m.ended && m.winnerHint != null) this._finalize(m, m.winnerHint, 'podium');
        }
        break;
      case 'MatchDestroyed':
        this._onDestroyed(guid);
        break;
      case 'StatfeedEvent':
        this._onStatfeed(d, guid);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- cycle de vie
  _ensure(guid, created = false) {
    const now = this.now();
    let m = this.match;
    if (m) {
      const guidChanged = guid && m.guid && guid !== m.guid;
      let replace = guidChanged;
      if (created && !replace) {
        // MatchCreated = nouvelle partie, sauf si c'est la même (même guid) ou une partie à peine créée
        const same = guid && m.guid === guid;
        const justCreated = !m.ended && !m.progressed && now - m.createdAt < 5000;
        replace = !same && !justCreated;
      }
      if (!replace && m.ended && !guid && !m.guid && created) replace = true;
      if (replace) {
        this._closeMatch(m, 'replaced');
        m = null;
      } else if (guid && !m.guid) {
        m.guid = guid;
      }
    }
    if (!m) {
      m = this.match = this._newMatch(guid, now);
      if (guid && this.store.hasMatch(guid)) {
        // partie déjà enregistrée (ex. l'app a redémarré pendant le podium)
        m.ended = true;
        m.endedAt = now;
        m.record = this.store.data.matches.find((r) => r.id === guid) || null;
      }
      this.emit('log', `Nouvelle partie détectée${guid ? '' : ' (hors-ligne)'}`);
    }
    return m;
  }

  _newMatch(guid, now) {
    return {
      guid: guid || null,
      localId: `local-${crypto.randomUUID()}`,
      createdAt: now,
      playlistId: this.logWatcher ? this.logWatcher.playlistFor(now) : null,
      playlistFromApi: false,
      arena: '',
      teams: [
        { num: 0, name: 'Bleu', score: 0, color: '' },
        { num: 1, name: 'Orange', score: 0, color: '' },
      ],
      goalCount: [0, 0],
      time: null,
      firstTime: null,
      overtime: false,
      otStartedAt: 0,
      otAlertPending: false,
      replay: false,
      inReplay: false,
      podium: false,
      progressed: false,
      players: new Map(),
      targetVotes: new Map(),
      me: null,
      identityState: 'pending',
      winnerHint: null,
      hintTimer: null,
      mvpFeed: false,
      ended: false,
      endedAt: 0,
      winner: null,
      pendingResult: null,
      record: null,
      lastUpdateAt: 0,
    };
  }

  _closeMatch(m, why) {
    if (!m.ended) this._finalizeUnfinished(m, why);
    clearTimeout(m.hintTimer);
    if (this.match === m) this.match = null;
  }

  // ---------------------------------------------------------------- événements
  _onUpdate(d, guid) {
    const m = this._ensure(guid);
    const g = d.Game || {};
    const now = this.now();
    m.lastUpdateAt = now;
    if (g.Arena) m.arena = g.Arena;
    if (Array.isArray(g.Teams) && g.Teams.length) {
      m.teams = g.Teams.map((t) => ({
        num: num(t.TeamNum),
        name: t.Name || (num(t.TeamNum) === 0 ? 'Bleu' : 'Orange'),
        score: num(t.Score),
        color: t.ColorPrimary ? `#${String(t.ColorPrimary).replace('#', '')}` : '',
      })).sort((a, b) => a.num - b.num);
      // le score officiel fait foi ; goalCount ne sert qu'à anticiper un but pas encore dans UpdateState
      for (const t of m.teams) if (t.num === 0 || t.num === 1) m.goalCount[t.num] = t.score;
    }
    if (typeof g.bReplay === 'boolean') m.replay = g.bReplay;
    this._clock(m, g.TimeSeconds, g.bOvertime);

    if (Array.isArray(d.Players)) {
      const seen = new Set();
      for (const p of d.Players) {
        const key = playerKey(p);
        seen.add(key);
        const cur = m.players.get(key) || { key };
        Object.assign(cur, {
          name: p.Name || cur.name || '?',
          id: p.PrimaryId || cur.id || '',
          team: num(p.TeamNum),
          shortcut: p.Shortcut,
          score: num(p.Score),
          goals: num(p.Goals),
          shots: num(p.Shots),
          assists: num(p.Assists),
          saves: num(p.Saves),
          touches: num(p.Touches),
          demos: num(p.Demos),
          left: false,
        });
        m.players.set(key, cur);
      }
      for (const [k, p] of m.players) if (!seen.has(k)) p.left = true;
    }

    if (g.bHasTarget && g.Target && !m.replay && !m.inReplay && !m.ended) this._voteTarget(m, g.Target);

    if (g.bHasWinner && g.Winner != null && g.Winner !== '') {
      const w = this._teamByName(m, g.Winner);
      if (w != null) m.winnerHint = w;
    }

    if (!m.ended) {
      // Le jeu envoie PlaylistId dans UpdateState (versions récentes) ; sinon on se rabat sur Launch.log
      const apiPl = Number(g.PlaylistId);
      if (g.PlaylistId != null && Number.isFinite(apiPl) && apiPl > 0) {
        m.playlistId = apiPl;
        m.playlistFromApi = true;
      } else if (!m.playlistFromApi) {
        const pl = this.logWatcher ? this.logWatcher.playlistFor(m.createdAt) : null;
        if (pl != null) m.playlistId = pl;
      }
      if (m.teams.some((t) => t.score > 0)) m.progressed = true;
    }

    if (!m.me) this._resolveIdentity(m);

    if (m.ended && m.record && now - m.endedAt < 8000) this._refreshRecord(m);

    if (!m.ended && m.winnerHint != null && !m.hintTimer) {
      // bHasWinner vu sans MatchEnded : on laisse 2 s à MatchEnded pour arriver
      m.hintTimer = setTimeout(() => {
        m.hintTimer = null;
        if (!m.ended && m.winnerHint != null) this._finalize(m, m.winnerHint, 'winner-flag');
        this._touch();
      }, 2000);
    }
  }

  _clock(m, t, ot) {
    if (typeof t === 'number' && Number.isFinite(t)) {
      if (m.firstTime == null) {
        m.firstTime = t;
        // connexion en cours de partie : on estime le début grâce au chrono (5:00 au coup d'envoi)
        if (!m.seenStart && !ot && t < 300) m.createdAt -= (300 - t) * 1000;
      } else if (t !== m.firstTime) m.progressed = true;
      m.time = t;
    }
    if (ot === true && !m.overtime && !m.ended) {
      m.overtime = true;
      m.progressed = true;
      m.otStartedAt = this.now();
      // pas d'alerte si on se connecte en plein overtime
      const seenStart = !(typeof t === 'number') || t <= 5;
      if (seenStart) {
        if (m.me) this._emitOvertime(m);
        else m.otAlertPending = true;
      }
    }
  }

  _emitOvertime(m) {
    m.otAlertPending = false;
    if (!this._tracked(m)) return;
    this.emit('overtime', this._summary(m));
  }

  _onGoal(d, guid) {
    const m = this._ensure(guid);
    m.progressed = true;
    if (m.inReplay || m.replay || m.ended) return;
    // Le jeu renvoie un faux GoalScored (buteur vide, vitesse 0) à la fin de chaque replay de but
    if (!d.Scorer || !d.Scorer.Name) return;
    const team = d.Scorer ? num(d.Scorer.TeamNum) : null;
    if (team !== 0 && team !== 1) return;
    m.goalCount[team]++;
    const me = m.me && m.players.get(m.me.key);
    this.emit('goal', {
      team,
      scorer: d.Scorer && d.Scorer.Name,
      assister: d.Assister && d.Assister.Name,
      mine: !!me && me.team === team,
      byMe: !!me && d.Scorer && d.Scorer.Name === me.name && num(d.Scorer.TeamNum) === me.team,
      overtime: m.overtime,
      speed: d.GoalSpeed,
      tracked: this._tracked(m),
    });
    if (m.overtime && !m.ended) m.winnerHint = team; // but en or = fin du match
  }

  _onEnded(d, guid) {
    const m = this._ensure(guid);
    let w = d.WinnerTeamNum;
    w = w === 0 || w === 1 || w === '0' || w === '1' ? Number(w) : null;
    if (w == null) w = m.winnerHint != null ? m.winnerHint : this._leader(m);
    this._finalize(m, w, 'ended');
  }

  _onDestroyed(guid) {
    const m = this.match;
    if (!m) return;
    if (guid && m.guid && guid !== m.guid) return;
    this._closeMatch(m, 'left');
  }

  _onStatfeed(d, guid) {
    const m = this._ensure(guid);
    const name = String(d.EventName || '');
    if (!m.me || !d.MainTarget) return;
    const me = m.players.get(m.me.key);
    if (me && d.MainTarget.Name === me.name && num(d.MainTarget.TeamNum) === me.team && /mvp/i.test(name)) {
      m.mvpFeed = true;
      if (m.record) this._refreshRecord(m);
    }
  }

  // Connexion à la Stats API perdue (jeu fermé/crash) : on attend une éventuelle reconnexion.
  onDisconnected() {
    const m = this.match;
    if (!m || m.ended) return;
    clearTimeout(this._lostTimer);
    this._lostTimer = setTimeout(() => {
      if (this.match === m && !m.ended) {
        this.emit('log', 'Partie interrompue (jeu fermé ou déconnecté)');
        this._closeMatch(m, 'lost');
        this._touch();
      }
    }, 5 * 60e3);
  }

  // ---------------------------------------------------------------- identité
  _voteTarget(m, target) {
    const tTeam = num(target.TeamNum);
    let hit = null;
    for (const p of m.players.values()) {
      if (p.team !== tTeam) continue;
      if (target.Shortcut != null && p.shortcut === target.Shortcut) {
        hit = p;
        break;
      }
      if (target.Name && p.name === target.Name) hit = p;
    }
    if (hit) m.targetVotes.set(hit.key, (m.targetVotes.get(hit.key) || 0) + 1);
  }

  _resolveIdentity(m) {
    const players = [...m.players.values()].filter((p) => !p.left);
    if (!players.length) return;
    const acct = this.logWatcher && this.logWatcher.account;
    const idCfg = this.settings.identity;
    let found = null;
    let via = null;
    if (acct && acct.id) {
      found = players.find((p) => sameId(p.id, acct.id)) || null;
      if (!found && acct.name) found = players.find((p) => norm(p.name) === norm(acct.name)) || null;
      if (found) via = 'account';
    }
    if (!found && idCfg.knownIds.length) {
      found = players.find((p) => idCfg.knownIds.some((id) => sameId(p.id, id))) || null;
      if (found) via = 'known';
    }
    if (!found && idCfg.names.length) {
      const names = idCfg.names.map(norm).filter(Boolean);
      found = players.find((p) => names.includes(norm(p.name))) || null;
      if (found) via = 'name';
    }
    if (!found && idCfg.useCameraTarget && m.targetVotes.size) {
      // en jeu, la caméra suit toujours la voiture du joueur local
      const votes = [...m.targetVotes.entries()].sort((a, b) => b[1] - a[1]);
      const total = votes.reduce((s, v) => s + v[1], 0);
      if (votes[0][1] >= 4 && votes[0][1] / total >= 0.9) {
        found = m.players.get(votes[0][0]) || null;
        if (found) via = 'camera';
      }
    }
    if (found) this._setMe(m, found.key, via);
    else m.identityState = acct && acct.id ? 'spectator' : 'unknown';
  }

  _setMe(m, key, via) {
    const p = m.players.get(key);
    if (!p) return false;
    const changed = !m.me || m.me.key !== key;
    m.me = { key, via };
    m.identityState = 'ok';
    if (via !== 'camera' && via !== 'known') this.store.learnId(p.id);
    if (changed) this.emit('identity', { name: p.name, id: p.id, via });
    if (m.otAlertPending && m.overtime && this.now() - m.otStartedAt < 15000) this._emitOvertime(m);
    if (m.pendingResult) {
      const pr = m.pendingResult;
      m.pendingResult = null;
      this._record(m, pr.winner, pr.reason, pr.extra);
    }
    return true;
  }

  // Choix manuel depuis le tableau de bord ("c'est moi")
  setIdentity(key) {
    const m = this.match;
    if (!m) return false;
    const ok = this._setMe(m, key, 'manual');
    this._touch();
    return ok;
  }

  // ---------------------------------------------------------------- résultat
  _scores(m) {
    const s = [0, 0];
    for (const t of m.teams) if (t.num === 0 || t.num === 1) s[t.num] = t.score;
    return [Math.max(s[0], m.goalCount[0]), Math.max(s[1], m.goalCount[1])];
  }

  _leader(m) {
    const [a, b] = this._scores(m);
    return a === b ? null : a > b ? 0 : 1;
  }

  _teamByName(m, name) {
    const hits = m.teams.filter((t) => t.name === name);
    return hits.length === 1 ? hits[0].num : null;
  }

  _category(m) {
    return describePlaylist(m.playlistId, !!m.guid).cat;
  }

  _counts(cat) {
    if (cat === 'training') return false;
    return this.settings.counting[cat] !== false;
  }

  _tracked(m) {
    return !this.settings.paused && !!m.me && this._counts(this._category(m));
  }

  _finalize(m, winner, reason) {
    if (m.ended) return;
    m.ended = true;
    m.endedAt = this.now();
    clearTimeout(m.hintTimer);
    m.hintTimer = null;
    if (winner !== 0 && winner !== 1) {
      this.emit('log', 'Fin de partie sans vainqueur identifiable : non comptée');
      return;
    }
    m.winner = winner;
    if (!m.me) {
      m.pendingResult = { winner, reason };
      this.emit('log', 'Fin de partie : en attente de ton identification');
      return;
    }
    this._record(m, winner, reason);
  }

  // Partie quittée / interrompue sans MatchEnded
  _finalizeUnfinished(m, why) {
    if (m.ended) return;
    let w = m.winnerHint;
    if (w == null) {
      const leader = this._leader(m);
      if (leader != null && (m.overtime || m.podium || (typeof m.time === 'number' && m.time <= 0))) w = leader;
    }
    if (w != null) return this._finalize(m, w, `${why}-inferred`);
    m.ended = true;
    m.endedAt = this.now();
    if (!m.me || !m.progressed) return;
    const cat = this._category(m);
    const policy = this.settings.abandonAsLoss;
    if (!(policy === 'always' || (policy === 'ranked' && cat === 'ranked'))) {
      this.emit('log', 'Partie quittée avant la fin : non comptée');
      return;
    }
    const me = m.players.get(m.me.key);
    if (!me) return;
    this._record(m, 1 - me.team, why, { abandon: true });
  }

  _record(m, winner, reason, extra = {}) {
    const cat = this._category(m);
    if (this.settings.paused) {
      this.emit('log', 'Tracker en pause : partie non comptée');
      return;
    }
    if (!this._counts(cat)) {
      this.emit('log', `Partie ignorée (${describePlaylist(m.playlistId, !!m.guid).name})`);
      return;
    }
    const id = m.guid || m.localId;
    if (this.store.hasMatch(id)) return;
    const me = m.players.get(m.me.key);
    if (!me) return;
    if (this.store.autoResetIfIdle(this.now())) this.emit('session', 'auto');
    const now = this.now();
    const pl = describePlaylist(m.playlistId, !!m.guid);
    const won = winner === me.team;
    const scores = this._scores(m);
    const record = {
      id,
      startedAt: m.createdAt,
      endedAt: now,
      durationSec: Math.max(0, Math.round((now - m.createdAt) / 1000)),
      result: won ? 'W' : 'L',
      overtime: !!m.overtime,
      otSeconds: m.overtime && typeof m.time === 'number' ? Math.round(m.time) : 0,
      abandon: !!extra.abandon,
      reason,
      myTeam: me.team,
      scoreFor: scores[me.team],
      scoreAgainst: scores[1 - me.team],
      playlistId: m.playlistId,
      playlistName: pl.name,
      category: cat,
      ranked: pl.ranked,
      arena: prettyArena(m.arena),
      identity: m.me.via,
      me: null,
      mvp: false,
      players: [],
    };
    m.record = record;
    this._fillPlayers(m, record);
    this.store.addMatch(record);
    this.emit('result', record);
  }

  _fillPlayers(m, record) {
    const me = m.players.get(m.me.key);
    record.me = me
      ? { name: me.name, id: me.id, score: me.score, goals: me.goals, assists: me.assists, saves: me.saves, shots: me.shots, demos: me.demos }
      : null;
    record.players = [...m.players.values()].map((p) => ({
      name: p.name,
      team: p.team,
      score: p.score,
      goals: p.goals,
      assists: p.assists,
      saves: p.saves,
      shots: p.shots,
      isMe: p.key === m.me.key,
      left: !!p.left,
    }));
    // MVP = meilleur score de l'équipe gagnante
    let mvp = m.mvpFeed;
    if (record.result === 'W' && me && !record.abandon) {
      const best = Math.max(...record.players.filter((p) => p.team === me.team && !p.left).map((p) => p.score), 0);
      if (best > 0 && me.score >= best) mvp = true;
    }
    record.mvp = !!mvp && record.result === 'W';
  }

  // Les stats de fin de partie arrivent parfois juste après MatchEnded : on met à jour l'enregistrement.
  _refreshRecord(m) {
    const r = m.record;
    if (!r || !m.me || !this.store.hasMatch(r.id)) return;
    const scores = this._scores(m);
    const before = JSON.stringify([r.me, r.mvp, r.scoreFor, r.scoreAgainst]);
    if (!r.abandon) {
      r.scoreFor = scores[r.myTeam];
      r.scoreAgainst = scores[1 - r.myTeam];
    }
    this._fillPlayers(m, r);
    if (JSON.stringify([r.me, r.mvp, r.scoreFor, r.scoreAgainst]) !== before) {
      this.store.save();
      this.emit('record-updated', r);
    }
  }

  // ---------------------------------------------------------------- état pour l'UI
  _summary(m) {
    const scores = this._scores(m);
    const me = m.me && m.players.get(m.me.key);
    const myTeam = me ? me.team : 0;
    return {
      playlist: describePlaylist(m.playlistId, !!m.guid),
      scoreFor: scores[myTeam],
      scoreAgainst: scores[1 - myTeam],
      time: m.time,
      overtime: m.overtime,
    };
  }

  live() {
    const m = this.match;
    if (!m) return { inMatch: false, ended: false };
    const pl = describePlaylist(m.playlistId, !!m.guid);
    const scores = this._scores(m);
    const me = m.me && m.players.get(m.me.key);
    return {
      inMatch: !m.ended,
      ended: m.ended,
      online: !!m.guid,
      playlist: pl,
      counted: this._counts(pl.cat) && !this.settings.paused,
      arena: prettyArena(m.arena),
      teams: m.teams.map((t) => ({ ...t, score: scores[t.num] ?? t.score })),
      time: m.time,
      overtime: m.overtime,
      myTeam: me ? me.team : null,
      me: me ? { key: me.key, name: me.name, team: me.team, via: m.me.via } : null,
      identityState: m.me ? 'ok' : m.identityState,
      needsIdentity: !m.me && m.identityState === 'unknown' && m.players.size > 0 && (!m.ended || !!m.pendingResult),
      players: [...m.players.values()]
        .filter((p) => !p.left)
        .map((p) => ({
          key: p.key,
          name: p.name,
          team: p.team,
          score: p.score,
          goals: p.goals,
          assists: p.assists,
          saves: p.saves,
          shots: p.shots,
          isMe: !!m.me && m.me.key === p.key,
        }))
        .sort((a, b) => a.team - b.team || b.score - a.score),
      result: m.record
        ? { result: m.record.result, scoreFor: m.record.scoreFor, scoreAgainst: m.record.scoreAgainst, overtime: m.record.overtime, abandon: m.record.abandon }
        : null,
    };
  }

  _touch() {
    if (this._liveTimer) return;
    this._liveTimer = setTimeout(() => {
      this._liveTimer = null;
      this.emit('live', this.live());
    }, 150);
  }
}

module.exports = { Tracker, playerKey, sameId, isRealId, prettyArena, norm };
