'use strict';
// Thèmes composés (format 2, éditeur visuel) : un format de données contrôlé, sans rien d'exécutable.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Compose = require('../web/shared/compose.js');
const themeFormat = require('../core/themeFormat');
const { ThemeManager } = require('../core/themes');
const { starter, STARTER_IDS } = require('../core/themeStarters');
const { writeZip } = require('../core/zip');
const I = require('../core/i18n');

const tmp = [];
test.after(() => tmp.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
function manager() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-cmp-'));
  tmp.push(dir);
  return new ThemeManager({ builtinDir: path.join(__dirname, '..', 'web', 'themes'), userDir: dir });
}
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40)]);

test('composition : ce qui est hors format est ramené dans les clous ou retiré', () => {
  const c = Compose.clean({
    width: 99999,
    height: -5,
    elements: [
      { type: 'box', x: 10, y: 10, w: 300, h: 80, fill: 'url(javascript:alert(1))', radius: 9999, onclick: 'x()', style: 'position:fixed' },
      { type: 'value', bind: '__proto__', font: 'Comic Sans MS', size: 'énorme', weight: 650, color: 'expression(1)' },
      { type: 'script', src: 'http://evil/x.js' },
      { type: 'text', text: `<img src=x onerror=1>${'a'.repeat(500)}`, id: 'Mon Titre' },
      { type: 'image', src: '../../secret.png' },
      { type: 'image', src: 'https://evil.example/x.png' },
      { type: 'image', src: 'images/logo.png', fit: 'tile' },
      null,
      'nope',
    ],
  });
  assert.deepStrictEqual([c.width, c.height], [1920, 20]);
  assert.strictEqual(c.elements.length, 6, 'le type inconnu et les non-objets sont retirés');
  const [box, value, text, img1, img2, img3] = c.elements;
  assert.strictEqual(box.fill, '#0a0f11');
  assert.strictEqual(box.radius, 400);
  assert.ok(!('onclick' in box) && !('style' in box), 'aucune propriété inconnue ne passe');
  assert.deepStrictEqual([value.bind, value.font, value.size, value.weight, value.color], ['wins', 'Unbounded', 32, 700, 'white']);
  assert.strictEqual(text.text.length, 80);
  assert.match(text.id, /^[a-z0-9]+$/);
  assert.deepStrictEqual([img1.src, img2.src, img3.src, img3.fit], ['', '', 'images/logo.png', 'contain']);
  assert.strictEqual(new Set(c.elements.map((e) => e.id)).size, 6, 'identifiants uniques');
  // nettoyer deux fois ne change plus rien
  assert.deepStrictEqual(Compose.clean(c), c);
  assert.throws(() => Compose.clean({ elements: 'x' }));
  assert.throws(() => Compose.clean({ elements: Array.from({ length: Compose.LIMITS.elements + 1 }, () => ({ type: 'box' })) }), /too-many/);
});

test('valeurs en direct : texte, teinte et visibilité', () => {
  const d = Compose.sample('idle');
  assert.deepStrictEqual(Compose.valueOf('record', d), { text: '12 - 5', tone: '' });
  assert.deepStrictEqual(Compose.valueOf('winRate', d), { text: '71%', tone: '' });
  assert.deepStrictEqual(Compose.valueOf('streak', d), { text: '3', tone: 'hot' });
  assert.deepStrictEqual(Compose.valueOf('mmrDelta', d), { text: '+45', tone: 'win' });
  const cold = Compose.sample('cold');
  assert.deepStrictEqual(Compose.valueOf('streak', cold), { text: '4', tone: 'cold' });
  assert.deepStrictEqual(Compose.valueOf('mmrDelta', cold), { text: '-38', tone: 'loss' });
  const empty = Compose.sample('empty');
  assert.strictEqual(Compose.valueOf('winRate', empty).text, '—');
  assert.strictEqual(Compose.valueOf('mmr', empty).text, '—');
  assert.strictEqual(Compose.valueOf('mode', d).text, '', 'hors partie : pas de mode');
  const ot = Compose.sample('overtime');
  assert.strictEqual(Compose.valueOf('clock', ot).tone, 'ot');
  assert.deepStrictEqual(['always', 'match', 'idle', 'overtime', 'winStreak', 'lossStreak', 'mmr'].map((w) => Compose.visible(w, ot)), [true, true, false, true, true, false, true]);
  assert.strictEqual(Compose.visible('mmr', empty), false);
  assert.strictEqual(Compose.visible('lossStreak', cold), true);
});

