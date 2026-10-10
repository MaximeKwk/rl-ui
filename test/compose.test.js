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
  assert.throws(() => Compose.clean({ elements: Array.from({ length: 81 }, () => ({ type: 'box' })) }), /too-many/);
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
