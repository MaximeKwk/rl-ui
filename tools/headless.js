#!/usr/bin/env node
'use strict';
// Lance le tracker sans Electron (tests, ou PC de stream sans interface).
//   node tools/headless.js
// Variables : BOOSTSIDE_DATA (dossier des données), BOOSTSIDE_DOCS (dossier Documents), BOOSTSIDE_LOG (chemin de Launch.log)

const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { Core } = require('../core');
const pkg = require('../package.json');

const dataDir = process.env.BOOSTSIDE_DATA || path.join(process.env.APPDATA || os.homedir(), 'BoostSide');
const documentsDir = process.env.BOOSTSIDE_DOCS || path.join(os.homedir(), 'Documents');

const core = new Core({
  dataDir,
  documentsDir,
  logPath: process.env.BOOSTSIDE_LOG || undefined,
  webDir: path.join(__dirname, '..', 'web'),
  version: pkg.version,
  hooks: {
    openPath: (p) => new Promise((r) => execFile('explorer', [p], () => r(true))),
    openExternal: (url) => new Promise((r) => execFile('cmd', ['/c', 'start', '', url], () => r(true))),
  },
});

core
  .start()
  .then((port) => {
    console.log(`BoostSide (sans interface) — tableau de bord : http://127.0.0.1:${port}/`);
    console.log(`Données : ${dataDir}`);
  })
  .catch((e) => {
    console.error('Démarrage impossible :', e);
    process.exit(1);
  });

const quit = async () => {
  await core.stop();
  process.exit(0);
};
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
