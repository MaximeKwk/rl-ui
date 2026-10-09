'use strict';
// Lit Launch.log de Rocket League en continu pour connaître :
//  - le compte connecté sur ce PC (PlayerID = même format que PrimaryId de la Stats API)
//  - la playlist de la partie en cours (2v2 classé, 3v3 occasionnel, ...)
//  - le MMR réel : à chaque recherche de partie lancée depuis ce PC, le jeu écrit
//    "Matchmaking: Pre-divide PartyLeaderMMR: 53.1329" (μ TrueSkill ; MMR affiché = μ × 20 + 100)
// Aucune donnée ne sort du PC.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const RE_TIME = /^\[(\d+(?:\.\d+)?)\]/;
const RE_OPEN = /Log file open,\s*(.+)$/;
const RE_ACCOUNT = /HandleLocalPlayerLoginStatusChanged PlayerName=(.*?) PlayerID=(\S+) LoginStatus=(\S+) IsPrimary=(True|False)/;
const RE_PRESENCE = /Set rich presence to: (.*?) data: (\S+)\s*$/;
const RE_JOIN = /(?:StartJoin Reservation|HandleServerReserved|Received game server|HandlePartyJoinGame).*?Playlist(?:Id)?=(\d+)/;
const RE_MM_MMR = /Matchmaking: Pre-divide PartyLeaderMMR: (-?\d+(?:\.\d+)?)/;
const RE_MM_TIER = /Matchmaking: PartyLeaderTier=\((\d+)\)/;
const RE_MM_START = /Matchmaking: StartMatchmaking at .*? for playlists ([\d,\s]+)/;
const RE_MM_PARTY = /PreferredPlaylists\.Length=\((\d+)\) Party\.GetOrderedPartyMemberIDs\(\)\.Length=\((\d+)\)/;
// Présences sans "Playlist-N" : OFP = jeu libre en ligne, Tutorial = entraînement
const PRESENCE_PLAYLISTS = { OFP: 73, Tutorial: 9 };

const mmrFromMu = (mu) => Math.round((mu * 20 + 100) * 10) / 10;

function parseLine(line) {
  let m = RE_ACCOUNT.exec(line);
  if (m) return { type: 'account', name: m[1], id: m[2], status: m[3], primary: m[4] === 'True' };
  m = RE_PRESENCE.exec(line);
  if (m) {
    const pm = /^Playlist-(\d+)$/.exec(m[2]);
    return pm ? { type: 'playlist', id: Number(pm[1]), source: 'presence', text: m[1] } : { type: 'presence', data: m[2], text: m[1] };
  }
  if (line.includes('Matchmaking:')) {
    if ((m = RE_MM_MMR.exec(line))) return { type: 'mm-mmr', mu: Number(m[1]) };
    if ((m = RE_MM_TIER.exec(line))) return { type: 'mm-tier', tier: Number(m[1]) };
    if ((m = RE_MM_START.exec(line))) return { type: 'mm-start', playlists: m[1].split(/[,\s]+/).filter(Boolean).map(Number) };
    if ((m = RE_MM_PARTY.exec(line))) return { type: 'mm-party', playlistCount: Number(m[1]), partySize: Number(m[2]) };
  }
  m = RE_JOIN.exec(line);
  if (m) return { type: 'playlist', id: Number(m[1]), source: 'join' };
  m = RE_OPEN.exec(line);
  if (m) return { type: 'open', text: m[1] };
  return null;
}

// "30/09/2026 14:07:07" (FR) ou "09/30/26 14:07:07" (US) -> timestamp local.
// En cas d'ambiguïté jour/mois, on garde la date la plus proche (et pas après) de refMs (dernière écriture du fichier).
function parseOpenTime(text, refMs = Date.now()) {
  const m = /(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})[\sT,]+(\d{1,2}):(\d{2}):(\d{2})/.exec(String(text));
  if (!m) return null;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [H, Mi, S] = [Number(m[4]), Number(m[5]), Number(m[6])];
  const yr = (y) => (y < 100 ? 2000 + y : y);
  const cands = m[1].length === 4 ? [[a, b, c]] : [[yr(c), b, a], [yr(c), a, b]]; // [année, mois, jour]
  let best = null;
  for (const [y, mo, d] of cands) {
    const dt = new Date(y, mo - 1, d, H, Mi, S);
    if (Number.isNaN(dt.getTime()) || dt.getMonth() !== mo - 1 || dt.getDate() !== d) continue;
    const t = dt.getTime();
    if (t > refMs + 5 * 60e3) continue;
    if (best == null || t > best) best = t;
  }
  return best;
}

