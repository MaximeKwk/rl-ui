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

// ---- compteur « Boost » : la plaque collée à gauche de la jauge de boost du jeu, comme celle de RL-UI
// La toile est posée dans le coin bas droit de l'écran ; la jauge du jeu y est à (largeur − 156, hauteur − 150).
OVERLAYS.boost = (tr) => {
  const W = 480;
  const H = 320;
  const gx = W - 156;
  const gy = H - 150;
  const R = 130; // rayon de la jauge + écart
  const px = gx - R - 128; // bord gauche de la plaque
  const py = gy - 118;
  const f = { font: 'Barlow Condensed' };
  const deg = (x, y) => ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
  const a0 = deg(-Math.sqrt(R * R - 100 * 100), 100); // bas de la plaque
  const a1 = deg(-Math.sqrt(R * R - 118 * 118), -118); // haut de la plaque
  const step = (a1 - a0) / 8;
  const stat = (i, key, bind, cap) => [
    value(tr(`cmp.n.${key}`), bind, px + 1 + i * 64, py + 155, 62, 28, { ...f, size: 27, weight: 800, color: 'auto', fit: true }),
    text(cap, cap, px + 1 + i * 64, py + 185, 62, 14, { ...f, size: 13, weight: 600, opacity: 0.55, fit: true }),
  ];
  return {
    width: W,
    height: H,
    gaugeGap: 12,
    elements: [
      // (la plaque dépasse sous la jauge : la découpe autour de la jauge lui donne son bord arrondi)
      box(tr('cmp.n.plate'), px, py, 234, 218, { radius: 14 }),
      { type: 'arc', name: tr('cmp.n.rim'), x: gx - R - 3, y: gy - R - 3, w: 2 * R + 6, h: 2 * R + 6, from: Math.round(a0), to: Math.round(a1), thickness: 3, color: 'team' },
      { type: 'arc', name: tr('cmp.n.ticks'), x: gx - R - 11, y: gy - R - 11, w: 2 * R + 22, h: 2 * R + 22, from: Math.round(a0 + step), to: Math.round(a1 - step), thickness: 7, ticks: 7, tickW: 2.2, color: 'team', opacity: 0.85 },
      value(tr('cmp.n.wins'), 'wins', px + 4, py + 18, 82, 60, { ...f, size: 58, weight: 800, color: 'win', align: 'right' }),
      value(tr('cmp.n.labelWin'), 'labelWin', px + 91, py + 44, 34, 26, { ...f, size: 20, weight: 700, color: 'win', align: 'left', opacity: 0.7 }),
      box(LINE, px + 41, py + 82, 46, 1, { fill: 'white', fillOpacity: 0.14 }),
      value(tr('cmp.n.losses'), 'losses', px + 4, py + 88, 82, 60, { ...f, size: 58, weight: 800, color: 'loss', align: 'right' }),
      value(tr('cmp.n.labelLoss'), 'labelLoss', px + 91, py + 114, 34, 26, { ...f, size: 20, weight: 700, color: 'loss', align: 'left', opacity: 0.7 }),
      ...stat(0, 'mmr', 'mmrDelta', 'MMR'),
      ...stat(1, 'streak', 'streak', tr('ov.streak')),
      box(tr('cmp.n.otBadge'), px - 11, py - 32, 150, 27, { fill: 'ot', fillOpacity: 1, when: 'overtime' }),
      text('OVERTIME', 'OVERTIME', px - 2, py - 32, 84, 27, { ...f, size: 17, weight: 800, color: '#1b1000', align: 'left', opacity: 1, when: 'overtime' }),
      value(tr('cmp.n.clock'), 'clock', px + 84, py - 32, 48, 27, { ...f, size: 17, weight: 800, color: '#1b1000', align: 'right', when: 'overtime' }),
    ],
  };
};

