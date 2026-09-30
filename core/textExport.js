'use strict';
// Fichiers texte pour les sources "Texte (GDI+)" d'OBS / Streamlabs (option "Lire depuis un fichier").

const fs = require('fs');
const path = require('path');
const { t: tr } = require('./i18n');

const signed = (n) => (n > 0 ? `+${n}` : String(n));

function templateVars(stats, settings, mmr = null) {
  const o = settings.overlay;
  const p = mmr && mmr.primary;
  return {
    mmr: p && p.current != null ? String(p.current) : '',
    mmrd: p ? signed(Math.round(p.delta)) : '',
    w: stats.wins,
    l: stats.losses,
    wr: stats.winRate,
    played: stats.played,
    streak: stats.streak > 0 ? `+${stats.streak}` : String(stats.streak),
    streakabs: Math.abs(stats.streak),
    best: stats.bestWinStreak,
    otw: stats.otWins,
    otl: stats.otLosses,
    mvp: stats.mvps,
    goals: stats.myGoals,
    lw: o.labelWin || tr('lbl.w'),
    ll: o.labelLoss || tr('lbl.l'),
  };
}

function renderTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k.toLowerCase() in vars ? String(vars[k.toLowerCase()]) : m));
}

class TextExporter {
  constructor(defaultDir) {
    this.defaultDir = defaultDir;
    this.cache = new Map();
  }

  dir(settings) {
    return settings.text.dir || this.defaultDir;
  }

  write(stats, settings, lastRecord, mmr = null) {
    if (!settings.text.enabled) return;
    const dir = this.dir(settings);
    const v = templateVars(stats, settings, mmr);
    const last = lastRecord
      ? `${lastRecord.result === 'W' ? v.lw : v.ll}${
          Number.isFinite(lastRecord.scoreFor) && !lastRecord.manual ? ` ${lastRecord.scoreFor}-${lastRecord.scoreAgainst}` : ''
        }${lastRecord.overtime ? ' (OT)' : ''}${lastRecord.abandon ? ` (${tr('abandon')})` : ''}`
      : '';
    const files = {
      'wins.txt': String(v.w),
      'losses.txt': String(v.l),
      'record.txt': `${v.w} - ${v.l}`,
      'winrate.txt': `${v.wr}%`,
      'streak.txt': v.streak,
      'ot.txt': `${v.otw} - ${v.otl}`,
      'last.txt': last,
      'mmr.txt': v.mmr,
      'mmr-session.txt': v.mmrd,
      'custom.txt': renderTemplate(settings.text.template || tr('text.template'), v),
    };
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, content] of Object.entries(files)) {
        const p = path.join(dir, name);
        if (this.cache.get(p) === content) continue;
        fs.writeFileSync(p, content, 'utf8');
        this.cache.set(p, content);
      }
    } catch (e) {
      console.warn('[text] écriture impossible', e.message);
    }
  }
}

const customTemplate = (settings) => settings.text.template || tr('text.template');

module.exports = { TextExporter, renderTemplate, templateVars, customTemplate };
