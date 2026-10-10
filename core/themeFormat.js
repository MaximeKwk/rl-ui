'use strict';
// Format des thèmes « composés » (format 2) : tout est décrit par des données validées, sans CSS ni script.
// C'est le format de l'éditeur visuel et le seul accepté pour un thème partagé (voir docs/THEME-FORMAT.md).
//
// theme.json :
//   { "format": 2, "name", "author", "version", "description", "tags": […], "minApp": "2.0.0",
//     "colors": { "win", "loss", "ot" },
//     "base": "signature",          // habillage des overlays que le thème ne redessine pas (alertes, récap…)
//     "counter": { "width", "height", "elements": [ … ] } }   // composition du compteur
// Le dossier ne contient à côté que des images (png, jpg, webp, gif), des sons et un aperçu.

const Compose = require('../web/shared/compose.js');

const FORMAT = Compose.FORMAT;
const BASES = ['signature', 'epure', 'contraste'];
const TAGS = ['minimal', 'competitive', 'neon', 'dark', 'light', 'colorful', 'retro', 'esport', 'compact', 'vertical'];
const SEMVER = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const HEX = /^#[0-9a-f]{6}$/i;

// Fichiers permis dans un thème composé : des données et des médias, rien d'autre
const COMPOSED_FILE = /^(theme\.json|preview\.png|images\/[\w\-. ]+\.(png|jpe?g|webp|gif)|sounds\/[\w\-. ]+\.(mp3|wav|ogg)|README\.md|LISEZMOI\.md)$/i;
const IMAGE_FILE = /\.(png|jpe?g|webp|gif)$/i;
const IMAGE_MAGIC = [
  ['png', (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47],
  ['jpg', (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['gif', (b) => b.length > 6 && b.toString('latin1', 0, 3) === 'GIF'],
  ['webp', (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'],
];
// Type réel d'une image, lu dans ses premiers octets (null si ce n'en est pas une)
const imageKind = (buf) => {
  const k = Buffer.isBuffer(buf) ? IMAGE_MAGIC.find(([, test]) => test(buf)) : null;
  return k ? k[0] : null;
};
// Limites d'un thème de la galerie : par fichier, au total, nombre de fichiers
const GALLERY = { file: 2 * 1024 * 1024, total: 8 * 1024 * 1024, files: 24 };

const slug = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'theme';

const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// Compare deux versions « 1.2.3 » : négatif si a < b
function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

// Ramène le contenu d'un theme.json de format 2 à ce que le format permet.
// Lève une erreur (message = code) si ce n'est pas un thème composé utilisable.
function cleanTheme(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('not-an-object');
  if (Number(meta.format) !== FORMAT) throw new Error('format');
  const name = text(meta.name, 60);
  if (!name) throw new Error('name');
  const colors = {};
  for (const k of ['win', 'loss', 'ot']) if (meta.colors && HEX.test(meta.colors[k] || '')) colors[k] = meta.colors[k].toLowerCase();
  const out = {
    format: FORMAT,
    name,
    author: text(meta.author, 60),
    version: SEMVER.test(meta.version || '') ? meta.version : '1.0.0',
    description: text(meta.description, 300),
    tags: Array.isArray(meta.tags) ? [...new Set(meta.tags.filter((t) => TAGS.includes(t)))].slice(0, 5) : [],
    minApp: SEMVER.test(meta.minApp || '') ? meta.minApp : '2.0.0',
    colors,
    base: BASES.includes(meta.base) ? meta.base : 'signature',
    counter: null,
  };
  // nom et description dans d'autres langues : "translations": { "fr": { "name", "description" } }
  const tr = {};
  for (const lang of ['en', 'fr']) {
    const l = meta.translations && meta.translations[lang];
    if (!l || typeof l !== 'object') continue;
    const e = {};
    if (text(l.name, 60)) e.name = text(l.name, 60);
    if (text(l.description, 300)) e.description = text(l.description, 300);
    if (Object.keys(e).length) tr[lang] = e;
  }
  if (Object.keys(tr).length) out.translations = tr;
  if (meta.counter != null) out.counter = Compose.clean(meta.counter);
  return out;
}

// Vérifie un thème avant de le partager : renvoie la liste des problèmes (vide = bon à partager).
// files : chemins relatifs du dossier ; sizes : taille de chaque fichier en octets.
function check(meta, files = [], sizes = {}, appVersion = null) {
  const problems = [];
  let t = null;
  try {
    t = cleanTheme(meta);
  } catch (e) {
    return { ok: false, problems: [`theme:${e.message}`], theme: null };
  }
  if (!t.counter || !t.counter.elements.length) problems.push('empty');
  if (!t.author) problems.push('author');
  if (!t.description) problems.push('description');
  // ce que le fichier contenait et que le format ne garde pas tel quel (propriété inconnue, valeur hors limites,
  // élément d'un type inconnu) : le thème ne s'affichera pas comme son auteur le pense
  const src = (meta.counter && meta.counter.elements) || [];
  if (t.counter) {
    if (src.length !== t.counter.elements.length) problems.push('adjusted:elements');
    else {
      src.forEach((e, i) => {
        for (const k of Object.keys(e || {})) {
          if (JSON.stringify(e[k]) !== JSON.stringify(t.counter.elements[i][k])) problems.push(`adjusted:${t.counter.elements[i].id}.${k}`);
        }
      });
    }
  }
  let total = 0;
  for (const f of files) {
    if (!COMPOSED_FILE.test(f)) problems.push(`file:${f}`);
    total += sizes[f] || 0;
    if ((sizes[f] || 0) > GALLERY.file) problems.push(`big:${f}`);
  }
  if (total > GALLERY.total) problems.push('too-big');
  for (const src of Compose.images(t.counter)) if (!files.includes(src)) problems.push(`missing:${src}`);
  if (appVersion && cmpVersion(appVersion, t.minApp) < 0) problems.push('needs-newer-app');
  return { ok: problems.length === 0, problems, theme: t };
}

// Un thème est-il acceptable dans la galerie ? files : [{ path, data }]. Renvoie { ok, problems, theme }.
// Les règles du format (check), plus celles de la galerie : un aperçu, de vraies images, pas de son.
// C'est le même contrôle partout : dans l'app avant de proposer un thème, sur le site à sa réception,
// et dans l'app encore avant de l'installer.
function review(files, appVersion = null) {
  const manifest = files.find((f) => f.path === 'theme.json');
  if (!manifest) return { ok: false, problems: ['theme:no-manifest'], theme: null };
  let meta;
  try {
    meta = JSON.parse(manifest.data.toString('utf8').replace(/^\ufeff/, ''));
  } catch {
    return { ok: false, problems: ['theme:unreadable'], theme: null };
  }
  const sizes = {};
  for (const f of files) sizes[f.path] = f.data.length;
  const r = check(meta, files.map((f) => f.path), sizes, appVersion);
  const problems = [...r.problems];
  if (!r.theme) return { ok: false, problems, theme: null };
  if (!files.some((f) => f.path === 'preview.png')) problems.push('no-preview');
  if (files.length > GALLERY.files) problems.push('too-many-files');
  for (const f of files) {
    if (IMAGE_FILE.test(f.path) && !imageKind(f.data)) problems.push(`not-image:${f.path}`);
    if (/^sounds\//i.test(f.path)) problems.push(`sound:${f.path}`);
  }
  return { ok: problems.length === 0, problems, theme: r.theme };
}

module.exports = { FORMAT, BASES, TAGS, GALLERY, COMPOSED_FILE, IMAGE_FILE, cleanTheme, check, review, cmpVersion, imageKind, slug };
