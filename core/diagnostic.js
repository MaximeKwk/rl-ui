'use strict';
// Diagnostic : bilan de santé de la détection, journal des parties en clair et rapport à copier.
// Tout est calculé ici (dans la langue choisie) pour que le tableau de bord et le rapport disent la même chose.

const os = require('os');
const { describePlaylist, categoryLabels } = require('./playlists');
const i18n = require('./i18n');

const { t: tr, tn } = i18n;

const locale = () => (i18n.getLang() === 'fr' ? 'fr-FR' : 'en-US');

// « 14:07 » aujourd'hui, « 08/10 14:07 » sinon
function when(at, now = Date.now()) {
  if (!at) return '';
  const d = new Date(at);
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay ? time : `${d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' })} ${time}`;
}

const modeName = (e) => describePlaylist(e.playlistId, e.online).name;

// Score vu de mon côté quand mon équipe est connue, sinon bleu - orange
function scoreOf(e, team = e.myTeam) {
  if (!Array.isArray(e.score)) return '';
  return team === 0 || team === 1 ? `${e.score[team]}-${e.score[1 - team]}` : `${e.score[0]}-${e.score[1]}`;
}

// ---------------------------------------------------------------- bilan de santé
// level : ok | warn | bad | idle (rien à signaler, en attente)
function checks(core) {
  const s = core.store.settings;
  const api = core.stats.status;
  const lw = core.logWatcher;
  const cfg = core.rlConfig;
  const out = [];
  const add = (id, level, detail, fix = null) => out.push({ id, level, title: tr(`s.dg.t.${id}`), detail, fix });

  add('game', core.rlRunning || api.state === 'live' ? 'ok' : 'idle', tr(core.rlRunning || api.state === 'live' ? 's.dg.gameOn' : 's.dg.gameOff'));

  if (api.state === 'live') add('api', 'ok', tr('s.dg.apiLive', { k: api.transport === 'ws' ? 'WebSocket' : 'TCP' }));
  else if (api.state === 'waiting') add('api', 'ok', tr('s.dg.apiWaiting'));
  else if (api.state === 'off') add('api', 'idle', tr('s.dg.apiStopped'));
  else if (cfg && cfg.known && !cfg.enabled) add('api', 'bad', tr(core.rlRunning ? 's.dg.apiOffRunning' : 's.dg.apiOff'), 'enable-api');
  else if (core.rlRunning) add('api', 'warn', tr('s.dg.apiUnreachable', { p: api.tcpPort }), 'enable-api');
  else if (cfg && !cfg.known) add('api', 'warn', tr('s.dg.apiNoCfg'), 'enable-api');
  else add('api', 'idle', tr('s.dg.apiIdle'));

  if (lw.exists) add('log', 'ok', tr('s.dg.logOk', { t: when(lw.lastWriteAt) }));
  else add('log', 'bad', tr('s.dg.logMissing'));

  const names = s.identity.names.filter(Boolean);
  if (lw.account) add('account', 'ok', tr('s.dg.accountOk', { n: lw.account.name, p: lw.account.platform }));
  else if (names.length) add('account', 'warn', tr('s.dg.accountNames', { n: names.join(', ') }));
  else add('account', lw.exists && !core.rlRunning ? 'idle' : 'warn', tr(lw.exists ? 's.dg.accountWait' : 's.dg.accountNone'), lw.exists ? null : 'identity');

  const labels = categoryLabels();
  const cats = ['ranked', 'casual', 'extra', 'tournament', 'private', 'offline'];
  const on = cats.filter((c) => s.counting[c] !== false).map((c) => labels[c]);
  const off = cats.filter((c) => s.counting[c] === false).map((c) => labels[c]);
  if (s.paused) add('counting', 'warn', tr('s.dg.paused'), 'resume');
  else {
    const left = tr(`s.dg.left.${['always', 'ranked', 'never'].includes(s.abandonAsLoss) ? s.abandonAsLoss : 'ranked'}`);
    add('counting', on.length ? 'ok' : 'warn', `${tr('s.dg.counted', { on: on.join(', ') || '—' })}${off.length ? ` ${tr('s.dg.ignored', { off: off.join(', ') })}` : ''} ${left}`, 'counting');
  }

  if (!s.mmr.enabled) add('mmr', 'idle', tr('s.dg.mmrOff'));
  else {
    // la dernière vraie valeur lue, de préférence dans un mode dont le MMR est suivi
    const all = core.mmr.known(lw.account && lw.account.id);
    const known = all.find((k) => core.mmr.tracks(k.playlist)) || all[0];
    const search = lw.lastSearch;
    if (search && !search.ok && (!known || search.at > known.at)) {
      add('mmr', 'warn', tr(`s.dg.mmrSkip.${search.why === 'multi' || search.why === 'no-account' ? search.why : 'other'}`, { t: when(search.at) }));
    } else if (known) add('mmr', 'ok', tr('s.dg.mmrOk', { pl: known.name, v: known.mmr, t: when(known.at) }));
    else add('mmr', 'idle', tr('s.dg.mmrNone'));
  }

  const ov = core.server.overlayClients();
  const n = Object.values(ov).reduce((a, b) => a + b, 0);
  add('overlays', n ? 'ok' : 'idle', n ? tn('s.dg.overlays', n, { l: Object.keys(ov).join(', ') }) : tr('s.dg.overlaysNone'), n ? null : 'overlays');

  const last = core.journal.list[core.journal.list.length - 1];
  if (!last) add('last', 'idle', tr('s.dg.lastNone'));
  else {
    const v = entryView(core, last);
    add('last', last.outcome === 'counted' || last.fixed ? 'ok' : 'warn', tr('s.dg.last', { t: when(last.at), m: v.mode, r: `${v.label}. ${v.why}` }));
  }
  return out;
}

