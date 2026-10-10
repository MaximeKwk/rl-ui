'use strict';
// Galerie de thèmes de la communauté : le client de l'app.
// Le site de la galerie (kydora.net/marketplace) publie un catalogue : la liste des thèmes composés (format 2 :
// des données et des images, jamais de code) et, pour chacun, ses fichiers avec leur taille et leur empreinte.
// L'app télécharge, vérifie chaque fichier, puis passe le thème par le même contrôle que tout thème composé
// avant de l'installer : elle ne fait pas confiance au site sur parole.
// Ce que l'app envoie : rien pour parcourir ; à l'installation d'un thème, son identifiant (pour le compteur
// d'installations du site). Aucun compte, aucun identifiant de l'utilisateur.

const crypto = require('crypto');
const themeFormat = require('./themeFormat');
const { t: tr, getLang } = require('./i18n');

const { COMPOSED_FILE, IMAGE_FILE, GALLERY, imageKind, slug, review } = themeFormat;
const KINDS = require('../web/shared/compose.js').KINDS;
const CATALOG_FORMAT = 1;
const OFFICIAL = 'https://kydora.net/marketplace/api/catalog.json';
const LIMITS = { catalog: 4 * 1024 * 1024, file: GALLERY.file, total: GALLERY.total, files: GALLERY.files, themes: 2000 };
const CACHE_MS = 10 * 60e3;
const SHA = /^[0-9a-f]{64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const PREVIEW_CACHE = 24 * 1024 * 1024;
const count = (v) => Math.max(0, Math.round(Number(v) || 0));

const defaultUrl = () => OFFICIAL;

// Seules des adresses https sont lues (et http sur ce PC, pour les essais)
function allowedUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || (url.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(url.hostname));
  } catch {
    return false;
  }
}