test('données tirées de l\'état public de l\'app', () => {
  const state = {
    session: { wins: 3, losses: 1, played: 4, winRate: 75, streak: 2, bestWinStreak: 2, otWins: 1, otLosses: 0, mvps: 1, last: [{ result: 'W', ot: true }, { result: 'L' }], mmr: { primary: { current: 1104, delta: 4.4, games: 4 } } },
    live: { inMatch: true, overtime: true, time: 37, myTeam: 1, playlist: { name: '2v2 Ranked' }, teams: [{ num: 0, score: 1 }, { num: 1, score: 2 }] },
  };
  const d = Compose.dataFrom(state, { labelWin: 'V' }, (k) => (k === 'lbl.l' ? 'L' : k));
  assert.deepStrictEqual([d.wins, d.losses, d.winRate, d.mmr, d.mmrDelta], [3, 1, 75, 1104, 4]);
  assert.deepStrictEqual([d.labelWin, d.labelLoss, d.mode, d.clock, d.score], ['V', 'L', '2v2 Ranked', '+0:37', '2 - 1']);
  assert.deepStrictEqual(d.last, [{ r: 'W', ot: true }, { r: 'L', ot: false }]);
  const none = Compose.dataFrom(null);
  assert.deepStrictEqual([none.wins, none.winRate, none.mmr, none.inMatch], [0, null, null, false]);
});

test('modèles de départ : valides tels quels, dans les deux langues', () => {
  for (const lang of ['en', 'fr']) {
    I.setLang(lang);
    for (const k of STARTER_IDS) {
      const raw = starter(k, I.t);
      const c = Compose.clean(raw);
      assert.strictEqual(c.elements.length, raw.elements.length, `${k} : aucun élément perdu`);
      assert.ok(c.elements.every((e) => e.x >= 0 && e.y >= 0 && e.x + e.w <= c.width && e.y + e.h <= c.height), `${k} : tout tient sur la toile`);
      assert.ok(!c.elements.some((e) => /^cmp\./.test(e.name) || /^cmp\./.test(e.text || '')), `${k} : tous les noms sont traduits (${lang})`);
    }
  }
  I.setLang('en');
});

test('thème composé : création, lecture, enregistrement, refus sur un thème intégré', () => {
  const tm = manager();
  const { id } = tm.create({ name: 'Mon Thème Néon', kind: 'bar', author: 'Zoxam' });
  assert.strictEqual(id, 'mon-theme-neon');
  const t = tm.get(id);
  assert.deepStrictEqual([t.format, t.editable, t.hasCss, t.base, t.problem], [2, true, false, 'signature', '']);
  assert.ok(t.compose.counter.elements.some((e) => e.type === 'results'));
  const src = tm.source(id);
  assert.strictEqual(src.theme.author, 'Zoxam');
  src.theme.name = 'Néon v2';
  src.theme.base = 'contraste';
  src.theme.counter.elements.push({ type: 'text', text: 'GG', x: 5, y: 5, w: 50, h: 20, junk: true });
  const saved = tm.saveSource(id, { ...src.theme, format: 1, css: 'body{}' });
  assert.strictEqual(saved.theme.name, 'Néon v2');
  const again = tm.get(id);
  assert.strictEqual(again.name, 'Néon v2');
  assert.strictEqual(again.base, 'contraste');
  const last = again.compose.counter.elements.at(-1);
  assert.strictEqual(last.text, 'GG');
  assert.ok(!('junk' in last));
  const onDisk = JSON.parse(fs.readFileSync(path.join(again.dir, 'theme.json'), 'utf8'));
  assert.deepStrictEqual([onDisk.format, onDisk.id, 'css' in onDisk], [2, id, false]);
  assert.throws(() => tm.saveSource('signature', src.theme), /built-in/i);
  assert.throws(() => tm.source('signature'), /editor/i);
  assert.throws(() => tm.saveSource(id, { name: '' }), /name/);
});

test('thème composé : images vérifiées sur leur contenu, et retirées quand elles ne servent plus', () => {
  const tm = manager();
  const { id } = tm.create({ name: 'Images', kind: 'blank' });
  const a = tm.saveImage(id, PNG, 'Mon Logo.exe');
  assert.strictEqual(a.src, 'images/mon-logo.png', 'le type vient du contenu, pas du nom');
  const b = tm.saveImage(id, PNG, 'Mon Logo.png');
  assert.strictEqual(b.src, 'images/mon-logo-2.png');
  assert.throws(() => tm.saveImage(id, Buffer.from('<svg onload="x()"/>'), 'a.svg'), /png/);
  assert.throws(() => tm.saveImage(id, Buffer.alloc(3 * 1024 * 1024, 1), 'gros.png'), /2/);
  assert.throws(() => tm.saveImage('signature', PNG, 'x.png'));
  const src = tm.source(id);
  assert.deepStrictEqual(src.images.sort(), ['images/mon-logo-2.png', 'images/mon-logo.png']);
  src.theme.counter.elements.push({ type: 'image', src: a.src, x: 0, y: 0, w: 40, h: 40 });
  tm.saveSource(id, src.theme);
  assert.deepStrictEqual(tm.source(id).images, ['images/mon-logo.png'], 'l\'image inutilisée est retirée');
  assert.ok(tm.file(id, 'images/mon-logo.png'));
});

