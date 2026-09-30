// Connexion temps réel au tracker (overlays et tableau de bord). Reconnexion automatique.
(function () {
  const params = new URLSearchParams(location.search);
  const handlers = {};
  let ws = null;
  let retry = 0;
  let opts = {};

  const OT = {
    params,
    state: null,
    config: null,
    dashboard: null,
    connected: false,
    on(type, fn) {
      (handlers[type] = handlers[type] || []).push(fn);
      return OT;
    },
    emit(type, payload) {
      for (const fn of handlers[type] || []) {
        try {
          fn(payload);
        } catch (e) {
          console.error(e);
        }
      }
    },
    connect(options = {}) {
      opts = options;
      if (options.overlay) document.body.classList.add(`ov-${options.overlay}`);
      open();
      return OT;
    },
  };

  function open() {
    const q = opts.role ? `?role=${opts.role}&key=${encodeURIComponent(opts.key || '')}` : '';
    try {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws${q}`);
    } catch {
      return schedule();
    }
    ws.onopen = () => {
      retry = 0;
      OT.connected = true;
      // les aperçus du tableau de bord ne comptent pas comme des sources OBS
      if (opts.overlay && !params.get('preview')) ws.send(JSON.stringify({ type: 'hello', overlay: opts.overlay }));
      for (const topic of opts.topics || []) ws.send(JSON.stringify({ type: 'sub', topic }));
      OT.emit('open');
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.type === 'state') {
        OT.state = m.state;
        OT.emit('state', m.state);
      } else if (m.type === 'config') {
        OT.config = m.config;
        emitConfig();
      } else if (m.type === 'dashboard') {
        OT.dashboard = m.data;
        OT.emit('dashboard', m.data);
      } else if (m.type === 'caster') {
        OT.caster = m.state;
        OT.emit('caster', m.state);
      } else if (m.type === 'casterEvent') {
        OT.emit('casterEvent', m.event);
      } else if (m.type === 'alert') {
        OT.emit('alert', m.alert);
      }
    };
    ws.onclose = () => {
      if (OT.connected) OT.emit('close');
      OT.connected = false;
      schedule();
    };
    ws.onerror = () => {};
  }

  // ?pack=<id> : force un thème (aperçus du tableau de bord) sans toucher au réglage
  let packOverride = null;
  const forced = params.get('pack');
  if (forced && /^[a-z0-9-]+$/.test(forced)) {
    fetch(`/api/theme/${forced}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((t) => {
        packOverride = t;
        if (OT.config) emitConfig();
      })
      .catch(() => {});
  }

  function emitConfig() {
    const c = OT.config;
    if (!c) return;
    if (packOverride) {
      c.theme = packOverride;
      const col = packOverride.colors || {};
      c.overlay = { ...c.overlay };
      if (col.win) c.overlay.winColor = col.win;
      if (col.loss) c.overlay.lossColor = col.loss;
      if (col.ot) c.overlay.otColor = col.ot;
    }
    if (c.lang) OT.setLang(c.lang);
    applyTheme(c.theme);
    OT.emit('config', c);
  }

  // ---- Langue (anglais par défaut, français en option) : voir /static/shared/i18n.js
  const I = window.I18N || { norm: () => 'en', t: (l, k) => k, tn: (l, k) => k, DICT: { en: {} } };
  OT.lang = I.norm(document.documentElement.lang);
  OT.t = (key, vars) => I.t(OT.lang, key, vars);
  OT.tn = (key, n, vars) => I.tn(OT.lang, key, n, vars);
  // Éléments du HTML : data-i18n (contenu), data-i18n-title, data-i18n-ph (placeholder).
  // L'anglais est dans le HTML : on le garde de côté pour pouvoir y revenir.
  OT.applyI18n = function (root = document) {
    const d = I.DICT[OT.lang] || {};
    for (const el of root.querySelectorAll('[data-i18n]')) {
      if (el.dataset.i18nEn == null) el.dataset.i18nEn = el.innerHTML;
      const v = d[el.dataset.i18n];
      el.innerHTML = v != null ? v : el.dataset.i18nEn;
    }
    for (const [attr, prop] of [
      ['title', 'i18nTitle'],
      ['placeholder', 'i18nPh'],
    ]) {
      for (const el of root.querySelectorAll(`[data-${attr === 'title' ? 'i18n-title' : 'i18n-ph'}]`)) {
        const keep = `${prop}En`;
        if (el.dataset[keep] == null) el.dataset[keep] = el.getAttribute(attr) || '';
        const v = d[el.dataset[prop]];
        el.setAttribute(attr, v != null ? v : el.dataset[keep]);
      }
    }
  };
  OT.setLang = function (lang) {
    const l = I.norm(lang);
    if (l === OT.lang) return;
    OT.lang = l;
    document.documentElement.lang = l;
    OT.applyI18n();
    OT.emit('lang', l);
  };
  if (OT.lang !== 'en') OT.applyI18n();
  if (!/^(en|fr)$/.test(document.documentElement.lang)) document.documentElement.lang = OT.lang;

  // Thème (DA) : feuille de style chargée en dernier, rechargée quand un fichier du thème change
  function applyTheme(t) {
    const id = (t && t.id) || 'classique';
    document.body.className = document.body.className.replace(/\bpack-\S+/g, '').trim();
    document.body.classList.add(`pack-${id}`);
    let link = document.getElementById('rlui-theme');
    const href = (t && t.css) || '';
    if (!href) {
      if (link) link.remove();
      return;
    }
    if (!link) {
      link = document.createElement('link');
      link.id = 'rlui-theme';
      link.rel = 'stylesheet';
    }
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
    document.head.appendChild(link);
  }

  function schedule() {
    setTimeout(open, Math.min(5000, 400 + retry++ * 400));
  }

  // Petits utilitaires partagés
  OT.fmtClock = function (sec, overtime) {
    if (typeof sec !== 'number' || !isFinite(sec)) return '';
    const s = Math.max(0, Math.round(sec));
    const t = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    return overtime ? `+${t}` : t;
  };
  OT.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  };
  function rgb(hex) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.replace(/./g, (c) => c + c);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  // Couleurs du thème -> variables CSS (+ variantes lumineuses/transparentes)
  OT.applyColors = function (o = {}) {
    const root = document.documentElement.style;
    for (const [k, def] of [['win', '#2ef2a0'], ['loss', '#ff4d6d'], ['ot', '#ffb020']]) {
      const c = rgb(OT.params.get(k) ? `#${OT.params.get(k).replace('#', '')}` : o[`${k}Color`]) || rgb(def);
      const light = c.map((v) => Math.round(v + (255 - v) * 0.18));
      root.setProperty(`--${k}`, `rgb(${c.join(',')})`);
      root.setProperty(`--${k}-glow`, `rgba(${c.join(',')},0.45)`);
      root.setProperty(`--${k}-soft`, `rgba(${c.join(',')},0.16)`);
      root.setProperty(`--${k}-light`, `rgb(${light.join(',')})`);
      root.setProperty(`--${k}-rgb`, c.join(','));
    }
  };
  OT.num = function (name, def) {
    const v = params.get(name);
    return v != null && v !== '' && isFinite(Number(v)) ? Number(v) : def;
  };

  window.OT = OT;
})();
