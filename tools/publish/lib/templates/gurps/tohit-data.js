// The to-hit calculator's data block: the parsed GURPS model turned into the one
// JSON block js/gurps-tohit.js reads, so the page reads no table cells.
// Names and numbers only. The hit-location penalties and the Speed/Range yard
// values come from the reference rows already shipped (B552, B550); the
// Dual-Weapon Attack figure is the technique's default of skill-4, capped at
// the skill (MA83). Aid names are looked for; the bonus is whatever the note says.

const { HIT_LOCATION_ROWS, SIZE_SPEED_RANGE_ROWS } = require('./blocks/reference');

const AID_NAMES = [
  ['Scope', /\b(?:fixed\s+)?(?:scope|telescopic sight)\b/i],
  ['Laser sight', /\blaser sight\b/i],
  ['Reflex sight', /\breflex sight\b/i],
  ['HUD link', /\bHUD(?:\s+link)?\b/i],
  ['Smartgun', /\bsmartgun\b/i],
  ['Targeting program', /\btargeting (?:program|software)\b/i],
  ['Silhouette program', /\bsilhouette program\b/i],
];
// These always count as aiming bonuses, with or without the word "Acc".
const ALWAYS_ACC = new Set(['Scope', 'HUD link']);
// A signed number: `+2`, `−1`, or a hyphen that starts a word (so "sw-2" is not one).
const SIGNED_RE = /(?:([+−])|(?:^|[\s(])(-))\s*(\d+)/;

// Dual-Weapon Attack: default skill-4, so up to 4 points can be bought off (MA83).
const DUAL_PENALTY = 4;

// [key, label, the reference-table row label whose penalty it carries]. The
// four limbs share one key, as do hand and foot.
const LOCATION_KEYS = [
  ['torso', 'Torso', 'Torso'],
  ['vitals', 'Vitals', 'Vitals'],
  ['limb', 'Arm or leg', 'Right Arm'],
  ['extremity', 'Hand or foot', 'Hand'],
  ['groin', 'Groin', 'Groin'],
  ['face', 'Face', 'Face'],
  ['neck', 'Neck', 'Neck'],
  ['skull', 'Skull', 'Skull'],
  ['eye', 'Eye', 'Eye'],
];
// Words a Targeted Attack names that are not themselves a key.
const LOCATION_WORDS = {
  arm: 'limb', arms: 'limb', leg: 'limb', legs: 'limb',
  hand: 'extremity', hands: 'extremity', foot: 'extremity', feet: 'extremity', eyes: 'eye',
};

const str = (v) => (v === undefined || v === null ? '' : String(v));
const norm = (s) => str(s).toLowerCase().replace(/\s+/g, ' ').trim();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
const firstInt = (s, dflt) => { const m = /\d+/.exec(str(s)); return m ? parseInt(m[0], 10) : dflt; };

function buildLocations() {
  const out = [];
  for (const [key, label, row] of LOCATION_KEYS) {
    const r = HIT_LOCATION_ROWS.find(x => x[1] === row);
    if (!r) continue;
    const n = /\d+/.exec(r[2]);
    out.push([key, label, n ? -parseInt(n[0], 10) : 0]);
  }
  return out;
}
function buildBands() {
  return SIZE_SPEED_RANGE_ROWS.map(r => firstInt(r[2], NaN)).filter(Number.isFinite);
}

// "Beam Weapons (Pistol)-17", "Guns (Rifle) 17", "Knife (12)", "Wrestling-15 +4 = 19",
// "DX-12 (default)", "10". The level is the `= N` if there is one, else the number
// that directly follows the skill name (after `-`, a space, or inside a trailing
// `(N)`); parentheticals of prose after it are ignored. Returns null with no level.
// `/TL<n>` is dropped from the name: it never decides which skill this is.
function readWeaponSkill(cell) {
  const s = str(cell).replace(/[*\u25c7\u25c6\u2020\u2021]/g, '').replace(/\/TL\d+/gi, '').trim();
  const m = /^(.*?)(?:\s*[-\u2212\u2013]\s*(\d+)|\s*\(\s*(\d+)\s*\)|\s*(\d+))/.exec(s);
  if (!m) return null;
  const eq = /=\s*(\d+)/.exec(s);
  const level = parseInt(eq ? eq[1] : (m[2] || m[3] || m[4]), 10);
  if (!(level >= 1 && level <= 99)) return null;
  return { skill: m[1].replace(/[\s=:\-\u2212\u2013]+$/, '').trim(), level };
}

// Skills-table lookup: exact, then ignoring /TL<n>, then a bracket written as
// initials (Guns (LMG) = Guns (Light Machine Gun), SMG = Submachine Gun).
function makeSkillMatcher(skills) {
  const entries = [];
  for (const s of skills) {
    const lv = /^\s*(\d+)/.exec(str(s && s.level));
    if (lv && str(s.name).trim()) entries.push({ name: str(s.name).trim(), level: parseInt(lv[1], 10) });
  }
  const bare = (n) => norm(n.replace(/\/TL\d+/gi, ''));
  const split = (n) => { const m = /^([^(]*?)\s*\((.*)\)\s*$/.exec(bare(n)); return m ? [m[1], m[2]] : [bare(n), null]; };
  const abbrOf = (abbr, words) => {
    const a = abbr.replace(/[^a-z]/g, ''); const letters = words.join('').replace(/[^a-z]/g, '');
    if (a.length < 2 || a[0] !== letters[0]) return false;
    let at = 0;
    for (const ch of a) { at = letters.indexOf(ch, at); if (at < 0) return false; at++; }
    const firsts = words.map(w => w[0]).join('');
    let k = 0;
    for (const ch of a) if (ch === firsts[k]) k++;
    return k === firsts.length;
  };
  return (name) => {
    const n = str(name).trim();
    if (!n) return null;
    const exact = entries.find(e => norm(e.name) === norm(n));
    if (exact) return exact;
    const noTl = entries.find(e => bare(e.name) === bare(n));
    if (noTl) return noTl;
    const [head, br] = split(n);
    if (br === null) return null;
    return entries.find(e => {
      const [h, b] = split(e.name);
      return b !== null && h === head && b.split(/[^a-z]+/).filter(Boolean).length > 1 && abbrOf(br, b.split(/[^a-z]+/).filter(Boolean));
    }) || null;
  };
}

function splitPieces(text) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of str(text)) {
    if (ch === '(') depth++;
    if (ch === ')' && depth > 0) depth--;
    if ((ch === ';' || ch === ',') && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  // "smartgun + HUD link" and "scope and laser sight" are two things, "+2 Guns" is not.
  return out.flatMap(p => p.split(/\s\+\s+(?=\D)|\s+(?:and|&)\s+/i)).map(p => p.trim()).filter(Boolean);
}
function signedIn(text) {
  const m = SIGNED_RE.exec(str(text));
  if (!m) return null;
  const n = parseInt(m[3], 10);
  return (m[1] || m[2]) === '+' ? n : -n;
}
// The first aid name in the text: { name, start, end } or null.
function aidMatchIn(text) {
  const t = str(text);
  for (const [name, re] of AID_NAMES) {
    const m = re.exec(t);
    if (m) return { name, start: m.index, end: m.index + m[0].length };
  }
  return null;
}
// The signed number nearest AFTER the aid's name in the same piece, or null.
function bonusAfter(piece, hit) {
  return signedIn(str(piece).slice(hit.end));
}
function aidFromPiece(name, piece, bonus) {
  return {
    name, bonus,
    acc: ALWAYS_ACC.has(name) || /\bacc\b/i.test(piece),
    fixed: /\bfixed\b/i.test(piece),
  };
}
const makeAid = (name, bonus, acc, fixed) => ({ name, bonus, acc: ALWAYS_ACC.has(name) || acc, fixed });

// Ids are a slug of where the aid was found and its name; a clash gets -2, -3.
function idMaker() {
  const seen = new Map();
  return (...parts) => {
    const base = parts.map(slug).join('-');
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

// A weapon's own row (its Notes, or the Equipment row named like it): the loose
// reading, every aid name in every piece.
function readRowNotes(notes) {
  const aids = []; const bonuses = [];
  for (const piece of splitPieces(notes)) {
    const hit = aidMatchIn(piece);
    if (hit) { aids.push(aidFromPiece(hit.name, piece, bonusAfter(piece, hit))); continue; }
    const bonus = signedIn(piece);
    if (bonus === null) continue;
    const label = piece.slice(0, SIGNED_RE.exec(piece).index).replace(/[\s:=(]+$/, '').trim();
    if (label) bonuses.push({ name: label, bonus });
  }
  return { aids, bonuses };
}

function readAccCell(cell) {
  const s = str(cell);
  const acc = firstInt(s, 0);
  const aids = [];
  const m = /^\s*\d+\s*\+\s*(\d+)/.exec(s);
  if (m) aids.push({ name: 'Scope', bonus: parseInt(m[1], 10), acc: true, fixed: false });
  const p = /\(\s*\+\s*(\d+)\s*([^)]*)\)/.exec(s);
  if (p) {
    const hit = aidMatchIn(p[2]);
    if (hit) aids.push({ name: hit.name, bonus: parseInt(p[1], 10), acc: true, fixed: /\bfixed\b/i.test(p[2]) });
  }
  return { acc, aids };
}

// What an item or weapon name is compared on: lower case, the text before the
// first " — " or " (", markers dropped.
const weaponStem = (n) => norm(str(n).split(/\s+\u2014\s+|\s+\(/)[0].replace(/[*\u25c7\u25c6\u2020\u2021]/g, ''));

// Character-wide aids, from an Equipment row or an Advantage. Only two shapes
// count: the NAME starts with an aid name, or a `;`-separated piece of the notes
// starts with one and is followed by a signed number. Prose mentions do not.
const AID_START = AID_NAMES.map(([name, re]) => [name, new RegExp('^\\s*(?:' + re.source + ')', 'i')]);
const NAME_REST = /^(?:\s+(?:link|system|software|program))?(?:\s*$|\s*[(,:\[]|\s*[+\u2212\u2013-]\s*\d|\s+\d)/i;
const BONUS_PHRASE = /([+\u2212]\s*\d+)\s+(?:\w+\s+){0,3}?(?:acc\b|skill\b|to hit|guns\b|gunner\b|beam weapons)/i;
const OFF_RE = /\b(?:backup|superseded|spare)\b/i;

function charWideAids(name, notes) {
  const out = [];
  const text = str(notes);
  for (const [aid, re] of AID_START) {
    const m = re.exec(str(name));
    if (!m || !NAME_REST.test(str(name).slice(m[0].length))) continue;
    let bonus = signedIn(str(name).slice(m[0].length));
    let acc = false;
    if (bonus === null) {
      const b = BONUS_PHRASE.exec(text);
      if (b) { bonus = signedIn(b[1]); acc = /\bacc\b/i.test(b[0]); }
    } else acc = /\bacc\b/i.test(str(name));
    out.push({ aid: makeAid(aid, bonus, acc, /\bfixed\b/i.test(str(name))), off: OFF_RE.test(text) });
    break;
  }
  for (const piece of text.split(';')) {
    for (const [aid, re] of AID_START) {
      const m = re.exec(piece);
      if (!m) continue;
      const rest = piece.slice(m[0].length);
      const num = /^\s*[:=(]?\s*([+\u2212])\s*(\d+)/.exec(rest);
      if (num && !out.some(o => o.aid.name === aid)) {
        out.push({ aid: makeAid(aid, signedIn(num[1] + num[2]), /\bacc\b/i.test(rest), /\bfixed\b/i.test(piece)), off: OFF_RE.test(piece) || OFF_RE.test(text) });
      }
      break;
    }
  }
  return out;
}

// A trait's level: the number after its name ("2", "(2)", "(Level 2)", "2 [10]");
// the trait with no number is level 1. 0 when the trait is not there.
function levelOf(name, re) {
  const m = re.exec(str(name).replace(/\[[^\]]*\]/g, ''));
  if (!m) return 0;
  const n = /(\d+)/.exec(m[1]);
  return n ? parseInt(n[1], 10) : 1;
}
function readTraits(advantages, match) {
  const t = { ambidextrous: false, offHand: [], halfRapid: false, telescopic: 0, nightVision: 0 };
  for (const a of advantages) {
    const n = str(a && a.name);
    if (/\bambidext/i.test(n)) t.ambidextrous = true;
    const oh = /^\s*off-?\s*hand weapon training\s*\((.+)\)/i.exec(n);
    if (oh) {
      for (const s of oh[1].split(',')) {
        const skill = s.trim();
        if (skill) t.offHand.push((match(skill) || { name: skill }).name);
      }
    }
    if (/\bweapon master\b|\btrained by a master\b/i.test(n)) t.halfRapid = true;
    t.telescopic = Math.max(t.telescopic, levelOf(n, /telescopic vision\b(.*)/i));
    t.nightVision = Math.max(t.nightVision, levelOf(n, /night vision\b(.*)/i));
  }
  return t;
}

function readTechniques(techniques, match, locKeys) {
  const out = { targeted: [], dual: {}, other: [] };
  for (const t of techniques) {
    const name = str(t && t.name);
    const level = firstInt(t && t.level, NaN);
    if (!Number.isFinite(level)) continue;
    const defSkill = (/^\s*(.+?)\s*[-\u2212\u2013+]\s*\d+/.exec(str(t.def)) || [, ''])[1].trim();
    const targeted = /^targeted attack\s*\((.*)\)\s*$/i.exec(name);
    const dual = /^dual-weapon attack\s*\((.*)\)\s*$/i.exec(name);
    if (targeted) {
      const inner = targeted[1]; const cut = inner.lastIndexOf('/');
      if (cut < 0) continue;
      const word = (/(\S+)\s*$/.exec(inner.slice(cut + 1)) || [, ''])[1].toLowerCase();
      const loc = locKeys.has(word) ? word : LOCATION_WORDS[word];
      if (!loc) continue;
      const bracket = inner.slice(0, cut).replace(/\s+(?:swing|thrust)$/i, '').trim();
      const hit = match(defSkill) || match(bracket);
      if (!hit) continue;
      out.targeted.push({ skill: hit.name, loc, net: level - hit.level, name });
    } else if (dual) {
      const hit = match(dual[1]);
      if (!hit) continue;
      out.dual[hit.name] = Math.max(0, Math.min(DUAL_PENALTY, level - (hit.level - DUAL_PENALTY)));
    } else if (defSkill) {
      out.other.push({ skill: (match(defSkill) || { name: defSkill }).name, name, level });
    }
  }
  return out;
}

function buildTohitData(model, meta) {
  const m = model || {};
  const match = makeSkillMatcher(m.skills || []);
  const nextId = idMaker();
  const items = (m.equipment && m.equipment.items) || [];
  const weapons = [];
  const addWeapon = (row, type) => {
    const key = str(row && row.weapon);
    const read = key && readWeaponSkill(row.skill);
    if (!read) return;
    const hit = match(read.skill);
    const notes = readRowNotes(row.notes);
    const w = {
      key, type,
      name: key.replace(/[*\u25c7\u25c6\u2020\u2021]/g, '').replace(/\s+/g, ' ').trim() || key,
      skill: hit ? hit.name : read.skill, skillAs: read.skill, level: read.level,
      base: hit ? hit.level : null,
      range: str(row.range), damage: str(row.damage),
      beam: /^beam weapons/i.test(read.skill),
      aids: [], bonuses: notes.bonuses,
    };
    if (type === 'ranged') {
      const acc = readAccCell(row.acc);
      // An Equipment row named like this weapon is part of this weapon's own row.
      const stem = weaponStem(key);
      const own = items.filter(i => i && weaponStem(i.name) === stem).map(i => readRowNotes(i.notes));
      Object.assign(w, {
        acc: acc.acc, rof: firstInt(row.rof, 1) || 1, rcl: firstInt(row.rcl, 1) || 1,
        bulk: firstInt(row.bulk, 0),
      });
      w.aids = [...acc.aids, ...notes.aids, ...own.flatMap(o => o.aids)]
        .map(a => ({ id: nextId('row', key, a.name), ...a, from: 'row', on: true }));
    }
    weapons.push(w);
  };
  for (const r of m.melee || []) addWeapon(r, 'melee');
  for (const r of m.ranged || []) addWeapon(r, 'ranged');
  if (!weapons.length) return null;

  const stems = new Set(weapons.map(w => weaponStem(w.key)));
  const advantages = (m.traits && m.traits.advantages) || [];
  const wide = [];
  for (const item of items) {
    if (!item || stems.has(weaponStem(item.name))) continue;
    for (const g of charWideAids(item.name, item.notes)) wide.push({ ...g, id: nextId('gear', item.name, g.aid.name), from: 'gear' });
  }
  for (const a of advantages) {
    for (const g of charWideAids(a && a.name, '')) wide.push({ ...g, id: nextId('trait', a.name, g.aid.name), from: 'trait' });
  }
  // Flat aids add, but a spare does not: of the flat ones only the best starts on.
  const flat = wide.filter(g => !g.aid.acc && g.aid.bonus !== null && !g.off);
  const best = flat.reduce((b, g) => (b === null || g.aid.bonus > b.aid.bonus ? g : b), null);
  const aids = wide.map(g => ({
    id: g.id, ...g.aid, from: g.from,
    on: !g.off && (g.aid.acc || g.aid.bonus === null || g === best),
  }));

  const locations = buildLocations();
  const ff = match('Free Fall');
  return {
    pc: meta && meta.pcSlug,
    weapons,
    aids,
    techniques: readTechniques(m.techniques || [], match, new Set(locations.map(l => l[0]))),
    traits: readTraits(advantages, match),
    freeFall: ff ? ff.level : null,
    locations,
    bands: buildBands(),
  };
}

// '<' is written as \u003c so a note can never close the tag; the two line
// separators are written out too, for older parsers.
function tohitDataScript(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<script type="application/json" id="gurps-tohit-data">${json}</script>`;
}

module.exports = { buildTohitData, tohitDataScript };