// ---- overlay caster : la disposition de RL-UI (tableau des scores, boost des joueurs, joueur suivi, but, actions, tableau final)
OVERLAYS.caster = (tr) => {
  const PANEL = '#080b14';
  const GOLD = '#ffd35a';
  const f = { font: 'Barlow Condensed', weight: 900 };
  const panel = (name, x, y, w, h, o = {}) => box(name, x, y, w, h, { fill: PANEL, fillOpacity: 0.9, ...o });
  const val = (name, bind, x, y, w, h, o = {}) => value(name, bind, x, y, w, h, { ...f, ...o });
  const txt = (name, t, x, y, w, h, o = {}) => text(name, t, x, y, w, h, { ...f, opacity: 1, ...o });
  const pips = (name, team, x, y, o = {}) => ({ type: 'pips', name, team, x, y, w: 122, h: 8, ...o });
  // tableau des scores : équipe, score, horloge, score, équipe
  const bx = 463;
  const by = 18;
  const side = (n) => {
    const x = n ? bx + 664 : bx;
    const sx = n ? bx + 572 : bx + 330;
    return [
      box(tr(n ? 'cmp.n.team1' : 'cmp.n.team0'), x, by, 330, 78, { fill: `team${n}`, fillOpacity: 1, cut: 14, cutCorner: n ? 'br' : 'bl' }),
      { type: 'image', name: tr(n ? 'e.ibind.teamLogo1' : 'e.ibind.teamLogo0'), bind: `teamLogo${n}`, x: n ? x + 262 : x + 10, y: by + 10, w: 58, h: 58 },
      val(tr(n ? 'e.bind.teamName1' : 'e.bind.teamName0'), `teamName${n}`, n ? x + 20 : x + 78, by, 232, 78, { size: 34, upper: true, spacing: 1.4, align: n ? 'left' : 'right', fit: true }),
      panel(tr('cmp.n.scoreBox'), sx, by, 92, 78),
      box(LINE, sx, by + 74, 92, 4, { fill: `team${n}`, fillOpacity: 1 }),
      val(tr(n ? 'e.bind.teamScore1' : 'e.bind.teamScore0'), `teamScore${n}`, sx, by, 92, 74, { size: 60 }),
    ];
  };
  const bug = [
    ...side(0),
    ...side(1),
    box(tr('cmp.n.clockBox'), bx + 422, by, 150, 78, { fill: '#05070d', fillOpacity: 1 }),
    box(LINE, bx + 422, by + 74, 150, 4, { fill: 'white', fillOpacity: 0.25 }),
    box(LINE, bx + 422, by + 74, 150, 4, { fill: GOLD, fillOpacity: 1, when: 'overtime' }),
    val(tr('e.bind.matchClock'), 'matchClock', bx + 422, by + 6, 150, 48, { size: 42, color: 'auto' }),
    val(tr('e.bind.clockNote'), 'clockNote', bx + 422, by + 54, 150, 16, { size: 13, weight: 800, spacing: 2.6, color: 'auto', opacity: 0.8 }),
    panel(tr('cmp.n.seriesBar'), 700, by + 77, 520, 30, { radius: 12, when: 'series' }),
    pips(tr('cmp.n.pips0'), 0, 722, by + 88, { when: 'series' }),
    val(tr('e.bind.seriesLine'), 'seriesLine', 856, by + 77, 208, 30, { size: 15, weight: 800, spacing: 2.4, upper: true, opacity: 0.85, fit: true, when: 'series' }),
    pips(tr('cmp.n.pips1'), 1, 1076, by + 88, { when: 'series' }),
  ];
  // boost des joueurs, une colonne par équipe
  const boosts = [0, 1].map((n) => ({ type: 'players', name: tr(n ? 'cmp.n.players1' : 'cmp.n.players0'), team: n, x: n ? 1566 : 24, y: 24, w: 330, h: 256, rowH: 58, gap: 8, when: 'boosts' }));
  // joueur suivi, en bas au centre
  const tx = 580;
  const ty = 942;
  const stat = (i, bind, cap) => [
    box(tr('cmp.n.tile'), tx + 332 + i * 68, ty + 26, 62, 58, { fill: 'white', fillOpacity: 0.05, radius: 8, when: 'target' }),
    val(tr(`e.bind.${bind}`), bind, tx + 332 + i * 68, ty + 31, 62, 28, { size: 26, when: 'target' }),
    txt(cap, cap, tx + 332 + i * 68, ty + 61, 62, 16, { size: 11, weight: 800, spacing: 1.5, upper: true, opacity: 0.55, fit: true, when: 'target' }),
  ];
  const target = [
    panel(tr('cmp.n.targetCard'), tx, ty, 760, 110, { radius: 16, shadow: 'soft', when: 'target' }),
    box(tr('cmp.n.teamLine'), tx + 14, ty, 732, 4, { fill: 'event', fillOpacity: 1, when: 'target' }),
    { type: 'arc', name: tr('cmp.n.boostRing'), x: tx + 14, y: ty + 16, w: 82, h: 82, from: 0, to: 360, thickness: 7, cap: 'round', color: 'event', bind: 'tgBoost', track: 0.18, when: 'target' },
    val(tr('e.bind.tgBoost'), 'tgBoost', tx + 14, ty + 16, 82, 82, { size: 30, when: 'target' }),
    val(tr('e.bind.tgName'), 'tgName', tx + 114, ty + 20, 200, 42, { size: 34, align: 'left', fit: true, when: 'target' }),
    val(tr('e.bind.tgTeam'), 'tgTeam', tx + 114, ty + 64, 200, 22, { size: 15, weight: 800, spacing: 2.4, upper: true, color: 'event', align: 'left', fit: true, when: 'target' }),
    ...stat(0, 'tgScore', tr('c.score')),
    ...stat(1, 'tgGoals', tr('c.goals')),
    ...stat(2, 'tgAssists', tr('c.assists')),
    ...stat(3, 'tgSaves', tr('c.saves')),
    ...stat(4, 'tgShots', tr('c.shots')),
    ...stat(5, 'tgDemos', tr('c.demos')),
  ];
  // bannière de but, sous le tableau des scores
  const goal = [
    panel(tr('cmp.n.goalBanner'), 640, 150, 640, 82, { radius: 14, when: 'goal' }),
    box(tr('cmp.n.goalTag'), 650, 160, 170, 62, { fill: 'event', fillOpacity: 1, radius: 10, when: 'goal' }),
    txt(tr('c.goal'), tr('c.goal'), 658, 160, 154, 62, { size: 46, fit: true, when: 'goal' }),
    val(tr('e.bind.goalScorer'), 'goalScorer', 842, 162, 300, 38, { size: 34, align: 'left', fit: true, when: 'goal' }),
    val(tr('e.bind.goalAssist'), 'goalAssist', 842, 200, 300, 22, { size: 18, weight: 700, align: 'left', opacity: 0.7, fit: true, when: 'goal' }),
    val(tr('e.bind.goalSpeed'), 'goalSpeed', 1150, 160, 112, 62, { size: 30, align: 'right', fit: true, when: 'goal' }),
  ];
  // action du statfeed, en bas à gauche
  const feed = [
    panel(tr('cmp.n.feedLine'), 24, 1014, 420, 38, { radius: 10, when: 'feed' }),
    box(tr('cmp.n.teamLine'), 24, 1014, 5, 38, { fill: 'event', fillOpacity: 1, when: 'feed' }),
    val(tr('e.bind.feedLabel'), 'feedLabel', 40, 1014, 150, 38, { size: 15, spacing: 1.8, upper: true, color: GOLD, align: 'right', fit: true, when: 'feed' }),
    val(tr('e.bind.feedText'), 'feedText', 202, 1014, 230, 38, { size: 19, weight: 700, align: 'left', fit: true, when: 'feed' }),
  ];
  // tableau de fin de partie
  const post = [
    box(tr('cmp.n.backdrop'), 0, 0, 1920, 1080, { fill: '#03050a', fillOpacity: 0.55, when: 'post' }),
    panel(tr('cmp.n.postCard'), 340, 300, 1240, 480, { fillOpacity: 0.96, cut: 26, shadow: 'strong', when: 'post' }),
    box(tr('cmp.n.team0'), 340, 300, 500, 106, { fill: 'team0', fillOpacity: 1, when: 'post' }),
    box(tr('cmp.n.team1'), 1080, 300, 500, 106, { fill: 'team1', fillOpacity: 1, cut: 26, when: 'post' }),
    val(tr('e.bind.teamName0'), 'teamName0', 370, 318, 440, 46, { size: 40, upper: true, align: 'left', fit: true, when: 'post' }),
    val(tr('e.bind.teamName1'), 'teamName1', 1110, 318, 440, 46, { size: 40, upper: true, align: 'right', fit: true, when: 'post' }),
    pips(tr('cmp.n.pips0'), 0, 370, 376, { color: 'white', when: 'post' }),
    pips(tr('cmp.n.pips1'), 1, 1428, 376, { color: 'white', when: 'post' }),
    val(tr('e.bind.finalScore'), 'finalScore', 840, 304, 240, 78, { size: 76, when: 'post' }),
    val(tr('e.bind.clockNote'), 'clockNote', 840, 382, 240, 18, { size: 15, weight: 800, spacing: 3, opacity: 0.6, when: 'post' }),
    val(tr('e.bind.winnerLine'), 'winnerLine', 360, 406, 1200, 58, { size: 30, spacing: 3.6, upper: true, color: GOLD, fit: true, when: 'post' }),
    { type: 'board', name: tr('e.type.board'), x: 340, y: 465, w: 1240, h: 315, rowH: 46, size: 24, when: 'post' },
  ];
  return { width: 1920, height: 1080, elements: [...boosts, ...bug, ...goal, ...target, ...feed, ...post] };
};

function starter(kind, tr) {
  LINE = tr('cmp.n.line');
  return (STARTERS[kind] || STARTERS.signature)(tr);
}

// Composition de départ d'un overlay autre que le compteur (boost, alerts, history, summary, caster) ; null si le nom est inconnu
function overlayStarter(overlay, tr) {
  LINE = tr('cmp.n.line');
  return Object.prototype.hasOwnProperty.call(OVERLAYS, overlay) ? OVERLAYS[overlay](tr) : null;
}

module.exports = { starter, overlayStarter, STARTER_IDS: Object.keys(STARTERS), OVERLAY_STARTERS: Object.keys(OVERLAYS) };
