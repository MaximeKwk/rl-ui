// Compositions RL-UI : un overlay décrit par des données (une toile, des éléments posés dessus), jamais par du code.
// Un thème peut composer six overlays : le compteur, le compteur « Boost » (collé à la jauge du jeu), les alertes,
// les dernières parties, le récap de session et l'overlay caster.
// Ce fichier est partagé : l'app le charge pour valider un thème (require), les pages pour l'afficher (window.Compose).
//
// Un élément est un rectangle posé sur la toile : { id, type, x, y, w, h, … }. Types :
//   box      plaque (fond, arrondi, coin coupé, bordure, ombre)
//   text     texte fixe
//   value    valeur en direct (victoires, winrate, MMR, mode de jeu…)
//   image    image du dossier du thème
//   results  les dernières parties, en pastilles
//   bar      barre victoires / défaites
//   arc      arc de cercle (trait, graduations, ou jauge qui suit une valeur)
//   players  caster : les joueurs d'une équipe et leur boost
//   pips     caster : les manches gagnées d'une équipe dans la série
//   board    caster : le tableau des joueurs en fin de partie
// Tout ce qui n'est pas dans ces listes est refusé ou ramené à une valeur permise : un thème ne peut rien exécuter.
(function (root) {
  const FORMAT = 2;
  const TYPES = ['box', 'text', 'value', 'image', 'results', 'bar', 'arc', 'players', 'pips', 'board'];
  // éléments proposés pour chaque overlay (ceux de la session n'ont pas de sens dans le caster, et inversement)
  const CASTER_TYPES = ['box', 'text', 'value', 'image', 'arc', 'players', 'pips', 'board'];
  const SESSION_TYPES = ['box', 'text', 'value', 'image', 'results', 'bar', 'arc'];
  const FONTS = ['Unbounded', 'Onest', 'Barlow Condensed', 'Archivo'];
  // overlays qu'un thème peut composer, et la toile proposée pour chacun
  const KINDS = ['counter', 'boost', 'alerts', 'history', 'summary', 'caster'];
  const SIZES = { counter: [1000, 220], boost: [480, 320], alerts: [1920, 1080], history: [700, 90], summary: [1920, 1080], caster: [1920, 1080] };
  const TYPES_FOR = { counter: SESSION_TYPES, boost: SESSION_TYPES, alerts: SESSION_TYPES, history: SESSION_TYPES, summary: SESSION_TYPES, caster: CASTER_TYPES };
  // Jauge de boost du jeu sur un écran 1920 × 1080 : distance de son centre aux bords droit et bas, rayon extérieur.
  // La toile du compteur « Boost » est posée dans le coin bas droit de l'écran : la jauge y est donc à (largeur − right, hauteur − bottom).
  const GAUGE = { right: 156, bottom: 150, radius: 118 };
  // valeurs en direct qu'un élément « value » peut afficher : la session…
  const SESSION_BINDS = ['wins', 'losses', 'record', 'winRate', 'streak', 'bestStreak', 'otRecord', 'mmr', 'mmrDelta', 'played', 'mvps', 'labelWin', 'labelLoss'];
  // … la partie en cours (compteur), l'alerte affichée (alertes), le bilan (récap)
  const LIVE_BINDS = ['mode', 'clock', 'score'];
  const ALERT_BINDS = ['alertTitle', 'alertDetail', 'matchScore', 'matchMmr', 'matchOt'];
  const RECAP_BINDS = ['timePlayed', 'goals', 'assists', 'saves', 'goalDiff', 'player'];
  // … et pour l'overlay caster : la partie observée, rangée par bloc (c'est aussi l'ordre du choix dans l'éditeur)
  const CASTER_GROUPS = [
    ['match', ['teamName0', 'teamName1', 'teamScore0', 'teamScore1', 'matchClock', 'clockNote']],
    ['series', ['seriesLine', 'seriesTitle', 'seriesInfo', 'seriesWins0', 'seriesWins1']],
    ['target', ['tgName', 'tgTeam', 'tgBoost', 'tgScore', 'tgGoals', 'tgAssists', 'tgSaves', 'tgShots', 'tgDemos']],
    ['goal', ['goalScorer', 'goalAssist', 'goalSpeed']],
    ['feed', ['feedLabel', 'feedText']],
    ['post', ['finalScore', 'winnerLine']],
  ];
  const CASTER_BINDS = CASTER_GROUPS.flatMap((g) => g[1]);
  const BINDS = [...SESSION_BINDS, ...LIVE_BINDS, ...ALERT_BINDS, ...RECAP_BINDS, ...CASTER_BINDS];
  // images fournies par l'app (onglet Caster), qu'un élément « image » peut afficher à la place d'une image du thème.
  // Quand l'app n'en a pas : l'image du thème (src) si l'élément en a une, sinon une silhouette pour la photo d'un joueur.
  const IMAGE_BINDS = ['teamLogo0', 'teamLogo1', 'tgPhoto'];
  // valeurs de 0 à 100 qu'un arc peut suivre
  const ARC_BINDS = ['winRate', 'tgBoost'];
  const ARC_BINDS_FOR = { counter: ['winRate'], boost: ['winRate'], alerts: ['winRate'], history: ['winRate'], summary: ['winRate'], caster: ['tgBoost'] };
  const BINDS_FOR = {
    counter: [...SESSION_BINDS, ...LIVE_BINDS],
    boost: [...SESSION_BINDS, ...LIVE_BINDS],
    caster: CASTER_BINDS,
    alerts: [...ALERT_BINDS, ...SESSION_BINDS],
    history: [...SESSION_BINDS],
    summary: [...SESSION_BINDS, ...RECAP_BINDS],
  };
  // quand un élément est visible
  const ALERT_WHEN = ['alertWin', 'alertLoss', 'alertOt', 'alertOtEnd', 'alertStreak', 'alertMvp', 'matchScore', 'matchMmr'];
  // caster : chaque bloc de l'overlay a sa condition (ralenti, fin de partie, série, boost des joueurs, joueur suivi,
  // bannière de but, action du statfeed, tableau final)
  const CASTER_WHEN = ['replay', 'ended', 'series', 'boosts', 'target', 'goal', 'feed', 'post'];
  const WHEN = ['always', 'match', 'idle', 'overtime', 'winStreak', 'lossStreak', 'mmr', ...ALERT_WHEN, ...CASTER_WHEN];
  // bloc du caster auquel appartient une condition (pour ?hide=bug,boosts,target,goals,feed,post dans l'adresse de l'overlay)
  const CASTER_PART = { always: 'bug', overtime: 'bug', replay: 'bug', ended: 'bug', series: 'bug', boosts: 'boosts', target: 'target', goal: 'goals', feed: 'feed', post: 'post' };
  const WHEN_FOR = {
    counter: ['always', 'match', 'idle', 'overtime', 'winStreak', 'lossStreak', 'mmr'],
    boost: ['always', 'match', 'idle', 'overtime', 'winStreak', 'lossStreak', 'mmr'],
    caster: ['always', 'overtime', ...CASTER_WHEN],
    alerts: ['always', ...ALERT_WHEN, 'winStreak'],
    history: ['always', 'winStreak', 'lossStreak', 'mmr'],
    summary: ['always', 'winStreak', 'lossStreak', 'mmr'],
  };
  // entrée en scène d'une alerte
  const ENTER = ['slide', 'rise', 'pop', 'fade', 'none'];
  // « event » : la couleur de l'alerte affichée (victoire, défaite, overtime) ; dans le caster, celle de l'équipe
  // concernée par l'élément (joueur suivi, buteur, auteur de l'action, vainqueur, selon sa condition)
  // « team » : ton équipe, comme la jauge de boost du jeu · « team0 », « team1 » : les deux équipes du caster
  const TOKENS = ['win', 'loss', 'ot', 'white', 'black', 'auto', 'event', 'team', 'team0', 'team1'];
  const TOKENS_FOR = { counter: [], boost: ['team'], alerts: ['event'], history: [], summary: [], caster: ['team0', 'team1', 'event'] };
  const LIMITS = { minW: 40, maxW: 1920, minH: 20, maxH: 1080, elements: 120, text: 80, affix: 12, name: 40 };
  const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const num = (v, def, min, max, round = true) => {
    let n = Number(v);
    if (!Number.isFinite(n)) n = def;
    n = Math.min(max, Math.max(min, n));
    return round ? Math.round(n) : Math.round(n * 100) / 100;
  };
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
  const color = (v, def) => {
    const s = String(v || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(s) || TOKENS.includes(s) ? s : def;
  };
  // chemin d'image : relatif au dossier du thème, sans remontée, une image et rien d'autre
  const imagePath = (v) => {
    const s = String(v || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!s || s.length > 120 || !IMAGE_EXT.test(s)) return '';
    if (s.split('/').some((p) => p === '..' || p === '' || p.startsWith('.'))) return '';
    return /^[\w\-./ ]+$/.test(s) ? s : '';
  };

  function typography(e, d = {}) {
    return {
      font: pick(e.font, FONTS, d.font || 'Unbounded'),
      size: num(e.size, d.size || 32, 6, 400),
      weight: num(Math.round(Number(e.weight) / 100) * 100, d.weight || 700, 100, 900),
      italic: !!e.italic,
      upper: !!e.upper,
      spacing: num(e.spacing, 0, -10, 60, false),
      color: color(e.color, d.color || 'white'),
      align: pick(e.align, ['left', 'center', 'right'], d.align || 'left'),
      valign: pick(e.valign, ['top', 'middle', 'bottom'], 'middle'),
      shadow: pick(e.shadow, ['none', 'soft', 'outline'], 'none'),
      fit: !!e.fit, // rétrécir le texte s'il dépasse la largeur de l'élément (titres d'alerte, pseudos)
    };
  }

  // Ramène un élément à ce que le format permet. Renvoie null si son type est inconnu.
  function cleanElement(e, i, seen) {
    if (!isObj(e) || !TYPES.includes(e.type)) return null;
    let id = /^[a-z0-9]{1,16}$/.test(String(e.id || '')) ? String(e.id) : '';
    // identifiant absent, invalide ou déjà pris : on en donne un libre
    for (let k = i + 1; !id || seen.has(id); k++) id = `e${k}`;
    seen.add(id);
    const out = {
      id,
      type: e.type,
      name: str(e.name, LIMITS.name),
      x: num(e.x, 0, -2000, 4000),
      y: num(e.y, 0, -2000, 4000),
      w: num(e.w, 100, 1, 4000),
      h: num(e.h, 40, 1, 4000),
      rotate: num(e.rotate, 0, -180, 180),
      opacity: num(e.opacity == null ? 1 : e.opacity, 1, 0, 1, false),
      when: pick(e.when, WHEN, 'always'),
      hidden: !!e.hidden,
    };
    if (e.type === 'box') {
      Object.assign(out, {
        fill: color(e.fill, '#0a0f11'),
        fillOpacity: num(e.fillOpacity == null ? 1 : e.fillOpacity, 1, 0, 1, false),
        radius: num(e.radius, 0, 0, 400),
        cut: num(e.cut, 0, 0, 400),
        cutCorner: pick(e.cutCorner, ['tr', 'tl', 'br', 'bl'], 'tr'),
        borderWidth: num(e.borderWidth, 0, 0, 40),
        borderColor: color(e.borderColor, 'white'),
        borderOpacity: num(e.borderOpacity == null ? 1 : e.borderOpacity, 1, 0, 1, false),
        shadow: pick(e.shadow, ['none', 'soft', 'strong'], 'none'),
      });
    } else if (e.type === 'text') {
      Object.assign(out, typography(e), { text: str(e.text, LIMITS.text) });
    } else if (e.type === 'value') {
      Object.assign(out, typography(e), { bind: pick(e.bind, BINDS, 'wins'), prefix: str(e.prefix, LIMITS.affix), suffix: str(e.suffix, LIMITS.affix) });
    } else if (e.type === 'image') {
      Object.assign(out, { src: imagePath(e.src), fit: pick(e.fit, ['contain', 'cover', 'fill'], 'contain'), radius: num(e.radius, 0, 0, 400) });
      if (IMAGE_BINDS.includes(e.bind)) out.bind = e.bind;
    } else if (e.type === 'results') {
      Object.assign(out, {
        count: num(e.count, 8, 1, 20),
        gap: num(e.gap, 4, 0, 40),
        radius: num(e.radius, 6, 0, 100),
        letters: e.letters !== false,
        dir: pick(e.dir, ['row', 'column'], 'row'),
        font: pick(e.font, FONTS, 'Onest'),
        weight: num(Math.round(Number(e.weight) / 100) * 100, 700, 100, 900),
      });
    } else if (e.type === 'bar') {
      Object.assign(out, { radius: num(e.radius, 4, 0, 100), gap: num(e.gap, 2, 0, 20), dir: pick(e.dir, ['row', 'column'], 'row'), colorWin: color(e.colorWin, 'win'), colorLoss: color(e.colorLoss, 'loss') });
    } else if (e.type === 'arc') {
      // angles en degrés, 0 en haut, dans le sens des aiguilles d'une montre
      Object.assign(out, {
        from: num(e.from, 0, -360, 360),
        to: num(e.to == null ? 270 : e.to, 270, -360, 720),
        thickness: num(e.thickness, 8, 1, 200),
        color: color(e.color, 'white'),
        cap: pick(e.cap, ['butt', 'round'], 'butt'),
        ticks: num(e.ticks, 0, 0, 72), // 0 : un trait continu ; sinon ce nombre de graduations
        tickW: num(e.tickW, 2, 1, 20, false),
        bind: pick(e.bind, ARC_BINDS, ''), // '' : arc entier ; sinon l'arc se remplit avec cette valeur
        track: num(e.track == null ? 0 : e.track, 0, 0, 1, false), // opacité du reste de l'arc, derrière
      });
    } else if (e.type === 'players') {
      const team = Number(e.team) === 1 ? 1 : 0;
      Object.assign(out, {
        team,
        side: pick(e.side, ['left', 'right'], team ? 'right' : 'left'),
        rowH: num(e.rowH, 62, 20, 200),
        gap: num(e.gap == null ? 8 : e.gap, 8, 0, 60),
        fill: color(e.fill, '#080b14'),
        fillOpacity: num(e.fillOpacity == null ? 0.9 : e.fillOpacity, 0.9, 0, 1, false),
        radius: num(e.radius == null ? 10 : e.radius, 10, 0, 100),
        stripe: num(e.stripe == null ? 5 : e.stripe, 5, 0, 30),
        barH: num(e.barH == null ? 8 : e.barH, 8, 0, 40),
        font: pick(e.font, FONTS, 'Barlow Condensed'),
        weight: num(Math.round(Number(e.weight) / 100) * 100, 800, 100, 900),
        size: num(e.size, 22, 8, 80),
        color: color(e.color, 'white'),
      });
    } else if (e.type === 'pips') {
      const team = Number(e.team) === 1 ? 1 : 0;
      Object.assign(out, { team, gap: num(e.gap == null ? 6 : e.gap, 6, 0, 40), radius: num(e.radius == null ? 3 : e.radius, 3, 0, 60), skew: e.skew !== false, color: color(e.color, team ? 'team1' : 'team0') });
    } else if (e.type === 'board') {
      Object.assign(out, {
        font: pick(e.font, FONTS, 'Barlow Condensed'),
        weight: num(Math.round(Number(e.weight) / 100) * 100, 800, 100, 900),
        size: num(e.size, 24, 8, 80),
        color: color(e.color, 'white'),
        rowH: num(e.rowH, 48, 20, 160),
        fill: color(e.fill, 'white'),
        fillOpacity: num(e.fillOpacity == null ? 0 : e.fillOpacity, 0, 0, 1, false),
        stripe: num(e.stripe == null ? 6 : e.stripe, 6, 0, 30),
        lines: num(e.lines == null ? 0.12 : e.lines, 0.12, 0, 1, false),
        header: e.header !== false,
      });
    }
    return out;
  }

  // Ramène une composition à ce que le format permet. Lève une erreur si ce n'en est pas une.
  function clean(comp) {
    if (!isObj(comp) || !Array.isArray(comp.elements)) throw new Error('composition');
    if (comp.elements.length > LIMITS.elements) throw new Error('too-many');
    const seen = new Set();
    return {
      width: num(comp.width, 1000, LIMITS.minW, LIMITS.maxW),
      height: num(comp.height, 220, LIMITS.minH, LIMITS.maxH),
      ...(ENTER.includes(comp.enter) ? { enter: comp.enter } : {}),
      // compteur « Boost » : tout ce qui est à moins de cet écart de la jauge du jeu est découpé (la plaque épouse la jauge)
      ...(comp.gaugeGap != null && Number.isFinite(Number(comp.gaugeGap)) ? { gaugeGap: num(comp.gaugeGap, 12, 0, 80) } : {}),
      elements: comp.elements.map((e, i) => cleanElement(e, i, seen)).filter(Boolean),
    };
  }

  // Images utilisées par une composition (pour ne garder que celles-là dans le dossier du thème)
  const images = (comp) => [...new Set(((comp && comp.elements) || []).filter((e) => e.type === 'image' && e.src).map((e) => e.src))];

  // ------------------------------------------------------------------ données affichées
  const fmtClock = (sec, ot) => {
    if (typeof sec !== 'number' || !isFinite(sec)) return '';
    const v = Math.max(0, Math.round(sec));
    return `${ot ? '+' : ''}${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
  };
  const fmtPlayed = (sec) => {
    const m = Math.round((Number(sec) || 0) / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`;
  };

  // Ce qu'une alerte apporte en plus de la session. a : { type, title, data } tel que l'app l'envoie aux overlays.
  //   alert        type de l'alerte : win, loss, overtime, ot_win, ot_loss, streak
  //   alertTitle   son titre (« VICTOIRE », ou le texte choisi dans RL-UI)
  //   alertDetail  la ligne au-dessus du titre : mode de jeu, « Mort subite », « But en or »…
  //   matchScore, matchMmr, matchOt : le score de la partie, sa variation de MMR, la durée de sa prolongation
  function alertFields(a, tr = (k) => k) {
    const d = (a && a.data) || {};
    const type = a && a.type;
    const pl = d.manual ? '' : d.playlist || '';
    const detail = type === 'overtime' ? `${tr('al.suddenDeath')}${pl ? ` · ${pl}` : ''}` : type === 'ot_win' ? tr('al.golden') : type === 'streak' ? tr('al.inARow') : pl;
    const hasScore = Number.isFinite(d.scoreFor) && Number.isFinite(d.scoreAgainst) && !d.manual;
    const mmr = d.mmr && Number.isFinite(d.mmr.delta) ? { delta: Math.round(d.mmr.delta), learned: !!d.mmr.learned } : null;
    const out = {
      alert: type || '',
      alertTitle: String((a && a.title) || ''),
      alertDetail: detail,
      matchScore: hasScore ? `${d.scoreFor} - ${d.scoreAgainst}` : '',
      matchMmr: mmr,
      matchOt: d.overtime && d.otSeconds > 0 ? fmtClock(d.otSeconds, true) : '',
      mvp: !!d.mvp && (type === 'win' || type === 'ot_win'),
    };
    // le bilan au moment de l'alerte (l'état de la session peut arriver un instant après elle)
    if (Number.isFinite(d.wins)) out.wins = d.wins;
    if (Number.isFinite(d.losses)) out.losses = d.losses;
    if (type === 'streak' && Number.isFinite(d.n)) out.streak = d.n;
    else if (Number.isFinite(d.streak)) out.streak = d.streak;
    return out;
  }

  // À partir de l'état public de l'app (le même que reçoivent les overlays) et des réglages de l'overlay.
  // alert : l'alerte affichée, pour l'overlay des alertes.
  function dataFrom(state, cfg = {}, tr = (k) => k, alert = null) {
    const s = (state && state.session) || {};
    const live = (state && state.live) || {};
    const mm = s.mmr && s.mmr.primary;
    const mine = live.myTeam === 0 || live.myTeam === 1 ? live.myTeam : 0;
    const teams = live.teams || [];
    const sc = (n) => (teams.find((t) => t.num === n) || {}).score;
    const inMatch = !!live.inMatch;
    const d = {
      wins: s.wins || 0,
      losses: s.losses || 0,
      played: s.played || 0,
      winRate: s.played ? s.winRate : null,
      streak: s.streak || 0,
      bestStreak: s.bestWinStreak || 0,
      otWins: s.otWins || 0,
      otLosses: s.otLosses || 0,
      mvps: s.mvps || 0,
      mmr: mm && mm.current != null ? mm.current : null,
      mmrDelta: mm && (mm.current != null || mm.games > 0) ? Math.round(mm.delta || 0) : null,
      labelWin: cfg.labelWin || tr('lbl.w'),
      labelLoss: cfg.labelLoss || tr('lbl.l'),
      mode: inMatch && live.playlist ? live.playlist.name || '' : '',
      clock: inMatch ? fmtClock(live.time, !!live.overtime) : '',
      score: inMatch && sc(mine) != null ? `${sc(mine)} - ${sc(1 - mine)}` : '',
      inMatch,
      overtime: inMatch && !!live.overtime,
      last: (s.last || []).map((r) => ({ r: r.result, ot: !!r.ot })),
      // récap de session
      timePlayed: fmtPlayed(s.timePlayedSec),
      goals: s.myGoals || 0,
      assists: s.myAssists || 0,
      saves: s.mySaves || 0,
      goalDiff: (s.goalsFor || 0) - (s.goalsAgainst || 0),
      player: (state && state.status && state.status.account) || '',
      // alerte affichée (overlay des alertes seulement)
      alert: '',
      alertTitle: '',
      alertDetail: '',
      matchScore: '',
      matchMmr: null,
      matchOt: '',
      mvp: false,
    };
    return alert ? Object.assign(d, alertFields(alert, tr)) : d;
  }

  // Les couleurs d'équipe du jeu sont sombres : un peu éclaircies pour l'écran
  function brighten(hex, k = 0.12) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return '';
    return `#${[0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).map((v) => Math.min(255, Math.round(v + (255 - v) * k)).toString(16).padStart(2, '0')).join('')}`;
  }

  // Overlay caster. st : l'état du mode caster tel que l'app l'envoie ({ match, series, options }).
  // now : ce qui est à l'écran en ce moment et que l'état ne dit pas : { goal, feed, post, hide }
  //   goal  le but dont la bannière est affichée ({ team, scorer, assister, speed })
  //   feed  l'action du statfeed affichée ({ label, team, main, secondary })
  //   post  le tableau final est affiché
  //   hide  blocs masqués par l'adresse de l'overlay : bug, boosts, target, goals, feed, post
  function casterData(st, tr = (k) => k, now = {}) {
    const m = (st && st.match) || {};
    const ser = (st && st.series) || {};
    const o = (st && st.options) || {};
    const teams = [0, 1].map((n) => (m.teams || []).find((t) => t.num === n) || { num: n, name: '', score: 0 });
    const players = Array.isArray(m.players) ? m.players : [];
    const tp = m.target ? players.find((p) => p.key === m.target) : null;
    const series = o.showSeries !== false && ser.bestOf > 1;
    const goal = o.showGoals !== false && now.goal ? now.goal : null;
    const feed = o.showFeed !== false && now.feed ? now.feed : null;
    const decided = m.winner === 0 || m.winner === 1;
    const post = !!now.post && !!m.ended && decided && o.showPostgame !== false;
    const wins = Array.isArray(ser.wins) ? ser.wins : [0, 0];
    const done = decided && ser.bestOf > 1 && wins[m.winner] >= ser.need;
    const mph = o.speedUnit === 'mph';
    const sorted = [...players].sort((a, b) => a.team - b.team || (b.score || 0) - (a.score || 0));
    const best = Math.max(0, ...sorted.map((p) => p.score || 0));
    const n = (v) => String(Number(v) || 0);
    const def = ['#1873ff', '#ff7a1a'];
    return Object.assign(dataFrom(null, {}, tr), {
      caster: true,
      hide: Array.isArray(now.hide) ? now.hide : [],
      inMatch: !!m.active,
      overtime: !!m.overtime,
      replay: !!m.replay,
      ended: !!m.ended,
      teamName0: teams[0].name || '',
      teamName1: teams[1].name || '',
      teamScore0: n(teams[0].score),
      teamScore1: n(teams[1].score),
      teamLogo0: teams[0].logo || '',
      teamLogo1: teams[1].logo || '',
      teamColor0: (teams[0].color && teams[0].color !== '#' && brighten(teams[0].color)) || def[0],
      teamColor1: (teams[1].color && teams[1].color !== '#' && brighten(teams[1].color)) || def[1],
      matchClock: fmtClock(Number(m.time) || 0, !!m.overtime),
      clockNote: m.replay ? tr('c.replay') : m.ended ? tr('c.final') : m.overtime ? tr('c.ot') : '',
      series,
      seriesTitle: ser.title || '',
      seriesInfo: series ? `${tr('c.game', { n: ser.game })} · ${tr('c.bestOf', { n: ser.bestOf })}` : '',
      // titre et série sur une ligne, comme sous le tableau des scores
      seriesLine: [ser.title || '', series ? `${tr('c.game', { n: ser.game })} · ${tr('c.bestOf', { n: ser.bestOf })}` : ''].filter(Boolean).join(' · '),
      seriesNeed: series ? Math.max(1, Math.min(4, Number(ser.need) || 1)) : 0,
      seriesWins0: n(wins[0]),
      seriesWins1: n(wins[1]),
      // boost des joueurs, équipe par équipe
      boosts: o.showBoosts !== false,
      roster: [0, 1].map((t) => players.filter((p) => p.team === t).map((p) => ({ key: p.key, name: p.name || '', boost: Math.max(0, Math.min(100, Math.round(Number(p.boost) || 0))), dead: !!p.demolished, fast: !!p.supersonic, target: p.key === m.target }))),
      demolished: tr('c.demolished'),
      // joueur suivi par la caméra
      target: !!tp && o.showTarget !== false && !m.replay && !m.ended,
      targetTeam: tp ? tp.team : null,
      tgName: tp ? tp.name || '' : '',
      tgTeam: tp && teams[tp.team] ? teams[tp.team].name || '' : '',
      tgBoost: tp ? Math.max(0, Math.min(100, Math.round(Number(tp.boost) || 0))) : 0,
      tgPhoto: tp ? tp.photo || '' : '',
      tgScore: tp ? n(tp.score) : '',
      tgGoals: tp ? n(tp.goals) : '',
      tgAssists: tp ? n(tp.assists) : '',
      tgSaves: tp ? n(tp.saves) : '',
      tgShots: tp ? n(tp.shots) : '',
      tgDemos: tp ? n(tp.demos) : '',
      // bannière de but
      goal: !!goal,
      goalTeam: goal ? (Number(goal.team) === 1 ? 1 : 0) : null,
      goalScorer: goal ? goal.scorer || '' : '',
      goalAssist: goal && goal.assister ? tr('c.assist', { n: goal.assister }) : '',
      goalSpeed: goal && goal.speed > 0 ? `${Math.round(mph ? goal.speed * 0.621371 : goal.speed)} ${tr(mph ? 'c.mph' : 'c.kmh')}` : '',
      // action du statfeed
      feed: !!feed,
      feedTeam: feed ? (Number(feed.team) === 1 ? 1 : 0) : null,
      feedLabel: feed ? feed.label || '' : '',
      feedText: feed ? `${feed.main || ''}${feed.secondary ? ` → ${feed.secondary}` : ''}` : '',
      // tableau final
      post,
      winner: decided ? m.winner : null,
      finalScore: `${n(teams[0].score)} - ${n(teams[1].score)}`,
      winnerLine: decided && m.ended ? tr(done ? 'c.seriesWin' : 'c.wins', { n: teams[m.winner].name || '' }) : '',
      board: sorted.map((p) => ({ name: p.name || '', team: p.team === 1 ? 1 : 0, photo: p.photo || '', mvp: !!m.mvp && p.key === m.mvp, best: best > 0 && (p.score || 0) === best, cells: [p.score, p.goals, p.assists, p.saves, p.shots, p.demos].map(n) })),
      boardCols: ['c.score', 'c.goals', 'c.assists', 'c.saves', 'c.shots', 'c.demos'].map((k) => tr(k)),
    });
  }

  // Une partie d'exemple vue par l'overlay caster : live (en jeu), goal (but, ralenti), overtime, post (tableau final)
  function sampleCaster(kind = 'live', tr = (k) => k) {
    const names = [['Nova', 'Flick', 'Kuro'], ['Blaze', 'Echo', 'Rift']];
    const mk = (team, name, i) => ({ key: `${team}:${name}`, name, team, boost: [72, 100, 34, 58, 12, 86][i], supersonic: i === 1, demolished: i === 4, score: 520 - i * 70, goals: [2, 1, 0, 1, 0, 0][i], shots: [4, 3, 1, 3, 2, 1][i], assists: [0, 1, 1, 0, 1, 0][i], saves: [1, 0, 3, 2, 1, 2][i], demos: i % 2 });
    const post = kind === 'post';
    const ot = kind === 'overtime';
    const st = {
      match: {
        active: true,
        time: ot ? 37 : post ? 0 : 187,
        overtime: ot,
        replay: kind === 'goal',
        ended: post,
        winner: post ? 0 : null,
        mvp: '0:Nova',
        target: '0:Flick',
        teams: [
          { num: 0, name: 'Nova Esports', score: ot ? 2 : 3, color: '#1873ff' },
          { num: 1, name: 'Apex Rising', score: ot ? 2 : 1, color: '#c26418' },
        ],
        players: [...names[0].map((p, i) => mk(0, p, i)), ...names[1].map((p, i) => mk(1, p, i + 3))],
      },
      series: { title: 'RL-UI Cup', bestOf: 5, need: 3, wins: [post ? 3 : 2, 1], game: 4 },
      options: {},
    };
    return casterData(st, tr, {
      goal: kind === 'goal' ? { team: 0, scorer: 'Nova', assister: 'Kuro', speed: 118 } : null,
      feed: kind === 'live' || ot ? { label: tr('c.epicSave'), team: 0, main: 'Kuro' } : kind === 'goal' ? { label: tr('c.demoFeed'), team: 1, main: 'Blaze', secondary: 'Flick' } : null,
      post,
    });
  }

  // Situations d'aperçu de chaque overlay (éditeur, galerie) : « a:… » une alerte de ce type, « c:… » un moment de la partie castée
  const SAMPLES = {
    counter: ['idle', 'match', 'overtime', 'cold', 'empty'],
    boost: ['match', 'overtime', 'idle', 'cold', 'empty'],
    alerts: ['a:win', 'a:loss', 'a:overtime', 'a:ot_win', 'a:ot_loss', 'a:streak'],
    history: ['idle', 'cold', 'empty'],
    summary: ['idle', 'cold', 'empty'],
    caster: ['c:live', 'c:goal', 'c:overtime', 'c:post'],
  };
  function sampleFor(kind, key, tr = (k) => k) {
    const k = String(key || '');
    if (k.startsWith('a:')) return { ...sample('idle', tr), ...alertFields(sampleAlert(k.slice(2), tr), tr) };
    if (k.startsWith('c:')) return sampleCaster(k.slice(2), tr);
    const d = sample(k, tr);
    // compteur « Boost » : la couleur de ton équipe (dans l'overlay, elle est neutre entre deux parties)
    if (kind === 'boost') d.teamColor = '#ff7f22';
    return d;
  }

  // Jeux de données d'exemple, pour l'éditeur et les aperçus
  function sample(kind = 'idle', tr = (k) => k) {
    const last = 'WWLWLWWWLLWWLWWW'.split('').map((r, i) => ({ r, ot: i % 5 === 3 }));
    const base = {
      ...dataFrom(null, {}, tr),
      wins: 12,
      losses: 5,
      played: 17,
      winRate: 71,
      streak: 3,
      bestStreak: 5,
      otWins: 2,
      otLosses: 1,
      mvps: 4,
      mmr: 1175,
      mmrDelta: 45,
      last,
      timePlayed: '2h14',
      goals: 31,
      assists: 14,
      saves: 22,
      goalDiff: 12,
      player: 'Zoxam',
    };
    if (kind === 'match') return { ...base, inMatch: true, mode: tr('cmp.sampleMode'), clock: '2:41', score: '2 - 1' };
    if (kind === 'overtime') return { ...base, inMatch: true, overtime: true, mode: tr('cmp.sampleMode'), clock: '+0:37', score: '2 - 2' };
    if (kind === 'cold') return { ...base, wins: 4, losses: 9, played: 13, winRate: 31, streak: -4, bestStreak: 2, mmrDelta: -38, mmr: 1092, goals: 17, goalDiff: -9, last: 'LWLLWLLLWLLLL'.split('').map((r) => ({ r, ot: false })) };
    if (kind === 'empty') return { ...base, wins: 0, losses: 0, played: 0, winRate: null, streak: 0, bestStreak: 0, otWins: 0, otLosses: 0, mvps: 0, mmr: null, mmrDelta: null, last: [], timePlayed: '0 min', goals: 0, assists: 0, saves: 0, goalDiff: 0 };
    return base;
  }

  // Une alerte d'exemple (type : win, loss, overtime, ot_win, ot_loss, streak), telle que l'app l'enverrait
  function sampleAlert(type = 'win', tr = (k) => k) {
    const ot = type === 'ot_win' || type === 'ot_loss';
    const lost = type === 'loss' || type === 'ot_loss';
    const data = { scoreFor: lost ? 1 : 3, scoreAgainst: 2, overtime: ot, otSeconds: ot ? 42 : 0, mvp: !lost, playlist: tr('cmp.sampleMode'), streak: lost ? -1 : 4, wins: lost ? 12 : 13, losses: lost ? 6 : 5, n: 5, mmr: { delta: lost ? -11 : 12, learned: true } };
    if (type === 'overtime') Object.assign(data, { scoreFor: 2, scoreAgainst: 2, mmr: null, mvp: false });
    if (type === 'streak') Object.assign(data, { mmr: null, mvp: false, scoreFor: NaN });
    return { type, title: String(tr(`alert.${type}`)).replace('{n}', data.n), data };
  }

  // Texte d'une valeur, et sa « teinte » (hausse, baisse, série chaude ou froide) pour la couleur automatique
  function valueOf(bind, d) {
    const sign = (n) => (n > 0 ? `+${n}` : String(n));
    switch (bind) {
      case 'wins':
        return { text: String(d.wins), tone: 'win' };
      case 'losses':
        return { text: String(d.losses), tone: 'loss' };
      case 'record':
        return { text: `${d.wins} - ${d.losses}`, tone: '' };
      case 'winRate':
        return { text: d.winRate == null ? '—' : `${d.winRate}%`, tone: '' };
      case 'streak':
        return { text: d.streak ? String(Math.abs(d.streak)) : '—', tone: d.streak > 0 ? 'hot' : d.streak < 0 ? 'cold' : '' };
      case 'bestStreak':
        return { text: String(d.bestStreak), tone: '' };
      case 'otRecord':
        return { text: `${d.otWins}-${d.otLosses}`, tone: 'ot' };
      case 'mmr':
        return { text: d.mmr == null ? '—' : String(d.mmr), tone: '' };
      case 'mmrDelta':
        return { text: d.mmrDelta == null ? '—' : sign(d.mmrDelta), tone: d.mmrDelta > 0 ? 'win' : d.mmrDelta < 0 ? 'loss' : '' };
      case 'played':
        return { text: String(d.played), tone: '' };
      case 'mvps':
        return { text: String(d.mvps), tone: '' };
      case 'labelWin':
        return { text: d.labelWin, tone: 'win' };
      case 'labelLoss':
        return { text: d.labelLoss, tone: 'loss' };
      case 'mode':
        return { text: d.mode, tone: '' };
      case 'clock':
        return { text: d.clock, tone: d.overtime ? 'ot' : '' };
      case 'score':
        return { text: d.score, tone: '' };
      // ---- alerte
      case 'alertTitle':
        return { text: d.alertTitle, tone: 'event' };
      case 'alertDetail':
        return { text: d.alertDetail, tone: '' };
      case 'matchScore':
        return { text: d.matchScore, tone: '' };
      case 'matchMmr':
        // « ≈ » : variation estimée, pas encore calée sur les vraies valeurs du joueur
        return { text: d.matchMmr ? `${d.matchMmr.learned ? '' : '≈ '}${sign(d.matchMmr.delta)}` : '', tone: d.matchMmr ? (d.matchMmr.delta >= 0 ? 'win' : 'loss') : '' };
      case 'matchOt':
        return { text: d.matchOt, tone: 'ot' };
      // ---- récap
      case 'timePlayed':
        return { text: d.timePlayed, tone: '' };
      case 'goals':
        return { text: String(d.goals), tone: '' };
      case 'assists':
        return { text: String(d.assists), tone: '' };
      case 'saves':
        return { text: String(d.saves), tone: '' };
      case 'goalDiff':
        return { text: sign(d.goalDiff), tone: d.goalDiff > 0 ? 'win' : d.goalDiff < 0 ? 'loss' : '' };
      case 'player':
        return { text: d.player, tone: '' };
      // ---- caster
      case 'matchClock':
        return { text: d.matchClock || '', tone: d.overtime ? 'ot' : '' };
      case 'clockNote':
        return { text: d.clockNote || '', tone: d.replay ? 'loss' : d.overtime ? 'ot' : '' };
      case 'tgBoost':
        return { text: d.caster ? String(d.tgBoost) : '', tone: '' };
      default:
        if (CASTER_BINDS.includes(bind)) return { text: d[bind] == null ? '' : String(d[bind]), tone: '' };
        return { text: '', tone: '' };
    }
  }

  function visible(when, d) {
    // caster : un bloc masqué par l'adresse de l'overlay emporte tous ses éléments
    if (d.caster && d.hide.length && d.hide.includes(CASTER_PART[when])) return false;
    switch (when) {
      case 'replay':
        return !!d.replay;
      case 'ended':
        return !!d.ended;
      case 'series':
        // (la série, ou seulement un titre : la ligne sous le tableau des scores a quelque chose à dire)
        return !!d.series || !!d.seriesLine;
      case 'boosts':
        return !!d.boosts;
      case 'target':
        return !!d.target;
      case 'goal':
        return d.goal === true;
      case 'feed':
        return !!d.feed;
      case 'post':
        return !!d.post;
      case 'match':
        return d.inMatch;
      case 'idle':
        return !d.inMatch;
      case 'overtime':
        return d.overtime;
      case 'winStreak':
        return d.streak >= 2;
      case 'lossStreak':
        return d.streak <= -2;
      case 'mmr':
        return d.mmrDelta != null;
      case 'alertWin':
        return d.alert === 'win' || d.alert === 'ot_win';
      case 'alertLoss':
        return d.alert === 'loss' || d.alert === 'ot_loss';
      case 'alertOt':
        return d.alert === 'overtime';
      case 'alertOtEnd':
        return d.alert === 'ot_win' || d.alert === 'ot_loss';
      case 'alertStreak':
        return d.alert === 'streak';
      case 'alertMvp':
        return !!d.mvp;
      case 'matchScore':
        return !!d.matchScore;
      case 'matchMmr':
        return !!d.matchMmr;
      default:
        return true;
    }
  }

  // Couleur de l'alerte affichée : celle du jeton « event »
  const eventTone = (alert) => (alert === 'loss' || alert === 'ot_loss' ? 'loss' : alert === 'overtime' || alert === 'streak' ? 'ot' : 'win');
  // Caster : équipe (0, 1 ou null) qui donne sa couleur « event » à un élément, d'après sa condition
  const eventTeam = (when, d) => (when === 'target' ? d.targetTeam : when === 'goal' ? d.goalTeam : when === 'feed' ? d.feedTeam : when === 'post' || when === 'ended' ? d.winner : null);

  const api = { FORMAT, TYPES, TYPES_FOR, FONTS, KINDS, SIZES, GAUGE, BINDS, BINDS_FOR, CASTER_GROUPS, IMAGE_BINDS, ARC_BINDS, ARC_BINDS_FOR, WHEN, WHEN_FOR, ENTER, TOKENS, TOKENS_FOR, LIMITS, SAMPLES, clean, cleanElement, images, imagePath, dataFrom, alertFields, casterData, sample, sampleAlert, sampleCaster, sampleFor, valueOf, visible, eventTone, eventTeam };

  // ------------------------------------------------------------------ affichage (pages seulement)
  if (typeof document !== 'undefined') {
    // « event » suit la couleur de l'alerte affichée (posée sur la composition : --event) ; hors alerte, c'est celle de la victoire
    const TONES = { win: 'var(--win)', loss: 'var(--loss)', ot: 'var(--ot)', hot: '#ffcf5a', cold: '#8fbcff', event: 'var(--event, var(--win))' };
    // couleur avec une opacité (fond d'une ligne de joueur, d'une ligne du tableau)
    const cssA = (c, a) => (a >= 1 ? css(c) : `color-mix(in srgb, ${css(c)} ${Math.round(a * 100)}%, transparent)`);
    const css = (c, tone) => {
      if (c === 'auto') return TONES[tone] || '#ffffff';
      if (c === 'event') return TONES.event;
      if (c === 'win' || c === 'loss' || c === 'ot') return `var(--${c})`;
      if (c === 'team') return 'var(--team, #cfd8e3)';
      if (c === 'team0') return 'var(--team0, #1873ff)';
      if (c === 'team1') return 'var(--team1, #ff7a1a)';
      if (c === 'white') return '#ffffff';
      if (c === 'black') return '#000000';
      return c;
    };
    const STYLE = `
.cmp { position: relative; flex: none; transform-origin: 0 0; }
.cmp-el { position: absolute; box-sizing: border-box; }
.cmp-el.cmp-off { display: none; }
.cmp-txt { display: flex; white-space: pre; line-height: 1; overflow: visible; }
.cmp-txt > span { display: block; }
.cmp-pop > span { animation: cmp-pop 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.4); }
@keyframes cmp-pop { 0% { transform: translateY(18%) scale(0.92); opacity: 0.4; } 100% { transform: none; opacity: 1; } }
.cmp-box svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; display: block; }
.cmp-img { background-repeat: no-repeat; background-position: center; overflow: hidden; }
.cmp-avatar { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.cmp-res { display: flex; }
.cmp-res i { flex: 1 1 0; min-width: 0; min-height: 0; display: grid; place-items: center; font-style: normal; line-height: 1; overflow: hidden; }
.cmp-res i.rw { background: var(--win); color: #0f2406; }
.cmp-res i.rl { background: var(--loss); color: #2a0b09; }
.cmp-res i.ro { box-shadow: inset 0 3px 0 var(--ot); }
.cmp-res i.rn { background: rgba(255, 255, 255, 0.12); }
.cmp-bar { display: flex; overflow: hidden; }
.cmp-bar i { display: block; flex: 0 0 auto; transition: flex-basis 0.5s ease; }
.cmp-arc svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; display: block; }
.cmp-arc path { fill: none; }
.cmp-gauge { position: absolute; pointer-events: none; }
.cmp-gauge svg { width: 100%; height: 100%; overflow: visible; display: block; }
.cmp-gauge .cmp-g-core { fill: rgba(0, 0, 0, 0.35); stroke: rgba(255, 255, 255, 0.35); stroke-width: 1.5; }
.cmp-gauge .cmp-g-ring { fill: none; stroke: var(--team, #ff7f22); stroke-width: 3; opacity: 0.55; }
.cmp-gauge .cmp-g-seg { fill: none; stroke: var(--team, #ff7f22); stroke-width: 15; stroke-dasharray: 7 3; opacity: 0.9; }
.cmp-gauge text { fill: var(--team, #ff7f22); font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-style: italic; }
.cmp-show { animation: cmp-show 0.3s ease-out; }
.cmp-el.cmp-hide { opacity: 0 !important; transition: opacity 0.22s ease-in; }
@keyframes cmp-show { from { opacity: 0; } }
.cmp-players { display: flex; flex-direction: column; line-height: 1; }
.cmp-pl { position: relative; box-sizing: border-box; flex: none; display: flex; flex-direction: column; justify-content: center; padding: 0 12px; overflow: hidden; outline: 2px solid transparent; outline-offset: -2px; transition: opacity 0.25s, outline-color 0.25s; }
.cmp-pl.cmp-tgt { outline-color: rgba(255, 255, 255, 0.85); }
.cmp-pl.cmp-dead { opacity: 0.45; }
.cmp-pl-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.cmp-pl.cmp-r .cmp-pl-top { flex-direction: row-reverse; }
.cmp-pl-nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.cmp-pl-bv { font-size: 1.1em; font-weight: 900; font-variant-numeric: tabular-nums; }
.cmp-pl-bv.cmp-dm { font-size: 0.6em; letter-spacing: 0.12em; color: #ff5a6a; }
.cmp-pl-bar { margin-top: 5px; border-radius: 99px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.cmp-pl-bar i { display: block; height: 100%; width: 0; background: var(--tc); transition: width 0.2s linear; }
.cmp-pl.cmp-r .cmp-pl-bar i { margin-left: auto; }
.cmp-pl.cmp-fast .cmp-pl-bar i { background: color-mix(in srgb, var(--tc) 55%, white 45%); }
.cmp-pips { display: flex; }
.cmp-pips i { flex: 1 1 0; min-width: 0; background: rgba(255, 255, 255, 0.14); }
.cmp-pips.cmp-skew i { transform: skewX(-20deg); }
.cmp-board { display: flex; flex-direction: column; line-height: 1; font-variant-numeric: tabular-nums; }
.cmp-bd-hr, .cmp-bd-rw { box-sizing: border-box; flex: none; display: grid; grid-template-columns: minmax(0, 1fr) repeat(6, 11%); align-items: center; }
.cmp-bd-hr { font-size: 0.55em; letter-spacing: 0.16em; text-transform: uppercase; opacity: 0.5; }
.cmp-board span { text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cmp-bd-rw > span:first-child { display: flex; align-items: center; gap: 10px; text-align: left; padding-left: 24px; }
.cmp-bd-rw.cmp-best { background-image: linear-gradient(rgba(255, 211, 90, 0.08), rgba(255, 211, 90, 0.08)); }
.cmp-board img { flex: none; width: 1.25em; height: 1.25em; border-radius: 50%; object-fit: cover; }
.cmp-board b { flex: none; font-size: 0.55em; padding: 3px 8px; border-radius: 6px; background: #ffd35a; color: #1b1000; font-weight: 900; letter-spacing: 0.1em; }
.cmp.in-slide { animation: cmp-in-slide 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.cmp.in-rise { animation: cmp-in-rise 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.cmp.in-pop { animation: cmp-in-pop 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.35) both; }
.cmp.in-fade { animation: cmp-in-fade 0.45s ease-out both; }
.cmp.out { animation: cmp-out 0.35s ease-in forwards; }
@keyframes cmp-in-slide { from { transform: translateX(-70px); opacity: 0; } }
@keyframes cmp-in-rise { from { transform: translateY(50px); opacity: 0; } }
@keyframes cmp-in-pop { from { transform: scale(0.88); opacity: 0; } }
@keyframes cmp-in-fade { from { opacity: 0; } }
@keyframes cmp-out { to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .cmp-show { animation: none; } .cmp-pop > span { animation: none; } .cmp-bar i { transition: none; } .cmp.in-slide, .cmp.in-rise, .cmp.in-pop { animation-name: cmp-in-fade; } }`;

    function ensureStyle() {
      if (document.getElementById('cmp-style')) return;
      const st = document.createElement('style');
      st.id = 'cmp-style';
      st.textContent = STYLE;
      document.head.appendChild(st);
    }

    // Contour d'une plaque : rectangle arrondi dont un coin peut être coupé
    function boxPath(w, h, radius, cut, corner, inset = 0) {
      const x0 = inset;
      const y0 = inset;
      const x1 = w - inset;
      const y1 = h - inset;
      const ww = x1 - x0;
      const hh = y1 - y0;
      const r = Math.max(0, Math.min(radius - inset, ww / 2, hh / 2));
      const c = Math.max(0, Math.min(cut, ww - r, hh - r));
      const seg = [];
      // chaque coin : arrondi, ou coupé en biais
      const cornerAt = (name, ax, ay, bx, by, cx, cy) => {
        if (c > 0 && corner === name) seg.push(`L${ax} ${ay} L${bx} ${by}`);
        else if (r > 0) seg.push(`L${ax} ${ay} Q${cx} ${cy} ${bx} ${by}`);
        else seg.push(`L${cx} ${cy}`);
      };
      const k = (name) => (c > 0 && corner === name ? c : r);
      seg.push(`M${x0 + k('tl')} ${y0}`);
      cornerAt('tr', x1 - k('tr'), y0, x1, y0 + k('tr'), x1, y0);
      cornerAt('br', x1, y1 - k('br'), x1 - k('br'), y1, x1, y1);
      cornerAt('bl', x0 + k('bl'), y1, x0, y1 - k('bl'), x0, y1);
      cornerAt('tl', x0, y0 + k('tl'), x0 + k('tl'), y0, x0, y0);
      return `${seg.join(' ')} Z`;
    }

    const NS = 'http://www.w3.org/2000/svg';

    // Tracé d'un arc inscrit dans w × h (trait d'épaisseur th), de l'angle a0 à a1 : 0 en haut, sens des aiguilles d'une montre
    function arcPath(w, h, th, a0, a1) {
      const rx = Math.max(0.5, w / 2 - th / 2);
      const ry = Math.max(0.5, h / 2 - th / 2);
      const pt = (a) => {
        const r = ((a - 90) * Math.PI) / 180;
        return `${(w / 2 + rx * Math.cos(r)).toFixed(2)} ${(h / 2 + ry * Math.sin(r)).toFixed(2)}`;
      };
      const span = a1 - a0;
      const cw = span >= 0 ? 1 : 0;
      // tour complet : deux demi-arcs (un arc qui revient à son point de départ ne se dessine pas)
      if (Math.abs(span) >= 359.99) return `M${pt(a0)} A${rx} ${ry} 0 1 ${cw} ${pt(a0 + 180)} A${rx} ${ry} 0 1 ${cw} ${pt(a0)}`;
      return `M${pt(a0)} A${rx} ${ry} 0 ${Math.abs(span) > 180 ? 1 : 0} ${cw} ${pt(a1)}`;
    }
    const arcLength = (w, h, th, a0, a1) => ((Math.min(360, Math.abs(a1 - a0)) * Math.PI) / 180) * Math.sqrt(((w / 2 - th / 2) ** 2 + (h / 2 - th / 2) ** 2) / 2);
    const cssUrl = (u) => `url("${String(u).replace(/["\\\n]/g, encodeURIComponent)}")`;

    function build(e, opts) {
      const el = document.createElement('div');
      el.className = `cmp-el cmp-${e.type === 'value' ? 'txt cmp-value' : e.type === 'text' ? 'txt' : e.type === 'image' ? 'img' : e.type === 'results' ? 'res' : e.type}${e.type === 'pips' && e.skew ? ' cmp-skew' : ''}`;
      el.dataset.id = e.id;
      const st = el.style;
      st.left = `${e.x}px`;
      st.top = `${e.y}px`;
      st.width = `${e.w}px`;
      st.height = `${e.h}px`;
      if (e.rotate) st.transform = `rotate(${e.rotate}deg)`;
      if (e.opacity < 1) st.opacity = String(e.opacity);
      if (e.type === 'box') {
        const s = document.createElementNS(NS, 'svg');
        s.setAttribute('viewBox', `0 0 ${e.w} ${e.h}`);
        s.setAttribute('preserveAspectRatio', 'none');
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', boxPath(e.w, e.h, e.radius, e.cut, e.cutCorner));
        p.setAttribute('fill', css(e.fill));
        p.setAttribute('fill-opacity', String(e.fillOpacity));
        s.appendChild(p);
        if (e.borderWidth > 0) {
          const b = document.createElementNS(NS, 'path');
          b.setAttribute('d', boxPath(e.w, e.h, e.radius, e.cut, e.cutCorner, e.borderWidth / 2));
          b.setAttribute('fill', 'none');
          b.setAttribute('stroke', css(e.borderColor));
          b.setAttribute('stroke-opacity', String(e.borderOpacity));
          b.setAttribute('stroke-width', String(e.borderWidth));
          b.setAttribute('stroke-linejoin', 'round');
          s.appendChild(b);
        }
        if (e.shadow !== 'none') s.style.filter = e.shadow === 'soft' ? 'drop-shadow(0 6px 14px rgba(0,0,0,0.35))' : 'drop-shadow(0 10px 24px rgba(0,0,0,0.6))';
        el.appendChild(s);
      } else if (e.type === 'text' || e.type === 'value') {
        st.fontFamily = `'${e.font}', sans-serif`;
        st.fontSize = `${e.size}px`;
        st.fontWeight = String(e.weight);
        st.fontStyle = e.italic ? 'italic' : 'normal';
        st.letterSpacing = `${e.spacing}px`;
        st.textTransform = e.upper ? 'uppercase' : 'none';
        st.justifyContent = e.align === 'center' ? 'center' : e.align === 'right' ? 'flex-end' : 'flex-start';
        st.alignItems = e.valign === 'top' ? 'flex-start' : e.valign === 'bottom' ? 'flex-end' : 'center';
        st.textShadow = e.shadow === 'soft' ? '0 2px 8px rgba(0,0,0,0.6)' : e.shadow === 'outline' ? '0 2px 0 rgba(0,0,0,0.6), 0 0 2px #000, 0 0 10px rgba(0,0,0,0.7)' : 'none';
        st.color = css(e.color, '');
        const span = document.createElement('span');
        span.textContent = e.type === 'text' ? e.text : '';
        el.appendChild(span);
      } else if (e.type === 'image') {
        // (une image liée — logo d'équipe, photo du joueur — vient de l'app : elle est posée à chaque mise à jour)
        if (e.src && !e.bind) st.backgroundImage = `url("${(opts.imageUrl || ((s) => s))(e.src).replace(/"/g, '%22')}")`;
        st.backgroundSize = e.fit === 'fill' ? '100% 100%' : e.fit;
        st.borderRadius = `${e.radius}px`;
        // photo du joueur suivi : une silhouette aux couleurs de son équipe, montrée quand il n'a pas de photo
        if (e.bind === 'tgPhoto' && !e.src) {
          const s = document.createElementNS(NS, 'svg');
          s.setAttribute('class', 'cmp-avatar');
          s.setAttribute('viewBox', '0 0 100 100');
          s.setAttribute('preserveAspectRatio', 'xMidYMid slice');
          s.innerHTML = '<rect width="100" height="100" fill="#10171a"/><rect width="100" height="100" fill="var(--event, #7e8f94)" opacity="0.38"/><circle cx="50" cy="39" r="17" fill="#fff" opacity="0.88"/><path d="M15 101c0-22 15-35 35-35s35 13 35 35z" fill="#fff" opacity="0.88"/>';
          el.appendChild(s);
        }
      } else if (e.type === 'results') {
        st.flexDirection = e.dir;
        st.gap = `${e.gap}px`;
        st.fontFamily = `'${e.font}', sans-serif`;
        st.fontWeight = String(e.weight);
      } else if (e.type === 'bar') {
        st.flexDirection = e.dir;
        st.gap = `${e.gap}px`;
        st.borderRadius = `${e.radius}px`;
        for (const k of ['Win', 'Loss']) {
          const i = document.createElement('i');
          i.style.background = css(e[`color${k}`]);
          el.appendChild(i);
        }
      } else if (e.type === 'arc') {
        const s = document.createElementNS(NS, 'svg');
        s.setAttribute('viewBox', `0 0 ${e.w} ${e.h}`);
        const len = arcLength(e.w, e.h, e.thickness, e.from, e.to);
        // deux tracés : le fond (arc entier, estompé) quand l'arc suit une valeur, puis l'arc lui-même
        for (const k of ['track', 'fg']) {
          if (k === 'track' && !(e.bind && e.track > 0)) continue;
          const p = document.createElementNS(NS, 'path');
          p.setAttribute('class', `cmp-arc-${k}`);
          p.setAttribute('d', arcPath(e.w, e.h, e.thickness, e.from, e.to));
          p.setAttribute('stroke', css(e.color));
          p.setAttribute('stroke-width', String(e.thickness));
          if (k === 'track') p.setAttribute('stroke-opacity', String(e.track));
          if (e.ticks > 0) p.setAttribute('stroke-dasharray', `${e.tickW} ${e.ticks > 1 ? Math.max(0.1, (len - e.tickW * e.ticks) / (e.ticks - 1)) : len + 1}`);
          else if (e.cap === 'round') p.setAttribute('stroke-linecap', 'round');
          s.appendChild(p);
        }
        el.appendChild(s);
      } else if (e.type === 'players') {
        st.gap = `${e.gap}px`;
        st.fontFamily = `'${e.font}', sans-serif`;
        st.fontWeight = String(e.weight);
        st.fontSize = `${e.size}px`;
        st.color = css(e.color);
        st.setProperty('--tc', `var(--team${e.team})`);
      } else if (e.type === 'pips') {
        st.gap = `${e.gap}px`;
      } else if (e.type === 'board') {
        st.fontFamily = `'${e.font}', sans-serif`;
        st.fontWeight = String(e.weight);
        st.fontSize = `${e.size}px`;
        st.color = css(e.color);
      }
      return el;
    }

    // Caster : les joueurs d'une équipe et leur boost. Les lignes ne sont refaites que si la liste des joueurs change.
    function updatePlayers(n, e, d) {
      const list = d.caster && d.boosts ? d.roster[e.team] || [] : [];
      const sig = list.map((p) => `${p.key}\u0001${p.name}`).join('\u0002');
      if (n.dataset.sig !== sig) {
        n.dataset.sig = sig;
        n.textContent = '';
        for (const p of list) {
          const row = document.createElement('div');
          row.className = `cmp-pl${e.side === 'right' ? ' cmp-r' : ''}`;
          row.style.height = `${e.rowH}px`;
          row.style.borderRadius = `${e.radius}px`;
          row.style.background = cssA(e.fill, e.fillOpacity);
          if (e.stripe > 0) row.style[e.side === 'right' ? 'borderRight' : 'borderLeft'] = `${e.stripe}px solid var(--tc)`;
          const top = document.createElement('div');
          top.className = 'cmp-pl-top';
          const nm = document.createElement('span');
          nm.className = 'cmp-pl-nm';
          nm.textContent = p.name;
          const bv = document.createElement('span');
          bv.className = 'cmp-pl-bv';
          top.append(nm, bv);
          row.appendChild(top);
          if (e.barH > 0) {
            const bar = document.createElement('div');
            bar.className = 'cmp-pl-bar';
            bar.style.height = `${e.barH}px`;
            bar.appendChild(document.createElement('i'));
            row.appendChild(bar);
          }
          n.appendChild(row);
        }
      }
      list.forEach((p, i) => {
        const row = n.children[i];
        row.classList.toggle('cmp-tgt', p.target);
        row.classList.toggle('cmp-dead', p.dead);
        row.classList.toggle('cmp-fast', p.fast);
        const bv = row.firstChild.lastChild;
        const txt = p.dead ? d.demolished : String(p.boost);
        if (bv.textContent !== txt) bv.textContent = txt;
        bv.classList.toggle('cmp-dm', p.dead);
        if (e.barH > 0) row.lastChild.firstChild.style.width = `${p.boost}%`;
      });
    }

    // Caster : les manches gagnées d'une équipe (autant de cases que de manches à gagner)
    function updatePips(n, e, d) {
      const need = d.caster ? d.seriesNeed : 0;
      const wins = Number(d[`seriesWins${e.team}`]) || 0;
      const sig = `${need}|${wins}`;
      if (n.dataset.sig === sig) return;
      n.dataset.sig = sig;
      n.textContent = '';
      for (let i = 0; i < need; i++) {
        const c = document.createElement('i');
        c.style.borderRadius = `${e.radius}px`;
        if (i < wins) c.style.background = css(e.color);
        n.appendChild(c);
      }
    }

    // Caster : le tableau des joueurs en fin de partie
    function updateBoard(n, e, d) {
      const rows = d.caster ? d.board : [];
      const sig = JSON.stringify([rows, d.boardCols]);
      if (n.dataset.sig === sig) return;
      n.dataset.sig = sig;
      n.textContent = '';
      const cell = (txt) => {
        const s = document.createElement('span');
        s.textContent = txt;
        return s;
      };
      if (e.header && rows.length) {
        const hr = document.createElement('div');
        hr.className = 'cmp-bd-hr';
        hr.style.height = `${Math.round(e.rowH * 0.8)}px`;
        hr.append(cell(''), ...d.boardCols.map(cell));
        n.appendChild(hr);
      }
      for (const p of rows) {
        const rw = document.createElement('div');
        rw.className = `cmp-bd-rw${p.best ? ' cmp-best' : ''}`;
        rw.style.height = `${e.rowH}px`;
        rw.style.backgroundColor = cssA(e.fill, e.fillOpacity);
        rw.style.borderTop = `1px solid rgba(255, 255, 255, ${e.lines})`;
        if (e.stripe > 0) rw.style.borderLeft = `${e.stripe}px solid var(--team${p.team})`;
        const who = document.createElement('span');
        if (p.photo) {
          const im = document.createElement('img');
          im.src = p.photo;
          im.alt = '';
          who.appendChild(im);
        }
        who.appendChild(document.createTextNode(p.name));
        if (p.mvp) {
          const b = document.createElement('b');
          b.textContent = 'MVP';
          who.appendChild(b);
        }
        rw.append(who, ...p.cells.map(cell));
        n.appendChild(rw);
      }
    }

    // La jauge de boost du jeu, dessinée là où elle est à l'écran par rapport à la toile d'un compteur « Boost » :
    // un décor pour l'éditeur et les aperçus (à poser sous la composition, dans le même repère). Rien de tel dans l'overlay.
    function gauge(comp, color) {
      ensureStyle();
      const D = GAUGE.radius * 2;
      const c = GAUGE.radius;
      const g = document.createElement('div');
      g.className = 'cmp-gauge';
      g.style.left = `${comp.width - GAUGE.right - c}px`;
      g.style.top = `${comp.height - GAUGE.bottom - c}px`;
      g.style.width = g.style.height = `${D}px`;
      if (color) g.style.setProperty('--team', color);
      const pt = (r, a) => `${(c + r * Math.cos((a * Math.PI) / 180)).toFixed(1)} ${(c + r * Math.sin((a * Math.PI) / 180)).toFixed(1)}`;
      g.innerHTML = `<svg viewBox="0 0 ${D} ${D}"><circle class="cmp-g-core" cx="${c}" cy="${c}" r="94"/><path class="cmp-g-seg" d="M ${pt(106, 100)} A 106 106 0 0 1 ${pt(106, 232)}"/><circle class="cmp-g-ring" cx="${c}" cy="${c}" r="94"/><text x="${c + 4}" y="${c + 16}" text-anchor="middle" font-size="68">54</text><text x="${c}" y="${c + 44}" text-anchor="middle" font-size="17" font-style="normal">BOOST</text></svg>`;
      return g;
    }

    // Charge les polices dont une composition a besoin (au plus 1,5 s d'attente). À appeler avant d'afficher une alerte :
    // ses textes sont ainsi mesurés avec la bonne police dès la première image.
    function loadFonts(comp) {
      if (!document.fonts || !document.fonts.load) return Promise.resolve();
      const specs = new Set();
      for (const e of comp.elements) if (e.type === 'text' || e.type === 'value') specs.add(`${e.italic ? 'italic ' : ''}${e.weight} ${e.size}px '${e.font}'`);
      const all = Promise.all([...specs].map((f) => document.fonts.load(f).catch(() => {})));
      return Promise.race([all, new Promise((r) => setTimeout(r, 1500))]);
    }

    // Texte plus large que son élément : rétréci pour tenir (option « fit »), depuis le côté où il est aligné
    function fitText(n, e) {
      const span = n.firstChild;
      span.style.transform = '';
      if (!e.fit) return;
      const w = span.offsetWidth;
      if (w > e.w && w > 0) {
        span.style.transformOrigin = `${e.align === 'center' ? '50%' : e.align === 'right' ? '100%' : '0'} 50%`;
        span.style.transform = `scale(${e.w / w})`;
      }
    }

    // Pose une composition dans `host`. Renvoie { el, update(données), nodes } ; update peut être rappelé à volonté.
    function mount(host, comp, opts = {}) {
      ensureStyle();
      const el = document.createElement('div');
      el.className = 'cmp';
      el.style.width = `${comp.width}px`;
      el.style.height = `${comp.height}px`;
      // compteur « Boost » : la toile est percée autour de la jauge du jeu
      if (comp.gaugeGap != null) {
        const r = GAUGE.radius + comp.gaugeGap;
        const mask = `radial-gradient(circle at ${comp.width - GAUGE.right}px ${comp.height - GAUGE.bottom}px, transparent ${r - 0.5}px, #000 ${r + 0.5}px)`;
        el.style.webkitMaskImage = mask;
        el.style.maskImage = mask;
      }
      const nodes = new Map();
      const shown = new Map(); // élément -> était-il visible à la mise à jour précédente
      const hiding = new Map();
      for (const e of comp.elements) {
        const n = build(e, opts);
        nodes.set(e.id, n);
        el.appendChild(n);
      }
      host.appendChild(el);
      const prev = new Map();
      let first = true;
      let last = null;
      // une police n'est chargée qu'à sa première utilisation : les textes ajustés sont remesurés une fois qu'elle est là
      if (comp.elements.some((e) => e.fit)) {
        loadFonts(comp).then(() => {
          if (last && el.isConnected) for (const e of comp.elements) if (e.fit && (e.type === 'text' || e.type === 'value')) fitText(nodes.get(e.id), e);
        });
      }

      function update(d) {
        last = d;
        // couleur de l'alerte affichée, pour les éléments de couleur « event »
        if (d.alert) el.style.setProperty('--event', `var(--${eventTone(d.alert)})`);
        else el.style.removeProperty('--event');
        // couleurs d'équipe : la tienne (compteur « Boost »), les deux du match (caster)
        if (d.teamColor) el.style.setProperty('--team', d.teamColor);
        else el.style.removeProperty('--team');
        if (d.caster) {
          el.style.setProperty('--team0', d.teamColor0);
          el.style.setProperty('--team1', d.teamColor1);
        }
        for (const e of comp.elements) {
          const n = nodes.get(e.id);
          // dans l'éditeur, un élément conditionnel reste visible (estompé) pour pouvoir être sélectionné
          const on = !e.hidden && visible(e.when, d);
          if (opts.editing) n.classList.toggle('cmp-ghost', !on);
          else if (first || opts.animate === false) n.classList.toggle('cmp-off', !on);
          else if (on !== shown.get(e.id)) {
            // un élément qui apparaît ou disparaît en cours de route le fait en fondu
            clearTimeout(hiding.get(e.id));
            n.classList.remove('cmp-show', 'cmp-hide');
            if (on) {
              n.classList.remove('cmp-off');
              void n.offsetWidth;
              n.classList.add('cmp-show');
            } else {
              n.classList.add('cmp-hide');
              hiding.set(e.id, setTimeout(() => {
                n.classList.add('cmp-off');
                n.classList.remove('cmp-hide');
              }, 230));
            }
          }
          shown.set(e.id, on);
          if (d.caster) {
            const tm = eventTeam(e.when, d);
            if (tm === 0 || tm === 1) n.style.setProperty('--event', `var(--team${tm})`);
            else n.style.setProperty('--event', '#ffffff');
          }
          if (e.type === 'image' && e.bind) {
            // l'image de l'app ; à défaut celle du thème ; à défaut la silhouette (photo) ou rien (logo)
            const own = d[e.bind] || '';
            const u = own || (e.src ? (opts.imageUrl || ((s) => s))(e.src) : '');
            if (n.dataset.src !== u) {
              n.dataset.src = u;
              n.style.backgroundImage = u ? cssUrl(u) : 'none';
              if (n.firstChild) n.firstChild.style.display = u ? 'none' : 'block';
            }
          } else if (e.type === 'arc') {
            if (e.bind) {
              const p = Math.max(0, Math.min(100, Number(d[e.bind]) || 0)) / 100;
              const fg = n.querySelector('.cmp-arc-fg');
              fg.setAttribute('d', arcPath(e.w, e.h, e.thickness, e.from, e.from + (e.to - e.from) * p));
              fg.style.visibility = p > 0 ? 'visible' : 'hidden';
            }
          } else if (e.type === 'players' || e.type === 'pips' || e.type === 'board') {
            // (un bloc qui n'est pas à l'écran n'est pas tenu à jour : le boost des joueurs change vingt fois par seconde)
            if (on || opts.editing) (e.type === 'players' ? updatePlayers : e.type === 'pips' ? updatePips : updateBoard)(n, e, d);
          } else if (e.type === 'value') {
            const v = valueOf(e.bind, d);
            const text = v.text === '' ? '' : `${e.prefix}${v.text}${e.suffix}`;
            const span = n.firstChild;
            if (span.textContent !== text) {
              span.textContent = text;
              if (!first && opts.animate !== false && prev.get(e.id) !== text) {
                n.classList.remove('cmp-pop');
                void n.offsetWidth;
                n.classList.add('cmp-pop');
              }
              prev.set(e.id, text);
            }
            n.style.color = css(e.color, v.tone);
            fitText(n, e);
          } else if (e.type === 'text') {
            fitText(n, e);
          } else if (e.type === 'results') {
            const list = d.last.slice(-e.count);
            const sig = list.map((r) => r.r + (r.ot ? 'o' : '')).join('');
            if (n.dataset.sig !== `${sig}|${d.labelWin}|${d.labelLoss}`) {
              n.dataset.sig = `${sig}|${d.labelWin}|${d.labelLoss}`;
              n.textContent = '';
              const size = Math.max(6, Math.round((e.dir === 'row' ? e.h : (e.h - e.gap * (e.count - 1)) / e.count) * 0.46));
              for (let i = 0; i < e.count; i++) {
                const r = list[i - (e.count - list.length)];
                const c = document.createElement('i');
                c.className = r ? `${r.r === 'W' ? 'rw' : 'rl'}${r.ot ? ' ro' : ''}` : 'rn';
                c.style.borderRadius = `${e.radius}px`;
                c.style.fontSize = `${size}px`;
                if (r && e.letters) c.textContent = r.r === 'W' ? d.labelWin : d.labelLoss;
                n.appendChild(c);
              }
            }
          } else if (e.type === 'bar') {
            const total = d.wins + d.losses;
            const p = total ? (d.wins / total) * 100 : 50;
            n.children[0].style.flexBasis = `calc(${p}% - ${e.gap / 2}px)`;
            n.children[1].style.flexBasis = `calc(${100 - p}% - ${e.gap / 2}px)`;
            n.children[0].style.opacity = n.children[1].style.opacity = total ? '1' : '0.35';
          }
        }
        first = false;
      }
      // Entrée en scène (alertes) : rejoue l'animation choisie dans la composition
      function enter(kind = comp.enter || 'none') {
        el.classList.remove('out', ...ENTER.map((k) => `in-${k}`));
        if (kind === 'none') return;
        void el.offsetWidth;
        el.classList.add(`in-${kind}`);
      }
      const leave = () => el.classList.add('out');
      return { el, nodes, update, enter, leave, destroy: () => el.remove() };
    }

    api.mount = mount;
    api.loadFonts = loadFonts;
    api.gauge = gauge;
    api.boxPath = boxPath;
    api.cssColor = css;
  }

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Compose = api;
})(typeof window !== 'undefined' ? window : this);