// Niveau global : le pire des points de contrôle (hors « en attente »)
function worst(list) {
  if (list.some((c) => c.level === 'bad')) return 'bad';
  if (list.some((c) => c.level === 'warn')) return 'warn';
  return 'ok';
}

// ---------------------------------------------------------------- journal des parties
function whyText(core, e) {
  const acct = core.logWatcher.account;
  if (e.outcome === 'counted') {
    if (e.corrected) return tr('s.dg.why.corrected');
    if (e.abandon) return tr(`s.dg.why.left.${e.how === 'lost' ? 'lost' : e.how === 'replaced' ? 'replaced' : 'left'}`);
    if (/-inferred$/.test(e.how)) return tr('s.dg.why.inferred');
    return tr('s.dg.why.counted');
  }
  switch (e.code) {
    case 'paused':
      return tr('s.dg.why.paused');
    case 'mode-off':
      return tr('s.dg.why.modeOff', { c: categoryLabels()[e.category] || modeName(e) });
    case 'no-winner':
      return tr('s.dg.why.noWinner');
    case 'identity':
      return tr('s.dg.why.identity');
    case 'spectator':
      return tr('s.dg.why.spectator', { n: acct ? acct.name : '?' });
    case 'not-started':
      return tr('s.dg.why.notStarted');
    case 'left':
      return tr('s.dg.why.leftOff');
    default:
      return e.code;
  }
}

// Entrée du journal telle qu'affichée (sans la photo de la partie ni les identifiants des joueurs)
function entryView(core, e, { trace = false } = {}) {
  const fixed = e.fixed || null;
  const result = e.outcome === 'counted' ? e.result : fixed ? fixed.result : null;
  const recorded = core.store.hasMatch(e.id);
  const removed = !!e.removedAt || ((e.outcome === 'counted' || !!fixed) && !recorded);
  const word = (r) => tr(r === 'W' ? 's.win' : 's.loss');
  let label;
  if (removed) label = tr('s.dg.removed');
  else if (result) label = `${word(result)}${e.overtime ? tr('s.inOt') : ''}${e.abandon ? tr('s.ab') : ''}`;
  else label = tr('s.dg.notCounted');
  const acct = core.logWatcher.account;
  const v = {
    id: e.id,
    at: e.at,
    when: when(e.at),
    outcome: e.outcome,
    code: e.code,
    mode: modeName(e),
    score: scoreOf(e, fixed && fixed.team != null ? fixed.team : e.myTeam),
    mySide: e.myTeam === 0 || e.myTeam === 1 || (fixed && fixed.team != null),
    overtime: !!e.overtime,
    result,
    label,
    why: fixed ? tr('s.dg.why.fixed', { w: whyText(core, e) }) : whyText(core, e),
    warn: e.outcome === 'counted' && e.accountAbsent && !removed ? tr('s.dg.why.camera', { n: acct ? acct.name : '?' }) : '',
    removed,
    recorded,
    needs: e.outcome === 'skipped' && !fixed && e.draft ? e.needs || [] : [],
    canFix: e.outcome === 'skipped' && !fixed && !!e.draft && !recorded,
    // si la partie a été quittée, la seule issue possible est une défaite
    leftDraft: !!(e.draft && e.draft.abandon),
    players: e.outcome === 'skipped' && !fixed && e.draft ? e.draft.players.map((p, i) => ({ i, name: p.name, team: p.team })) : [],
  };
  if (trace) v.trace = (e.trace || []).map(([t, text]) => ({ t, text }));
  return v;
}

function journalView(core, opts) {
  return [...core.journal.list].reverse().map((e) => entryView(core, e, opts));
}

