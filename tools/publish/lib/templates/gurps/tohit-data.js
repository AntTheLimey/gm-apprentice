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

// "Beam Weapons (Pistol)-17", "Guns (Rifle) 17", "Wrestling-15 +4 = 19",
// "DX-12 (default)", "10". Returns null when no level can be read.
function readWeaponSkill(cell) {
  let s = str(cell).replace(/[*◇◆†‡]/g, '').trim();
  s = s.replace(/\(\s*[+−-]\s*\d[^)]*\)\s*$/, '').trim();
  const eq = /=\s*(\d+)/.exec(s);
  const all = s.match(/\d+/g);
  if (!eq && !all) return null;
  const level = parseInt(eq ? eq[1] : all[all.length - 1], 10);
  if (!(level >= 1 && level <= 99)) return null;
  const name = (/^(.*?)\s*[-−–]?\s*\d/.exec(s) || [, ''])[1].replace(/[-−–\s]+$/, '').trim();
  return { skill: name, level };
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
function aidNameIn(text) {
  for (const [name, re] of AID_NAMES) if (re.test(str(text))) return name;
  return null;
}
function aidFromPiece(name, piece, bonus) {
  return {
    name, bonus,
    acc: ALWAYS_ACC.has(name) || /\bacc\b/i.test(piece),
    fixed: /\bfixed\b/i.test(piece),
  };
}

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

function readRowNotes(notes) {
  const aids = []; const bonuses = [];
  for (const piece of splitPieces(notes)) {
    const bonus = signedIn(piece);
    const name = aidNameIn(piece);
    if (name) { aids.push(aidFromPiece(name, piece, bonus)); continue; }
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
    const name = aidNameIn(p[2]);
    if (name) aids.push({ name, bonus: parseInt(p[1], 10), acc: true, fixed: /\bfixed\b/i.test(p[2]) });
  }
  return { acc, aids };
}

function readGear(items) {
  const out = [];
  for (const item of items) {
    const found = new Map();
    const pieces = splitPieces(item && item.notes);
    for (const piece of pieces) {
      const name = aidNameIn(piece);
      if (name && !found.has(name)) found.set(name, { piece, bonus: signedIn(piece) });
    }
    const nameAid = aidNameIn(item && item.name);
    if (nameAid && !found.has(nameAid)) {
      let bonus = signedIn(item.name);
      let piece = str(item.name);
      if (bonus === null) {
        const plain = pieces.find(p => !aidNameIn(p) && signedIn(p) !== null);
        if (plain) { bonus = signedIn(plain); piece = plain; }
      }
      found.set(nameAid, { piece, bonus });
    }
    for (const [name, { piece, bonus }] of found) {
      out.push({ item: str(item.name), aid: aidFromPiece(name, piece, bonus), from: 'gear' });
    }
  }
  return out;
}

