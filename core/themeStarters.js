'use strict';
// Points de départ de l'éditeur de thèmes : des compositions prêtes à modifier.
// Toile = taille conseillée de la source OBS du compteur (1000 × 220) sauf pour le modèle vertical.

const PLATE = '#0a0f11';

const box = (name, x, y, w, h, o = {}) => ({ type: 'box', name, x, y, w, h, fill: PLATE, fillOpacity: 0.94, ...o });
const line = (x, y, w, h) => ({ type: 'box', name: '', x, y, w, h, fill: 'white', fillOpacity: 0.12 });
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

function starter(kind, tr) {
  return (STARTERS[kind] || STARTERS.signature)(tr);
}

module.exports = { starter, STARTER_IDS: Object.keys(STARTERS) };