test('vérification avant partage : liste des problèmes', () => {
  const tm = manager();
  const { id } = tm.create({ name: 'À partager', kind: 'signature', author: 'Zoxam' });
  assert.deepStrictEqual(tm.check(id, '2.0.0').problems, ['description']);
  const src = tm.source(id);
  tm.saveSource(id, { ...src.theme, description: 'Une plaque sobre.', minApp: '9.0.0' });
  assert.deepStrictEqual(tm.check(id, '2.0.0').problems, ['needs-newer-app']);
  tm.saveSource(id, { ...src.theme, description: 'Une plaque sobre.' });
  assert.strictEqual(tm.check(id, '2.0.0').ok, true);
  // un fichier qui n'a rien à faire là, et un thème écrit à la main avec des valeurs hors format
  const dir = tm.get(id).dir;
  fs.writeFileSync(path.join(dir, 'theme.css'), 'body{}');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'theme.json'), 'utf8'));
  meta.counter.elements[0].radius = 5000;
  meta.counter.elements[1].behavior = 'url(#default#time2)';
  fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify(meta));
  const r = tm.check(id, '2.0.0');
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.includes('file:theme.css'));
  assert.ok(r.problems.some((p) => /^adjusted:.*\.radius$/.test(p)));
  assert.ok(r.problems.some((p) => /^adjusted:.*\.behavior$/.test(p)));
  assert.deepStrictEqual(themeFormat.check({ format: 2 }).problems, ['theme:name']);
  assert.deepStrictEqual(themeFormat.check({ format: 1, name: 'x' }).problems, ['theme:format']);
});

test('installation d\'un thème composé : nettoyé, fichiers hors format refusés', () => {
  const tm = manager();
  const theme = { format: 2, name: 'Venu d\'ailleurs', author: 'Quelqu\'un', description: 'x', counter: { width: 400, height: 100, elements: [{ type: 'box', x: 0, y: 0, w: 400, h: 100, evil: '<script>' }, { type: 'iframe', src: 'http://x' }] } };
  const zip = writeZip([
    { name: 'pack/theme.json', data: Buffer.from(JSON.stringify(theme)) },
    { name: 'pack/theme.css', data: Buffer.from('body { background: url(http://evil) }') },
    { name: 'pack/images/fond.png', data: PNG },
    { name: 'pack/fonts/x.woff2', data: Buffer.from('x') },
    { name: 'pack/run.js', data: Buffer.from('alert(1)') },
  ]);
  const r = tm.install(zip);
  assert.strictEqual(r.id, 'venu-d-ailleurs');
  assert.deepStrictEqual(r.refused.sort(), ['pack/fonts/x.woff2', 'pack/run.js', 'pack/theme.css']);
  const t = tm.get(r.id);
  assert.strictEqual(t.format, 2);
  assert.strictEqual(t.hasCss, false);
  assert.strictEqual(t.compose.counter.elements.length, 1);
  const onDisk = JSON.parse(fs.readFileSync(path.join(t.dir, 'theme.json'), 'utf8'));
  assert.ok(!JSON.stringify(onDisk).includes('<script>') && !JSON.stringify(onDisk).includes('evil'));
  assert.ok(!fs.existsSync(path.join(t.dir, 'theme.css')));
  assert.ok(fs.existsSync(path.join(t.dir, 'images', 'fond.png')));
  // un format 2 illisible n'est pas installé
  assert.throws(() => tm.install(writeZip([{ name: 'theme.json', data: Buffer.from(JSON.stringify({ format: 2, name: 'x', counter: 'nope' })) }])));
});

test('comparaison de versions', () => {
  assert.ok(themeFormat.cmpVersion('2.0.0', '2.0.1') < 0);
  assert.ok(themeFormat.cmpVersion('2.10.0', '2.9.9') > 0);
  assert.strictEqual(themeFormat.cmpVersion('1.2.5', '1.2.5'), 0);
});

// ---------------------------------------------------------------- alertes, dernières parties, récap
const { overlayStarter, OVERLAY_STARTERS } = require('../core/themeStarters');

