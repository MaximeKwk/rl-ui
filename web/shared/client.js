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
        OT.emit('config', m.config);
      } else if (m.type === 'dashboard') {
        OT.dashboard = m.data;
        OT.emit('dashboard', m.data);
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