// Une page que le catalogue donne à ouvrir (page d'un thème, page pour publier) : seulement sur le site du catalogue
function sitePage(u, base) {
  if (!u || typeof u !== 'string') return '';
  try {
    const url = new URL(u, base);
    return allowedUrl(url.href) && url.origin === new URL(base).origin && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

// Ramène une entrée du catalogue à ce que l'app attend. Renvoie null si elle est inutilisable.
function cleanEntry(e, base) {
  if (!e || typeof e !== 'object') return null;
  const id = slug(e.id);
  if (!id || id !== e.id) return null;
  let theme;
  try {
    theme = themeFormat.cleanTheme({ format: themeFormat.FORMAT, name: e.name, author: e.author, version: e.version, description: e.description, tags: e.tags, minApp: e.minApp, translations: e.translations, colors: e.colors });
  } catch {
    return null;
  }
  const dir = String(e.path || `themes/${id}/`);
  if (!/^[\w\-./]+\/$/.test(dir) || dir.includes('..') || dir.startsWith('/')) return null;
  const files = [];
  let total = 0;
  for (const f of Array.isArray(e.files) ? e.files.slice(0, LIMITS.files) : []) {
    if (!f || !COMPOSED_FILE.test(String(f.path)) || !SHA.test(String(f.sha256)) || !(f.size > 0) || f.size > LIMITS.file) return null;
    total += f.size;
    files.push({ path: String(f.path), size: Number(f.size), sha256: String(f.sha256) });
  }
  if (!files.some((f) => f.path === 'theme.json') || total > LIMITS.total) return null;
  const loc = (theme.translations && theme.translations[getLang()]) || {};
  let root;
  try {
    root = new URL(dir, base).href;
    if (new URL(root).origin !== new URL(base).origin) return null;
  } catch {
    return null;
  }
  return {
    id,
    name: loc.name || theme.name,
    author: theme.author,
    version: theme.version,
    description: loc.description || theme.description,
    tags: theme.tags,
    minApp: theme.minApp,
    size: total,
    files,
    root,
    preview: files.some((f) => f.path === 'preview.png') ? `${root}preview.png` : '',
    colors: theme.colors,
    likes: count(e.likes),
    installs: count(e.installs),
    featured: !!e.featured,
    // overlays que le thème dessine lui-même (le compteur toujours ; alertes, dernières parties, récap s'il les compose)
    draws: ['counter', ...(Array.isArray(e.draws) ? KINDS.filter((k) => k !== 'counter' && e.draws.includes(k)) : [])],
    page: sitePage(e.page, base),
    added: DAY.test(e.added || '') ? e.added : '',
    updated: DAY.test(e.updated || '') ? e.updated : '',
  };
}

class Market {
  constructor({ store, themes, version, fetchImpl = null }) {
    this.store = store;
    this.themes = themes;
    this.version = version;
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this._cache = null;
    this._files = new Map(); // images déjà téléchargées pour les aperçus (empreinte -> { data, type })
    this._pending = new Map();
    const d = store.data;
    if (!d.market || typeof d.market !== 'object') d.market = {};
    if (!d.market.installed || typeof d.market.installed !== 'object') d.market.installed = {};
    if (!Array.isArray(d.market.favorites)) d.market.favorites = [];
  }

  // Adresse du catalogue : celle du site officiel, sauf essai (réglage market.url, ou variable RLUI_MARKET au lancement)
  get custom() {
    return (this.store.settings.market && this.store.settings.market.url) || process.env.RLUI_MARKET || '';
  }

  get url() {
    return this.custom || defaultUrl();
  }

  async _get(url, limit, opts = {}) {
    if (!allowedUrl(url)) throw new Error(tr('s.mk.badUrl'));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await this.fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': `RL-UI/${this.version}` }, ...opts });
      if (!r.ok) throw new Error(r.status === 404 ? tr('s.mk.notFound') : tr('s.mk.http', { n: r.status }));
      const len = Number(r.headers.get('content-length')) || 0;
      if (len > limit) throw new Error(tr('s.mk.tooBig'));
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > limit) throw new Error(tr('s.mk.tooBig'));
      return buf;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(tr('s.mk.timeout'));
      if (e.cause || e instanceof TypeError) throw new Error(tr('s.mk.offline'));
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // Lit le catalogue (gardé dix minutes). Renvoie { ok, themes, error }.
  async catalog(force = false) {
    const url = this.url;
    if (!force && this._cache && this._cache.url === url && this._cache.lang === getLang() && Date.now() - this._cache.at < CACHE_MS) return this._cache.data;
    let data;
    try {
      const raw = JSON.parse((await this._get(url, LIMITS.catalog)).toString('utf8').replace(/^﻿/, ''));
      if (!raw || Number(raw.format) !== CATALOG_FORMAT || !Array.isArray(raw.themes)) throw new Error(tr('s.mk.badCatalog'));
      const seen = new Set();
      const themes = [];
      for (const e of raw.themes.slice(0, LIMITS.themes)) {
        const c = cleanEntry(e, url);
        if (!c || seen.has(c.id)) continue;
        seen.add(c.id);
        themes.push(c);
      }
      // adresses que le site donne : son accueil, la page pour publier, et celle qui compte une installation
      const stats = typeof raw.installed === 'string' && raw.installed.includes('{id}') ? sitePage(raw.installed.replace('{id}', '__ID__'), url) : '';
      data = { ok: true, themes, site: sitePage(raw.site, url), submit: sitePage(raw.submit, url), stats, fetchedAt: Date.now() };
    } catch (e) {
      data = { ok: false, themes: [], error: e.message, fetchedAt: Date.now() };
    }
    // (un échec n'est gardé que 30 secondes : on réessaie vite)
    this._cache = { url, lang: getLang(), at: data.ok ? Date.now() : Date.now() - CACHE_MS + 30e3, data };
    return data;
  }

  // Catalogue + ce qu'on en sait ici : installé, à jour, compatible, favori
  async view(force = false) {
    const cat = await this.catalog(force);
    const inst = this.store.data.market.installed;
    const fav = new Set(this.store.data.market.favorites);
    const themes = cat.themes.map(({ files, root, preview, ...e }) => {
      const mine = inst[e.id];
      const local = mine && this.themes.get(mine.theme);
      return {
        ...e,
        hasPreview: !!preview,
        installed: local ? mine.version : null,
        themeId: local ? local.id : null,
        update: !!local && themeFormat.cmpVersion(e.version, mine.version) > 0,
        compatible: themeFormat.cmpVersion(this.version, e.minApp) >= 0,
        favorite: fav.has(e.id),
      };
    });
    let host = '';
    try {
      host = new URL(this.url).host;
    } catch {}
    return { ok: cat.ok, error: cat.error || '', themes, site: cat.site || '', submit: cat.submit || '', host, official: !this.custom, appVersion: this.version, fetchedAt: cat.fetchedAt };
  }

  // Télécharge un thème du catalogue, vérifie chaque fichier (taille, empreinte), contrôle le thème, puis l'installe.
  async install(id) {
    const cat = await this.catalog();
    const e = cat.themes.find((x) => x.id === id);
    if (!e) throw new Error(tr('s.mk.unknown'));
    if (themeFormat.cmpVersion(this.version, e.minApp) < 0) throw new Error(tr('s.mk.needsApp', { v: e.minApp }));
    const files = [];
    for (const f of e.files) {
      const data = await this._get(`${e.root}${f.path.split('/').map(encodeURIComponent).join('/')}`, LIMITS.file);
      if (data.length !== f.size || crypto.createHash('sha256').update(data).digest('hex') !== f.sha256) throw new Error(tr('s.mk.corrupt', { f: f.path }));
      if (IMAGE_FILE.test(f.path) && !imageKind(data)) throw new Error(tr('s.mk.corrupt', { f: f.path }));
      files.push({ path: f.path, data });
    }
    // le même contrôle que celui passé pour entrer dans la galerie : rien hors format, images présentes, pas trop lourd
    const chk = review(files, this.version);
    const blocking = chk.problems.filter((p) => !/^(author|description|no-preview)$/.test(p));
    if (blocking.length) throw new Error(tr('s.mk.rejected', { p: blocking.slice(0, 3).join(', ') }));
    const prev = this.store.data.market.installed[id];
    const kept = prev && this.themes.get(prev.theme);
    const r = this.themes.installFiles(files, { id: kept ? prev.theme : null, wanted: id });
    this.store.data.market.installed[id] = { theme: r.id, version: e.version, at: Date.now() };
    this.store.save();
    // première installation : le site la compte (seul l'identifiant du thème part, sans attendre la réponse)
    if (!kept && cat.stats) this._get(cat.stats.replace('__ID__', encodeURIComponent(id)), 4096, { method: 'POST' }).catch(() => {});
    return { id: r.id, name: e.name, version: e.version, updated: !!kept };
  }

  // Une image d'un thème du catalogue (aperçu, images de la composition), vérifiée comme à l'installation.
  // Le tableau de bord passe par ici : il ne parle jamais lui-même à un autre site.
  async file(id, rel) {
    const cat = await this.catalog();
    const e = cat.themes.find((x) => x.id === id);
    const f = e && e.files.find((x) => x.path === rel && IMAGE_FILE.test(x.path));
    if (!f) return null;
    if (this._files.has(f.sha256)) return this._files.get(f.sha256);
    if (!this._pending.has(f.sha256)) {
      const job = (async () => {
        const data = await this._get(`${e.root}${f.path.split('/').map(encodeURIComponent).join('/')}`, LIMITS.file);
        const kind = imageKind(data);
        if (data.length !== f.size || crypto.createHash('sha256').update(data).digest('hex') !== f.sha256 || !kind) return null;
        const out = { data, type: MIME[kind] };
        this._files.set(f.sha256, out);
        // (les plus anciennes sortent quand la réserve est pleine)
        let total = 0;
        for (const v of this._files.values()) total += v.data.length;
        for (const k of this._files.keys()) {
          if (total <= PREVIEW_CACHE) break;
          total -= this._files.get(k).data.length;
          this._files.delete(k);
        }
        return out;
      })()
        .catch(() => null)
        .finally(() => this._pending.delete(f.sha256));
      this._pending.set(f.sha256, job);
    }
    return this._pending.get(f.sha256);
  }

  // La composition d'un thème du catalogue (pour l'afficher en direct avant de l'installer), vérifiée et nettoyée
  async theme(id) {
    const cat = await this.catalog();
    const e = cat.themes.find((x) => x.id === id);
    const f = e && e.files.find((x) => x.path === 'theme.json');
    if (!f) return null;
    const key = `t:${f.sha256}`;
    if (this._files.has(key)) return this._files.get(key);
    try {
      const data = await this._get(`${e.root}theme.json`, LIMITS.file);
      if (data.length !== f.size || crypto.createHash('sha256').update(data).digest('hex') !== f.sha256) return null;
      const t = themeFormat.cleanTheme(JSON.parse(data.toString('utf8').replace(/^﻿/, '')));
      const compose = Object.fromEntries(KINDS.filter((k) => t[k]).map((k) => [k, t[k]]));
      const out = { id, colors: t.colors, counter: t.counter, compose, images: e.files.filter((x) => /^images\//.test(x.path)).map((x) => x.path), data: Buffer.alloc(0) };
      this._files.set(key, out);
      return out;
    } catch {
      return null;
    }
  }

  // Pages que le catalogue donne à ouvrir dans le navigateur (le site, la page d'un thème, celle pour publier)
  canOpen(url) {
    const d = this._cache && this._cache.data;
    return !!d && !!d.ok && !!url && (d.site === url || d.submit === url || d.themes.some((x) => x.page === url));
  }

  favorite(id, on) {
    const set = new Set(this.store.data.market.favorites);
    if (on) set.add(String(id));
    else set.delete(String(id));
    this.store.data.market.favorites = [...set].slice(-200);
    this.store.save();
    return on;
  }

  // Un thème supprimé n'est plus « installé »
  forget(themeId) {
    const inst = this.store.data.market.installed;
    for (const k of Object.keys(inst)) if (inst[k].theme === themeId) delete inst[k];
    this.store.save();
  }
}

// Entrée de catalogue d'un thème à partir de ses fichiers (le site fabrique les siennes de la même façon)
function entryFromFiles(id, files, extra = {}) {
  const manifest = files.find((f) => f.path === 'theme.json');
  const theme = themeFormat.cleanTheme(JSON.parse(manifest.data.toString('utf8').replace(/^﻿/, '')));
  const today = new Date().toISOString().slice(0, 10);
  return {
    id,
    name: theme.name,
    author: theme.author,
    version: theme.version,
    description: theme.description,
    tags: theme.tags,
    minApp: theme.minApp,
    colors: theme.colors,
    ...(theme.translations ? { translations: theme.translations } : {}),
    added: extra.added || today,
    updated: extra.updated || today,
    likes: extra.likes || 0,
    installs: extra.installs || 0,
    page: extra.page || '',
    draws: KINDS.filter((k) => theme[k]),
    path: extra.path || `themes/${id}/`,
    files: files.map((f) => ({ path: f.path, size: f.data.length, sha256: crypto.createHash('sha256').update(f.data).digest('hex') })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
}

module.exports = { Market, cleanEntry, entryFromFiles, review, defaultUrl, allowedUrl, sitePage, CATALOG_FORMAT, LIMITS, OFFICIAL };