test('alertes : ce que l\'alerte apporte, quand un élément se montre, couleur de l\'alerte', () => {
  const tr = (k) => I.tl('en', k);
  const win = Compose.dataFrom(null, {}, tr, { type: 'ot_win', title: 'OVERTIME VICTORY', data: { scoreFor: 3, scoreAgainst: 2, overtime: true, otSeconds: 42, mvp: true, playlist: '2v2 Ranked', streak: 4, wins: 13, losses: 5, mmr: { delta: 11.6, learned: false } } });
  assert.deepStrictEqual([win.alert, win.alertTitle, win.alertDetail, win.matchScore, win.matchOt, win.mvp], ['ot_win', 'OVERTIME VICTORY', 'Golden goal', '3 - 2', '+0:42', true]);
  assert.deepStrictEqual([win.wins, win.losses, win.streak], [13, 5, 4], 'le bilan vient de l\'alerte : l\'état de la session peut arriver après elle');
  assert.deepStrictEqual(Compose.valueOf('matchMmr', win), { text: '≈ +12', tone: 'win' });
  assert.deepStrictEqual(Compose.valueOf('alertTitle', win), { text: 'OVERTIME VICTORY', tone: 'event' });
  for (const [when, want] of [['alertWin', true], ['alertLoss', false], ['alertOt', false], ['alertOtEnd', true], ['alertStreak', false], ['alertMvp', true], ['matchScore', true], ['matchMmr', true]]) assert.strictEqual(Compose.visible(when, win), want, when);
  // défaite : pas de MVP même si le jeu le dit ; partie comptée à la main : pas de score ni de mode
  const loss = Compose.dataFrom(null, {}, tr, { type: 'loss', title: 'DEFEAT', data: { manual: true, scoreFor: 0, scoreAgainst: 0, mvp: true, playlist: 'x', mmr: { delta: -9, learned: true } } });
  assert.deepStrictEqual([loss.mvp, loss.matchScore, loss.alertDetail, Compose.valueOf('matchMmr', loss).text, Compose.visible('alertLoss', loss), Compose.visible('matchScore', loss)], [false, '', '', '-9', true, false]);
  // début de prolongation, série
  const ot = Compose.dataFrom(null, {}, tr, { type: 'overtime', title: 'OVERTIME', data: { scoreFor: 2, scoreAgainst: 2, playlist: '2v2 Ranked' } });
  assert.deepStrictEqual([ot.alertDetail, ot.matchMmr, Compose.visible('alertOt', ot), Compose.visible('matchMmr', ot)], ['Sudden death · 2v2 Ranked', null, true, false]);
  const streak = Compose.dataFrom(null, {}, tr, Compose.sampleAlert('streak', tr));
  assert.deepStrictEqual([streak.alertTitle, streak.streak, streak.matchScore, Compose.visible('alertStreak', streak)], ['5 WIN STREAK', 5, '', true]);
  assert.deepStrictEqual(['win', 'ot_win', 'loss', 'ot_loss', 'overtime', 'streak'].map(Compose.eventTone), ['win', 'win', 'loss', 'loss', 'ot', 'ot']);
  // hors alerte, rien de tout cela n'apparaît
  const idle = Compose.dataFrom({ session: { wins: 1 } }, {}, tr);
  for (const when of ['alertWin', 'alertLoss', 'alertOt', 'alertOtEnd', 'alertStreak', 'alertMvp', 'matchScore', 'matchMmr']) assert.strictEqual(Compose.visible(when, idle), false, when);
  // chaque type d'alerte a son exemple, pour l'éditeur et les aperçus
  for (const type of ['win', 'loss', 'overtime', 'ot_win', 'ot_loss', 'streak']) assert.ok(Compose.sampleAlert(type, tr).title && !/^alert\./.test(Compose.sampleAlert(type, tr).title), type);
});

test('récap : temps de jeu, buts, passes, arrêts, différence de buts, joueur', () => {
  const d = Compose.dataFrom({ session: { wins: 3, losses: 1, played: 4, winRate: 75, timePlayedSec: 4980, myGoals: 7, myAssists: 2, mySaves: 5, goalsFor: 11, goalsAgainst: 6 }, status: { account: 'Zoxam' } }, {});
  assert.deepStrictEqual(['timePlayed', 'goals', 'assists', 'saves', 'goalDiff', 'player'].map((b) => Compose.valueOf(b, d).text), ['1h23', '7', '2', '5', '+5', 'Zoxam']);
  assert.strictEqual(Compose.valueOf('goalDiff', d).tone, 'win');
  assert.strictEqual(Compose.valueOf('timePlayed', Compose.dataFrom(null)).text, '0 min');
  // chaque overlay propose des valeurs et des conditions qui existent
  for (const k of Compose.KINDS) {
    assert.ok(Compose.BINDS_FOR[k].every((b) => Compose.BINDS.includes(b)) && Compose.WHEN_FOR[k].every((w) => Compose.WHEN.includes(w)), k);
    assert.strictEqual(Compose.SIZES[k].length, 2);
  }
  assert.ok(!Compose.BINDS_FOR.counter.includes('alertTitle') && Compose.BINDS_FOR.alerts.includes('alertTitle') && Compose.BINDS_FOR.summary.includes('timePlayed'));
});

