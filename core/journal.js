'use strict';
// Journal de diagnostic : une entrée par partie vue (comptée ou non, et pourquoi).
// Gardé dans data.json pour pouvoir expliquer — et corriger — une partie après un redémarrage.

const MAX = 40; // entrées gardées
const WITH_TRACE = 15; // les plus récentes gardent leur trace technique

class Journal {
  constructor(store) {
    this.store = store;
    if (!Array.isArray(store.data.journal)) store.data.journal = [];
  }

  get list() {
    return this.store.data.journal;
  }

  get(id) {
    return this.list.find((e) => e.id === id) || null;
  }

  // Une partie = une entrée : une nouvelle décision pour la même partie remplace la précédente
  // (identité trouvée après coup, retour dans une partie quittée…).
  add(decision) {
    const list = this.list;
    const i = list.findIndex((e) => e.id === decision.id);
    if (i >= 0) list.splice(i, 1);
    list.push({ ...decision, fixed: null, removedAt: null });
    if (list.length > MAX) list.splice(0, list.length - MAX);
    for (let k = 0; k < list.length - WITH_TRACE; k++) if (list[k].trace && list[k].trace.length) list[k].trace = [];
    this.store.save();
  }

  mark(id, patch) {
    const e = this.get(id);
    if (!e) return null;
    Object.assign(e, patch);
    this.store.save();
    return e;
  }

  // Dernière partie non comptée qui peut encore l'être
  lastSkipped() {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.outcome === 'skipped' && !e.fixed) return e;
      if (e.outcome === 'counted') return null;
    }
    return null;
  }
}

module.exports = { Journal };
