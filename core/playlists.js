'use strict';
// Identifiants de playlists Rocket League (lus dans Launch.log : "Playlist-11", "PlaylistId=11"...).
// Catégories : ranked | casual | extra | tournament | private | offline | training
// Noms : [anglais, français]

const { t: tr, getLang } = require('./i18n');

const PLAYLISTS = {
  1: { name: ['1v1 Casual', '1v1 Occasionnel'], short: '1v1', cat: 'casual' },
  2: { name: ['2v2 Casual', '2v2 Occasionnel'], short: '2v2', cat: 'casual' },
  3: { name: ['3v3 Casual', '3v3 Occasionnel'], short: '3v3', cat: 'casual' },
  4: { name: ['Chaos 4v4', 'Chaos 4v4'], short: '4v4', cat: 'casual' },
  6: { name: ['Private match', 'Partie privée'], short: ['Private', 'Privée'], cat: 'private' },
  7: { name: ['Season (offline)', 'Saison (hors-ligne)'], short: ['Season', 'Saison'], cat: 'offline' },
  8: { name: ['Split screen', 'Écran partagé'], short: 'Local', cat: 'offline' },
  9: { name: ['Training', 'Entraînement'], short: 'Training', cat: 'training' },
  10: { name: ['1v1 Ranked', '1v1 Classé'], short: '1v1', cat: 'ranked' },
  11: { name: ['2v2 Ranked', '2v2 Classé'], short: '2v2', cat: 'ranked' },
  12: { name: ['Solo 3v3 Ranked', 'Solo 3v3 Classé'], short: '3v3', cat: 'ranked' },
  13: { name: ['3v3 Ranked', '3v3 Classé'], short: '3v3', cat: 'ranked' },
  15: { name: ['Snow Day', 'Snow Day'], short: 'Snow Day', cat: 'extra' },
  16: { name: ['Rocket Labs', 'Rocket Labs'], short: 'Labs', cat: 'extra' },
  17: { name: ['Hoops', 'Hoops'], short: 'Hoops', cat: 'extra' },
  18: { name: ['Rumble', 'Rumble'], short: 'Rumble', cat: 'extra' },
  19: { name: ['Workshop', 'Workshop'], short: 'Workshop', cat: 'offline' },
  20: { name: ['Training editor', "Éditeur d'entraînement"], short: 'Training', cat: 'training' },
  21: { name: ['Custom training', 'Entraînement perso'], short: 'Training', cat: 'training' },
  22: { name: ['Tournament', 'Tournoi'], short: ['Tournament', 'Tournoi'], cat: 'tournament' },
  23: { name: ['Dropshot', 'Dropshot'], short: 'Dropshot', cat: 'extra' },
  24: { name: ['LAN match', 'Partie LAN'], short: 'LAN', cat: 'private' },
  26: { name: ['FACEIT', 'FACEIT'], short: 'FACEIT', cat: 'private' },
  27: { name: ['Hoops Ranked', 'Hoops Classé'], short: 'Hoops', cat: 'ranked' },
  28: { name: ['Rumble Ranked', 'Rumble Classé'], short: 'Rumble', cat: 'ranked' },
  29: { name: ['Dropshot Ranked', 'Dropshot Classé'], short: 'Dropshot', cat: 'ranked' },
  30: { name: ['Snow Day Ranked', 'Snow Day Classé'], short: 'Snow Day', cat: 'ranked' },
  34: { name: ['Tournament', 'Tournoi'], short: ['Tournament', 'Tournoi'], cat: 'tournament' },
  73: { name: ['Online freeplay', 'Jeu libre en ligne'], short: 'Freeplay', cat: 'training' },
};

const CATEGORY_LABELS = {
  ranked: ['Ranked', 'Classé'],
  casual: ['Casual', 'Occasionnel'],
  extra: ['Extra modes', 'Modes extra'],
  tournament: ['Tournaments', 'Tournois'],
  private: ['Private matches', 'Parties privées'],
  offline: ['Offline', 'Hors-ligne'],
  training: ['Training', 'Entraînement'],
  unknown: ['Unknown mode', 'Mode inconnu'],
};

const pick = (v) => (Array.isArray(v) ? v[getLang() === 'fr' ? 1 : 0] : v);

function categoryLabels() {
  return Object.fromEntries(Object.entries(CATEGORY_LABELS).map(([k, v]) => [k, pick(v)]));
}

// online = la partie a un MatchGuid (en ligne / LAN)
function describePlaylist(id, online = true) {
  if (id == null || Number.isNaN(Number(id))) {
    return { id: null, name: tr(online ? 's.pl.online' : 's.pl.offline'), short: '', cat: online ? 'unknown' : 'offline', ranked: false };
  }
  const n = Number(id);
  const p = PLAYLISTS[n];
  if (p) return { id: n, name: pick(p.name), short: pick(p.short), cat: p.cat, ranked: p.cat === 'ranked' };
  // Playlists inconnues = modes temporaires / événements
  return { id: n, name: tr('s.pl.special', { n }), short: tr('s.pl.specialShort'), cat: 'extra', ranked: false };
}

// Nom du mode d'une partie enregistrée, dans la langue actuelle
function playlistLabel(r) {
  if (!r) return '';
  if (r.manual) return tr('manual');
  if (r.playlistId != null) return describePlaylist(r.playlistId).name;
  if (r.category === 'offline') return tr('s.pl.offline');
  if (r.category === 'unknown') return tr('s.pl.online');
  return r.playlistName || tr('unknown');
}

module.exports = { PLAYLISTS, categoryLabels, describePlaylist, playlistLabel };
