'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readZip, writeZip } = require('../core/zip');
const { ThemeManager, safeRel, slug } = require('../core/themes');

const BUILTIN = path.join(__dirname, '..', 'web', 'themes');

function manager() {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlui-themes-'));
  return new ThemeManager({ builtinDir: BUILTIN, userDir });
}

test('zip : écriture puis relecture à l\'identique', () => {
  const files = [
    { name: 'a/theme.json', data: Buffer.from('{"name":"A"}') },
    { name: 'a/images/fond.svg', data: Buffer.from('<svg/>'.repeat(500)) },
  ];
  const back = readZip(writeZip(files));
  assert.deepStrictEqual(
    back.map((e) => [e.name, e.data.toString()]),
    files.map((e) => [e.name, e.data.toString()])
  );
});

test('zip : un fichier qui n\'est pas un zip est refusé', () => {
  assert.throws(() => readZip(Buffer.from('pas un zip du tout')));
});

test('chemins : scripts, dossiers parents et fichiers cachés refusés', () => {
  assert.strictEqual(safeRel('images/logo.png'), 'images/logo.png');
  assert.strictEqual(safeRel('images\\logo.png'), 'images/logo.png');
  assert.strictEqual(safeRel('../evil.css'), null);
  assert.strictEqual(safeRel('a/../../evil.css'), null);
  assert.strictEqual(safeRel('script.js'), null);
  assert.strictEqual(safeRel('page.html'), null);
  assert.strictEqual(safeRel('.hidden.css'), null);
  assert.strictEqual(slug('Néon Été !'), 'neon-ete');
});

test('thèmes intégrés listés, « classique » en tête', () => {
  const list = manager().list();
  assert.strictEqual(list[0].id, 'classique');
  for (const id of ['neon', 'or-noir', 'modele']) assert.ok(list.some((t) => t.id === id && t.builtin), id);
});

test('personnaliser puis exporter puis réinstaller un thème', () => {
  const tm = manager();
  const d = tm.duplicate('modele', 'Ma DA');
  assert.strictEqual(d.id, 'ma-da');
  const t = tm.get('ma-da');
  assert.ok(t && !t.builtin && t.hasCss);
  assert.ok(tm.file('ma-da', 'images/logo.svg'));
  assert.strictEqual(tm.file('ma-da', '../modele/theme.json'), null);

  const z = tm.exportZip('ma-da');
  assert.strictEqual(z.name, 'ma-da.zip');
  assert.ok(tm.remove('ma-da'));
  assert.strictEqual(tm.get('ma-da'), null);

  const r = tm.install(z.data);
  assert.strictEqual(r.id, 'ma-da');
  assert.deepStrictEqual(r.refused, []);
  assert.ok(tm.get('ma-da'));
});

test('installation : les scripts sont ignorés, un thème intégré n\'est jamais écrasé', () => {
  const tm = manager();
  const zip = writeZip([
    { name: 'theme.json', data: Buffer.from('{"id":"neon","name":"Néon"}') },
    { name: 'theme.css', data: Buffer.from('body{color:red}') },
    { name: 'hack.js', data: Buffer.from('alert(1)') },
    { name: '../../sortie.css', data: Buffer.from('x') },
  ]);
  const r = tm.install(zip);
  assert.notStrictEqual(r.id, 'neon');
  assert.strictEqual(r.refused.length, 2);
  assert.ok(!fs.existsSync(path.join(tm.userDir, r.id, 'hack.js')));
  assert.ok(tm.get('neon').builtin);
  assert.ok(!tm.remove('neon'));
});

test('installation : un zip sans theme.json est refusé', () => {
  assert.throws(() => manager().install(writeZip([{ name: 'x.css', data: Buffer.from('a') }])), /theme\.json/);
});
