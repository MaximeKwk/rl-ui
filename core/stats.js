'use strict';
// Calcul des statistiques à partir d'une liste de parties (ordre chronologique).

function computeStats(records) {
  const s = {
    wins: 0,
    losses: 0,
    played: 0,
    winRate: 0,
    streak: 0, // >0 série de victoires, <0 série de défaites
    bestWinStreak: 0,
    worstLossStreak: 0,
    otWins: 0,
    otLosses: 0,
    abandons: 0,
    mvps: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    myGoals: 0,
    myAssists: 0,
    mySaves: 0,
    myShots: 0,
    timePlayedSec: 0,
    last: [],
  };
  let cur = 0;
  for (const r of records) {
    const win = r.result === 'W';
    if (win) s.wins++;
    else s.losses++;
    if (r.overtime) win ? s.otWins++ : s.otLosses++;
    if (r.abandon) s.abandons++;
    if (r.mvp) s.mvps++;
    if (Number.isFinite(r.scoreFor)) s.goalsFor += r.scoreFor;
    if (Number.isFinite(r.scoreAgainst)) s.goalsAgainst += r.scoreAgainst;
    if (r.me) {
      s.myGoals += r.me.goals || 0;
      s.myAssists += r.me.assists || 0;
      s.mySaves += r.me.saves || 0;
      s.myShots += r.me.shots || 0;
    }
    if (Number.isFinite(r.durationSec)) s.timePlayedSec += r.durationSec;
    cur = win ? (cur > 0 ? cur + 1 : 1) : cur < 0 ? cur - 1 : -1;
    if (cur > s.bestWinStreak) s.bestWinStreak = cur;
    if (-cur > s.worstLossStreak) s.worstLossStreak = -cur;
  }
  s.played = s.wins + s.losses;
  s.winRate = s.played ? Math.round((s.wins / s.played) * 100) : 0;
  s.streak = cur;
  s.last = records.slice(-20).map((r) => ({
    id: r.id,
    result: r.result,
    ot: !!r.overtime,
    abandon: !!r.abandon,
    manual: !!r.manual,
    score: Number.isFinite(r.scoreFor) ? `${r.scoreFor}-${r.scoreAgainst}` : '',
  }));
  return s;
}

// Répartition par playlist pour l'historique global
function statsByPlaylist(records) {
  const map = new Map();
  for (const r of records) {
    const key = r.playlistName || (r.manual ? 'Ajout manuel' : 'Inconnu');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return [...map.entries()]
    .map(([name, rs]) => {
      const st = computeStats(rs);
      return { name, wins: st.wins, losses: st.losses, winRate: st.winRate, played: st.played };
    })
    .sort((a, b) => b.played - a.played);
}

module.exports = { computeStats, statsByPlaylist };
