'use strict';
// Images du mode caster : logos des deux équipes et photos des joueurs (par pseudo).
// Rangées dans <données>/caster ; l'index (caster.json) garde le nom de fichier de chaque image.

const fs = require('fs');
const path = require('path');

const EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']);
const MAX = 5 * 1024 * 1024;

const keyOf = (name) => String(name || '').trim().toLowerCase().slice(0, 40);
const slug = (s) => keyOf(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'p';

class CasterAssets {
  constructor(dir) {
    this.dir = dir;
    this.indexFile = path.join(dir, 'caster.json');
    this.index = this._load();
  }

  _load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      return { logos: j.logos || {}, photos: j.photos || {} };
    } catch {
      return { logos: {}, photos: {} };
    }
  }

  _save() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.indexFile, JSON.stringify(this.index, null, 2));
  }

  _unlink(name) {
    if (!name) return;
    try {
      fs.unlinkSync(path.join(this.dir, name));
    } catch {}
  }

  // kind : 'logo' (key = 0 | 1) ou 'photo' (key = pseudo du joueur)
  save(kind, key, buf, ext) {
    ext = String(ext || '').toLowerCase().replace('.', '');
    if (!EXT.has(ext)) throw new Error('format');
    if (!buf || !buf.length) throw new Error('empty');
    if (buf.length > MAX) throw new Error('size');
    const map = kind === 'logo' ? this.index.logos : this.index.photos;
    const k = kind === 'logo' ? String(Number(key) === 1 ? 1 : 0) : keyOf(key);
    if (!k) throw new Error('name');
    const name = `${kind}-${kind === 'logo' ? k : slug(k)}-${Date.now().toString(36)}.${ext}`;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, name), buf);
    this._unlink(map[k]);
    map[k] = name;
    this._save();
    return name;
  }

  remove(kind, key) {
    const map = kind === 'logo' ? this.index.logos : this.index.photos;
    const k = kind === 'logo' ? String(Number(key) === 1 ? 1 : 0) : keyOf(key);
    if (!map[k]) return false;
    this._unlink(map[k]);
    delete map[k];
    this._save();
    return true;
  }

  swapLogos() {
    const l = this.index.logos;
    this.index.logos = { 0: l[1], 1: l[0] };
    for (const k of ['0', '1']) if (!this.index.logos[k]) delete this.index.logos[k];
    this._save();
  }

  // chemin d'un fichier servi (seulement ceux de l'index)
  file(name) {
    const all = [...Object.values(this.index.logos), ...Object.values(this.index.photos)];
    return all.includes(name) ? path.join(this.dir, name) : null;
  }

  logoUrl(i) {
    const n = this.index.logos[String(i)];
    return n ? `/caster-assets/${n}` : null;
  }

  photoUrl(playerName) {
    const n = this.index.photos[keyOf(playerName)];
    return n ? `/caster-assets/${n}` : null;
  }

  photos() {
    return Object.entries(this.index.photos).map(([name, file]) => ({ name, url: `/caster-assets/${file}` }));
  }
}

module.exports = { CasterAssets, keyOf };
