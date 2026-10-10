'use strict';
// Points de départ de l'éditeur de thèmes : des compositions prêtes à modifier.
// Toile = taille conseillée de la source OBS du compteur (1000 × 220) sauf pour le modèle vertical.

const PLATE = '#0a0f11';
let LINE = ''; // nom des traits de séparation, dans la langue de l'app

const box = (name, x, y, w, h, o = {}) => ({ type: 'box', name, x, y, w, h, fill: PLATE, fillOpacity: 0.94, ...o });
const line = (x, y, w, h) => ({ type: 'box', name: LINE, x, y, w, h, fill: 'white', fillOpacity: 0.12 });
const value = (name, bind, x, y, w, h, o = {}) => ({ type: 'value', name, bind, x, y, w, h, font: 'Unbounded', size: 24, weight: 700, color: 'white', align: 'center', ...o });
const text = (name, t, x, y, w, h, o = {}) => ({ type: 'text', name, text: t, x, y, w, h, font: 'Onest', size: 13, weight: 500, color: 'white', align: 'center', opacity: 0.62, ...o });

// Badge « OVERTIME +0:37 » et mode de jeu : n'apparaissent qu'en partie
function liveTags(tr, x, y, right) {
  return [
    box(tr('cmp.n.modeTag'), x, y, 170, 28, { radius: 8, when: 'match' }),
    value(tr('cmp.n.mode'), 'mode', x + 8, y, 154, 28, { font: 'Onest', size: 14, weight: 600, when: 'match' }),
    box(tr('cmp.n.otBadge'), right - 178, y, 178, 28, { fill: 'ot', fillOpacity: 1, radius: 8, when: 'overtime' }),
    text('OVERTIME', 'OVERTIME', right - 170, y, 100, 28, { font: 'Unbounded', size: 12, weight: 700, color: 'black', align: 'left', opacity: 1, when: 'overtime' }),
    value(tr('cmp.n.clock'), 'clock', right - 70, y, 62, 28, { size: 13, color: 'black', align: 'right', when: 'overtime' }),
  ];
}

function cell(tr, key, bind, x, y, w, o = {}) {
  return [value(tr(`cmp.n.${key}`), bind, x, y, w, 30, { size: 23, ...o }), text(tr(`cmp.cap.${key}`), tr(`cmp.cap.${key}`), x, y + 34, w, 18)];
}

