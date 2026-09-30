'use strict';
// Localisation de Rocket League (Steam / Epic) et configuration de la Stats API officielle
// (TAGame\Config\DefaultStatsAPI.ini dans le dossier du jeu, TAStatsAPI.ini dans Documents).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const SECTION = 'TAGame.MatchStatsExporter_TA';
const DEFAULTS = { Port: 49123, WebPort: 49124, PacketSendRate: 1 };

function exec(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

async function steamLibraries() {
  const libs = new Set();
  const out = await exec('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']);
  const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(out);
  const roots = [m && m[1].trim(), 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].filter(Boolean);
  for (const root of roots) {
    const base = path.normalize(root);
    libs.add(base);
    try {
      const vdf = fs.readFileSync(path.join(base, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const mm of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(path.normalize(mm[1].replace(/\\\\/g, '\\')));
    } catch {}
  }
  return [...libs];
}

function epicInstalls() {
  const dir = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
  const found = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.item')) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (/rocket\s*league/i.test(j.DisplayName || '') || j.AppName === 'Sugar') found.push(j.InstallLocation);
      } catch {}
    }
  } catch {}
  return found;
}

// Renvoie les dossiers d'installation trouvés [{ dir, platform }]
async function findInstalls() {
  const res = [];
  const seen = new Set();
  const add = (dir, platform) => {
    if (!dir) return;
    const d = path.normalize(dir);
    const key = d.toLowerCase();
    if (seen.has(key)) return;
    if (fs.existsSync(path.join(d, 'TAGame', 'Config'))) {
      seen.add(key);
      res.push({ dir: d, platform });
    }
  };
  for (const lib of await steamLibraries()) add(path.join(lib, 'steamapps', 'common', 'rocketleague'), 'Steam');
  for (const d of epicInstalls()) add(d, 'Epic');
  add('C:\\Program Files\\Epic Games\\rocketleague', 'Epic');
  return res;
}

// ---- INI minimaliste qui préserve commentaires et autres sections
function parseIni(text) {
  const out = {};
  let sec = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const s = /^\[(.+)\]$/.exec(line);
    if (s) {
      sec = s[1].trim();
      out[sec] = out[sec] || {};
      continue;
    }
    const kv = /^([^=]+)=(.*)$/.exec(line);
    if (kv && sec) out[sec][kv[1].trim()] = kv[2].trim();
  }
  return out;
}

function setIniValues(text, section, values) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text ? String(text).split(/\r?\n/) : [];
  let start = lines.findIndex((l) => l.trim() === `[${section}]`);
  if (start < 0) {
    const block = [`[${section}]`, ...Object.entries(values).map(([k, v]) => `${k}=${v}`), ''];
    return [...block, ...lines].join(eol);
  }
  let end = lines.findIndex((l, i) => i > start && /^\s*\[.+\]\s*$/.test(l));
  if (end < 0) end = lines.length;
  const pending = new Map(Object.entries(values));
  for (let i = start + 1; i < end; i++) {
    const kv = /^\s*([^=;#]+?)\s*=/.exec(lines[i]);
    if (kv && pending.has(kv[1])) {
      lines[i] = `${kv[1]}=${pending.get(kv[1])}`;
      pending.delete(kv[1]);
    }
  }
  if (pending.size) {
    // on insère après la dernière ligne non vide de la section
    let at = end;
    while (at > start + 1 && !lines[at - 1].trim()) at--;
    lines.splice(at, 0, ...[...pending].map(([k, v]) => `${k}=${v}`));
  }
  return lines.join(eol);
}

function readStatsIni(file) {
  try {
    const ini = parseIni(fs.readFileSync(file, 'latin1'));
    const s = ini[SECTION];
    if (!s) return { file, exists: true, section: false };
    const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
    return { file, exists: true, section: true, Port: num(s.Port), WebPort: num(s.WebPort), PacketSendRate: num(s.PacketSendRate) };
  } catch {
    return { file, exists: false };
  }
}

function userConfigDir(documentsDir) {
  return path.join(documentsDir, 'My Games', 'Rocket League', 'TAGame', 'Config');
}

// État de la configuration Stats API
async function getStatsConfig(documentsDir) {
  const installs = await findInstalls();
  const user = readStatsIni(path.join(userConfigDir(documentsDir), 'TAStatsAPI.ini'));
  const defaults = installs.map((i) => ({ ...readStatsIni(path.join(i.dir, 'TAGame', 'Config', 'DefaultStatsAPI.ini')), platform: i.platform }));
  // Le fichier utilisateur (généré par le jeu) a priorité, sinon DefaultStatsAPI.ini
  const src = [user, ...defaults].find((c) => c.exists && c.section) || null;
  const pick = (k) => (src && Number.isFinite(src[k]) ? src[k] : DEFAULTS[k]);
  const effective = { Port: pick('Port'), WebPort: pick('WebPort'), PacketSendRate: pick('PacketSendRate') };
  return {
    installs,
    user,
    defaults,
    effective,
    enabled: !!src && effective.PacketSendRate > 0,
    known: !!src,
  };
}

function writeFileKeepingEncoding(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'latin1');
}

