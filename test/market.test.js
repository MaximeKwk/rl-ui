'use strict';
// Galerie de thèmes de la communauté : un catalogue lu en ligne, des fichiers vérifiés un par un,
// et le même contrôle de format que pour tout thème composé avant la moindre installation.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { Store } = require('../core/store');
const { ThemeManager, walk } = require('../core/themes');
const { Market, cleanEntry, entryFromFiles, review, defaultUrl, allowedUrl, sitePage, CATALOG_FORMAT } = require('../core/market');
const { starter } = require('../core/themeStarters');
const themeFormat = require('../core/themeFormat');
const I = require('../core/i18n');

const tmp = [];
const servers = [];
const stores = [];
test.after(() => {
  stores.forEach((s) => s.flush());
  servers.forEach((s) => s.close());
  tmp.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
});
const tmpDir = (p) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), p));
  tmp.push(d);
  return d;
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const readDir = (dir) => walk(dir).map((rel) => ({ path: rel, data: fs.readFileSync(path.join(dir, rel)) }));
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40)]);

// Sert un dossier en http sur ce PC, comme le ferait le dépôt GitHub. `tamper` permet de modifier une réponse.
function serve(dir, tamper = null) {
  return new Promise((resolve) => {
    const hits = [];
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      hits.push(req.method === 'GET' ? rel : `${req.method} ${rel}`);
      if (req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"ok":true}');
      }
      const f = path.join(dir, rel);
      if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        res.writeHead(404);
        return res.end('nope');
      }
      let data = fs.readFileSync(f);
      if (tamper) data = tamper(rel, data);
      res.writeHead(200, { 'Content-Length': data.length });
      res.end(data);
    });
    servers.push(srv);
    srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}/catalog.json`, hits, close: () => new Promise((r) => srv.close(r)) }));
  });
}

function setup(url, version = '2.0.0') {
  const store = new Store(tmpDir('rlui-mk-data-'));
  stores.push(store);
  store.settings.market.url = url;
  const themes = new ThemeManager({ builtinDir: path.join(__dirname, '..', 'web', 'themes'), userDir: tmpDir('rlui-mk-themes-') });
  return { store, themes, market: new Market({ store, themes, version }) };
}

// Une galerie d'essai : un dossier avec catalog.json et themes/<id>/…
function gallery(themes, patch = (c) => c) {
  const dir = tmpDir('rlui-mk-gal-');
  const entries = [];
  for (const [id, files] of Object.entries(themes)) {
    for (const f of files) {
      const p = path.join(dir, 'themes', id, f.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, f.data);
    }
    entries.push(entryFromFiles(id, files));
  }
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(patch({ format: CATALOG_FORMAT, themes: entries })));
  return dir;
}

const themeJson = (over = {}) =>
  Buffer.from(
    JSON.stringify(
      themeFormat.cleanTheme({
        format: 2,
        name: 'Essai',
        author: 'Moi',
        description: 'Un thème pour les tests.',
        version: '1.0.0',
        counter: { width: 400, height: 100, elements: [{ type: 'value', bind: 'wins', x: 0, y: 0, w: 100, h: 40 }] },
        ...over,
      })
    )
  );

// Une petite galerie comme celle du site : deux thèmes complets, l'un traduit
function siteGallery(patch = (c) => c) {
  const tr = (k) => k;
  return gallery(
    {
      'neon-night': [
        { path: 'theme.json', data: themeJson({ name: 'Neon Night', tags: ['neon', 'dark'], colors: { win: '#3dffd0', loss: '#ff4fa8', ot: '#ffe04d' }, translations: { fr: { name: 'Nuit néon', description: 'Une plaque sombre.' } }, counter: starter('signature', tr) }) },
        { path: 'preview.png', data: PNG },
        { path: 'images/logo.png', data: Buffer.concat([PNG, Buffer.from('logo')]) },
      ],
      arcade: [{ path: 'theme.json', data: themeJson({ name: 'Arcade', tags: ['retro'], counter: starter('bar', tr) }) }, { path: 'preview.png', data: PNG }],
    },
    (c) => patch({ ...c, site: './..', submit: '../publish', installed: 'themes/{id}/installed', themes: c.themes.map((t) => ({ ...t, page: `../theme/${t.id}`, likes: t.id === 'arcade' ? 12 : 3, installs: 40 })) })
  );
}

test('adresses : https seulement (http sur ce PC pour les essais), catalogue officiel selon la version', () => {
  assert.ok(allowedUrl('https://raw.githubusercontent.com/x/y/main/catalog.json'));
  assert.ok(allowedUrl('http://127.0.0.1:8080/catalog.json'));
  assert.ok(!allowedUrl('http://example.com/catalog.json'));
  assert.ok(!allowedUrl('file:///etc/passwd'));
  assert.ok(!allowedUrl('javascript:alert(1)'));
  assert.strictEqual(defaultUrl(), 'https://kydora.net/marketplace/api/catalog.json');
  // une page donnée par le catalogue n'est ouverte que si elle est sur le même site que lui
  const base = 'https://kydora.net/marketplace/api/catalog.json';
  assert.strictEqual(sitePage('../theme/neon', base), 'https://kydora.net/marketplace/theme/neon');
  assert.strictEqual(sitePage('https://kydora.net/marketplace/publish', base), 'https://kydora.net/marketplace/publish');
  assert.strictEqual(sitePage('https://evil.example/login', base), '');
  assert.strictEqual(sitePage('//evil.example/x', base), '');
  assert.strictEqual(sitePage('javascript:alert(1)', base), '');
  assert.strictEqual(sitePage('https://user:pass@kydora.net/x', base), '');
  assert.strictEqual(sitePage('', base), '');
});

test('entrée du catalogue : tout ce qui sort du cadre la fait ignorer', () => {
  const files = [{ path: 'theme.json', data: themeJson() }, { path: 'preview.png', data: PNG }];
  const good = entryFromFiles('essai', files);
  const base = 'https://example.org/gal/catalog.json';
  const ok = cleanEntry(good, base);
  assert.strictEqual(ok.root, 'https://example.org/gal/themes/essai/');
  assert.strictEqual(ok.size, files[0].data.length + PNG.length);
  const bad = (patch) => cleanEntry({ ...good, ...patch }, base);
  assert.strictEqual(bad({ id: '../essai' }), null);
  assert.strictEqual(bad({ id: 'Essai' }), null);
  assert.strictEqual(bad({ path: '../../ailleurs/' }), null);
  assert.strictEqual(bad({ path: 'https://evil.example/t/' }), null);
  assert.strictEqual(bad({ path: '/ailleurs/' }), null);
  assert.strictEqual(bad({ files: [...good.files, { path: 'theme.css', size: 10, sha256: 'a'.repeat(64) }] }), null, 'pas de feuille de style');
  assert.strictEqual(bad({ files: [...good.files, { path: 'run.js', size: 10, sha256: 'a'.repeat(64) }] }), null, 'pas de script');
  assert.strictEqual(bad({ files: [...good.files, { path: '../x.png', size: 10, sha256: 'a'.repeat(64) }] }), null);
  assert.strictEqual(bad({ files: good.files.map((f) => ({ ...f, sha256: 'xyz' })) }), null);
  assert.strictEqual(bad({ files: good.files.filter((f) => f.path !== 'theme.json') }), null, 'pas de thème sans theme.json');
  assert.strictEqual(bad({ files: good.files.map((f) => ({ ...f, size: 50 * 1024 * 1024 })) }), null, 'fichier trop lourd');
  // la page d'un thème ne peut être que sur le site du catalogue ; les textes sont nettoyés et bornés
  assert.strictEqual(bad({ page: 'https://evil.example/login' }).page, '');
  assert.strictEqual(bad({ page: 'https://example.org/gal/theme/essai' }).page, 'https://example.org/gal/theme/essai');
  assert.strictEqual(bad({ likes: -4 }).likes, 0);
  assert.strictEqual(bad({ installs: '1250' }).installs, 1250);
  assert.strictEqual(bad({ name: 'x'.repeat(500) }).name.length, 60);
  assert.deepStrictEqual(bad({ tags: ['neon', 'pas-une-categorie', '<script>'] }).tags, ['neon']);
});

test('contrôle d\'entrée : aperçu obligatoire, vraies images, pas de son, rien hors format', () => {
  const tj = themeJson();
  assert.deepStrictEqual(review([{ path: 'theme.json', data: tj }, { path: 'preview.png', data: PNG }], '2.0.0').problems, []);
  assert.deepStrictEqual(review([{ path: 'theme.json', data: tj }], '2.0.0').problems, ['no-preview']);
  assert.deepStrictEqual(review([{ path: 'preview.png', data: PNG }]).problems, ['theme:no-manifest']);
  assert.deepStrictEqual(review([{ path: 'theme.json', data: Buffer.from('{pas du json') }]).problems, ['theme:unreadable']);
  const fake = review([{ path: 'theme.json', data: tj }, { path: 'preview.png', data: Buffer.from('<svg onload=alert(1)>') }]).problems;
  assert.ok(fake.includes('not-image:preview.png'));
  const snd = review([{ path: 'theme.json', data: tj }, { path: 'preview.png', data: PNG }, { path: 'sounds/win.mp3', data: Buffer.alloc(10) }]).problems;
  assert.deepStrictEqual(snd, ['sound:sounds/win.mp3']);
  const css = review([{ path: 'theme.json', data: tj }, { path: 'preview.png', data: PNG }, { path: 'theme.css', data: Buffer.from('*{}') }]).problems;
  assert.deepStrictEqual(css, ['file:theme.css']);
  // un thème à feuille de style (format 1) n'entre pas
  assert.deepStrictEqual(review([{ path: 'theme.json', data: Buffer.from('{"name":"Vieux"}') }, { path: 'preview.png', data: PNG }]).problems, ['theme:format']);
  // une propriété inconnue glissée dans un élément est signalée
  const raw = JSON.parse(tj);
  raw.counter.elements[0].onclick = 'alert(1)';
  const adj = review([{ path: 'theme.json', data: Buffer.from(JSON.stringify(raw)) }, { path: 'preview.png', data: PNG }]).problems;
  assert.ok(adj.some((p) => p.startsWith('adjusted:')), adj.join());
  // thème prévu pour une version plus récente de l'app
  const newer = review([{ path: 'theme.json', data: themeJson({ minApp: '9.0.0' }) }, { path: 'preview.png', data: PNG }], '2.0.0').problems;
  assert.deepStrictEqual(newer, ['needs-newer-app']);
});

test('parcourir, installer, mettre à jour, favoris (un site de galerie servi en local)', async () => {
  const dir = siteGallery();
  fs.mkdirSync(path.join(dir, 'api'));
  fs.renameSync(path.join(dir, 'catalog.json'), path.join(dir, 'api', 'catalog.json'));
  fs.renameSync(path.join(dir, 'themes'), path.join(dir, 'api', 'themes'));
  const srv = await serve(dir);
  srv.url = srv.url.replace('/catalog.json', '/api/catalog.json');
  const root = srv.url.replace('/api/catalog.json', '');
  const { store, themes, market } = setup(srv.url, '2.0.0-beta.1');
  I.setLang('fr');
  let v = await market.view();
  I.setLang('en');
  assert.ok(v.ok, v.error);
  assert.strictEqual(v.official, false);
  const neon = v.themes.find((t) => t.id === 'neon-night');
  assert.strictEqual(neon.name, 'Nuit néon', 'nom dans la langue de l\'app');
  assert.ok(neon.compatible && neon.hasPreview && !neon.installed && !neon.favorite);
  assert.deepStrictEqual([neon.likes, neon.installs, neon.page], [3, 40, `${root}/theme/neon-night`]);
  assert.deepStrictEqual([v.site, v.submit], [`${root}/`, `${root}/publish`]);
  assert.ok(market.canOpen(`${root}/publish`) && market.canOpen(neon.page) && !market.canOpen(`${root}/admin`));
  assert.ok(!('files' in neon) && !('root' in neon), 'le tableau de bord ne reçoit aucune adresse à contacter');
  // le catalogue est gardé : une seconde lecture ne retourne pas sur le réseau
  await market.view();
  assert.strictEqual(srv.hits.filter((h) => h === 'api/catalog.json').length, 2, 'une lecture par langue, pas plus');

  // aperçu : l'image passe par l'app, vérifiée ; rien d'autre qu'une image ne sort par là
  const img = await market.file('neon-night', 'preview.png');
  assert.strictEqual(img.type, 'image/png');
  assert.strictEqual(sha(img.data), sha(PNG));
  assert.strictEqual(await market.file('neon-night', 'theme.json'), null);
  assert.strictEqual(await market.file('neon-night', '../catalog.json'), null);
  const live = await market.theme('neon-night');
  assert.ok(live.counter.elements.length > 5 && live.colors.win);

  const r = await market.install('neon-night');
  assert.deepStrictEqual([r.id, r.version, r.updated], ['neon-night', '1.0.0', false]);
  const local = themes.get('neon-night');
  assert.ok(local && local.format === 2 && !local.problem && local.hasPreview && local.compose.counter);
  assert.deepStrictEqual(walk(local.dir).sort(), ['images/logo.png', 'preview.png', 'theme.json']);
  // le site est prévenu de l'installation : l'identifiant du thème, et rien d'autre
  await new Promise((r) => setTimeout(r, 80));
  assert.deepStrictEqual(srv.hits.filter((h) => h.startsWith('POST')), ['POST api/themes/neon-night/installed']);
  v = await market.view();
  assert.strictEqual(v.themes.find((t) => t.id === 'neon-night').installed, '1.0.0');
  assert.strictEqual(v.themes.find((t) => t.id === 'neon-night').update, false);

  // une version plus récente dans le catalogue : proposée en mise à jour, installée au même endroit
  store.data.market.installed['neon-night'].version = '0.9.0';
  v = await market.view();
  assert.strictEqual(v.themes.find((t) => t.id === 'neon-night').update, true);
  const again = await market.install('neon-night');
  assert.deepStrictEqual([again.id, again.updated], ['neon-night', true]);
  assert.strictEqual(themes.list().filter((t) => t.id.startsWith('neon-night')).length, 1);
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(srv.hits.filter((h) => h.startsWith('POST')).length, 1, 'une mise à jour ne compte pas comme une installation');

  // favoris : gardés sur ce PC
  market.favorite('arcade', true);
  market.favorite('arcade', true);
  assert.deepStrictEqual(store.data.market.favorites, ['arcade']);
  assert.ok((await market.view()).themes.find((t) => t.id === 'arcade').favorite);
  market.favorite('arcade', false);
  assert.deepStrictEqual(store.data.market.favorites, []);

  // thème supprimé : il redevient « à installer »
  themes.remove('neon-night');
  market.forget('neon-night');
  assert.strictEqual((await market.view()).themes.find((t) => t.id === 'neon-night').installed, null);
});

test('un nom déjà pris ici : le thème de la galerie s\'installe à côté, sans rien écraser', async () => {
  const srv = await serve(siteGallery());
  const { themes, market } = setup(srv.url);
  const mine = themes.create({ name: 'Arcade' });
  assert.strictEqual(mine.id, 'arcade');
  const r = await market.install('arcade');
  assert.strictEqual(r.id, 'arcade-2');
  assert.ok(themes.get('arcade') && themes.get('arcade-2'));
});

test('fichier modifié en route : refusé, rien n\'est installé', async () => {
  const dir = gallery({ essai: [{ path: 'theme.json', data: themeJson() }, { path: 'preview.png', data: PNG }] });
  const srv = await serve(dir, (rel, data) => (rel.endsWith('theme.json') ? Buffer.from(data.toString().replace('Essai', 'Pirat')) : data));
  const { themes, market } = setup(srv.url);
  await assert.rejects(() => market.install('essai'), /theme\.json/);
  assert.strictEqual(themes.list().filter((t) => !t.builtin).length, 0);
  assert.strictEqual(await market.theme('essai'), null, 'pas d\'aperçu en direct non plus');
});

test('thème du catalogue hors format : refusé même si ses empreintes sont bonnes', async () => {
  const raw = JSON.parse(themeJson());
  raw.counter.elements.push({ type: 'value', bind: 'wins', x: 0, y: 0, w: 10, h: 10, style: 'position:fixed', id: 'zz' });
  const dir = gallery({
    piege: [{ path: 'theme.json', data: Buffer.from(JSON.stringify(raw)) }, { path: 'preview.png', data: PNG }],
    fausse: [{ path: 'theme.json', data: themeJson({ name: 'Fausse image' }) }, { path: 'preview.png', data: PNG }, { path: 'images/logo.png', data: Buffer.from('<script>alert(1)</script>') }],
    futur: [{ path: 'theme.json', data: themeJson({ name: 'Futur', minApp: '9.0.0' }) }, { path: 'preview.png', data: PNG }],
  });
  const srv = await serve(dir);
  const { themes, market } = setup(srv.url);
  await assert.rejects(() => market.install('piege'), /adjusted/);
  await assert.rejects(() => market.install('fausse'), /logo\.png/);
  const v = await market.view();
  assert.strictEqual(v.themes.find((t) => t.id === 'futur').compatible, false);
  await assert.rejects(() => market.install('futur'), /9\.0\.0/);
  await assert.rejects(() => market.install('inconnu'));
  assert.strictEqual(themes.list().filter((t) => !t.builtin).length, 0);
});

test('galerie injoignable ou illisible : un message, pas de plantage', async () => {
  const dir = gallery({ essai: [{ path: 'theme.json', data: themeJson() }, { path: 'preview.png', data: PNG }] }, () => ({ format: 99, themes: [] }));
  const srv = await serve(dir);
  let { market } = setup(srv.url);
  let v = await market.view();
  assert.strictEqual(v.ok, false);
  assert.ok(v.error && !/s\.mk\./.test(v.error), v.error);

  ({ market } = setup(srv.url.replace('catalog.json', 'absent.json')));
  v = await market.view();
  assert.strictEqual(v.ok, false);
  assert.match(v.error, /not found/i);

  await srv.close();
  ({ market } = setup(srv.url));
  v = await market.view();
  assert.strictEqual(v.ok, false);
  assert.match(v.error, /unreachable/i);
  assert.deepStrictEqual(v.themes, []);

  ({ market } = setup('http://example.com/catalog.json'));
  v = await market.view();
  assert.match(v.error, /https/);
});

test('catalogue : doublons et entrées inutilisables écartés, les autres gardées', async () => {
  const dir = gallery(
    { un: [{ path: 'theme.json', data: themeJson({ name: 'Un' }) }, { path: 'preview.png', data: PNG }], deux: [{ path: 'theme.json', data: themeJson({ name: 'Deux' }) }] },
    (c) => ({ ...c, submit: 'https://evil.example/phish', themes: [...c.themes, c.themes[0], { id: 'vide' }, null, 'x', { ...c.themes[0], id: 'UN MAJUSCULE' }] })
  );
  const srv = await serve(dir);
  const { market } = setup(srv.url);
  const v = await market.view();
  assert.deepStrictEqual(v.themes.map((t) => t.id), ['un', 'deux']);
  assert.strictEqual(v.submit, '', 'adresse pour publier : une page du site de la galerie, ou rien');
  assert.strictEqual(v.themes[1].hasPreview, false);
  assert.ok(!market.canOpen('https://evil.example/phish'));
});
