'use strict';
// Suivi du MMR.
// - Valeur réelle : lue dans Launch.log quand une recherche de partie est lancée depuis ce PC
//   (seul ou chef de groupe). Elle arrive donc à la file suivante, pas à la fin du match.
// - En fin de match on affiche tout de suite une estimation (moyenne de tes vraies variations
//   récentes dans ce mode), remplacée par la vraie valeur dès qu'elle est connue.
// - Si le jeu n'a pas encore reçu la mise à jour quand tu relances la file, la variation arrive
//   cumulée à la file suivante : elle est alors répartie entre les parties concernées.

const { EventEmitter } = require('events');
const { describePlaylist } = require('./playlists');
const { t: tr } = require('./i18n');

const round1 = (n) => Math.round(n * 10) / 10;
// Une partie finie depuis plus longtemps que ça avant la recherche est forcément comptée dans la valeur lue.
// En dessous, le serveur n'a peut-être pas encore mis le MMR à jour (la variation arrive à la recherche suivante).
const LAG_MS = 3 * 60 * 1000;
const ALGO = 2; // version de l'attribution (recalcul de l'historique quand elle change)
const accountOf = (key) => String(key).slice(0, String(key).lastIndexOf('|'));

class MmrTracker extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    const d = store.data;
    if (!d.mmr || typeof d.mmr !== 'object') d.mmr = {};
    this.d = d.mmr;
    if (!Array.isArray(this.d.samples)) this.d.samples = [];
    if (!this.d.last || typeof this.d.last !== 'object') this.d.last = {};
    if (!this.d.pending || typeof this.d.pending !== 'object') this.d.pending = {};
    this._learn = null;
    if (this.d.algo !== ALGO) {
      this.rebuild();
      this.d.algo = ALGO;
      store.save();
    }
  }

  // Recalcule toutes les variations à partir des valeurs réelles enregistrées (dans l'ordre chronologique)
  rebuild() {
    const matches = this.store.data.matches.filter((m) => m.mmr && m.mmr.key);
    for (const m of matches) m.mmr = { key: m.mmr.key, playlist: m.mmr.playlist, before: null, after: null, delta: m.mmr.delta, status: 'estimated' };
    this._learn = null;
    const keys = new Set([...matches.map((m) => m.mmr.key), ...this.d.samples.map((x) => x.key)]);
    this.d.pending = {};
    for (const k of keys) {
      const ev = [
        ...matches.filter((m) => m.mmr.key === k).map((m) => ({ t: m.endedAt, m })),
        ...this.d.samples.filter((x) => x.key === k).map((x) => ({ t: x.at, x })),
      ].sort((a, b) => a.t - b.t || (a.m ? -1 : 1));
      this.d.pending[k] = [];
      let last = null;
      for (const e of ev) {
        if (e.m) {
          e.m.mmr.delta = this.estimate(e.m, k);
          this.d.pending[k].push(e.m.id);
          continue;
        }
        if (!last) this._dropOlderPending(k, e.x.at);
        else if (Math.abs(e.x.mmr - last.mmr) >= 0.05) this._assign(k, e.x.mmr - last.mmr, last.mmr, e.x.at, true);
        last = e.x;
      }
    }
    this._learn = null;
  }

  get settings() {
    return this.store.settings.mmr;
  }

  key(accountId, playlist) {
    return `${accountId}|${playlist}`;
  }

  tracks(playlistId) {
    const cat = describePlaylist(playlistId).cat;
    return cat === 'ranked' || (!!this.settings.includeCasual && cat === 'casual');
  }

  lastSampleAt() {
    return Object.values(this.d.last).reduce((m, s) => Math.max(m, s.at || 0), 0);
  }

  // ---------------------------------------------------------------- valeurs réelles (Launch.log)
  onSample(s) {
    if (!s || !s.accountId || s.playlist == null || !Number.isFinite(s.mmr) || !Number.isFinite(s.at)) return false;
    const k = this.key(s.accountId, s.playlist);
    const last = this.d.last[k];
    if (last && s.at <= last.at) return false; // déjà traité
    this.d.samples.push({ key: k, accountId: s.accountId, playlist: s.playlist, mmr: s.mmr, mu: s.mu, tier: s.tier, partySize: s.partySize, at: s.at });
    if (this.d.samples.length > 3000) this.d.samples.splice(0, this.d.samples.length - 3000);
    this.d.last[k] = { mmr: s.mmr, mu: s.mu, tier: s.tier, at: s.at, playlist: s.playlist, accountId: s.accountId };
    let assigned = [];
    if (!last) this._dropOlderPending(k, s.at);
    else if (Math.abs(s.mmr - last.mmr) >= 0.05) assigned = this._assign(k, s.mmr - last.mmr, last.mmr, s.at);
    this.store.save();
    this.emit('update', { key: k, playlist: s.playlist, mmr: s.mmr, delta: last ? round1(s.mmr - last.mmr) : null, assigned });
    return true;
  }

  // Premier échantillon d'un mode : les parties plus anciennes ne pourront jamais être rattachées
  _dropOlderPending(k, at) {
    const keep = (this.d.pending[k] || []).filter((id) => {
      const m = this.store.getMatch(id);
      return m && m.endedAt > at + 2000;
    });
    this.d.pending[k] = keep;
  }

  _assign(k, delta, before, at, quiet = false) {
    const pend = (this.d.pending[k] || []).map((id) => this.store.getMatch(id)).filter((m) => m && m.mmr);
    const covered = pend.filter((m) => m.endedAt <= at + 2000).sort((a, b) => a.endedAt - b.endedAt);
    const later = pend.filter((m) => m.endedAt > at + 2000);
    if (!covered.length) {
      if (!quiet) this.emit('log', tr('s.mmrNoMatch'));
      return [];
    }
    // parties finies bien avant la recherche : forcément dans cette valeur ; les dernières peuvent manquer (retard du serveur)
    const required = covered.filter((m) => m.endedAt < at - LAG_MS).length;
    const est = covered.map((m) => this.estimate(m, k));
    let best = required;
    let sum = est.slice(0, required).reduce((a, b) => a + b, 0);
    let bestErr = Math.abs(delta - sum);
    for (let i = required; i < covered.length; i++) {
      sum += est[i];
      const err = Math.abs(delta - sum);
      if (err < bestErr - 0.5) {
        bestErr = err;
        best = i + 1;
      }
    }
    if (best === 0) {
      // variation sans partie suivie (joué hors de l'app ?) ; les parties récentes seront expliquées à la recherche suivante
      if (!quiet) this.emit('log', tr('s.mmrNoMatch'));
      return [];
    }
    const group = covered.slice(0, best);
    const gEst = est.slice(0, best);
    const residual = delta - gEst.reduce((a, b) => a + b, 0);
    const single = group.length === 1;
    const signOk = !single || Math.abs(delta) < 3 || (group[0].result === 'W') === delta > 0;
    this.d.pending[k] = [...covered.slice(best), ...later].map((m) => m.id);
    this._learn = null;
    // trop d'écart avec les parties suivies : des parties ont été jouées sans RL-UI, on garde les estimations
    if (Math.abs(residual) > 15 + 6 * group.length || !signOk) {
      for (const m of group) m.mmr = { ...m.mmr, status: 'unknown' };
      if (!quiet) this.emit('log', tr('s.mmrGap', { d: `${delta > 0 ? '+' : ''}${round1(delta)}` }));
      return [];
    }
    const adj = residual / group.length;
    let cur = before;
    for (let i = 0; i < group.length; i++) {
      const m = group[i];
      const dv = single ? delta : gEst[i] + adj;
      m.mmr = { key: k, playlist: m.mmr.playlist, before: round1(cur), after: round1(cur + dv), delta: round1(dv), status: single ? 'exact' : 'grouped' };
      cur += dv;
    }
    return group.map((m) => m.id);
  }

  // ---------------------------------------------------------------- fin de match
  onMatch(record) {
    if (!this.settings.enabled || record.manual || !record.me || !record.me.id || record.playlistId == null) return null;
    if (!this.tracks(record.playlistId)) return null;
    const k = this.key(record.me.id, record.playlistId);
    const est = this.estimate(record, k);
    const cur = this.current(k);
    record.mmr = {
      key: k,
      playlist: record.playlistId,
      before: cur ? round1(cur.value) : null,
      after: cur ? round1(cur.value + est) : null,
      delta: round1(est),
      status: 'estimated',
      learned: this.hasLearned(k),
    };
    const list = this.d.pending[k] || (this.d.pending[k] = []);
    list.push(record.id);
    if (list.length > 40) list.splice(0, list.length - 40);
    return record.mmr;
  }

  // Partie supprimée de l'historique
  forget(id) {
    for (const k of Object.keys(this.d.pending)) this.d.pending[k] = this.d.pending[k].filter((x) => x !== id);
    this._learn = null;
  }

  // MMR actuel d'un mode = dernière valeur réelle + variations estimées des parties en attente
  // (une partie reste "en attente" tant que sa variation n'apparaît pas dans une valeur réelle)
  current(k) {
    const last = this.d.last[k];
    if (!last) return null;
    const pend = (this.d.pending[k] || []).map((id) => this.store.getMatch(id)).filter((m) => m && m.mmr);
    const extra = pend.reduce((s, m) => s + (m.mmr.delta || 0), 0);
    return { value: last.mmr + extra, real: last.mmr, at: last.at, pending: pend.length };
  }

  // ---------------------------------------------------------------- estimation
  _learned() {
    if (this._learn) return this._learn;
    const byKey = {};
    const byAcc = {};
    for (const m of this.store.data.matches) {
      if (!m.mmr || m.mmr.status !== 'exact' || !Number.isFinite(m.mmr.delta) || Math.abs(m.mmr.delta) > 60) continue;
      const win = m.result === 'W';
      if (win !== m.mmr.delta > 0) continue; // incohérent : on n'apprend pas dessus
      const k = m.mmr.key;
      for (const [map, id] of [[byKey, k], [byAcc, accountOf(k)]]) {
        const e = map[id] || (map[id] = { w: [], l: [] });
        (win ? e.w : e.l).push(m.mmr.delta);
      }
    }
    this._learn = { byKey, byAcc };
    return this._learn;
  }

  hasLearned(k) {
    const L = this._learned();
    return !!(L.byKey[k] && (L.byKey[k].w.length || L.byKey[k].l.length)) || !!L.byAcc[accountOf(k)];
  }

  estimate(record, k = record.mmr && record.mmr.key) {
    const win = record.result === 'W';
    const L = this._learned();
    const avg = (arr) => (arr && arr.length ? arr.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, arr.length) : null);
    const pick = (e) => (e ? avg(win ? e.w : e.l) : null);
    let v = pick(L.byKey[k]);
    if (v == null) v = pick(L.byAcc[accountOf(k)]);
    if (v == null) {
      const def = Math.abs(Number(this.settings.defaultDelta)) || 12;
      v = win ? def : -def;
    }
    return round1(v);
  }

  // ---------------------------------------------------------------- bilan pour l'affichage
  // liveKey : mode de la partie en cours ; accountId : compte connecté (pour afficher un MMR même sans partie)
  summary(sessionMatches, { liveKey = null, accountId = null } = {}) {
    const keys = new Map();
    const entry = (k, playlist) => {
      if (!keys.has(k)) keys.set(k, { key: k, playlist, delta: 0, games: 0, approx: false, lastAt: 0 });
      return keys.get(k);
    };
    for (const m of sessionMatches) {
      if (!m.mmr || !m.mmr.key) continue;
      const e = entry(m.mmr.key, m.mmr.playlist);
      e.delta += m.mmr.delta || 0;
      e.games++;
      if (m.mmr.status !== 'exact' && m.mmr.status !== 'grouped') e.approx = true;
      e.lastAt = Math.max(e.lastAt, m.endedAt || 0);
    }
    if (liveKey && this.d.last[liveKey]) {
      const e = entry(liveKey, this.d.last[liveKey].playlist);
      e.lastAt = Date.now();
    }
    if (!keys.size && accountId) {
      // pas encore de partie dans la session : dernier mode joué avec ce compte
      const lastKey = Object.keys(this.d.last)
        .filter((k) => accountOf(k) === accountId && this.tracks(this.d.last[k].playlist))
        .sort((a, b) => this.d.last[b].at - this.d.last[a].at)[0];
      if (lastKey) entry(lastKey, this.d.last[lastKey].playlist).lastAt = this.d.last[lastKey].at;
    }
    const list = [...keys.values()].map((e) => {
      const cur = this.current(e.key);
      const pl = describePlaylist(e.playlist);
      return {
        ...e,
        delta: round1(e.delta),
        name: pl.name,
        short: pl.short,
        current: cur ? Math.round(cur.value) : null,
        currentApprox: !!(cur && cur.pending),
        realAt: cur ? cur.at : null,
      };
    });
    list.sort((a, b) => b.lastAt - a.lastAt);
    const primary = (liveKey && list.find((e) => e.key === liveKey)) || list[0] || null;
    return { primary, list };
  }

  // Dernières valeurs réelles connues pour un compte (réglages)
  known(accountId) {
    return Object.entries(this.d.last)
      .filter(([k]) => !accountId || accountOf(k) === accountId)
      .map(([k, s]) => ({ key: k, playlist: s.playlist, name: describePlaylist(s.playlist).name, mmr: Math.round(s.mmr), at: s.at, tier: s.tier }))
      .sort((a, b) => b.at - a.at);
  }
}

module.exports = { MmrTracker, round1, LAG_MS };
