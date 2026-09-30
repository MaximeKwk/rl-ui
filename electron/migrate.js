'use strict';
// Reprise des données de l'ancienne version (nom de code "Overtime Tracker") au premier lancement de RL-UI.
const fs = require('fs');
const path = require('path');

function migrateLegacyData(legacyDir, destDir) {
  try {
    if (fs.existsSync(path.join(destDir, 'data.json')) || !fs.existsSync(path.join(legacyDir, 'data.json'))) return false;
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(path.join(legacyDir, 'data.json'), path.join(destDir, 'data.json'));
    if (fs.existsSync(path.join(legacyDir, 'sounds'))) fs.cpSync(path.join(legacyDir, 'sounds'), path.join(destDir, 'sounds'), { recursive: true });
    return true;
  } catch (e) {
    console.error('Migration impossible :', e.message);
    return false;
  }
}

module.exports = { migrateLegacyData };