function platformOf(id) {
  const p = String(id || '').split('|')[0];
  return p || 'Inconnu';
}

// Lecture d'un fichier de log (état propre à une session de jeu) : date les lignes et assemble les blocs de matchmaking.
class LogSession {
  constructor(refMs) {
    this.refMs = refMs;
    this.openTime = null;
    this.account = null;
    this.mm = null;
    this.lastSecs = null;
  }

  // Renvoie les événements trouvés dans la ligne ; `at` vaut null si l'heure de début du log est inconnue.
  feed(line) {
    const tm = RE_TIME.exec(line);
    const secs = tm ? Number(tm[1]) : this.lastSecs;
    if (tm) this.lastSecs = secs;
    const ev = parseLine(line);
    if (!ev) return [];
    if (ev.type === 'open') {
      this.openTime = parseOpenTime(ev.text, this.refMs);
      return [];
    }
    const at = this.openTime != null && secs != null ? Math.round(this.openTime + secs * 1000) : null;
    const out = [];
    switch (ev.type) {
      case 'mm-mmr':
        this.mm = { mu: ev.mu, at, secs, tier: null, playlists: null, account: this.account };
        break;
      case 'mm-tier':
        if (this.mm) this.mm.tier = ev.tier;
        break;
      case 'mm-start':
        if (this.mm) this.mm.playlists = ev.playlists;
        break;
      case 'mm-party':
        if (this.mm && this.mm.playlists) {
          const s = this.mm;
          this.mm = null;
          // une seule playlist en file : sinon on ne sait pas à quel mode correspond la valeur
          const why = !s.account ? 'no-account' : ev.playlistCount !== 1 || s.playlists.length !== 1 ? 'multi' : !(Number.isFinite(s.mu) && s.mu > 0) ? 'no-value' : null;
          if (why) {
            // recherche vue mais MMR inutilisable : on le dit (diagnostic) au lieu de l'ignorer en silence
            out.push({ type: 'mmr-skip', why, playlists: s.playlists, at: s.at, secs: s.secs });
          } else {
            out.push({
              type: 'mmr',
              accountId: s.account.id,
              accountName: s.account.name,
              playlist: s.playlists[0],
              mu: s.mu,
              mmr: mmrFromMu(s.mu),
              tier: s.tier,
              partySize: ev.partySize,
              at: s.at,
              secs: s.secs,
            });
          }
        }
        break;
      case 'account':
        if (ev.status === 'LS_LoggedIn' && ev.primary) this.account = { name: ev.name, id: ev.id };
        out.push({ ...ev, at, secs });
        break;
      default:
        out.push({ ...ev, at, secs });
    }
    return out;
  }
}

class RlLogWatcher extends EventEmitter {
  constructor({ documentsDir, logPath, pollMs = 1000 } = {}) {
    super();
    this.logPath = logPath || path.join(documentsDir || '', 'My Games', 'Rocket League', 'TAGame', 'Logs', 'Launch.log');
    this.pollMs = pollMs;
    this.account = null; // { name, id, platform, at }
    this.playlist = null; // { id, source, at }
    this.presence = null; // { data, text, at }
    this.lastSearch = null; // dernière recherche de partie vue : { at, ok, playlist | playlists, why }
    this.exists = false;
    this.lastWriteAt = 0;
    this._offset = 0;
    this._partial = '';
    this._session = null;
    this._initialDone = false;
    this._busy = false;
    this._timer = null;
  }

