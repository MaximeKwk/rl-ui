// Le logo RL-UI, partagé par les outils qui fabriquent les icônes (make-icon.js).
// Un cadre dont le coin supérieur droit est coupé, le ballon logé dans la lucarne.
//   letters : « RL » dans le cadre (icône de l'app) ; sans lettres pour les très petites tailles (zone de notification).
// Couleurs de l'interface : turquoise (marque), violet (accent), fond sombre. Sans dégradé ni lueur.
const path = require('path');
const { pathToFileURL } = require('url');

const FONT = pathToFileURL(path.join(__dirname, '..', 'web', 'assets', 'fonts', 'unbounded-latin-wght-normal.woff2')).href;

function logoSvg({ size = 512, letters = true } = {}) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">
  <path d="M27 9H47L91 53V73A18 18 0 0 1 73 91H27A18 18 0 0 1 9 73V27A18 18 0 0 1 27 9Z" fill="#12181b" stroke="#2fd2c6" stroke-width="${letters ? 8 : 10}" stroke-linejoin="round"/>
  <circle cx="85" cy="15" r="13" fill="#a996ff"/>
  ${letters ? '<text x="43" y="61" text-anchor="middle" dominant-baseline="central" font-family="UB" font-weight="700" font-size="29" fill="#2fd2c6">RL</text>' : ''}
</svg>`;
}

// Page autonome (fond transparent) pour capturer le logo en PNG
function logoHtml(opts) {
  return `<!doctype html><html><head><style>
@font-face { font-family: 'UB'; src: url('${FONT}') format('woff2-variations'); font-weight: 200 900; font-style: normal; }
html, body { margin: 0; background: transparent; overflow: hidden; }
svg { display: block; }
</style></head><body>${logoSvg(opts)}</body></html>`;
}

module.exports = { logoSvg, logoHtml };
