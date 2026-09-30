'use strict';
// Découpe un flux TCP en objets JSON complets.
// La Stats API de Rocket League envoie des objets JSON concaténés sans séparateur,
// et le champ Data est lui-même souvent une chaîne JSON (double encodage).

const { StringDecoder } = require('string_decoder');

const MAX_BUFFER = 8 * 1024 * 1024;

class JsonFramer {
  constructor() {
    this.decoder = new StringDecoder('utf8');
    this.reset();
  }

  reset() {
    this.buf = '';
    this.pos = 0; // prochain caractère à analyser
    this.start = -1; // début de l'objet courant
    this.depth = 0;
    this.inStr = false;
    this.esc = false;
  }

  // Renvoie la liste des objets JSON (texte brut) terminés dans ce chunk.
  push(chunk) {
    this.buf += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    const out = [];
    const s = this.buf;
    for (let i = this.pos; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (this.start < 0) {
        if (c === 123 /* { */) {
          this.start = i;
          this.depth = 1;
          this.inStr = false;
          this.esc = false;
        }
        continue; // ignore espaces, \0, retours ligne, bruit entre objets
      }
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (c === 92 /* \ */) this.esc = true;
        else if (c === 34 /* " */) this.inStr = false;
        continue;
      }
      if (c === 34) this.inStr = true;
      else if (c === 123 || c === 91) this.depth++;
      else if (c === 125 || c === 93) {
        this.depth--;
        if (this.depth === 0) {
          out.push(s.slice(this.start, i + 1));
          this.start = -1;
        }
      }
    }
    // On garde seulement l'objet en cours (ou rien).
    if (this.start >= 0) {
      this.buf = s.slice(this.start);
      this.pos = this.buf.length;
      this.start = 0;
      if (this.buf.length > MAX_BUFFER) this.reset();
    } else {
      this.buf = '';
      this.pos = 0;
    }
    return out;
  }
}

// Normalise une enveloppe { Event, Data } (Data peut être une chaîne JSON ou un objet).
function decodeEnvelope(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const event = obj.Event ?? obj.event;
  if (typeof event !== 'string' || !event) return null;
  let data = obj.Data ?? obj.data ?? {};
  if (typeof data === 'string') {
    try {
      data = data.trim() ? JSON.parse(data) : {};
    } catch {
      data = {};
    }
  }
  if (!data || typeof data !== 'object') data = {};
  return { event, data };
}

module.exports = { JsonFramer, decodeEnvelope };
