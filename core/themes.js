'use strict';
// Thèmes : un dossier avec theme.json + theme.css + images / polices / sons.
// - intégrés : web/themes/<id>   - perso : <données>/themes/<id> (modifiables, rechargés en direct)
// Sécurité : seuls des fichiers "passifs" sont acceptés (aucun script), servis avec une CSP stricte.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { readZip, writeZip } = require('./zip');
const { t: tr, getLang } = require('./i18n');

const ALLOWED = new Set(['.json', '.css', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.woff2', '.woff', '.ttf', '.otf', '.mp3', '.wav', '.ogg', '.md', '.txt']);
const SOUND_TYPES = ['win', 'loss', 'overtime', 'ot_win', 'ot_loss', 'streak'];

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
    return {
      id,
      builtin,
      name: String(loc.name || meta.name || id).slice(0, 60),
      author: String(meta.author || '').slice(0, 60),
      version: String(meta.version || '1.0.0').slice(0, 20),
      description: String(loc.description || meta.description || '').slice(0, 300),
      colors,
      sounds,
      hasCss: files.includes('theme.css'),
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
    // intégrés d'abord, "classique" en tête
    return out.sort((a, b) => (a.id === 'classique' ? -1 : b.id === 'classique' ? 1 : a.builtin === b.builtin ? a.name.localeCompare(b.name) : a.builtin ? -1 : 1));
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
    const files = [];
    const refused = [];
    for (const e of entries) {
      if (!e.name.startsWith(prefix)) continue;
      const rel = safeRel(e.name.slice(prefix.length));
      if (!rel) {
        refused.push(e.name);
        continue;
      }
      files.push({ rel, data: e.data });
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
    fs.writeFileSync(metaFile, `${JSON.stringify({ ...meta, id: newId, name: newName, translations: undefined }, null, 2)}\n`);
    this._changed();
    return { id: newId, dir: dest };
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

module.exports = { ThemeManager, safeRel, slug, SOUND_TYPES };