function levelOf(name, re) {
  const m = re.exec(str(name));
  return m ? parseInt(m[1], 10) : 0;
}
function readTraits(advantages) {
  const t = { ambidextrous: false, offHand: [], halfRapid: false, telescopic: 0, nightVision: 0 };
  for (const a of advantages) {
    const n = str(a && a.name);
    if (/\bambidext/i.test(n)) t.ambidextrous = true;
    const oh = /^\s*off-?\s*hand weapon training\s*\((.+)\)/i.exec(n);
    if (oh) for (const s of oh[1].split(',')) if (s.trim()) t.offHand.push(s.trim());
    if (/\bweapon master\b|\btrained by a master\b/i.test(n)) t.halfRapid = true;
    t.telescopic = Math.max(t.telescopic, levelOf(n, /telescopic vision\s*\(?\s*(\d+)/i));
    t.nightVision = Math.max(t.nightVision, levelOf(n, /night vision\s*\(?\s*(\d+)/i));
  }
  return t;
}

function readTechniques(techniques, skillLevel, locKeys) {
  const out = { targeted: [], dual: {}, other: [] };
  for (const t of techniques) {
    const name = str(t && t.name);
    const level = firstInt(t && t.level, NaN);
    if (!Number.isFinite(level)) continue;
    const defSkill = (/^\s*(.+?)\s*[-−–+]\s*\d+/.exec(str(t.def)) || [, ''])[1].trim();
    const targeted = /^targeted attack\s*\((.*)\)\s*$/i.exec(name);
    const dual = /^dual-weapon attack\s*\((.*)\)\s*$/i.exec(name);
    if (targeted) {
      const inner = targeted[1]; const cut = inner.lastIndexOf('/');
      if (cut < 0) continue;
      const word = inner.slice(cut + 1).trim().toLowerCase();
      const loc = locKeys.has(word) ? word : LOCATION_WORDS[word];
      if (!loc) continue;
      const bracket = inner.slice(0, cut).replace(/\s+(?:swing|thrust)$/i, '').trim();
      const skill = [defSkill, bracket].find(s => s && skillLevel.has(norm(s)));
      if (!skill) continue;
      out.targeted.push({ skill, loc, net: level - skillLevel.get(norm(skill)), name });
    } else if (dual) {
      const skill = dual[1].trim();
      if (!skillLevel.has(norm(skill))) continue;
      const bought = level - (skillLevel.get(norm(skill)) - DUAL_PENALTY);
      out.dual[skill] = Math.max(0, Math.min(DUAL_PENALTY, bought));
    } else if (defSkill) {
      out.other.push({ skill: defSkill, name, level });
    }
  }
  return out;
}

function buildTohitData(model, meta) {
  const m = model || {};
  const skillLevel = new Map();
  for (const s of m.skills || []) {
    const lv = /^\s*(\d+)/.exec(str(s && s.level));
    if (lv && !skillLevel.has(norm(s.name))) skillLevel.set(norm(s.name), parseInt(lv[1], 10));
  }
  const nextId = idMaker();
  const weapons = [];
  const addWeapon = (row, type) => {
    const key = str(row && row.weapon);
    const read = key && readWeaponSkill(row.skill);
    if (!read) return;
    const notes = readRowNotes(row.notes);
    const w = {
      key, type,
      name: key.replace(/[*◇◆†‡]/g, '').replace(/\s+/g, ' ').trim() || key,
      skill: read.skill, level: read.level,
      base: read.skill && skillLevel.has(norm(read.skill)) ? skillLevel.get(norm(read.skill)) : null,
      range: str(row.range), damage: str(row.damage),
      beam: /^beam weapons/i.test(read.skill),
      aids: [], bonuses: notes.bonuses,
    };
    if (type === 'ranged') {
      const acc = readAccCell(row.acc);
      Object.assign(w, {
        acc: acc.acc, rof: firstInt(row.rof, 1) || 1, rcl: firstInt(row.rcl, 1) || 1,
        bulk: firstInt(row.bulk, 0),
      });
      w.aids = [...acc.aids, ...notes.aids].map(a => ({ id: nextId('row', key, a.name), ...a, from: 'row' }));
    }
    weapons.push(w);
  };
  for (const r of m.melee || []) addWeapon(r, 'melee');
  for (const r of m.ranged || []) addWeapon(r, 'ranged');
  if (!weapons.length) return null;

  const advantages = (m.traits && m.traits.advantages) || [];
  const aids = [];
  for (const g of readGear((m.equipment && m.equipment.items) || [])) {
    aids.push({ id: nextId('gear', g.item, g.aid.name), ...g.aid, from: 'gear' });
  }
  for (const a of advantages) {
    const name = aidNameIn(a && a.name);
    if (name) aids.push({ id: nextId('trait', a.name, name), ...aidFromPiece(name, str(a.name), signedIn(a.name)), from: 'trait' });
  }

  const locations = buildLocations();
  const ff = skillLevel.get('free fall');
  return {
    pc: meta && meta.pcSlug,
    weapons,
    aids,
    techniques: readTechniques(m.techniques || [], skillLevel, new Set(locations.map(l => l[0]))),
    traits: readTraits(advantages),
    freeFall: ff === undefined ? null : ff,
    locations,
    bands: buildBands(),
  };
}

// '<' is written as < so a note can never close the tag.
function tohitDataScript(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/json" id="gurps-tohit-data">${json}</script>`;
}

module.exports = { buildTohitData, tohitDataScript };