// Avis pour l'accueil : la dernière partie vue n'a pas été comptée (et peut l'être)
function notice(core) {
  const list = core.journal.list;
  const e = list[list.length - 1];
  if (!e || e.outcome !== 'skipped' || e.fixed || e.dismissed || e.code === 'not-started') return null;
  const v = entryView(core, e);
  return { id: v.id, when: v.when, mode: v.mode, score: v.score, mySide: v.mySide, why: v.why, canFix: v.canFix, needs: v.needs, leftDraft: v.leftDraft };
}

// ---------------------------------------------------------------- rapport à copier
// Texte à envoyer pour demander de l'aide : ni clé d'accès, ni jeton, ni identifiant de compte, ni nom d'autres joueurs.
function report(core) {
  const s = core.store.settings;
  const lw = core.logWatcher;
  const api = core.stats.status;
  const home = os.homedir();
  const tidy = (p) => String(p || '').split(home).join('~');
  const mark = { ok: 'OK ', warn: '!  ', bad: 'X  ', idle: '-  ' };
  const L = [];
  L.push(`RL-UI ${core.version} — ${tr('s.dg.reportTitle')} — ${new Date().toLocaleString(locale())}`);
  L.push(`${os.platform()} ${os.release()} · ${os.arch()} · Node ${process.versions.node}${process.versions.electron ? ` · Electron ${process.versions.electron}` : ''} · ${i18n.getLang()}`);
  L.push('');
  L.push(`== ${tr('s.dg.reportChecks')} ==`);
  for (const c of checks(core)) L.push(`${mark[c.level] || ''}${c.title} : ${c.detail}`);
  L.push('');
  L.push(`== ${tr('s.dg.reportSettings')} ==`);
  L.push(`paused=${!!s.paused} · abandonAsLoss=${s.abandonAsLoss} · autoResetHours=${s.session.autoResetHours}`);
  L.push(`counting: ${Object.entries(s.counting).map(([k, v]) => `${k}=${v ? 1 : 0}`).join(' ')}`);
  L.push(`identity: names=${s.identity.names.length} knownIds=${s.identity.knownIds.length} camera=${!!s.identity.useCameraTarget}`);
  L.push(`mmr: enabled=${!!s.mmr.enabled} casual=${!!s.mmr.includeCasual} default=${s.mmr.defaultDelta}`);
  L.push(`stats api: state=${api.state} transport=${api.transport || '-'} (${api.transportMode}) tcp=${api.tcpPort} ws=${api.webPort} messages=${api.messages}`);
  if (core.rlConfig) {
    const e = core.rlConfig.effective || {};
    L.push(`game config: known=${!!core.rlConfig.known} enabled=${!!core.rlConfig.enabled} PacketSendRate=${e.PacketSendRate} Port=${e.Port} WebPort=${e.WebPort} installs=${(core.rlConfig.installs || []).map((i) => i.platform).join(',') || '-'}`);
  }
  L.push(`game log: found=${!!lw.exists} path=${tidy(lw.logPath)} account=${lw.account ? `${lw.account.name} (${lw.account.platform})` : '-'} mode=${lw.playlist ? lw.playlist.id : '-'}`);
  if (lw.lastSearch) L.push(`last search: ${when(lw.lastSearch.at)} ok=${!!lw.lastSearch.ok}${lw.lastSearch.why ? ` why=${lw.lastSearch.why}` : ''} modes=${lw.lastSearch.playlist != null ? lw.lastSearch.playlist : (lw.lastSearch.playlists || []).join(',')}`);
  L.push(`data: ${tidy(core.dataDir)} · matches=${core.store.data.matches.length} · sessions=${core.store.data.sessions.length}`);
  L.push('');
  L.push(`== ${tr('s.dg.reportJournal')} ==`);
  const entries = [...core.journal.list].reverse();
  if (!entries.length) L.push(tr('s.dg.lastNone'));
  entries.forEach((e, i) => {
    const v = entryView(core, e);
    L.push(`${v.when}  ${v.mode}  ${v.score}  ${v.label} — ${v.why}${v.warn ? ` (${v.warn})` : ''} [${e.outcome}/${e.code}${e.how ? `/${e.how}` : ''}${e.via ? ` via ${e.via}` : ''}]`);
    // la trace technique des 5 dernières parties
    if (i < 5) for (const [t, text] of e.trace || []) L.push(`      ${String(t).padStart(6)}s  ${text}`);
  });
  L.push('');
  L.push(`== ${tr('s.dg.reportLog')} ==`);
  for (const l of core.logs.filter((x) => x.tag !== 'chat').slice(-60)) L.push(`[${new Date(l.at).toLocaleTimeString(locale())}] ${l.level === 'info' ? '' : `(${l.level}) `}${l.msg}`);
  return L.join('\n');
}

module.exports = { checks, worst, journalView, entryView, notice, report, when };
