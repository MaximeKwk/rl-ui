'use strict';
// Coffre des secrets (mots de passe OBS / Streamlabs, connexion Twitch).
// Dans l'application, le chiffrement est fourni par Electron (safeStorage = DPAPI de Windows) :
// les valeurs ne sont lisibles que par ce compte Windows, sur ce PC.
// Sans chiffrement disponible (tests, mode sans interface), les valeurs restent telles quelles.

const PREFIX = 'enc:v1:';

// impl : { encrypt(texte) -> base64, decrypt(base64) -> texte } ou null
function makeVault(impl) {
  return {
    available: !!impl,
    seal(v) {
      if (!impl || typeof v !== 'string' || !v || v.startsWith(PREFIX)) return v;
      try {
        return PREFIX + impl.encrypt(v);
      } catch {
        return v;
      }
    },
    open(v) {
      if (typeof v !== 'string' || !v.startsWith(PREFIX)) return v;
      if (!impl) return ''; // chiffré sur un autre PC / compte : illisible ici
      try {
        return impl.decrypt(v.slice(PREFIX.length));
      } catch {
        return '';
      }
    },
    isSealed: (v) => typeof v === 'string' && v.startsWith(PREFIX),
  };
}

// Réglages qui contiennent des secrets : [section, champ]
const SECRET_SETTINGS = [
  ['obs', 'password'],
  ['obs', 'slToken'],
];

module.exports = { makeVault, SECRET_SETTINGS, PREFIX };
