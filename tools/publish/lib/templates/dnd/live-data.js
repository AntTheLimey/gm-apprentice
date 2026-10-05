const { splitReason } = require('./parse');
const { yesNo } = require('../sheet-parse');
const { liveKey, shown, trackable, holdsNothing, saysNone } = require('./live-key');
const { fitConditions } = require('../../../js/dnd-live');

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

// The names in a Conditions cell. A dash, or a word that says there are none, is not a name.
const conditionsOf = text => String(text || '').split(',').map(t => t.trim()).filter(t => !saysNone(t));

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

// The four facts the party board shows, read from the note alone: the island carries them, and so
// does a PC whose note gives nothing live (no island).
function boardOf(model) {
  const c = model.combat || {};
  return {
    who: whoOf(model.header),
    ac: splitReason(c.ac).value,
    pp: splitReason(firstValue(model.senses, /^passive perception$/i)).value,
    dc: splitReason(firstValue(model.casting, /^spell save dc(\s*\(.+\))?$/i)).value,
  };
}

function buildDndLiveData(model, meta) {
  const c = model.combat || {};
  const tracks = [];
  const seen = new Set();
  const warnings = [];
  const rows = new Set();       // the model's own row objects that own a track
  // The key belongs to the first row of that name, trackable or not: a later row of the same
  // name is never live, so the row the page follows is the row flush writes.
  const add = (row, key, label, max, used, rest, extra) => {
    if (seen.has(key)) { warnings.push(`Two rows are named "${label}"; only the first is live.`); return; }
    seen.add(key);
    if (!trackable(max, used)) return;        // nothing to mark, or shown as written
    tracks.push({ key, label, max, used, rest, ...extra });
    rows.add(row);
  };

  for (const h of c.hitDice || []) {
    if (h.raw !== undefined) continue;
    const label = shown(h.label);
    add(h, liveKey('hd', label), label, h.max, h.spent, 'long');
  }
  for (const s of model.slots || []) {
    const label = shown(s.level);
    add(s, liveKey('slot', label), label, s.total, s.expended, /^pact\b/i.test(label) ? 'short' : 'long');
  }
  for (const [list, kind] of [['class', 'class'], ['species', 'species'], ['feats', 'feat']]) {
    for (const f of model.features[list] || []) {
      if (!Number.isInteger(f.uses)) continue;
      const label = shown(f.name);
      add(f, liveKey(kind, label), label, f.uses, f.used || 0, recoveryKind(f.recovers));
    }
  }
  for (const i of model.magicItems || []) {
    if (!Number.isInteger(i.charges)) continue;
    const label = shown(i.name);
    add(i, liveKey('item', label), label, i.charges, i.used || 0, recoveryKind(i.recovers));
  }
  const d = c.deathSaves;
  if (d && d.raw === undefined && d.s <= 3 && d.f <= 3) {
    add(d, 'ds:s', 'Death saves made', 3, d.s, 'reset', { fill: 'made' });
    add(d, 'ds:f', 'Death saves failed', 3, d.f, 'reset', { fill: 'made' });
  }

  // Hit points are live when the maximum is a number and the current cell is a number or
  // holds nothing. Words in either are shown as written: the page invents no number.
  const hpCur = whole(c.hpCur);
  const hpMax = hpCur !== null || holdsNothing(c.hpCur) ? whole(c.hpMax) : null;
  if (hpMax === null && !tracks.length) return null;
  const exhaustion = whole(c.exhaustion);
  const tempHp = whole(c.tempHp);
  const inspired = yesNo(model.inspiration);
  // Conditions are live when the cell is plain text and every name in it is one the sheet can
  // carry (fitConditions, the rule flush writes by). A link, markup or an unusual character
  // makes the cell the GM's own writing: shown as written, never tapped, never rewritten.
  const conditions = conditionsOf(c.conditions);
  const conditionsLive = c.conditionsPlain !== false && fitConditions(conditions).join('\n') === conditions.join('\n');
  const used = {};
  for (const t of tracks) used[t.key] = t.used;

  return {
    system: 'dnd', campaignId: meta.campaignId, pcSlug: meta.pcSlug, buildVersion: meta.buildVersion,
    hpMax,
    exhaustionLive: exhaustion !== null || saysNone(c.exhaustion),
    // Temporary hit points are set from the hit point tile: with no tile they are not live.
    tempLive: hpMax !== null && (tempHp !== null || saysNone(c.tempHp)),
    conditionsLive,
    inspirationLive: inspired !== null,
    defaults: {
      hp: hpMax === null ? null : Math.min(hpCur === null ? hpMax : hpCur, hpMax),
      temp: tempHp || 0,
      exhaustion: Math.min(exhaustion || 0, 6),
      inspiration: inspired === true,
      concentrating: false,
      conditions,
      used,
    },
    tracks,
    board: boardOf(model),
    warnings,
    rows,
  };
}

module.exports = { STANDARD_CONDITIONS, recoveryKind, conditionsOf, boardOf, buildDndLiveData };