  start() {
    if (this._timer) return;
    this._poll();
    this._timer = setInterval(() => this._poll(), this.pollMs);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  async _poll() {
    if (this._busy) return;
    this._busy = true;
    try {
      let st;
      try {
        st = await fs.promises.stat(this.logPath);
      } catch {
        if (this.exists) {
          this.exists = false;
          this.emit('change');
        }
        return;
      }
      if (!this.exists) {
        this.exists = true;
        this.emit('change');
      }
      // Fichier plus petit qu'avant = le jeu a été relancé (Launch.log recréé)
      if (st.size < this._offset || !this._session) {
        this._offset = 0;
        this._partial = '';
        this._session = new LogSession(st.mtimeMs);
      }
      this._session.refMs = st.mtimeMs;
      this.lastWriteAt = st.mtimeMs;
      if (st.size <= this._offset) return;
      const initial = !this._initialDone;
      const pending = [];
      const fh = await fs.promises.open(this.logPath, 'r');
      try {
        while (this._offset < st.size) {
          const len = Math.min(st.size - this._offset, 4 * 1024 * 1024);
          const buf = Buffer.alloc(len);
          const { bytesRead } = await fh.read(buf, 0, len, this._offset);
          if (!bytesRead) break;
          this._offset += bytesRead;
          const lines = (this._partial + buf.toString('latin1', 0, bytesRead)).split(/\r?\n/);
          this._partial = lines.pop();
          for (const line of lines) pending.push(...this._session.feed(line));
        }
      } finally {
        await fh.close();
      }
      this._initialDone = true;
      const lastSecs = this._session.lastSecs;
      for (const ev of pending) {
        if (ev.at == null) {
          // heure de début inconnue : lecture initiale -> relatif à la dernière écriture, sinon maintenant
          ev.at = initial && ev.secs != null && lastSecs != null ? Math.round(st.mtimeMs - (lastSecs - ev.secs) * 1000) : Date.now();
        }
        this._apply(ev);
      }
    } catch (e) {
      this.emit('error', e);
    } finally {
      this._busy = false;
    }
  }

  _apply(ev) {
    const at = ev.at;
    if (ev.type === 'account') {
      if (ev.status !== 'LS_LoggedIn' || !ev.primary) return;
      const changed = !this.account || this.account.id !== ev.id || this.account.name !== ev.name;
      this.account = { name: ev.name, id: ev.id, platform: platformOf(ev.id), at };
      if (changed) this.emit('account', this.account);
    } else if (ev.type === 'playlist') {
      const changed = !this.playlist || this.playlist.id !== ev.id;
      this.playlist = { id: ev.id, source: ev.source, at };
      if (changed) this.emit('playlist', this.playlist);
    } else if (ev.type === 'presence') {
      this.presence = { data: ev.data, text: ev.text, at };
      // Hors partie : on oublie la playlist (sinon une partie hors-ligne hériterait de la précédente)
      const mapped = PRESENCE_PLAYLISTS[ev.data];
      if (mapped) this._apply({ type: 'playlist', id: mapped, source: 'presence', at });
      else if (this.playlist) {
        this.playlist = null;
        this.emit('playlist', null);
      }
    } else if (ev.type === 'mmr') {
      this.lastSearch = { at, ok: true, playlist: ev.playlist, mmr: ev.mmr };
      this.emit('mmr', ev);
    } else if (ev.type === 'mmr-skip') {
      this.lastSearch = { at, ok: false, why: ev.why, playlists: ev.playlists };
      this.emit('mmr-skip', ev);
    }
  }

  // Playlist probable d'une partie démarrée à `sinceMs` (tolérance : recherche de partie + chargement)
  playlistFor(sinceMs) {
    if (!this.playlist) return null;
    return this.playlist.at >= sinceMs - 3 * 60e3 ? this.playlist.id : null;
  }

  // MMR des sessions de jeu précédentes (Launch-backup-*.log), pour connaître ton MMR dès le lancement.
  async scanBackups({ maxFiles = 6, newerThan = 0 } = {}) {
    const dir = path.dirname(this.logPath);
    let files = [];
    try {
      files = (await fs.promises.readdir(dir)).filter((f) => /^Launch-backup-.*\.log$/i.test(f));
    } catch {
      return [];
    }
    const stats = [];
    for (const f of files) {
      try {
        const st = await fs.promises.stat(path.join(dir, f));
        if (st.mtimeMs > newerThan) stats.push({ file: path.join(dir, f), mtime: st.mtimeMs });
      } catch {}
    }
    stats.sort((a, b) => b.mtime - a.mtime);
    const samples = [];
    for (const { file, mtime } of stats.slice(0, maxFiles)) {
      try {
        const text = await fs.promises.readFile(file, 'latin1');
        const sess = new LogSession(mtime);
        const found = [];
        for (const line of text.split(/\r?\n/)) for (const ev of sess.feed(line)) if (ev.type === 'mmr') found.push(ev);
        for (const ev of found) {
          if (ev.at == null) ev.at = Math.round(mtime - ((sess.lastSecs || 0) - (ev.secs || 0)) * 1000);
          samples.push(ev);
        }
      } catch {}
    }
    return samples.sort((a, b) => a.at - b.at);
  }
}

module.exports = { RlLogWatcher, LogSession, parseLine, parseOpenTime, platformOf, mmrFromMu };
