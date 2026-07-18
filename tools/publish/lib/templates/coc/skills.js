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

function normalizeName(name) {
  // Collapse an empty specialisation placeholder ("Art/Craft ()") — which the
  // shipped template ships for every specialisable skill — onto its canonical
  // parent, so a freshly-templated sheet doesn't render phantom "()" rows that
  // also suppress the real parent.
  const stripped = String(name || '').trim().replace(/\s*\(\s*\)\s*$/, '').trim();
  const key = stripped.toLowerCase();
  return SKILL_ALIASES[key] || stripped;
}
function parentOf(name) {
  const m = String(name).match(/^(.*?)\s*\(/);
  return m ? m[1].trim() : null;
}

// pcSkills: [{ name, base, reg }] parsed from the sheet.
function mergeSkills(pcSkills, variant) {
  const canonical = variant === 'base' ? BASE_SKILLS : REGENCY_SKILLS;
  const byName = new Map(); // keyed by lowercased canonical name
  for (const c of canonical) {
    byName.set(c.name.toLowerCase(), { name: c.name, base: c.base, reg: c.base });
  }
  const specParents = new Set();
  for (const pc of (pcSkills || [])) {
    const name = normalizeName(pc.name);
    const key = name.toLowerCase();
    const existing = byName.get(key);
    const base = existing ? existing.base : (Number(pc.base) || 0);
    // A blank/absent Regular means the skill was never developed — keep it at its
    // base default. (Number(null) is 0, so guard the empty cell explicitly.)
    const blank = pc.reg == null || (typeof pc.reg === 'string' && pc.reg.trim() === '');
    const regNum = Number(pc.reg);
    const reg = (blank || !Number.isFinite(regNum)) ? base : regNum;
    byName.set(key, { name: existing ? existing.name : name, base, reg });
    const p = parentOf(name);
    if (p && GENERIC_PARENTS.has(p.toLowerCase())) specParents.add(p.toLowerCase());
  }
  let rows = Array.from(byName.values());
  // Drop bare untouched generic parents that now have specialisations.
  rows = rows.filter(s => !(specParents.has(s.name.toLowerCase()) && s.reg === s.base));
  return rows
    .map(s => ({
      name: s.name, reg: s.reg, half: half(s.reg), fifth: fifth(s.reg),
      developed: s.reg > s.base,
    }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

module.exports = { mergeSkills, normalizeName, REGENCY_SKILLS, BASE_SKILLS };
