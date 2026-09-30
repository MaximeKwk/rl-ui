// Overlay caster (1920x1080, fond transparent) : /overlay/caster
// Options d'URL : ?scale=1 · ?hide=bug,boosts,target,goals,feed,post · ?demo=1 (partie fictive) · ?demo=post (tableau final)
(function () {
  const P = OT.params;
  const esc = OT.esc;
  const t = OT.t;
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement.style;
  if (P.get('preview')) document.body.classList.add('preview');
  const hidden = new Set(String(P.get('hide') || '').split(',').filter(Boolean));

  let S = null; // dernier état reçu
  let lastScores = [null, null];
  let postTimer = null;

  function updateScale() {
    const vs = Math.min(window.innerWidth / 1920, window.innerHeight / 1080) || 1;
    root.setProperty('--s', vs * OT.num('scale', 1));
  }
  window.addEventListener('resize', updateScale);
  updateScale();

  const clock = (sec, ot) => OT.fmtClock(Number(sec) || 0, ot) || (ot ? '+0:00' : '0:00');
  const speed = (kmh) => {
    const mph = S && S.options.speedUnit === 'mph';
    return { v: Math.round(mph ? kmh * 0.621371 : kmh), u: t(mph ? 'c.mph' : 'c.kmh') };
  };
  const pips = (el, need, wins) => {
    const html = Array.from({ length: need }, (_, i) => `<i class="${i < wins ? 'on' : ''}"></i>`).join('');
    if (el.innerHTML !== html) el.innerHTML = html;
  };
  // couleurs d'équipe envoyées par le jeu (couleurs de club comprises)
  function teamColors(teams) {
    const def = ['#1873ff', '#ff7a1a'];
    teams.forEach((tm) => root.setProperty(tm.num === 0 ? '--blue' : '--orange', tm.color && tm.color !== '#' ? brighten(tm.color) : def[tm.num]));
  }
  function brighten(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const c = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    // les couleurs du jeu sont sombres : on les éclaircit un peu pour l'écran
    return `#${c.map((v) => Math.min(255, Math.round(v + (255 - v) * 0.12)).toString(16).padStart(2, '0')).join('')}`;
  }

  // ---------------------------------------------------------------- rendu
  function render(st) {
    S = st;
    if (!st) return;
    const m = st.match;
    const o = st.options;
    const ser = st.series;
    $('root').classList.toggle('on', !!m.active || !!P.get('demo'));
    teamColors(m.teams);

    // scorebug
    $('bug').classList.toggle('hide', hidden.has('bug'));
    for (const tm of m.teams) {
      $(`n${tm.num}`).textContent = tm.name;
      const s = $(`s${tm.num}`);
      if (s.textContent !== String(tm.score)) {
        s.textContent = tm.score;
        if (lastScores[tm.num] != null && tm.score > lastScores[tm.num]) {
          s.classList.remove('pop');
          void s.offsetWidth;
          s.classList.add('pop');
        }
      }
      lastScores[tm.num] = tm.score;
    }
    const ck = $('clock');
    ck.className = `clock${m.overtime ? ' ot' : ''}${m.replay ? ' replay' : ''}`;
    $('clk').textContent = clock(m.time, m.overtime);
    $('clkSub').textContent = m.replay ? t('c.replay') : m.ended ? t('c.final') : m.overtime ? t('c.ot') : '';
    const showSeries = o.showSeries && ser.bestOf > 1;
    $('p0').classList.toggle('hide', !showSeries);
    $('p1').classList.toggle('hide', !showSeries);
    if (showSeries) {
      pips($('p0'), ser.need, ser.wins[0]);
      pips($('p1'), ser.need, ser.wins[1]);
    }
    const bits = [];
    if (ser.title) bits.push(`<span class="ttl">${esc(ser.title)}</span>`);
    if (showSeries) bits.push(esc(`${t('c.game', { n: ser.game })} · ${t('c.bestOf', { n: ser.bestOf })}`));
    $('subTxt').innerHTML = bits.join(' · ');
    $('sub').classList.toggle('hide', !bits.length && !showSeries);

    // boost
    for (const n of [0, 1]) {
      const box = $(`b${n}`);
      box.classList.toggle('hide', !o.showBoosts || hidden.has('boosts'));
      if (!o.showBoosts) continue;
      const list = m.players.filter((p) => p.team === n);
      const sig = list.map((p) => p.key).join('|');
      if (box.dataset.sig !== sig) {
        box.dataset.sig = sig;
        box.innerHTML = list
          .map((p) => `<div class="pl" data-k="${esc(p.key)}"><div class="top"><span class="nm">${esc(p.name)}</span><span class="bv"></span></div><div class="bar"><i></i></div></div>`)
          .join('');
      }
      list.forEach((p, i) => {
        const el = box.children[i];
        el.classList.toggle('tgt', p.key === m.target);
        el.classList.toggle('dead', p.demolished);
        el.classList.toggle('ss', p.supersonic);
        el.querySelector('.bv').innerHTML = p.demolished ? `<span class="dm">${esc(t('c.demolished'))}</span>` : p.boost;
        el.querySelector('.bar i').style.width = `${p.boost}%`;
      });
    }

    // joueur suivi
    const tp = m.target && m.players.find((p) => p.key === m.target);
    const tgt = $('target');
    tgt.classList.toggle('hide', !tp || !o.showTarget || hidden.has('target') || m.replay || m.ended);
    if (tp) {
      tgt.className = `target c${tp.team}${tgt.classList.contains('hide') ? ' hide' : ''}`;
      const C = 2 * Math.PI * 40;
      const stat = (v, k) => `<div><b>${v}</b><i>${esc(t(k))}</i></div>`;
      const team = m.teams[tp.team] ? m.teams[tp.team].name : '';
      const html = `
        <div class="ring"><svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="40"/><circle class="fg" cx="50" cy="50" r="40" stroke-dasharray="${(C * tp.boost) / 100} ${C}"/></svg><b>${tp.boost}</b></div>
        <div class="who"><b>${esc(tp.name)}</b><span>${esc(team)}</span></div>
        <div class="st">${stat(tp.score, 'c.score')}${stat(tp.goals, 'c.goals')}${stat(tp.assists, 'c.assists')}${stat(tp.saves, 'c.saves')}${stat(tp.shots, 'c.shots')}${stat(tp.demos, 'c.demos')}</div>`;
      if (tgt.dataset.html !== html) {
        tgt.dataset.html = html;
        tgt.innerHTML = html;
      }
    }

    // tableau de fin de partie (après un court délai pour laisser voir le but gagnant)
    const wantPost = m.ended && o.showPostgame && !hidden.has('post') && (m.winner === 0 || m.winner === 1);
    if (wantPost && !postTimer && !$('post').classList.contains('show')) {
      postTimer = setTimeout(() => {
        postTimer = null;
        renderPost();
        $('post').classList.add('show');
      }, P.get('demo') === 'post' ? 0 : 2500);
    } else if (!wantPost) {
      clearTimeout(postTimer);
      postTimer = null;
      $('post').classList.remove('show');
    } else if ($('post').classList.contains('show')) {
      renderPost();
    }
  }

  function renderPost() {
    const m = S.match;
    const ser = S.series;
    const w = m.teams[m.winner];
    const done = ser.bestOf > 1 && ser.wins[m.winner] >= ser.need;
    const head = (tm) => `<div class="tm c${tm.num}"><b>${esc(tm.name)}</b>${ser.bestOf > 1 && S.options.showSeries ? `<div class="pips c${tm.num}">${Array.from({ length: ser.need }, (_, i) => `<i class="${i < tm.seriesWins ? 'on' : ''}"></i>`).join('')}</div>` : ''}</div>`;
    const players = [...m.players].sort((a, b) => a.team - b.team || b.score - a.score);
    const best = Math.max(...players.map((p) => p.score), 0);
    const rows = players
      .map(
        (p) =>
          `<tr class="c${p.team}${p.score === best && best > 0 ? ' best' : ''}"><td>${esc(p.name)}${p.key === m.mvp ? `<span class="mvp">MVP</span>` : ''}</td><td>${p.score}</td><td>${p.goals}</td><td>${p.assists}</td><td>${p.saves}</td><td>${p.shots}</td><td>${p.demos}</td></tr>`
      )
      .join('');
    const cols = ['c.score', 'c.goals', 'c.assists', 'c.saves', 'c.shots', 'c.demos'].map((k) => `<th>${esc(t(k))}</th>`).join('');
    const html = `
      <div class="head">${head(m.teams[0])}<div class="fs"><b>${m.teams[0].score} - ${m.teams[1].score}</b><i>${esc(t('c.final'))}${m.overtime ? ` · ${esc(t('c.ot'))}` : ''}</i></div>${head(m.teams[1])}</div>
      <div class="win">${esc(t(done ? 'c.seriesWin' : 'c.wins', { n: w.name }))}</div>
      <table><thead><tr><th></th>${cols}</tr></thead><tbody>${rows}</tbody></table>`;
    if ($('postCard').dataset.html !== html) {
      $('postCard').dataset.html = html;
      $('postCard').innerHTML = html;
    }
  }

  // ---------------------------------------------------------------- événements
  let goalTimer = null;
  function showGoal(e) {
    if (!S || !S.options.showGoals || hidden.has('goals')) return;
    const g = $('goal');
    const sp = speed(e.speed);
    g.className = `goal c${e.team}`;
    g.innerHTML = `<div class="tag">${esc(t('c.goal'))}</div><div class="info"><b>${esc(e.scorer)}</b><span>${e.assister ? esc(t('c.assist', { n: e.assister })) : '&nbsp;'}</span></div>${e.speed > 0 ? `<div class="spd">${sp.v}<small>${esc(sp.u)}</small></div>` : ''}`;
    void g.offsetWidth;
    g.classList.add('show');
    clearTimeout(goalTimer);
    goalTimer = setTimeout(() => g.classList.remove('show'), 5600);
  }

  function showFeed(e) {
    if (!S || !S.options.showFeed || hidden.has('feed')) return;
    const box = $('feed');
    const it = document.createElement('div');
    it.className = `it c${e.team}`;
    it.innerHTML = `<em>${esc(e.label)}</em><span class="p${e.team}">${esc(e.main)}</span>${e.secondary ? ` → <span class="p${e.secondaryTeam}">${esc(e.secondary)}</span>` : ''}`;
    box.appendChild(it);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => it.classList.add('out'), 4200);
    setTimeout(() => it.remove(), 4700);
  }

  OT.on('config', () => S && render(S));
  OT.on('lang', () => S && render(S));
  OT.on('caster', (st) => {
    if (!P.get('demo')) render(st);
  });
  OT.on('casterEvent', (e) => {
    if (P.get('demo')) return;
    if (e.kind === 'goal') showGoal(e);
    else if (e.kind === 'feed') showFeed(e);
  });
  OT.connect({ overlay: 'caster', topics: ['caster'] });

  // ---------------------------------------------------------------- démo (aperçus)
  const demo = P.get('demo');
  if (demo) {
    const names = [['Nova', 'Flick', 'Kuro'], ['Blaze', 'Echo', 'Rift']];
    const mk = (team, name, i) => ({ key: `${team}:${name}`, name, team, boost: 30 + ((i * 37) % 70), speed: 0, supersonic: false, demolished: false, score: 420 - i * 60, goals: 2 - (i % 3), shots: 4 - (i % 2), assists: i % 2, saves: (i + 1) % 3, touches: 20, demos: i % 2 });
    const st = {
      match: {
        active: true,
        time: 187,
        overtime: false,
        replay: false,
        ended: demo === 'post',
        winner: demo === 'post' ? 0 : null,
        mvp: '0:Nova',
        target: '0:Flick',
        teams: [
          { num: 0, name: 'Nova Esports', score: 2, color: '#1873ff', seriesWins: 2 },
          { num: 1, name: 'Apex Rising', score: 1, color: '#e2621a', seriesWins: 1 },
        ],
        players: [...names[0].map((n, i) => mk(0, n, i)), ...names[1].map((n, i) => mk(1, n, i + 3))],
      },
      series: { title: 'RL-UI Cup', bestOf: 5, need: 3, wins: [demo === 'post' ? 3 : 2, 1], game: 4, done: false },
      options: { showSeries: true, showBoosts: true, showTarget: true, showGoals: true, showFeed: true, showPostgame: true, speedUnit: 'kmh' },
    };
    const apply = () => {
      if (OT.caster && OT.caster.options) st.options = { ...OT.caster.options };
      if (OT.caster && OT.caster.series && OT.caster.series.title) st.series.title = OT.caster.series.title;
      render(st);
    };
    OT.on('caster', apply);
    apply();
    if (demo !== 'post') {
      let tick = 0;
      setInterval(() => {
        tick++;
        st.match.time = Math.max(0, st.match.time - 1);
        st.match.players.forEach((p, i) => {
          p.boost = Math.max(0, Math.min(100, p.boost + Math.round(Math.sin(tick / 2 + i) * 18)));
          p.supersonic = p.boost > 80 && i % 2 === 0;
        });
        if (tick % 4 === 0) st.match.target = st.match.players[(tick / 4) % 6].key;
        render(st);
        if (tick % 9 === 3) showGoal({ team: 0, scorer: 'Nova', assister: 'Kuro', speed: 118 });
        if (tick % 6 === 1) showFeed({ label: t('c.demoFeed'), team: 1, main: 'Blaze', secondary: 'Flick', secondaryTeam: 0 });
        if (tick % 6 === 4) showFeed({ label: t('c.epicSave'), team: 0, main: 'Kuro' });
      }, 1000);
    }
  }
})();
