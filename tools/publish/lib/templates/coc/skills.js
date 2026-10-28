// tools/publish/lib/templates/coc/skills.js
const { REGENCY_SKILLS, BASE_SKILLS } = require('./skills-data');

const half = v => Math.floor(v / 2);
const fifth = v => Math.floor(v / 5);

// Legacy/abbreviated names seen on real sheets → canonical name.
const SKILL_ALIASES = {
  'mech. repair': 'Mechanical Repair',
  'mechanical repair': 'Mechanical Repair',
  'elec. repair': 'Electrical Repair',
  'drive carriage/cart': 'Drive Carriage',
  'operate hvy. machine': 'Operate Heavy Machinery',
  'language (english, own)': 'Language (Own)',
};
// Generic parents that take a specialisation; a bare untouched parent is
// suppressed when the PC has at least one specialisation of it.
const GENERIC_PARENTS = new Set(['art/craft', 'language', 'science', 'pilot', 'survival']);

const TRAILING_MARK = /[\s\u2713\u2714\u2611\u2705\uFE0E\uFE0F]+$/u;

function normalizeName(name) {
  // Collapse an empty specialisation placeholder ("Art/Craft ()") — which the
  // shipped template ships for every specialisable skill — onto its canonical
  // parent, so a freshly-templated sheet doesn't render phantom "()" rows that
  // also suppress the real parent.
  // A trailing check mark (the paper sheet's tick box, copied across) is not part of the name.
  const stripped = String(name || '').trim().replace(TRAILING_MARK, '').replace(/\s*\(\s*\)\s*$/, '').trim();
  const key = stripped.toLowerCase();
  return SKILL_ALIASES[key] || stripped;
}
function parentOf(name) {
  const m = String(name).match(/^(.*?)\s*\(/);
  return m ? m[1].trim() : null;
}

// A list entry's base as the templates write it: a number, or the characteristic share ("DEX/5", "EDU").
function baseText(entry) {
  if (entry.of) return entry.div === 1 ? entry.of : `${entry.of}/${entry.div}`;
  return String(entry.base);
}

// A list entry's base for this PC: a number, or null when it is a share of a characteristic the sheet does not give.
function baseFor(entry, chars) {
  if (!entry.of) return entry.base;
  const c = chars && chars[entry.of];
  const v = c ? Number(c.reg) : NaN;
  return c && c.reg != null && Number.isFinite(v) ? Math.floor(v / entry.div) : null;
}

// A base the note writes as a characteristic or a share of one ("EDU", "INT/5", as the templates do): { of, div }, or null.
const SHARE_RE = /^\s*(STR|CON|DEX|INT|SIZ|POW|APP|EDU)\s*(?:\/\s*(\d+))?\s*$/i;
function shareOf(text) {
  const m = SHARE_RE.exec(String(text || ''));
  return m ? { of: m[1].toUpperCase(), div: m[2] ? Number(m[2]) : 1 } : null;
}
// A base of the note's own, with no list to take it from: a characteristic share worked out from the PC's characteristics
// (null when the sheet does not give that characteristic, or the text names one the tool does not know, such as SAN/3,
// so it is never guessed at), else the number written.
function ownBase(pc, chars) {
  const share = shareOf(pc.baseText);
  if (share) return share.div > 0 ? baseFor(share, chars) : null;
  if (pc.baseText !== undefined && /^\s*[A-Za-z]{3}\s*\//.test(pc.baseText)) return null;
  return Number(pc.base) || 0;
}

// pcSkills: [{ name, base, baseText, reg }] parsed from the sheet; chars: { DEX: { reg }, … } from its Characteristics table.
// `variant` 'none' lays the note's skills over no list: only the skills it names, each with the base and value it writes.
// A skill whose base cannot be worked out (no such characteristic on the sheet) is left off unless the PC lists it,
// and a listed one shows its own value without a claim that it was developed: a flat guess would be wrong.
function mergeSkills(pcSkills, variant, chars) {
  const canonical = variant === 'none' ? [] : (variant === 'base' ? BASE_SKILLS : REGENCY_SKILLS);
  const byName = new Map(); // keyed by lowercased canonical name
  const known = new Map();  // every canonical skill, with its base for this PC (null: unknown)
  for (const c of canonical) {
    const base = baseFor(c, chars);
    known.set(c.name.toLowerCase(), { name: c.name, base });
    if (base !== null) byName.set(c.name.toLowerCase(), { name: c.name, base, reg: base });
  }
  const specParents = new Set();
  const listed = new Set();
  for (const pc of (pcSkills || [])) {
    const name = normalizeName(pc.name);
    const key = name.toLowerCase();
    listed.add(key);
    const existing = known.get(key);
    // With no list (variant 'none') a base comes from the note alone, worked out as the list's own are.
    const base = existing ? existing.base : (variant === 'none' ? ownBase(pc, chars) : (Number(pc.base) || 0));
    // A blank/absent Regular means the skill was never developed — keep it at its
    // base default. (Number(null) is 0, so guard the empty cell explicitly.)
    const blank = pc.reg == null || (typeof pc.reg === 'string' && pc.reg.trim() === '');
    const regNum = Number(pc.reg);
    if (base === null && (blank || !Number.isFinite(regNum))) continue;   // nothing to show but a guess
    const reg = (blank || !Number.isFinite(regNum)) ? base : regNum;
    byName.set(key, { name: existing ? existing.name : name, base, reg, worked: !!existing });
    const p = parentOf(name);
    if (p && GENERIC_PARENTS.has(p.toLowerCase())) specParents.add(p.toLowerCase());
  }
  let rows = Array.from(byName.values());
  // A note that names its native language (`Language (English)` at EDU or above) has no blank Language (Own) beside it.
  const own = byName.get('language (own)');
  if (own && !listed.has('language (own)') && own.base !== null
      && rows.some(s => /^language \((?!own\)|other\))/i.test(s.name) && s.reg >= own.base)) {
    rows = rows.filter(s => s !== own);
  }
  // Drop bare untouched generic parents that now have specialisations.
  rows = rows.filter(s => !(specParents.has(s.name.toLowerCase()) && s.reg === s.base));
  return rows
    .map(s => ({
      name: s.name, reg: s.reg, half: half(s.reg), fifth: fifth(s.reg),
      developed: s.base !== null && s.reg > s.base,
      // Written below the base worked out for it from the PC's characteristics; the sheet still shows the written number.
      ...(s.worked && s.base !== null && s.reg < s.base ? { belowBase: s.base } : {}),
    }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

module.exports = { mergeSkills, normalizeName, baseText, REGENCY_SKILLS, BASE_SKILLS };