test('thème : les autres overlays composés, nettoyés et contrôlés comme le compteur', () => {
  const base = { format: 2, name: 'Complet', author: 'Moi', description: 'Tout est dessiné.', counter: { width: 400, height: 100, elements: [{ type: 'value', bind: 'wins', x: 0, y: 0, w: 100, h: 40 }] } };
  const t = themeFormat.cleanTheme({
    ...base,
    alerts: { width: 1920, height: 1080, enter: 'pop', elements: [{ type: 'value', bind: 'alertTitle', color: 'event', fit: 'oui', x: 0, y: 0, w: 900, h: 100, onload: 'x()' }, { type: 'box', fill: 'event', x: 0, y: 0, w: 10, h: 10 }, { type: 'script' }] },
    history: { width: 700, height: 90, enter: 'explosion', elements: [{ type: 'results', x: 0, y: 0, w: 300, h: 30 }] },
    scoreboard: { width: 100, height: 100, elements: [] },
  });
  assert.deepStrictEqual([t.alerts.enter, t.alerts.elements.length, t.alerts.elements[0].color, t.alerts.elements[0].fit, t.alerts.elements[1].fill], ['pop', 2, 'event', true, 'event']);
  assert.ok(!('onload' in t.alerts.elements[0]));
  assert.ok(!('enter' in t.history), 'une entrée inconnue est retirée');
  assert.ok(!('scoreboard' in t), 'un overlay qui n\'est pas dans le format est ignoré');
  // (une composition illisible rend le thème inutilisable : il n'est pas à moitié chargé)
  assert.throws(() => themeFormat.cleanTheme({ ...base, alerts: { elements: 'x' } }));
  assert.throws(() => themeFormat.cleanTheme({ ...base, summary: 'pas une composition' }));
  assert.ok(!('summary' in themeFormat.cleanTheme({ ...base, summary: null })));
  // contrôle avant partage : chaque composition compte
  const clean = JSON.parse(JSON.stringify(themeFormat.cleanTheme({ ...base, alerts: { width: 1920, height: 1080, elements: [{ type: 'image', src: 'images/bandeau.png', x: 0, y: 0, w: 100, h: 50 }] } })));
  assert.deepStrictEqual(themeFormat.check(clean, ['theme.json']).problems, ['missing:images/bandeau.png']);
  assert.deepStrictEqual(themeFormat.check(clean, ['theme.json', 'images/bandeau.png']).problems, []);
  assert.deepStrictEqual(themeFormat.usedImages(clean), ['images/bandeau.png']);
  clean.alerts.elements[0].style = 'position:fixed';
  assert.deepStrictEqual(themeFormat.check(clean, ['theme.json', 'images/bandeau.png']).problems, ['adjusted:alerts.e1.style']);
  clean.alerts.elements.push({ type: 'iframe' });
  assert.ok(themeFormat.check(clean, ['theme.json', 'images/bandeau.png']).problems.includes('adjusted:alerts.elements'));
  // le compteur reste obligatoire : c'est lui que montre la vignette du thème
  assert.ok(themeFormat.check({ ...clean, counter: null }, []).problems.includes('empty'));
});

test('points de départ des autres overlays (Boost, alertes, dernières parties, récap, caster) : valides, dans les deux langues', () => {
  assert.deepStrictEqual([...OVERLAY_STARTERS].sort(), Compose.KINDS.filter((k) => k !== 'counter').sort());
  for (const lang of ['en', 'fr']) {
    const tr = (k) => I.tl(lang, k);
    for (const kind of OVERLAY_STARTERS) {
      const raw = overlayStarter(kind, tr);
      const c = Compose.clean(raw);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(c.elements.map(({ id, ...e }) => e))), JSON.parse(JSON.stringify(raw.elements.map((e) => ({ ...Compose.cleanElement(e, 0, new Set()), id: undefined })).map(({ id, ...e }) => e))), `${kind} : rien n'est corrigé`);
      assert.deepStrictEqual([c.width, c.height], Compose.SIZES[kind], kind);
      // chaque valeur et chaque condition est de celles que l'éditeur propose pour cet overlay
      for (const e of c.elements) {
        if (e.type === 'value') assert.ok(Compose.BINDS_FOR[kind].includes(e.bind), `${kind} ${e.bind}`);
        assert.ok(Compose.TYPES_FOR[kind].includes(e.type), `${kind} ${e.type}`);
        for (const k of ['color', 'fill', 'borderColor']) if (Compose.TOKENS.includes(e[k]) && !['win', 'loss', 'ot', 'white', 'black', 'auto'].includes(e[k])) assert.ok(Compose.TOKENS_FOR[kind].includes(e[k]), `${kind} : couleur ${e[k]}`);
        assert.ok(Compose.WHEN_FOR[kind].includes(e.when), `${kind} ${e.when}`);
        assert.ok(e.x >= 0 && e.y >= 0 && e.x + e.w <= c.width && e.y + e.h <= c.height, `${kind} : « ${e.name} » tient dans la toile`);
        assert.ok(e.name && !/^(cmp|ov|al|e|c)\./.test(e.name) && !/^(cmp|ov|al|e|c)\./.test(e.text || ''), `${lang} ${kind} : ${e.name}`);
      }
    }
    assert.strictEqual(overlayStarter('alerts', tr).enter, 'slide');
  }
  assert.strictEqual(overlayStarter('boost', (k) => k).gaugeGap, 12, 'le compteur Boost de départ épouse la jauge du jeu');
  assert.ok(Compose.clean(overlayStarter('caster', (k) => k)).elements.length <= Compose.LIMITS.elements);
  assert.strictEqual(overlayStarter('counter', (k) => k), null);
  assert.strictEqual(overlayStarter('constructor', (k) => k), null);
});

