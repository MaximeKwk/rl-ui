'use strict';
// Thèmes : un dossier avec theme.json + theme.css + images / polices / sons.
// - intégrés : web/themes/<id>   - perso : <données>/themes/<id> (modifiables, rechargés en direct)
// Sécurité : seuls des fichiers "passifs" sont acceptés (aucun script), servis avec une CSP stricte.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { readZip, writeZip } = require('./zip');
const { t: tr, getLang } = require('./i18n');
const themeFormat = require('./themeFormat');
const { starter, STARTER_IDS } = require('./themeStarters');

const ALLOWED = new Set(['.json', '.css', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.woff2', '.woff', '.ttf', '.otf', '.mp3', '.wav', '.ogg', '.md', '.txt']);
const SOUND_TYPES = ['win', 'loss', 'overtime', 'ot_win', 'ot_loss', 'streak'];
// Thème par défaut, et celui sur lequel on retombe quand le thème choisi n'existe plus
const DEFAULT_THEME = 'signature';
// Thèmes intégrés des versions 1.x, retirés avec la V2 : un réglage qui les désigne revient au thème par défaut
const RETIRED_THEMES = ['classique', 'neon', 'or-noir'];

// Fichiers permis dans un thème composé (format 2) : des données et des médias, rien d'autre
const COMPOSED_FILE = /^(theme\.json|preview\.png|images\/[\w\-. ]+\.(png|jpe?g|webp|gif)|sounds\/[\w\-. ]+\.(mp3|wav|ogg)|README\.md|LISEZMOI\.md)$/i;
const IMAGE_MAGIC = [
  ['png', (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47],
  ['jpg', (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['gif', (b) => b.length > 6 && b.toString('latin1', 0, 3) === 'GIF'],
  ['webp', (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'],
];

const slug = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'theme';

function safeRel(rel) {
  const r = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!r || r.split('/').some((p) => p === '..' || p === '' || p.startsWith('.'))) return null;
  if (!ALLOWED.has(path.extname(r).toLowerCase())) return null;
  return r;
}

function walk(dir, base = dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}

class ThemeManager extends EventEmitter {
  constructor({ builtinDir, userDir }) {
    super();
    this.builtinDir = builtinDir;
    this.userDir = userDir;
    this._watcher = null;
    this._timer = null;
  }

  _meta(dir, id, builtin) {
    let meta = {};
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, 'theme.json'), 'utf8').replace(/^﻿/, ''));
    } catch {
      return null;
    }
    const files = walk(dir);
    const sounds = {};
    for (const t of SOUND_TYPES) {
      const rel = safeRel(meta.sounds && meta.sounds[t]);
      if (rel && files.includes(rel)) sounds[t] = rel;
    }
    // traductions facultatives : "translations": { "fr": { "name": …, "description": … } }
    const loc = (meta.translations && meta.translations[getLang()]) || {};
    const colors = {};
    for (const k of ['win', 'loss', 'ot']) {
      if (meta.colors && /^#[0-9a-f]{6}$/i.test(meta.colors[k] || '')) colors[k] = meta.colors[k];
    }
    // thème composé (format 2, celui de l'éditeur) : décrit par des données validées, sans feuille de style
    const isComposed = Number(meta.format) === themeFormat.FORMAT;
    let composed = null;
    let problem = '';
    if (isComposed) {
      try {
        composed = themeFormat.cleanTheme(meta);
      } catch (e) {
        problem = e.message;
      }
    }
    return {
      format: isComposed ? themeFormat.FORMAT : 1,
      problem,
      base: composed ? composed.base : null,
      tags: composed ? composed.tags : [],
      minApp: composed ? composed.minApp : null,
      compose: composed && composed.counter ? { counter: composed.counter } : null,
      editable: !builtin && !!composed,
      id,
      builtin,
      name: String(loc.name || meta.name || id).slice(0, 60),
      author: String(meta.author || '').slice(0, 60),
      version: String(meta.version || '1.0.0').slice(0, 20),
      description: String(loc.description || meta.description || '').slice(0, 300),
      colors,
      sounds,
      hasCss: !isComposed && files.includes('theme.css'),
      hasPreview: files.includes('preview.png'),
      dir,
    };
  }

  list() {
    const out = [];
    for (const [root, builtin] of [
      [this.builtinDir, true],
      [this.userDir, false],
    ]) {
      let dirs = [];
      try {
        dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
      } catch {}
      for (const d of dirs) {
        const m = this._meta(path.join(root, d.name), d.name, builtin);
        if (m && !(builtin === false && out.some((t) => t.id === m.id))) out.push(m);
      }
    }
    // intégrés d'abord, le thème par défaut en tête
    return out.sort((a, b) => (a.id === DEFAULT_THEME ? -1 : b.id === DEFAULT_THEME ? 1 : a.builtin === b.builtin ? a.name.localeCompare(b.name) : a.builtin ? -1 : 1));
  }

  get(id) {
    return this.list().find((t) => t.id === id) || null;
  }

  // Chemin d'un fichier du thème (null si interdit)
  file(id, rel) {
    const t = this.get(id);
    const r = safeRel(rel);
    if (!t || !r) return null;
    const f = path.resolve(t.dir, r);
    return f.startsWith(path.resolve(t.dir) + path.sep) && fs.existsSync(f) ? f : null;
  }

  // Numéro de version pour forcer le rechargement quand un fichier change
  stamp(id) {
    const t = this.get(id);
    if (!t) return 0;
    return walk(t.dir).reduce((m, rel) => {
      try {
        return Math.max(m, fs.statSync(path.join(t.dir, rel)).mtimeMs);
      } catch {
        return m;
      }
    }, 0);
  }

  _freeId(base) {
    let id = slug(base);
    const taken = new Set(this.list().map((t) => t.id));
    if (!taken.has(id)) return id;
    for (let i = 2; ; i++) if (!taken.has(`${id}-${i}`)) return `${id}-${i}`;
  }

  // Installe un thème depuis un .zip (remplace un thème perso du même nom)
  install(buffer) {
    const entries = readZip(buffer);
    const manifest = entries.find((e) => /(^|\/)theme\.json$/i.test(e.name));
    if (!manifest) throw new Error(tr('s.zipNoManifest'));
    const prefix = manifest.name.slice(0, manifest.name.length - 'theme.json'.length);
    let meta;
    try {
      meta = JSON.parse(manifest.data.toString('utf8').replace(/^﻿/, ''));
    } catch {
      throw new Error(tr('s.zipBadManifest'));
    }
    const wanted = slug(meta.id || meta.name);
    const existing = this.get(wanted);
    const id = existing && !existing.builtin ? wanted : this._freeId(meta.id || meta.name);
    const dest = path.join(this.userDir, id);
    // thème composé : son contenu est ramené au format (rien d'autre que des données et des médias)
    const composed = Number(meta.format) === themeFormat.FORMAT;
    let cleaned = null;
    if (composed) {
      try {
        cleaned = themeFormat.cleanTheme(meta);
      } catch {
        throw new Error(tr('s.zipBadManifest'));
      }
    }
    const files = [];
    const refused = [];
    for (const e of entries) {
      if (!e.name.startsWith(prefix)) continue;
      const rel = safeRel(e.name.slice(prefix.length));
      if (!rel || (composed && !COMPOSED_FILE.test(rel))) {
        refused.push(e.name);
        continue;
      }
      files.push({ rel, data: rel === 'theme.json' && cleaned ? Buffer.from(`${JSON.stringify({ id, ...cleaned }, null, 2)}\n`) : e.data });
    }
    fs.rmSync(dest, { recursive: true, force: true });
    for (const f of files) {
      const p = path.join(dest, f.rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, f.data);
    }
    this._changed();
    return { id, name: String(meta.name || id), files: files.length, refused };
  }

  // Copie un thème dans les thèmes perso pour le modifier
  duplicate(id, name) {
    const src = this.get(id);
    if (!src) throw new Error(tr('s.themeMissing'));
    const newName = String(name || `${src.name} (perso)`).slice(0, 60);
    const newId = this._freeId(newName);
    const dest = path.join(this.userDir, newId);
    for (const rel of walk(src.dir)) {
      if (!safeRel(rel)) continue;
      const p = path.join(dest, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.copyFileSync(path.join(src.dir, rel), p);
    }
    const metaFile = path.join(dest, 'theme.json');
    let meta = {};
    try {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf8').replace(/^﻿/, ''));
    } catch {}
    // (une copie repart en 1.0.0 : c'est un nouveau thème)
    fs.writeFileSync(metaFile, `${JSON.stringify({ ...meta, id: newId, name: newName, translations: undefined, ...(Number(meta.format) === themeFormat.FORMAT ? { version: '1.0.0' } : {}) }, null, 2)}\n`);
    this._changed();
    return { id: newId, dir: dest };
  }

  // ---------------------------------------------------------------- thèmes composés (éditeur visuel)
  _userTheme(id) {
    const t = this.get(id);
    if (!t) throw new Error(tr('s.themeMissing'));
    if (t.builtin) throw new Error(tr('s.themeBuiltin'));
    return t;
  }

  _readMeta(t) {
    try {
      return JSON.parse(fs.readFileSync(path.join(t.dir, 'theme.json'), 'utf8').replace(/^\ufeff/, ''));
    } catch {
      return {};
    }
  }

  // Nouveau thème composé, à partir d'un point de départ (signature, bar, vertical, blank)
  create({ name, kind = 'signature', author = '' } = {}) {
    const label = String(name || '').trim().slice(0, 60) || tr('cmp.newName');
    const id = this._freeId(label);
    const dir = path.join(this.userDir, id);
    const theme = themeFormat.cleanTheme({
      format: themeFormat.FORMAT,
      name: label,
      author,
      version: '1.0.0',
      colors: { win: '#8bd95a', loss: '#f2685f', ot: '#f0b03f' },
      base: 'signature',
      counter: starter(STARTER_IDS.includes(kind) ? kind : 'signature', tr),
    });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'theme.json'), `${JSON.stringify({ id, ...theme }, null, 2)}\n`);
    this._changed();
    return { id, dir };
  }

  // Contenu d'un thème composé, tel que l'éditeur le lit
  source(id) {
    const t = this.get(id);
    if (!t) throw new Error(tr('s.themeMissing'));
    if (t.format !== themeFormat.FORMAT || t.problem) throw new Error(tr('s.themeNotComposed'));
    const theme = themeFormat.cleanTheme(this._readMeta(t));
    const images = walk(t.dir).filter((f) => /^images\//.test(f) && COMPOSED_FILE.test(f));
    return { id: t.id, builtin: t.builtin, theme, images };
  }

  // Enregistre un thème composé (thèmes perso seulement) ; les images qui ne servent plus sont retirées
  saveSource(id, data) {
    const t = this._userTheme(id);
    if (t.format !== themeFormat.FORMAT) throw new Error(tr('s.themeNotComposed'));
    const theme = themeFormat.cleanTheme({ ...(data || {}), format: themeFormat.FORMAT });
    const used = new Set(theme.counter ? require('../web/shared/compose.js').images(theme.counter) : []);
    for (const f of walk(t.dir)) {
      if (/^images\//.test(f) && !used.has(f)) {
        try {
          fs.unlinkSync(path.join(t.dir, f));
        } catch {}
      }
    }
    fs.writeFileSync(path.join(t.dir, 'theme.json'), `${JSON.stringify({ id: t.id, ...theme }, null, 2)}\n`);
    this._changed();
    return { id: t.id, theme };
  }

  // Ajoute une image au dossier d'un thème composé. Le type est lu dans le fichier lui-même, pas dans son nom.
  saveImage(id, buf, name) {
    const t = this._userTheme(id);
    if (!Buffer.isBuffer(buf) || !buf.length) throw new Error(tr('s.emptyFile'));
    if (buf.length > 2 * 1024 * 1024) throw new Error(tr('s.imageTooBig'));
    const kind = IMAGE_MAGIC.find(([, test]) => test(buf));
    if (!kind) throw new Error(tr('s.imageFormats'));
    const base = slug(String(name || 'image').replace(/\.[^.]+$/, ''));
    let rel = `images/${base}.${kind[0]}`;
    for (let i = 2; fs.existsSync(path.join(t.dir, rel)); i++) rel = `images/${base}-${i}.${kind[0]}`;
    fs.mkdirSync(path.join(t.dir, 'images'), { recursive: true });
    fs.writeFileSync(path.join(t.dir, rel), buf);
    return { src: rel };
  }

  // Aperçu du thème (image fabriquée par l'éditeur à l'enregistrement)
  savePreview(id, buf) {
    const t = this._userTheme(id);
    if (!Buffer.isBuffer(buf) || buf.length > 1024 * 1024 || !IMAGE_MAGIC[0][1](buf)) throw new Error(tr('s.imageFormats'));
    fs.writeFileSync(path.join(t.dir, 'preview.png'), buf);
    this._changed();
    return { ok: true };
  }

  // Le thème est-il prêt à être partagé ? Liste des problèmes (vide = oui).
  check(id, appVersion = null) {
    const t = this.get(id);
    if (!t) throw new Error(tr('s.themeMissing'));
    const files = walk(t.dir);
    const sizes = {};
    for (const f of files) {
      try {
        sizes[f] = fs.statSync(path.join(t.dir, f)).size;
      } catch {}
    }
    return themeFormat.check(this._readMeta(t), files, sizes, appVersion);
  }

  exportZip(id) {
    const t = this.get(id);
    if (!t) throw new Error(tr('s.themeMissing'));
    const files = walk(t.dir)
      .filter((rel) => safeRel(rel))
      .map((rel) => ({ name: `${t.id}/${rel}`, data: fs.readFileSync(path.join(t.dir, rel)) }));
    return { name: `${t.id}.zip`, data: writeZip(files) };
  }

  remove(id) {
    const t = this.get(id);
    if (!t || t.builtin) return false;
    fs.rmSync(t.dir, { recursive: true, force: true });
    this._changed();
    return true;
  }

  // Surveille les thèmes perso : chaque modification recharge les overlays
  watch() {
    fs.mkdirSync(this.userDir, { recursive: true });
    try {
      this._watcher = fs.watch(this.userDir, { recursive: true }, () => this._changed());
    } catch {}
  }

  stop() {
    if (this._watcher) this._watcher.close();
    this._watcher = null;
  }

  _changed() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.emit('changed'), 250);
  }
}

module.exports = { ThemeManager, safeRel, slug, SOUND_TYPES, DEFAULT_THEME, RETIRED_THEMES };
