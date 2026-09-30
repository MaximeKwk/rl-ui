'use strict';
// Identifiants de playlists Rocket League (lus dans Launch.log : "Playlist-11", "PlaylistId=11"...).
// Catégories : ranked | casual | extra | tournament | private | offline | training

const PLAYLISTS = {
  1: { name: '1v1 Occasionnel', short: '1v1', cat: 'casual' },
  2: { name: '2v2 Occasionnel', short: '2v2', cat: 'casual' },
  3: { name: '3v3 Occasionnel', short: '3v3', cat: 'casual' },
  4: { name: 'Chaos 4v4', short: '4v4', cat: 'casual' },
  6: { name: 'Partie privée', short: 'Privée', cat: 'private' },
  7: { name: 'Saison (hors-ligne)', short: 'Saison', cat: 'offline' },
  8: { name: 'Écran partagé', short: 'Local', cat: 'offline' },
  9: { name: 'Entraînement', short: 'Training', cat: 'training' },
  10: { name: '1v1 Classé', short: '1v1', cat: 'ranked' },
  11: { name: '2v2 Classé', short: '2v2', cat: 'ranked' },
  12: { name: 'Solo 3v3 Classé', short: '3v3', cat: 'ranked' },
  13: { name: '3v3 Classé', short: '3v3', cat: 'ranked' },
  15: { name: 'Snow Day', short: 'Snow Day', cat: 'extra' },
  16: { name: 'Rocket Labs', short: 'Labs', cat: 'extra' },
  17: { name: 'Hoops', short: 'Hoops', cat: 'extra' },
  18: { name: 'Rumble', short: 'Rumble', cat: 'extra' },
  19: { name: 'Workshop', short: 'Workshop', cat: 'offline' },
  20: { name: 'Éditeur d\'entraînement', short: 'Training', cat: 'training' },
  21: { name: 'Entraînement perso', short: 'Training', cat: 'training' },
  22: { name: 'Tournoi', short: 'Tournoi', cat: 'tournament' },
  23: { name: 'Dropshot', short: 'Dropshot', cat: 'extra' },
  24: { name: 'Partie LAN', short: 'LAN', cat: 'private' },
  26: { name: 'FACEIT', short: 'FACEIT', cat: 'private' },
  27: { name: 'Hoops Classé', short: 'Hoops', cat: 'ranked' },
  28: { name: 'Rumble Classé', short: 'Rumble', cat: 'ranked' },
  29: { name: 'Dropshot Classé', short: 'Dropshot', cat: 'ranked' },
  30: { name: 'Snow Day Classé', short: 'Snow Day', cat: 'ranked' },
  34: { name: 'Tournoi', short: 'Tournoi', cat: 'tournament' },
  73: { name: 'Jeu libre en ligne', short: 'Freeplay', cat: 'training' },
};

const CATEGORY_LABELS = {
  ranked: 'Classé',
  casual: 'Occasionnel',
  extra: 'Modes extra',
  tournament: 'Tournois',
  private: 'Parties privées',
  offline: 'Hors-ligne',
  training: 'Entraînement',
  unknown: 'Mode inconnu',
};

// online = la partie a un MatchGuid (en ligne / LAN)
function describePlaylist(id, online = true) {
  if (id == null || Number.isNaN(Number(id))) {
    return { id: null, name: online ? 'Partie en ligne' : 'Hors-ligne', short: '', cat: online ? 'unknown' : 'offline', ranked: false };
  }
  const n = Number(id);
  const p = PLAYLISTS[n];
  if (p) return { id: n, name: p.name, short: p.short, cat: p.cat, ranked: p.cat === 'ranked' };
  // Playlists inconnues = modes temporaires / événements
  return { id: n, name: `Mode spécial #${n}`, short: 'Spécial', cat: 'extra', ranked: false };
}

module.exports = { PLAYLISTS, CATEGORY_LABELS, describePlaylist };
