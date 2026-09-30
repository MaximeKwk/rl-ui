'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { newer } = require('../electron/updater');

test('mises à jour : comparaison des versions', () => {
  assert.ok(newer('v1.1.0', '1.0.0'));
  assert.ok(newer('1.0.10', '1.0.9'));
  assert.ok(newer('2.0.0', '1.9.9'));
  assert.ok(!newer('v1.0.0', '1.0.0'));
  assert.ok(!newer('1.0.0', '1.2.0'));
});
