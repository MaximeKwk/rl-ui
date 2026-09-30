#!/usr/bin/env node
'use strict';
// Notes de la release GitHub : la section de CHANGELOG.md qui correspond à la version de package.json.
//   node tools/release-notes.js > release-notes.md

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');

const lines = log.split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith(`## ${version}`));
let section = [];
if (start >= 0) {
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  section = lines.slice(start + 1, end < 0 ? undefined : end);
}

const out = [
  `**Download:** \`RL-UI-Setup-${version}.exe\` (installer, updates itself) or \`RL-UI-Portable-${version}.exe\` (no install). Windows 10 / 11.`,
  '',
  '> The app is not code-signed yet: Windows SmartScreen may show a warning on first launch (*More info → Run anyway*).',
  '',
  `## What's new in ${version}`,
  ...section,
];
process.stdout.write(`${out.join('\n').trim()}\n`);
