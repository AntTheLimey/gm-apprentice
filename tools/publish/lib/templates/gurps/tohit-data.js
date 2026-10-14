// The to-hit calculator's data block: the parsed GURPS model turned into the one
// JSON block js/gurps-tohit.js reads, so the page reads no table cells.
// Names and numbers only. The hit-location penalties and the Speed/Range yard
// values come from the reference rows already shipped (B552, B550); the
// Dual-Weapon Attack figure is the technique's default of skill-4, capped at
// the skill (MA83, B230). Aid names are looked for; the bonus is whatever the note says.

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

// Dual-Weapon Attack: default skill-4, so up to 4 points can be bought off (MA83, B230).
const DUAL_PENALTY = 4;

// [key, label, the reference-table row label whose penalty it carries]. Arms and legs
// are apart (a low target is harder to hit in the legs only, B551); hand and foot share one key.
const LOCATION_KEYS = [
  ['torso', 'Torso', 'Torso'],
  ['vitals', 'Vitals', 'Vitals'],
  ['arm', 'Arm', 'Right Arm'],
  ['leg', 'Leg', 'Right Leg'],
  ['extremity', 'Hand or foot', 'Hand'],
  ['groin', 'Groin', 'Groin'],
  ['face', 'Face', 'Face'],
  ['neck', 'Neck', 'Neck'],
  ['skull', 'Skull', 'Skull'],
  ['eye', 'Eye', 'Eye'],
];
// Words a Targeted Attack names that are not themselves a key.
const LOCATION_WORDS = {
  arms: 'arm', legs: 'leg', limb: 'arm',
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

// The number the sheet wraps in .wp-tohit: the TRAILING number of the Skill cell, exactly
// as blocks/melee.js and blocks/ranged.js match it (a test keeps the two in step).
function shownLevel(cell) {
  const m = /^(.*?)(\d+)(\s*)$/.exec(str(cell));
  return m ? parseInt(m[2], 10) : null;
}

// "Beam Weapons (Pistol)-17", "Guns (Rifle) 17", "Knife (12)", "Wrestling-15 +4 = 19",
// "DX-12 (default)", "10". The level is the `= N` if there is one, else the number
// that directly follows the skill name (after `-`, a space, or inside a trailing
// `(N)`); parentheticals of prose after it are ignored. Returns null with no level.
// `/TL<n>` is dropped from the name: it never decides which skill this is.
function readOnePair(cell) {
  const s = str(cell).replace(/[*\u25c7\u25c6\u2020\u2021]/g, '').replace(/\/TL\d+/gi, '').trim();
  const m = /^(.*?)(?:\s*[-\u2212\u2013]\s*(\d+)|\s*\(\s*(\d+)\s*\)|\s*(\d+))/.exec(s);
  if (!m) return null;
  const eq = /=\s*(\d+)/.exec(s);
  const level = parseInt(eq ? eq[1] : (m[2] || m[3] || m[4]), 10);
  if (!(level >= 1 && level <= 99)) return null;
  return { skill: m[1].replace(/[\s=:\-\u2212\u2013]+$/, '').trim(), level };
}
// A cell can hold two attacks (`Karate-15, Kick-13`). The one named like the weapon is read;
// else the last, the number the sheet wraps as the row's live cell. `pairs` counts them.
function readWeaponSkill(cell, weapon) {
  const parts = splitTop(cell, /[,;]/).map(readOnePair).filter(Boolean);
  if (parts.length < 2) return readOnePair(cell);
  const stem = weaponStem(weapon);
  const named = stem ? parts.find(p => p.skill && (norm(p.skill) === stem || stem.includes(norm(p.skill)))) : null;
  return { ...(named || parts[parts.length - 1]), pairs: parts.length };
}
// Split on a separator outside brackets.
function splitTop(text, sep) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of str(text)) {
    if (ch === '(') depth++;
    if (ch === ')' && depth > 0) depth--;
    if (depth === 0 && sep.test(ch)) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
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
  const find = (n) => {
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
  const match = (name) => {
    const n = str(name).trim();
    if (!n) return null;
    const hit = find(n);
    if (hit) return hit;
    // `Beam Weapons/Pistol` is `Beam Weapons (Pistol)`; a skill whose own name has a slash
    // (Axe/Mace) was found above.
    const slash = /^([^()/]+?)\s*\/\s*([^()/]+)$/.exec(bare(n));
    return slash ? find(`${slash[1]} (${slash[2]})`) : null;
  };
  // The Skills-table name nearest a name that is not on it: the same head word, else one
  // that starts the same. Only for a warning.
  match.closest = (name) => {
    const [head] = split(str(name).replace(/\//, ' ('));
    const first = head.split(' ')[0];
    const same = entries.find(e => split(e.name)[0] === head) || (first ? entries.find(e => norm(e.name).startsWith(first)) : null);
    return same ? same.name : null;
  };
  return match;
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
// The signed number nearest AFTER the aid's name in the same piece; else the one just before
// it (`+2 scope`); else null.
function bonusAfter(piece, hit) {
  const after = signedIn(str(piece).slice(hit.end));
  if (after !== null) return after;
  const before = /(?:([+\u2212])|(?:^|[\s(])(-))\s*(\d+)\s*$/.exec(str(piece).slice(0, hit.start));
  return before ? ((before[1] || before[2]) === '+' ? 1 : -1) * parseInt(before[3], 10) : null;
}
// `fixed` belongs to the aid when it is written beside it: `fixed scope`, `Scope +3 (fixed)`,
// `Scope +3 Acc fixed`. A `fixed` further along the piece is about something else.
const FIXED_BEFORE = /\bfixed\s*$/i;
const FIXED_AFTER = /^\s*(?:[+\u2212-]?\s*\d+\s*)?(?:acc\b\s*)?[(,]?\s*fixed\b/i;
const fixedBeside = (piece, hit) => /\bfixed\b/i.test(str(piece).slice(hit.start, hit.end))
  || FIXED_BEFORE.test(str(piece).slice(0, hit.start)) || FIXED_AFTER.test(str(piece).slice(hit.end));
function aidFromPiece(name, piece, bonus, hit) {
  return {
    name, bonus,
    acc: ALWAYS_ACC.has(name) || /\bacc\b/i.test(piece),
    fixed: fixedBeside(piece, hit),
  };
}
// A piece that only finishes the aid before it: `HUD link, -1`, `Scope +2, fixed`, `, +1 Acc`.
const AID_TAIL = /^\s*(?:([+\u2212]|-)\s*(\d+))?\s*(acc)?\s*(\(?\s*fixed\s*\)?)?\s*$/i;
// The shooting skills a note can say a bonus is to; the head word only.
const SKILL_HEADS = { guns: 'Guns', gunner: 'Gunner', 'beam weapons': 'Beam Weapons' };
function skillsIn(text) {
  const out = [];
  for (const m of str(text).matchAll(/\b(beam weapons|gunner|guns)\b/gi)) {
    const head = SKILL_HEADS[m[1].toLowerCase()];
    if (!out.includes(head)) out.push(head);
  }
  return out;
}
const makeAid = (name, bonus, acc, fixed, skills) => {
  const a = { name, bonus, acc: ALWAYS_ACC.has(name) || acc, fixed };
  if (skills && skills.length) a.skills = skills;
  return a;
};

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

// A row's own bonus is a name, a signed number, and at most "to hit" or "skill" after it.
// A piece that names damage, parry and the like is not a to-hit bonus.
const BONUS_PIECE = /^\s*([^+\u2212\d]*?)\s*[:=(]*\s*([+\u2212]|(?<=^|[\s:(])-)\s*(\d+)\s*\)?\s*(?:to\s+hit|to\s+skill|skill)?\s*$/i;
const NOT_TOHIT = /\b(?:damage|dmg|parry|block|dr|st|bulk|acc|range|reach)\b/i;

// A weapon's own row (its Notes, or the Equipment row named like it): the loose
// reading, every aid name in every piece.
function readRowNotes(notes) {
  const aids = []; const bonuses = [];
  for (const piece of splitPieces(notes)) {
    const hit = aidMatchIn(piece);
    if (hit) { aids.push(aidFromPiece(hit.name, piece, bonusAfter(piece, hit), hit)); continue; }
    const tail = aids.length ? AID_TAIL.exec(piece) : null;
    if (tail && (tail[2] || tail[3] || tail[4])) {
      const last = aids[aids.length - 1];
      if (tail[2] && last.bonus === null) last.bonus = (tail[1] === '+' ? 1 : -1) * parseInt(tail[2], 10);
      if (tail[3]) last.acc = true;
      if (tail[4]) last.fixed = true;
      continue;
    }
    const b = BONUS_PIECE.exec(piece);
    if (!b || !b[1].trim() || NOT_TOHIT.test(b[1])) continue;
    bonuses.push({ name: b[1].replace(/[\s:=(]+$/, '').trim(), bonus: (b[2] === '+' ? 1 : -1) * parseInt(b[3], 10) });
  }
  return { aids, bonuses };
}

function readAccCell(cell) {
  const s = str(cell);
  const acc = firstInt(s, 0);
  const aids = [];
  const m = /^\s*\d+\s*\+\s*(\d+)/.exec(s);
  // `6+3 fixed` or `6+3 (fixed)`: a fixed scope written in the Acc cell.
  if (m) aids.push({ name: 'Scope', bonus: parseInt(m[1], 10), acc: true, fixed: /\bfixed\b/i.test(s.slice(m[0].length)) });
  const p = /\(\s*\+\s*(\d+)\s*([^)]*)\)/.exec(s);
  if (p) {
    const hit = aidMatchIn(p[2]);
    if (hit) aids.push({ name: hit.name, bonus: parseInt(p[1], 10), acc: ALWAYS_ACC.has(hit.name) || /^\s*acc\b/i.test(p[2]), fixed: /\bfixed\b/i.test(p[2]) });
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
    let acc = false; let skills = skillsIn(str(name).slice(m[0].length));
    if (bonus === null) {
      const b = BONUS_PHRASE.exec(text);
      if (b) { bonus = signedIn(b[1]); acc = /\bacc\b/i.test(b[0]); skills = skillsIn(b[0]); }
    } else acc = /\bacc\b/i.test(str(name));
    out.push({ aid: makeAid(aid, bonus, acc, /\bfixed\b/i.test(str(name)), skills), off: OFF_RE.test(text) });
    break;
  }
  for (const piece of text.split(';')) {
    for (const [aid, re] of AID_START) {
      const m = re.exec(piece);
      if (!m) continue;
      const rest = piece.slice(m[0].length);
      const num = /^\s*[:=(]?\s*([+\u2212])\s*(\d+)/.exec(rest);
      if (num && !out.some(o => o.aid.name === aid)) {
        out.push({ aid: makeAid(aid, signedIn(num[1] + num[2]), /\bacc\b/i.test(rest), /\bfixed\b/i.test(piece), skillsIn(rest)), off: OFF_RE.test(piece) || OFF_RE.test(text) });
      }
      break;
    }
  }
  return out;
}

// The attributes a Skill cell can name in place of a skill (`DX-12`).
const ATTRIBUTES = new Set(['st', 'dx', 'iq', 'ht', 'per', 'will', 'perception']);
// Unarmed attacks, which an untrained fighter rolls against DX (a kick at DX-2): an attribute
// in their Skill cell is right, not a fault (B271).
const UNARMED = /^(?:punch|kick|bite|slam|grapple|grab|head ?butt|elbow|knee|shove|trip|unarmed)\b/i;
// The head words of skills that shoot or throw: their techniques are offered only on a
// weapon row, since the calculator needs the weapon's Acc, RoF and Rcl.
const SHOOTING = /^(?:guns|gunner|beam weapons|bow|crossbow|sling|thrown weapon|throwing|blowpipe|liquid projector|artillery|spear thrower|bolas|lasso|net)\b/i;
// The last bracket of a name, one level of brackets inside it kept:
// `Dual-Weapon Attack (Beam Weapons (Pistol))` -> `Beam Weapons (Pistol)`.
const bracketOf = (name) => { const m = /\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/.exec(str(name)); return m ? m[1].trim() : ''; };
// A name before its bracket or slash, lower case: `Guns (Rifle)` -> `guns`.
const headOf = (name) => norm(str(name).replace(/\/TL\d+/gi, '')).split(/\s*[(/]/)[0].trim();
// The skill a technique's Default cell names: `Judo-2` -> `Judo`.
const defSkillOf = (t) => (/^\s*(.+?)\s*[-−–+]\s*\d+/.exec(str(t && t.def)) || [, ''])[1].trim();

// A trait's level: the number after its name ("2", "(2)", "(Level 2)", "2 [10]");
// the trait with no number is level 1. 0 when the trait is not there.
function levelOf(name, re) {
  const m = re.exec(str(name).replace(/\[[^\]]*\]/g, ''));
  if (!m) return 0;
  const n = /(\d+)/.exec(m[1]);
  return n ? parseInt(n[1], 10) : 1;
}
// The weapon row a trait names by the weapon (`Off-Hand Weapon Training (Vibro-Axe)`,
// `Weapon Bond (Grandfather's Saber)`), or null.
function weaponNamed(weapons, name) {
  const want = weaponStem(name);
  if (!want) return null;
  return weapons.find(w => !w.bySkill && (weaponStem(w.key) === want || norm(w.name) === norm(name))) || null;
}
function readTraits(advantages, match, weapons, say) {
  const t = { ambidextrous: false, offHand: [], halfRapid: false, telescopic: 0, nightVision: 0, weaponBond: [] };
  for (const a of advantages) {
    const n = str(a && a.name);
    if (/\bambidext/i.test(n)) t.ambidextrous = true;
    // Off-Hand Weapon Training names a skill; a sheet that names the weapon is read as that weapon's skill.
    const oh = /^\s*off-?\s*hand weapon training\s*\((.+)\)/i.exec(n);
    if (oh) {
      for (const s of oh[1].split(',')) {
        const said = s.trim();
        if (!said) continue;
        const hit = match(said);
        const w = hit ? null : weaponNamed(weapons, said);
        if (hit || w) t.offHand.push(hit ? hit.name : w.skill);
        else {
          t.offHand.push(said);
          say('warning', `Off-Hand Weapon Training (${said}) names no skill in the Skills table and no weapon row, so the off-hand −4 still applies`, `name the skill it is for${match.closest(said) ? ` (${match.closest(said)}?)` : ''}`);
        }
      }
    }
    // Weapon Bond: +1 with that one weapon (B99). The Skill cell's level includes it, as every
    // bonus of the row; it is named so the "+N included" line can say what the +1 is.
    const bond = /^\s*weapon bond\s*\((.+)\)/i.exec(n);
    if (bond) {
      const w = weaponNamed(weapons, bond[1].trim());
      if (!w) say('warning', `Weapon Bond (${bond[1].trim()}) names no weapon row, so its +1 is shown on none`, `name the weapon as its row does`);
      else {
        t.weaponBond.push(w.id);
        if (!w.bonuses.some(b => /weapon bond/i.test(b.name))) w.bonuses.push({ name: 'Weapon Bond', bonus: 1 });
      }
    }
    if (/\bweapon master\b|\btrained by a master\b/i.test(n)) t.halfRapid = true;
    // "No Targeting" means it gives nothing to an attack roll.
    if (!/no targeting/i.test(n)) t.telescopic = Math.max(t.telescopic, levelOf(n, /telescopic vision\b(.*)/i));
    t.nightVision = Math.max(t.nightVision, levelOf(n, /night vision\b(.*)/i));
  }
  return t;
}

// A technique's skill: the one its Default cell names, else the one its own bracket names
// (`Ranged Rapid Strike (Beam Weapons/Pistol)` with Default `Beam Weapons-6`).
const techniqueSkill = (t, match) => match(defSkillOf(t)) || match(bracketOf(t && t.name));

function readTechniques(techniques, match, locKeys, say) {
  const out = { targeted: [], dual: {}, other: [] };
  const seen = new Set();
  for (const t of techniques) {
    const name = str(t && t.name).trim();
    // Read twice (main table, then an "at a glance" table): the first row wins.
    if (!name || seen.has(norm(name))) continue;
    seen.add(norm(name));
    const level = firstInt(t && t.level, NaN);
    if (!Number.isFinite(level)) continue;
    const defSkill = defSkillOf(t);
    const targeted = /^targeted attack\s*\((.*)\)\s*$/i.exec(name);
    const dual = /^dual-weapon attack\s*\((.*)\)\s*$/i.exec(name);
    const skillNotFound = [`technique "${name}" names a skill that is not in the Skills table, so it is not offered`, 'spell the skill in full in its name and Default, as the Skills table has it'];
    if (targeted) {
      const inner = targeted[1]; const cut = inner.lastIndexOf('/');
      const word = cut < 0 ? '' : (/(\S+)\s*$/.exec(inner.slice(cut + 1)) || [, ''])[1].toLowerCase();
      const loc = locKeys.has(word) ? word : LOCATION_WORDS[word];
      if (!loc) { say('warning', `technique "${name}" names no hit location the calculator knows, so it is not offered`, `end its bracket with /Neck, /Vitals, /Arm and the like`); continue; }
      const bracket = inner.slice(0, cut).replace(/\s+(?:swing|thrust)$/i, '').trim();
      const hit = match(defSkill) || match(bracket);
      if (!hit) { say('warning', ...skillNotFound); continue; }
      out.targeted.push({ skill: hit.name, loc, net: level - hit.level, name });
    } else if (dual) {
      const hit = match(dual[1]) || match(defSkill);
      if (!hit) { say('warning', ...skillNotFound); continue; }
      out.dual[hit.name] = Math.max(0, Math.min(DUAL_PENALTY, level - (hit.level - DUAL_PENALTY)));
    } else if (defSkill || bracketOf(name)) {
      // A skill's default written in the Techniques table (`Guns (Rifle)` from Guns (Pistol)-2)
      // is a skill, for another weapon's row: not a technique to use with this one.
      if (match(name) || (defSkill && headOf(name) === headOf(defSkill))) continue;
      const hit = techniqueSkill(t, match);
      if (!hit) { say('warning', ...skillNotFound); continue; }
      out.other.push({ skill: hit.name, name, level });
    }
  }
  return out;
}

// The Equipment table's items, then any a load-out lists that the table does not: a
// load-out row's notes can name a sighting aid too.
function equipmentItems(eq) {
  const items = ((eq && eq.items) || []).filter(Boolean);
  const seen = new Set(items.map(i => norm(i.name)));
  const extra = [];
  for (const lo of (eq && eq.loadouts) || []) {
    for (const i of (lo && lo.items) || []) {
      if (!i || seen.has(norm(i.name))) continue;
      seen.add(norm(i.name));
      extra.push(i);
    }
  }
  return items.concat(extra);
}

// `report`, when given, is an array: each row the calculator cannot fully read is pushed to it
// as { severity: 'warning' | 'info', detail, fix, text }, for the build's Site Faults audit.
function buildTohitData(model, meta, report) {
  const m = model || {};
  const match = makeSkillMatcher(m.skills || []);
  const say = (severity, detail, fix) => {
    if (Array.isArray(report)) report.push({ severity, detail: `to-hit calculator: ${detail}`, fix, text: `to-hit calculator: ${detail}; ${fix}` });
  };
  const nextId = idMaker();
  const items = equipmentItems(m.equipment);
  const techRows = (m.techniques || []).filter(Boolean);
  const weapons = [];
  // `nth`: this row's place among the rows of the same name in its own table (the page reads that
  // row's live to-hit cell); `id` is unique, `key` is the name and may repeat.
  const addWeapon = (row, type, nth) => {
    const key = str(row && row.weapon);
    if (!key) return;
    const where = `${type === 'ranged' ? 'Ranged' : 'Melee'} Attacks row "${key.trim()}"`;
    const read = readWeaponSkill(row.skill, key);
    if (!read) {
      say('warning', `${where} is left out: its Skill cell "${str(row.skill).trim()}" has no level`, 'write it as the skill and its level (Brawling-12)');
      return;
    }
    let hit = match(read.skill);
    let technique = null;
    let base = hit ? hit.level : null;
    if (!hit && !read.skill) {
      // A bare number: the skill the Weapon cell names in its bracket (`Punch (Brawling)`),
      // else the weapon's own name when that is a skill (`Knife`).
      hit = match(bracketOf(key)) || match(weaponStem(key));
      base = hit ? hit.level : null;
      if (!hit) say('warning', `${where}: its Skill cell is a bare number, so the row gets no techniques, off-hand rule or "+N included" line`, 'write it as the skill and its level');
    } else if (!hit && ATTRIBUTES.has(norm(read.skill))) {
      if (!UNARMED.test(weaponStem(key))) say('warning', `${where}: its Skill cell names the attribute ${read.skill}, not a skill`, "name the weapon's skill at its default level, and add that skill to the Skills table at 0 points");
    } else if (!hit) {
      // A technique written as a weapon row (`Choke Hold-16`): read as its skill, with the technique.
      const t = techRows.find(x => norm(x.name) === norm(read.skill) || headOf(x.name) === norm(read.skill));
      const parent = t ? techniqueSkill(t, match) : null;
      if (parent) {
        hit = parent;
        technique = str(t.name).trim();
        const lv = firstInt(t.level, NaN);
        base = Number.isFinite(lv) ? lv : null;
        say('info', `${where} names the technique ${technique}, so it is read as ${parent.name} with that technique`, `the calculator offers ${technique} on the ${parent.name} rows too: keep this row only for its own damage or reach, with ${parent.name} in its Skill cell`);
      } else {
        const near = match.closest(read.skill);
        say('warning', `${where}: skill "${read.skill}" is not in the Skills table${near ? ` (nearest: "${near}")` : ''}, so the row gets no techniques, off-hand rule or "+N included" line`, 'name the skill as the Skills table does, or add it there at its default level for 0 points');
      }
    }
    const shown = shownLevel(row.skill);
    if (shown === null) say('warning', `${where}: its Skill cell "${str(row.skill).trim()}" does not end with its level, so the calculator cannot follow encumbrance on this row`, 'end the cell with its level and put any comment in Notes');
    if (read.pairs > 1) say('info', `${where}: its Skill cell holds ${read.pairs} levels; the calculator uses ${read.skill ? read.skill + ' ' : ''}${read.level}`, 'give each attack its own row');
    const notes = readRowNotes(row.notes);
    const w = {
      id: 'w' + weapons.length, key, type, nth,
      name: key.replace(/[*◇◆†‡]/g, '').replace(/\s+/g, ' ').trim() || key,
      skill: hit ? hit.name : read.skill, skillAs: read.skill, level: read.level,
      shown,
      base,
      range: str(row.range), damage: str(row.damage),
      beam: /^beam weapons/i.test(hit ? hit.name : read.skill),
      aids: [], bonuses: notes.bonuses,
    };
    if (technique) w.technique = technique;
    if (type === 'ranged') {
      const acc = readAccCell(row.acc);
      // An Equipment row named like this weapon is part of this weapon's own row.
      const stem = weaponStem(key);
      const own = items.filter(i => weaponStem(i.name) === stem).map(i => readRowNotes(i.notes));
      Object.assign(w, {
        acc: acc.acc, rof: firstInt(row.rof, 1) || 1, rcl: firstInt(row.rcl, 1) || 1,
        bulk: firstInt(row.bulk, 0),
      });
      // The same aid written twice (Acc `5+2` and Notes `Scope +2 Acc`): the later one stays,
      // since the Notes can say `fixed`.
      const all = [...acc.aids, ...notes.aids, ...own.flatMap(o => o.aids)];
      w.aids = all.filter((a, i) => !all.slice(i + 1).some(b => b.name === a.name))
        .map(a => ({ id: nextId('row', key, a.name), ...a, from: 'row', on: true }));
    }
    weapons.push(w);
  };
  for (const [rows, type] of [[m.melee || [], 'melee'], [m.ranged || [], 'ranged']]) {
    const seen = new Map();
    for (const r of rows) {
      const k = str(r && r.weapon);
      const nth = seen.get(k) || 0;
      seen.set(k, nth + 1);
      addWeapon(r, type, nth);
    }
  }

  const locations = buildLocations();
  const techniques = readTechniques(techRows, match, new Set(locations.map(l => l[0])), say);
  // A skill with techniques and no weapon row (Judo holds, Karate kicks) is offered as its own
  // entry at its Skills-table level. A shooting skill needs its weapon's numbers: said, not offered.
  const armed = new Set(weapons.map(w => w.skill));
  const lone = [...new Set([...techniques.other, ...techniques.targeted].map(t => t.skill))].filter(s => !armed.has(s));
  for (const skill of lone) {
    const hit = match(skill);
    if (!hit) continue;
    if (SHOOTING.test(skill)) {
      say('warning', `the techniques of ${skill} are not offered: no Ranged Attacks row uses ${skill}`, "add the weapon's row");
      continue;
    }
    weapons.push({
      id: 'w' + weapons.length, key: hit.name, type: 'melee', nth: 0, name: hit.name,
      skill: hit.name, skillAs: hit.name, level: hit.level, shown: null, base: hit.level,
      range: '', damage: '', beam: false, aids: [], bonuses: [], bySkill: true,
    });
  }
  for (const skill of Object.keys(techniques.dual)) {
    if (!weapons.some(w => w.skill === skill)) say('warning', `Dual-Weapon Attack (${skill}) is not offered: no weapon row uses ${skill}`, "add the weapon's row, or name the skill as the weapon's row does");
  }
  if (!weapons.length) return null;

  const stems = new Set(weapons.filter(w => !w.bySkill).map(w => weaponStem(w.key)));
  const advantages = (m.traits && m.traits.advantages) || [];
  const wide = [];
  for (const item of items) {
    if (stems.has(weaponStem(item.name))) continue;
    for (const g of charWideAids(item.name, item.notes)) wide.push({ ...g, id: nextId('gear', item.name, g.aid.name), from: 'gear' });
  }
  for (const a of advantages) {
    for (const g of charWideAids(a && a.name, '')) wide.push({ ...g, id: nextId('trait', a.name, g.aid.name), from: 'trait' });
  }
  // Of the same KIND of aid only the best starts on: the programs are one kind, an aid of
  // the same name is another. A spare starts off. Everything else starts on.
  const kind = (g) => (/ program$/.test(g.aid.name) ? 'program' : g.aid.name);
  const best = new Map();
  for (const g of wide) {
    if (g.off || g.aid.bonus === null) continue;
    const top = best.get(kind(g));
    if (!top || g.aid.bonus > top.aid.bonus) best.set(kind(g), g);
  }
  const aids = wide.map(g => ({
    id: g.id, ...g.aid, from: g.from,
    on: !g.off && (g.aid.bonus === null || best.get(kind(g)) === g),
  }));
  const traits = readTraits(advantages, match, weapons, say);

  // A row written above its skill by more than the bonuses it names: said, as information. A
  // character-wide skill bonus (a targeting program, a reflex sight) can account for it on a
  // ranged row, as the page's own reading of the row does.
  const skillAidBonuses = new Set(aids.filter(a => /program$|reflex sight/i.test(a.name) && a.bonus > 0).map(a => a.bonus));
  for (const w of weapons) {
    if (w.bySkill || w.base === null) continue;
    const named = w.bonuses.reduce((t, b) => t + (Number.isFinite(b.bonus) ? b.bonus : 0), 0);
    const over = w.level - w.base - named;
    if (over > 0 && !(w.type === 'ranged' && skillAidBonuses.has(over))) {
      say('info', `${w.type === 'ranged' ? 'Ranged' : 'Melee'} Attacks row "${w.name}": its level ${w.level} is ${w.level - w.base} over ${w.technique || w.skill} ${w.base}, and the row names ${named ? `only +${named} of bonuses` : 'no bonus'}`, 'name the rest in its Notes (+1 Weapon Bond), so the calculator can say what is included');
    }
  }

  const ff = match('Free Fall');
  return {
    pc: meta && meta.pcSlug,
    campaign: str(meta && meta.campaignId),
    weapons,
    aids,
    techniques,
    traits,
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

// The empty container the page script draws into, then its data block.
function tohitMarkup(data) {
  return `<div class="wide cat-table tohit" id="tohit-calc"></div>\n${tohitDataScript(data)}`;
}

module.exports = { buildTohitData, tohitDataScript, tohitMarkup };