test('thème composé : enregistrer et relire les autres overlays ; images gardées si une composition s\'en sert', () => {
  const tm = manager();
  const { id } = tm.create({ name: 'Avec alertes', kind: 'bar', author: 'Zoxam' });
  assert.deepStrictEqual(Object.keys(tm.get(id).compose), ['counter']);
  const img = tm.saveImage(id, PNG, 'bandeau.png');
  const unused = tm.saveImage(id, PNG, 'oubli.png');
  const src = tm.source(id);
  const tr = (k) => I.tl('fr', k);
  const alerts = overlayStarter('alerts', tr);
  alerts.elements.push({ type: 'image', src: img.src, x: 0, y: 0, w: 100, h: 100 });
  tm.saveSource(id, { ...src.theme, alerts, summary: overlayStarter('summary', tr) });
  const t = tm.get(id);
  assert.deepStrictEqual(Object.keys(t.compose), ['counter', 'alerts', 'summary']);
  assert.strictEqual(t.compose.alerts.enter, 'slide');
  const dir = t.dir;
  assert.ok(fs.existsSync(path.join(dir, img.src)), 'image utilisée par les alertes : gardée');
  assert.ok(!fs.existsSync(path.join(dir, unused.src)), 'image qui ne sert à rien : retirée');
  // ne plus dessiner un overlay : il disparaît du thème
  tm.saveSource(id, { ...tm.source(id).theme, alerts: null });
  assert.deepStrictEqual(Object.keys(tm.get(id).compose), ['counter', 'summary']);
  assert.ok(!fs.existsSync(path.join(dir, img.src)));
});

test('éléments du Boost et du caster : arc, joueurs, manches, tableau ; ramenés dans les clous', () => {
  const c = Compose.clean({
    width: 480,
    height: 320,
    gaugeGap: 500,
    elements: [
      { type: 'arc', x: 0, y: 0, w: 100, h: 100, from: -900, to: 9000, thickness: 0, color: 'team', cap: 'pointu', ticks: 500, tickW: 0, bind: 'wins', track: 7 },
      { type: 'arc', x: 0, y: 0, w: 100, h: 100, bind: 'tgBoost', track: 0.2 },
      { type: 'players', team: '1', rowH: 5, gap: -3, stripe: 99, font: 'Comic Sans', onclick: 'x()' },
      { type: 'players', team: 0, side: 'right' },
      { type: 'pips', team: 7, skew: false, color: 'javascript:1' },
      { type: 'board', rowH: 999, lines: 4, header: false },
      { type: 'image', bind: 'teamLogo1', src: 'https://exemple.test/logo.png' },
      { type: 'image', bind: 'document.cookie', src: 'images/a.png' },
    ],
  });
  assert.strictEqual(c.gaugeGap, 80);
  const [arc, ring, pl1, pl0, pips, board, logo, img] = c.elements;
  assert.deepStrictEqual([arc.from, arc.to, arc.thickness, arc.color, arc.cap, arc.ticks, arc.tickW, arc.bind, arc.track], [-360, 720, 1, 'team', 'butt', 72, 1, '', 1]);
  assert.deepStrictEqual([ring.bind, ring.track, ring.from, ring.to], ['tgBoost', 0.2, 0, 270]);
  assert.deepStrictEqual([pl1.team, pl1.side, pl1.rowH, pl1.gap, pl1.stripe, pl1.font, 'onclick' in pl1], [1, 'right', 20, 0, 30, 'Barlow Condensed', false]);
  assert.deepStrictEqual([pl0.team, pl0.side], [0, 'right'], 'le côté peut être choisi à part de l\'équipe');
  assert.deepStrictEqual([pips.team, pips.skew, pips.color], [0, false, 'team0']);
  assert.deepStrictEqual([board.rowH, board.lines, board.header], [160, 1, false]);
  // une image liée vient de l'app (logo d'équipe, photo) : jamais d'une adresse choisie par le thème
  assert.deepStrictEqual([logo.bind, logo.src, img.bind, img.src], ['teamLogo1', '', undefined, 'images/a.png']);
  assert.deepStrictEqual(Compose.clean(c), c, 'nettoyer deux fois ne change plus rien');
  assert.ok(!('gaugeGap' in Compose.clean({ elements: [] })));
  // chaque type est proposé pour au moins un overlay, et le caster n'a pas ceux de la session
  for (const ty of Compose.TYPES) assert.ok(Compose.KINDS.some((k) => Compose.TYPES_FOR[k].includes(ty)), ty);
  assert.ok(!Compose.TYPES_FOR.caster.includes('results') && !Compose.TYPES_FOR.counter.includes('players'));
  for (const k of Compose.KINDS) assert.ok(Compose.SIZES[k] && Compose.BINDS_FOR[k].length && Compose.WHEN_FOR[k].length && Compose.SAMPLES[k].length && Compose.TOKENS_FOR[k] && Compose.ARC_BINDS_FOR[k], k);
});

