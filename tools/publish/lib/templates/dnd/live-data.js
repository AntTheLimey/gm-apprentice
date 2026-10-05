const { splitReason } = require('./parse');
const { yesNo } = require('../sheet-parse');
const { liveKey, shown, trackable } = require('./live-key');

const STANDARD_CONDITIONS = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
  'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious'];

// The one place a Recovers cell is read. Anything else is the player's to track.
function recoveryKind(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (t === 'long rest') return 'long';
  if (t === 'short rest') return 'short';
  if (t === '1 short rest, all long rest') return 'short1';
  return 'none';
}

const conditionsOf = text => String(text || '').split(',').map(t => t.trim()).filter(t => t && !/^[—–-]$/.test(t));

// A whole number the note gave, with or without a reason after it; null when it is anything else.
function whole(text) {
  const { value } = splitReason(text);
  return /^\d+$/.test(value.trim()) ? Number(value) : null;
}

const firstValue = (rows, re) => { const row = (rows || []).find(([label]) => re.test(shown(label))); return row ? String(row[1] || '') : ''; };

// A class text such as "Paladin 5 (Oath of Devotion)" already carries its level; one such as
// "Wizard (Evoker)" does not, so the character level goes in front.
function whoOf(header) {
  const classes = String(header.classes || '').trim();
  if (!classes) return header.level ? `Level ${header.level}` : '';
  if (/\d/.test(classes) || !header.level) return classes;
  return `Level ${header.level} ${classes}`;
}

function buildDndLiveData(model, meta) {
  const c = model.combat || {};
  const tracks = [];
  const seen = new Set();
  const warnings = [];
  const add = (key, label, max, used, rest, extra) => {
    if (!trackable(max, used)) return;        // nothing to mark, or shown as written
    if (seen.has(key)) { warnings.push(`Two live rows are named "${label}"; they share one count.`); return; }
    seen.add(key);
    tracks.push({ key, label, max, used, rest, ...extra });
  };

  for (const h of c.hitDice || []) if (h.raw === undefined) add(liveKey('hd', shown(h.label)), shown(h.label), h.max, h.spent, 'long');
  for (const s of model.slots || []) add(liveKey('slot', shown(s.level)), shown(s.level), s.total, s.expended, /^pact\b/i.test(shown(s.level)) ? 'short' : 'long');
  for (const [list, kind] of [['class', 'class'], ['species', 'species'], ['feats', 'feat']]) {
    for (const f of model.features[list] || []) {
      if (Number.isInteger(f.uses)) add(liveKey(kind, shown(f.name)), shown(f.name), f.uses, f.used || 0, recoveryKind(f.recovers));
    }
  }
  for (const i of model.magicItems || []) {
    if (Number.isInteger(i.charges)) add(liveKey('item', shown(i.name)), shown(i.name), i.charges, i.used || 0, recoveryKind(i.recovers));
  }
  const d = c.deathSaves;
  if (d && d.raw === undefined && d.s <= 3 && d.f <= 3) {
    add('ds:s', 'Death saves made', 3, d.s, 'reset', { fill: 'made' });
    add('ds:f', 'Death saves failed', 3, d.f, 'reset', { fill: 'made' });
  }

  const hpMax = whole(c.hpMax);
  if (hpMax === null && !tracks.length) return null;
  const hpCur = whole(c.hpCur);
  const exhaustion = whole(c.exhaustion);
  const inspired = yesNo(model.inspiration);
  const used = {};
  for (const t of tracks) used[t.key] = t.used;

  return {
    system: 'dnd', campaignId: meta.campaignId, pcSlug: meta.pcSlug, buildVersion: meta.buildVersion,
    hpMax,
    exhaustionLive: exhaustion !== null || String(c.exhaustion || '').trim() === '',
    inspirationLive: inspired !== null,
    defaults: {
      hp: hpMax === null ? null : Math.min(hpCur === null ? hpMax : hpCur, hpMax),
      temp: whole(c.tempHp) || 0,
      exhaustion: Math.min(exhaustion || 0, 6),
      inspiration: inspired === true,
      concentrating: false,
      conditions: conditionsOf(c.conditions),
      used,
    },
    tracks,
    board: {
      who: whoOf(model.header),
      ac: splitReason(c.ac).value,
      pp: splitReason(firstValue(model.senses, /^passive perception$/i)).value,
      dc: splitReason(firstValue(model.casting, /^spell save dc(\s*\(.+\))?$/i)).value,
    },
    warnings,
  };
}

module.exports = { STANDARD_CONDITIONS, recoveryKind, conditionsOf, buildDndLiveData };
