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
  const allowed = /^(theme\.json|preview\.png|images\/[\w\-. ]+\.(png|jpe?g|webp|gif)|sounds\/[\w\-. ]+\.(mp3|wav|ogg)|README\.md|LISEZMOI\.md)$/i;
  let total = 0;
  for (const f of files) {
    if (!allowed.test(f)) problems.push(`file:${f}`);
    total += sizes[f] || 0;
    if ((sizes[f] || 0) > 2 * 1024 * 1024) problems.push(`big:${f}`);
  }
  if (total > 8 * 1024 * 1024) problems.push('too-big');
  for (const src of Compose.images(t.counter)) if (!files.includes(src)) problems.push(`missing:${src}`);
  if (appVersion && cmpVersion(appVersion, t.minApp) < 0) problems.push('needs-newer-app');
  return { ok: problems.length === 0, problems, theme: t };
}

module.exports = { FORMAT, BASES, TAGS, cleanTheme, check, cmpVersion };