test('caster : ce que l\'overlay affiche à partir de l\'état du mode caster', () => {
  const tr = (k, v) => (v ? `${k}(${Object.values(v).join(',')})` : k);
  const players = [
    { key: '0:Nova', name: 'Nova', team: 0, boost: 72.4, score: 300, goals: 2, shots: 4, assists: 0, saves: 1, demos: 0 },
    { key: '0:Kuro', name: 'Kuro', team: 0, boost: 140, demolished: true, score: 520, goals: 0, shots: 1, assists: 2, saves: 3, demos: 1 },
    { key: '1:Blaze', name: 'Blaze', team: 1, boost: -5, supersonic: true, score: 100, goals: 1, shots: 2, assists: 0, saves: 0, demos: 0, photo: '/caster/photo/blaze.png' },
  ];
  const st = {
    match: { active: true, time: 187, overtime: false, replay: false, ended: false, winner: null, mvp: '0:Kuro', target: '0:Nova', teams: [{ num: 0, name: 'Nova Esports', score: 2, color: '#1873ff', logo: '/caster/logo/0.png' }, { num: 1, name: 'Apex', score: 1, color: '' }], players },
    series: { title: 'Cup', bestOf: 5, need: 3, wins: [2, 1], game: 4 },
    options: { showSeries: true, showBoosts: true, showTarget: true, showGoals: true, showFeed: true, showPostgame: true, speedUnit: 'mph' },
  };
  const d = Compose.casterData(st, tr);
  const val = (b, x = d) => Compose.valueOf(b, x).text;
  assert.deepStrictEqual(['teamName0', 'teamScore1', 'matchClock', 'clockNote', 'seriesLine', 'seriesWins0', 'tgName', 'tgTeam', 'tgBoost', 'tgGoals'].map((b) => val(b)), ['Nova Esports', '1', '3:07', '', 'Cup · c.game(4) · c.bestOf(5)', '2', 'Nova', 'Nova Esports', '72', '2']);
  assert.deepStrictEqual([d.teamLogo0, d.teamLogo1, d.teamColor1, d.seriesNeed], ['/caster/logo/0.png', '', '#ff7a1a', 3]);
  assert.notStrictEqual(d.teamColor0, '#1873ff', 'la couleur du jeu est éclaircie');
  // boost des joueurs : borné, par équipe ; démoli, supersonique, suivi
  assert.deepStrictEqual(d.roster.map((l) => l.map((p) => [p.name, p.boost, p.dead, p.fast, p.target])), [[['Nova', 72, false, false, true], ['Kuro', 100, true, false, false]], [['Blaze', 0, false, true, false]]]);
  // blocs visibles
  const vis = (x) => ['always', 'series', 'boosts', 'target', 'goal', 'feed', 'post', 'replay', 'ended', 'overtime'].filter((w) => Compose.visible(w, x));
  assert.deepStrictEqual(vis(d), ['always', 'series', 'boosts', 'target']);
  // but : la bannière, pendant le ralenti (plus de joueur suivi)
  const g = Compose.casterData({ ...st, match: { ...st.match, replay: true } }, tr, { goal: { team: 1, scorer: 'Blaze', assister: 'Echo', speed: 100 }, feed: { label: 'Save', team: 0, main: 'Kuro', secondary: 'Blaze' } });
  assert.deepStrictEqual(vis(g), ['always', 'series', 'boosts', 'goal', 'feed', 'replay']);
  assert.deepStrictEqual(['goalScorer', 'goalAssist', 'goalSpeed', 'feedLabel', 'feedText', 'clockNote'].map((b) => val(b, g)), ['Blaze', 'c.assist(Echo)', '62 c.mph', 'Save', 'Kuro → Blaze', 'c.replay']);
  assert.deepStrictEqual([Compose.eventTeam('goal', g), Compose.eventTeam('feed', g), Compose.eventTeam('target', d), Compose.eventTeam('always', d)], [1, 0, 0, null]);
  // fin de partie : tableau trié par équipe puis score, MVP, meilleur score ; le vainqueur donne sa couleur
  const end = { ...st, match: { ...st.match, ended: true, winner: 0, overtime: true }, series: { ...st.series, wins: [3, 1] } };
  assert.deepStrictEqual(vis(Compose.casterData(end, tr)), ['always', 'series', 'boosts', 'ended', 'overtime'], 'le tableau final attend que l\'overlay le demande');
  const p = Compose.casterData(end, tr, { post: true });
  assert.ok(Compose.visible('post', p));
  assert.deepStrictEqual([val('finalScore', p), val('winnerLine', p), val('matchClock', p), Compose.valueOf('matchClock', p).tone, Compose.eventTeam('post', p)], ['2 - 1', 'c.seriesWin(Nova Esports)', '+3:07', 'ot', 0]);
  assert.deepStrictEqual(p.board.map((r) => [r.name, r.team, r.mvp, r.best, r.cells.join(' ')]), [['Kuro', 0, true, true, '520 0 2 3 1 1'], ['Nova', 0, false, false, '300 2 0 1 4 0'], ['Blaze', 1, false, false, '100 1 0 0 2 0']]);
  assert.strictEqual(p.board[2].photo, '/caster/photo/blaze.png');
  assert.strictEqual(val('winnerLine', Compose.casterData({ ...end, series: { ...st.series, wins: [2, 1] } }, tr, { post: true })), 'c.wins(Nova Esports)');
  // réglages de l'onglet Caster : un bloc décoché n'apparaît pas ; ?hide= masque aussi le tableau des scores
  const off = Compose.casterData({ ...end, options: { showSeries: false, showBoosts: false, showTarget: false, showGoals: false, showFeed: false, showPostgame: false } }, tr, { post: true, goal: { team: 0, scorer: 'x' }, feed: { label: 'y', team: 0, main: 'z' } });
  assert.deepStrictEqual(vis(off), ['always', 'series', 'ended', 'overtime'], '(le titre seul garde la ligne de la série)');
  assert.deepStrictEqual([off.seriesNeed, val('seriesLine', off), val('seriesInfo', off)], [0, 'Cup', '']);
  assert.deepStrictEqual(vis(Compose.casterData(st, tr, { hide: ['bug', 'target'] })), ['boosts']);
  // un état vide ou abîmé ne fait rien planter
  for (const bad of [null, {}, { match: { players: 'x', teams: null } }]) assert.strictEqual(Compose.casterData(bad, tr).teamScore0, '0');
  // les situations d'aperçu de l'éditeur
  assert.deepStrictEqual(Compose.SAMPLES.caster.map((k) => vis(Compose.sampleFor('caster', k)).join(' ')), ['always series boosts target feed', 'always series boosts goal feed replay', 'always series boosts target feed overtime', 'always series boosts post ended']);
  assert.strictEqual(Compose.sampleFor('boost', 'match').teamColor, '#ff7f22');
  assert.strictEqual(Compose.sampleFor('alerts', 'a:win').alert, 'win');
});

test('thème : le compteur Boost et l\'overlay caster se composent comme les autres', () => {
  const base = { format: 2, name: 'Complet', author: 'Moi', description: 'Tout est dessiné.', counter: { width: 400, height: 100, elements: [{ type: 'value', bind: 'wins', x: 0, y: 0, w: 100, h: 40 }] } };
  const t = themeFormat.cleanTheme({ ...base, boost: overlayStarter('boost', (k) => k), caster: overlayStarter('caster', (k) => k) });
  assert.deepStrictEqual([t.boost.gaugeGap, t.boost.width, t.caster.width, t.caster.elements.filter((e) => e.type === 'players').length], [12, 480, 1920, 2]);
  const clean = JSON.parse(JSON.stringify(t));
  assert.deepStrictEqual(themeFormat.check(clean, ['theme.json']).problems, []);
  clean.caster.elements[0].team = 3;
  assert.deepStrictEqual(themeFormat.check(clean, ['theme.json']).problems, ['adjusted:caster.e1.team']);
});