const STARTERS = {
  // la plaque horizontale de RL-UI : bilan à gauche, quatre chiffres à droite
  signature(tr) {
    const y = 56;
    return {
      width: 1000,
      height: 220,
      elements: [
        ...liveTags(tr, 34, 24, 644),
        box(tr('cmp.n.plate'), 18, y, 642, 86, { radius: 16, cut: 22 }),
        value(tr('cmp.n.wins'), 'wins', 34, y, 74, 86, { size: 46, color: 'win', align: 'right' }),
        value(tr('cmp.n.labelWin'), 'labelWin', 112, y + 44, 30, 22, { font: 'Onest', size: 17, color: 'win', align: 'left', opacity: 0.75 }),
        line(150, y + 23, 1, 40),
        value(tr('cmp.n.losses'), 'losses', 158, y, 74, 86, { size: 46, color: 'loss', align: 'right' }),
        value(tr('cmp.n.labelLoss'), 'labelLoss', 236, y + 44, 30, 22, { font: 'Onest', size: 17, color: 'loss', align: 'left', opacity: 0.75 }),
        line(276, y + 14, 1, 58),
        ...cell(tr, 'winRate', 'winRate', 277, y + 17, 92),
        line(369, y + 14, 1, 58),
        ...cell(tr, 'streak', 'streak', 370, y + 17, 92, { color: 'auto' }),
        line(461, y + 14, 1, 58),
        ...cell(tr, 'ot', 'otRecord', 462, y + 17, 92),
        line(553, y + 14, 1, 58),
        ...cell(tr, 'mmr', 'mmrDelta', 554, y + 17, 92, { color: 'auto' }),
      ],
    };
  },
  // une barre fine : le bilan, le winrate et les dernières parties
  bar(tr) {
    const y = 60;
    return {
      width: 1000,
      height: 220,
      elements: [
        ...liveTags(tr, 34, 28, 610),
        box(tr('cmp.n.plate'), 18, y, 608, 60, { radius: 30 }),
        value(tr('cmp.n.record'), 'record', 40, y, 150, 60, { size: 28, align: 'left' }),
        line(196, y + 14, 1, 32),
        value(tr('cmp.n.winRate'), 'winRate', 208, y, 86, 60, { size: 20 }),
        line(304, y + 14, 1, 32),
        { type: 'results', name: tr('cmp.n.results'), x: 320, y: y + 14, w: 284, h: 32, count: 10, gap: 4, radius: 7 },
      ],
    };
  },
  // une colonne, pour un bord d'écran
  vertical(tr) {
    const w = 180;
    return {
      width: 220,
      height: 470,
      elements: [
        box(tr('cmp.n.plate'), 20, 20, w, 430, { radius: 18, cut: 24 }),
        value(tr('cmp.n.wins'), 'wins', 20, 36, w, 64, { size: 50, color: 'win' }),
        value(tr('cmp.n.labelWin'), 'labelWin', 20, 100, w, 20, { font: 'Onest', size: 16, color: 'win', opacity: 0.75 }),
        line(70, 134, 80, 1),
        value(tr('cmp.n.losses'), 'losses', 20, 146, w, 64, { size: 50, color: 'loss' }),
        value(tr('cmp.n.labelLoss'), 'labelLoss', 20, 210, w, 20, { font: 'Onest', size: 16, color: 'loss', opacity: 0.75 }),
        { type: 'bar', name: tr('cmp.n.bar'), x: 44, y: 246, w: w - 48, h: 8, radius: 4, gap: 2 },
        ...cell(tr, 'winRate', 'winRate', 20, 272, w),
        line(44, 334, w - 48, 1),
        ...cell(tr, 'streak', 'streak', 20, 346, w / 2, { color: 'auto' }),
        ...cell(tr, 'mmr', 'mmrDelta', 20 + w / 2, 346, w / 2, { color: 'auto' }),
        box(tr('cmp.n.otBadge'), 20, 412, w, 26, { fill: 'ot', fillOpacity: 1, radius: 0, when: 'overtime' }),
        value(tr('cmp.n.clock'), 'clock', 20, 412, w, 26, { size: 13, color: 'black', prefix: 'OT ', when: 'overtime' }),
      ],
    };
  },
  // presque rien : une plaque et le bilan, pour tout construire soi-même
  blank(tr) {
    return {
      width: 1000,
      height: 220,
      elements: [box(tr('cmp.n.plate'), 18, 56, 320, 86, { radius: 16 }), value(tr('cmp.n.record'), 'record', 18, 56, 320, 86, { size: 40 })],
    };
  },
};

