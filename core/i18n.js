'use strict';
// Langue côté serveur (journal, alertes, noms des modes…) : même dictionnaire que les pages.
const I = require('../web/shared/i18n.js');

let lang = 'en';

module.exports = {
  LANGS: I.LANGS,
  setLang(l) {
    lang = I.norm(l);
  },
  getLang: () => lang,
  t: (key, vars) => I.t(lang, key, vars),
  tn: (key, n, vars) => I.tn(lang, key, n, vars),
  tl: (l, key, vars) => I.t(l, key, vars),
};
