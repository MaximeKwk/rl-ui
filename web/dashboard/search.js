// Recherche du tableau de bord : trouver une page, une fonction ou un réglage sans parcourir les onglets.
// L'index est lu dans la page elle-même (titres, libellés, cartes « ce que RL-UI sait faire ») : rien à tenir à jour à la main.
(function () {
  const R = window.RLUI;
  const { $, $$, esc, t } = R;
  const input = $('#searchInput');
  const list = $('#searchList');
  let items = [];
  let hits = [];
  let at = 0;

  const norm = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  // Texte propre d'un libellé : sans les options de la liste déroulante qu'il contient
  function labelText(el) {
    if (el.tagName !== 'LABEL') return clean(el.textContent);
    const span = el.querySelector(':scope > span');
    if (span) return clean(span.textContent);
    return clean([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
  }

  // Où se trouve un élément : page, volet, carte
  function place(el) {
    const tab = el.closest('.tab');
    if (!tab) return null;
    const name = tab.id.slice(4);
    const nav = $(`.side button[data-tab="${name}"] .lbl`);
    const crumbs = [nav ? clean(nav.textContent) : name];
    let go = name;
    const ov = el.closest('[data-ovpane]');
    const st = el.closest('[data-stpane]');
    const pg = el.closest('[data-pane-of]');
    const paneBtn = ov ? $(`#ovTabs [data-ovtab="${ov.dataset.ovpane}"]`) : st ? $(`#stTabs [data-sttab="${st.dataset.stpane}"]`) : pg ? $(`[data-panes="${pg.dataset.paneOf}"] [data-pane="${pg.dataset.paneId}"]`) : null;
    if (ov) go = `stream/${ov.dataset.ovpane}`;
    else if (st) go = `history/${st.dataset.stpane}`;
    else if (pg) go = `${name}/${pg.dataset.paneId}`;
    if (paneBtn) crumbs.push(clean(paneBtn.textContent));
    const card = el.closest('.card');
    const head = card && card.querySelector('h2, h3');
    if (head && head !== el && !head.contains(el)) crumbs.push(labelText(head).replace(/\s*\?$/, ''));
    return { go, crumb: crumbs.join(' › ') };
  }

  function build() {
    const out = [];
    const seen = new Set();
    const add = (it) => {
      const k = `${it.text}|${it.sub}`;
      if (!it.text || it.text.length < 3 || it.text.length > 90 || seen.has(k)) return;
      seen.add(k);
      it.n = norm(`${it.text} ${it.sub} ${it.kw || ''}`);
      out.push(it);
    };
    $$('.disc-card').forEach((c) => add({ text: clean($('b', c).textContent), sub: clean($('span', c).textContent), go: c.dataset.go, w: 3 }));
    $$('.side button[data-tab]').forEach((b) => add({ text: clean($('.lbl', b).textContent), sub: t('d.search.page'), go: b.dataset.tab, w: 3 }));
    for (const el of $$('main .tab h2, main .tab h3, main .tab label, main .tab summary')) {
      // (une zone masquée parce que la fonction n'existe pas ici n'est pas proposée ; un volet fermé, si)
      const hid = el.closest('.hidden');
      if (hid && !hid.matches('[data-ovpane], [data-stpane], [data-pane-of]')) continue;
      if (el.closest('.page-head')) continue; // (le titre d'une page : la page elle-même est déjà proposée)
      const p = place(el);
      if (!p) continue;
      const text = labelText(el).replace(/\s*\?$/, '');
      add({ text, sub: p.crumb, go: p.go, el, w: /^H/.test(el.tagName) ? 2 : 1 });
    }
    return out;
  }

  function search(q) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return items
      .filter((it) => words.every((w) => it.n.includes(w)))
      .map((it) => ({ it, score: it.w * 10 + (norm(it.text).startsWith(words[0]) ? 6 : 0) + (words.every((w) => norm(it.text).includes(w)) ? 4 : 0) - it.text.length / 100 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.it);
  }

  function render() {
    const q = input.value.trim();
    hits = search(q);
    at = Math.min(at, Math.max(0, hits.length - 1));
    const open = !!q;
    list.classList.toggle('hidden', !open);
    input.setAttribute('aria-expanded', String(open));
    if (!open) return;
    list.innerHTML = hits.length
      ? hits.map((h, i) => `<div class="search-item ${i === at ? 'on' : ''}" role="option" id="sr-${i}" aria-selected="${i === at}" data-i="${i}"><b>${esc(h.text)}</b><span>${esc(h.sub)}</span></div>`).join('')
      : `<div class="search-none">${esc(t('d.search.none', { q }))}</div>`;
    input.setAttribute('aria-activedescendant', hits.length ? `sr-${at}` : '');
  }

  function close() {
    input.value = '';
    list.classList.add('hidden');
    input.setAttribute('aria-expanded', 'false');
  }

  function reveal(h) {
    close();
    input.blur();
    R.go(h.go);
    if (!h.el) return;
    // un réglage rangé dans « plus d'options » : on déplie
    for (let d = h.el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
    const target = h.el.closest('.sw-row, label, .card-head') || h.el;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'center' });
      target.classList.add('found');
      setTimeout(() => target.classList.remove('found'), 2200);
    });
  }

  input.addEventListener('focus', () => {
    items = build();
    render();
  });
  input.addEventListener('input', () => {
    at = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length) at = (at + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
      render();
    } else if (e.key === 'Enter' && hits[at]) {
      e.preventDefault();
      reveal(hits[at]);
    } else if (e.key === 'Escape') {
      close();
      input.blur();
    }
  });
  list.addEventListener('mousedown', (e) => {
    const row = e.target.closest('[data-i]');
    if (!row) return;
    e.preventDefault(); // (garde le champ actif jusqu'au clic)
    reveal(hits[Number(row.dataset.i)]);
  });
  input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 120));
  // Ctrl + K (ou Cmd + K) : aller à la recherche depuis n'importe où
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
})();