// Points de départ des autres overlays : un thème qui veut redessiner ses alertes, ses dernières parties ou son récap
// part d'une composition complète plutôt que d'une toile vide.
const OVERLAYS = {
  // un bandeau au centre de l'écran : barre de la couleur de l'alerte, titre, puis le détail de la partie
  alerts(tr) {
    const x = 360;
    const y = 420;
    const chip = { font: 'Onest', size: 28, weight: 700, align: 'left' };
    return {
      width: 1920,
      height: 1080,
      enter: 'slide',
      elements: [
        box(tr('cmp.n.plate'), x, y, 1200, 240, { cut: 28, shadow: 'strong' }),
        box(tr('cmp.n.eventBar'), x, y, 16, 240, { fill: 'event', fillOpacity: 1 }),
        value(tr('cmp.n.alertDetail'), 'alertDetail', x + 60, y + 24, 1080, 36, { ...chip, size: 26, opacity: 0.62 }),
        value(tr('cmp.n.alertTitle'), 'alertTitle', x + 60, y + 58, 1080, 108, { size: 92, weight: 800, color: 'event', align: 'left', fit: true }),
        line(x + 60, y + 176, 1080, 1),
        value(tr('cmp.n.record'), 'record', x + 60, y + 186, 300, 44, { ...chip, prefix: `${tr('al.session')} ` }),
        value(tr('cmp.n.matchScore'), 'matchScore', x + 370, y + 186, 170, 44, { size: 32, weight: 800, align: 'left', when: 'matchScore' }),
        value(tr('cmp.n.matchMmr'), 'matchMmr', x + 550, y + 186, 230, 44, { ...chip, color: 'auto', suffix: ' MMR', when: 'matchMmr' }),
        text(tr('cmp.n.nextGoal'), tr('al.nextGoal'), x + 550, y + 186, 420, 44, { ...chip, color: 'ot', opacity: 1, when: 'alertOt', fit: true }),
        value(tr('cmp.n.matchOt'), 'matchOt', x + 790, y + 186, 180, 44, { ...chip, color: 'ot', prefix: 'OT ', when: 'alertOtEnd' }),
        text('MVP', 'MVP', x + 1000, y + 186, 140, 44, { ...chip, color: 'ot', opacity: 1, align: 'right', when: 'alertMvp' }),
      ],
    };
  },
  // une plaque et les dernières parties en pastilles
  history(tr) {
    return {
      width: 700,
      height: 90,
      elements: [
        box(tr('cmp.n.plate'), 10, 12, 566, 66, { radius: 12, cut: 16 }),
        text(tr('ov.recent'), tr('ov.recent'), 28, 12, 104, 66, { size: 18, weight: 700, align: 'left', opacity: 0.55, fit: true }),
        { type: 'results', name: tr('cmp.n.results'), x: 140, y: 24, w: 418, h: 42, count: 10, gap: 6, radius: 5 },
      ],
    };
  },
  // une carte au centre de l'écran : le bilan en grand, huit chiffres, les dernières parties
  summary(tr) {
    const x = 510;
    const tile = (i, row, key, bind, o = {}) => {
      const tx = x + i * 230;
      const ty = 566 + row * 126;
      return [box(tr('cmp.n.tile'), tx, ty, 210, 110, { fill: 'white', fillOpacity: 0.05, radius: 14 }), value(tr(`cmp.n.${key}`), bind, tx, ty + 14, 210, 50, { size: 38, ...o }), text(tr(`cmp.cap.${key}`), tr(`cmp.cap.${key}`), tx, ty + 70, 210, 24, { size: 16 })];
    };
    return {
      width: 1920,
      height: 1080,
      elements: [
        box(tr('cmp.n.plate'), 460, 180, 1000, 720, { radius: 24, cut: 40, shadow: 'strong' }),
        text(tr('ov.recap'), tr('ov.recap'), x, 214, 560, 56, { font: 'Unbounded', size: 34, weight: 700, align: 'left', opacity: 1, fit: true }),
        value(tr('cmp.n.player'), 'player', 1110, 214, 300, 56, { font: 'Onest', size: 24, weight: 600, align: 'right', opacity: 0.6, fit: true }),
        value(tr('cmp.n.wins'), 'wins', 540, 300, 280, 150, { size: 130, weight: 800, color: 'win' }),
        text(tr('ov.wins'), tr('ov.wins'), 540, 452, 280, 30, { size: 20, color: 'win', opacity: 0.8 }),
        text('–', '–', 820, 300, 80, 150, { font: 'Unbounded', size: 70, weight: 500, opacity: 0.35 }),
        value(tr('cmp.n.losses'), 'losses', 900, 300, 280, 150, { size: 130, weight: 800, color: 'loss' }),
        text(tr('ov.losses'), tr('ov.losses'), 900, 452, 280, 30, { size: 20, color: 'loss', opacity: 0.8 }),
        line(1200, 320, 1, 150),
        value(tr('cmp.n.winRate'), 'winRate', 1210, 336, 200, 80, { size: 54 }),
        text(tr('cmp.cap.winRate'), tr('cmp.cap.winRate'), 1210, 420, 200, 28, { size: 18 }),
        { type: 'bar', name: tr('cmp.n.bar'), x, y: 512, w: 900, h: 12, radius: 6, gap: 4 },
        ...tile(0, 0, 'bestStreak', 'bestStreak'),
        ...tile(1, 0, 'ot', 'otRecord', { color: 'ot' }),
        ...tile(2, 0, 'mvps', 'mvps'),
        ...tile(3, 0, 'timePlayed', 'timePlayed'),
        ...tile(0, 1, 'goals', 'goals'),
        ...tile(1, 1, 'assists', 'assists'),
        ...tile(2, 1, 'saves', 'saves'),
        ...tile(3, 1, 'mmr', 'mmrDelta', { color: 'auto' }),
        { type: 'results', name: tr('cmp.n.results'), x, y: 828, w: 900, h: 40, count: 14, gap: 8, radius: 6 },
      ],
    };
  },
};

function starter(kind, tr) {
  LINE = tr('cmp.n.line');
  return (STARTERS[kind] || STARTERS.signature)(tr);
}

// Composition de départ d'un overlay autre que le compteur (alerts, history, summary) ; null si le nom est inconnu
function overlayStarter(overlay, tr) {
  LINE = tr('cmp.n.line');
  return Object.prototype.hasOwnProperty.call(OVERLAYS, overlay) ? OVERLAYS[overlay](tr) : null;
}

module.exports = { starter, overlayStarter, STARTER_IDS: Object.keys(STARTERS), OVERLAY_STARTERS: Object.keys(OVERLAYS) };