// Active la Stats API (PacketSendRate > 0) dans tous les fichiers trouvés.
// Le TAStatsAPI.ini de Documents n'est créé que si aucun fichier du jeu n'a pu être modifié.
// force = remplace aussi une fréquence déjà réglée (mode caster : barres de boost fluides)
async function enableStatsApi(documentsDir, { rate = 10, force = false } = {}) {
  const cfg = await getStatsConfig(documentsDir);
  const results = [];
  const targets = [...cfg.defaults.filter((d) => d.exists).map((d) => d.file)];
  if (cfg.user.exists) targets.push(cfg.user.file);
  for (const file of targets) {
    results.push(writeStatsValues(file, rate, force));
  }
  if (!results.some((r) => r.ok)) results.push(writeStatsValues(cfg.user.file, rate, force));
  return { results, config: await getStatsConfig(documentsDir) };
}

function writeStatsValues(file, rate, force = false) {
  const cur = readStatsIni(file);
  const values = {
    Port: Number.isFinite(cur.Port) && cur.Port > 0 ? cur.Port : DEFAULTS.Port,
    WebPort: Number.isFinite(cur.WebPort) && cur.WebPort > 0 ? cur.WebPort : DEFAULTS.WebPort,
    PacketSendRate: !force && Number.isFinite(cur.PacketSendRate) && cur.PacketSendRate > 0 ? cur.PacketSendRate : rate,
  };
  try {
    let text = '';
    try {
      text = fs.readFileSync(file, 'latin1');
    } catch {}
    writeFileKeepingEncoding(file, setIniValues(text, SECTION, values));
    return { file, ok: true };
  } catch (e) {
    return { file, ok: false, error: e.code || e.message, needsAdmin: e.code === 'EPERM' || e.code === 'EACCES' };
  }
}

// Écriture avec élévation (UAC) si le dossier du jeu est protégé
function writeElevated(file, text) {
  return new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), `rl-ui-statsapi-${Date.now()}.ini`);
    fs.writeFileSync(tmp, text, 'latin1');
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const inner = `Copy-Item -LiteralPath ${q(tmp)} -Destination ${q(file)} -Force`;
    const encoded = Buffer.from(inner, 'utf16le').toString('base64');
    const cmd = `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`;
    execFile('powershell', ['-NoProfile', '-Command', cmd], { windowsHide: true }, (err) => {
      try {
        fs.unlinkSync(tmp);
      } catch {}
      resolve(!err);
    });
  });
}

async function enableStatsApiElevated(documentsDir, { rate = 10, force = false } = {}) {
  const cfg = await getStatsConfig(documentsDir);
  for (const d of cfg.defaults) {
    if (!d.exists) continue;
    const text = fs.readFileSync(d.file, 'latin1');
    const values = {
      Port: d.Port > 0 ? d.Port : DEFAULTS.Port,
      WebPort: d.WebPort > 0 ? d.WebPort : DEFAULTS.WebPort,
      PacketSendRate: !force && d.PacketSendRate > 0 ? d.PacketSendRate : rate,
    };
    await writeElevated(d.file, setIniValues(text, SECTION, values));
  }
  return getStatsConfig(documentsDir);
}

// Rocket League est-il lancé ?
async function isRocketLeagueRunning() {
  if (process.platform !== 'win32') return false;
  const out = await exec('tasklist', ['/FI', 'IMAGENAME eq RocketLeague.exe', '/FO', 'CSV', '/NH']);
  return /rocketleague\.exe/i.test(out);
}

module.exports = {
  findInstalls,
  getStatsConfig,
  enableStatsApi,
  enableStatsApiElevated,
  isRocketLeagueRunning,
  parseIni,
  setIniValues,
  readStatsIni,
  userConfigDir,
  SECTION,
  DEFAULTS,
};
