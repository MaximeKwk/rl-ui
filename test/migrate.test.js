'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrateLegacyData } = require('../electron/migrate');

test('reprise des données de l\'ancienne version', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-migrate-'));
  const legacy = path.join(root, 'Overtime Tracker');
  const dest = path.join(root, 'BoostSide');
  // rien à reprendre
  assert.strictEqual(migrateLegacyData(legacy, dest), false);
  fs.mkdirSync(path.join(legacy, 'sounds'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'data.json'), '{"matches":[{"id":"a"}]}');
  fs.writeFileSync(path.join(legacy, 'sounds', 'win.mp3'), 'x');
  assert.strictEqual(migrateLegacyData(legacy, dest), true);
  assert.strictEqual(fs.readFileSync(path.join(dest, 'data.json'), 'utf8'), '{"matches":[{"id":"a"}]}');
  assert.ok(fs.existsSync(path.join(dest, 'sounds', 'win.mp3')));
  // une seule fois : les données de BoostSide ne sont jamais écrasées
  fs.writeFileSync(path.join(legacy, 'data.json'), '{"matches":[]}');
  assert.strictEqual(migrateLegacyData(legacy, dest), false);
  assert.match(fs.readFileSync(path.join(dest, 'data.json'), 'utf8'), /"a"/);
  fs.rmSync(root, { recursive: true, force: true });
});
