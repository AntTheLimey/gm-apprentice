// tools/publish/lib/templates/coc/parse.js
const { parseTableRows, findSectionByTitle, extractSubsectionHtml } = require('../gurps/tables');
const { mergeSkills } = require('./skills');

// "35 (starting 60)" -> { value: 35, note: 'starting 60' }; "—" -> { value: null }
function num(cell) {
  const s = String(cell == null ? '' : cell).trim();
  const m = s.match(/-?\d+/);
  const note = (s.match(/\(([^)]*)\)/) || [])[1] || null;
  const startM = note && note.match(/\d+/);
  return { value: m ? parseInt(m[0], 10) : null, note, start: startM ? parseInt(startM[0], 10) : null };
}
function int(cell) { const n = num(cell).value; return n == null ? null : n; }
function half(v) { return v == null ? null : Math.floor(v / 2); }
function fifth(v) { return v == null ? null : Math.floor(v / 5); }

function parseChars(statHtml) {
  const chars = {};
  const html = extractSubsectionHtml(statHtml, 'Characteristics') || '';
  for (const row of parseTableRows(html)) {
    const key = (row[0] || '').toUpperCase();
    if (['STR','CON','SIZ','DEX','INT','POW','APP','EDU'].includes(key)) {
      const reg = int(row[1]);
      chars[key] = { reg, half: half(reg), fifth: fifth(reg) };
    }
  }
  return chars;
}

function parseDerived(statHtml) {
  const d = { hp:{}, mp:{}, sanity:{}, luck:{} };
  const html = extractSubsectionHtml(statHtml, 'Derived') || '';
  for (const row of parseTableRows(html)) {
    const key = (row[0] || '').toLowerCase();
    const max = num(row[1]); const cur = num(row[2]);
    if (key === 'hp') d.hp = { cur: cur.value, max: max.value };
    else if (key === 'mp') d.mp = { cur: cur.value, max: max.value };
    else if (key === 'luck') d.luck = { cur: cur.value, start: cur.start };
    else if (key === 'sanity') d.sanity = { cur: cur.value, max: max.value, start: cur.start };
  }
  return d;
}

function parseReputation(statHtml) {
  const html = extractSubsectionHtml(statHtml, 'Reputation');
  if (!html) return null;
  const rep = { current: null, start: null, censure: null };
  for (const row of parseTableRows(html)) {
    const k = (row[0] || '').toLowerCase();
    if (k.includes('starting')) rep.start = int(row[1]);
    else if (k.includes('current')) rep.current = int(row[1]);
    else if (k.includes('censure')) rep.censure = (row[1] || '').replace(/—/, '').trim() || null;
  }
  return rep;
}

function parseCombat(statHtml) {
  const html = extractSubsectionHtml(statHtml, 'Combat') || '';
  const c = { move: null, build: null, db: null, dodge: {} };
  for (const row of parseTableRows(html)) {
    const k = (row[0] || '').toLowerCase();
    const v = (row[1] || '').trim();
    if (k === 'move') c.move = v;
    else if (k === 'build') c.build = v;
    else if (k.startsWith('damage bonus')) c.db = v;
    else if (k.includes('dodge') && k.includes('regular')) c.dodge.reg = int(v);
    else if (k.includes('dodge') && k.includes('half')) c.dodge.half = int(v);
    else if (k.includes('dodge') && k.includes('fifth')) c.dodge.fifth = int(v);
  }
  return c;
}

const CONDITION_KEYS = [
  ['temporary insanity', 'temporaryInsanity'], ['indefinite insanity', 'indefiniteInsanity'],
  ['major wound', 'majorWound'], ['unconscious', 'unconscious'], ['dying', 'dying'],
];
function parseConditions(statHtml) {
  const out = { temporaryInsanity:false, indefiniteInsanity:false, majorWound:false, unconscious:false, dying:false };
  const html = extractSubsectionHtml(statHtml, 'Status') || '';
  // Split into list items, strip tags, look for a ticked box next to a known label.
  const items = html.split(/<li[^>]*>/i).slice(1).map(s => s.replace(/<[^>]+>/g, ' '));
  for (const raw of items) {
    const text = raw.toLowerCase();
    const ticked = /\[x\]/.test(text) || /checked/.test(raw);
    if (!ticked) continue;
    for (const [needle, key] of CONDITION_KEYS) if (text.includes(needle)) out[key] = true;
  }
  return out;
}

function parseRawSkills(sections) {
  const sec = findSectionByTitle(sections, 'skills');
  if (!sec) return [];
  const out = [];
  for (const row of parseTableRows(sec.html)) {
    const name = (row[0] || '').trim();
    if (!name || /^skill$/i.test(name)) continue;
    out.push({ name, base: int(row[1]), reg: int(row[2]) });
  }
  return out;
}

function parseWeapons(sections) {
  // The top-level `## Combat` section (weapons table) — distinct from Stat Sheet ### Combat.
  const sec = sections.find(s => s.title.toLowerCase() === 'combat');
  if (!sec) return [];
  const out = [];
  for (const row of parseTableRows(sec.html)) {
    if (/^weapon$/i.test((row[0] || '').trim())) continue;
    if (!row[0] || !row[0].trim()) continue;
    out.push({ weapon: row[0], skill: row[1], damage: row[2], attacks: row[3], range: row[4], ammo: row[5], malf: row[6] });
  }
  return out;
}

// The `## Background` section carries `**Label:** value` lines (Personal
// Description, Ideology & Beliefs, …). Pull those labelled pairs for the
// sheet-face backstory strip; the full prose still renders in the Record tab.
// The label/value come from already-rendered HTML, so they carry entity
// encoding (e.g. `Ideology &amp; Beliefs`). Decode to plain text here; the
// layout re-escapes on output, so leaving entities in would double-encode.
function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&');
}

function parseBackstory(sections) {
  const sec = findSectionByTitle(sections || [], 'background');
  if (!sec || !sec.html) return [];
  const out = [];
  const re = /<strong>([^<]+?)<\/strong>\s*:?\s*([\s\S]*?)(?=<strong>|<\/p>|<p>|$)/gi;
  let m;
  while ((m = re.exec(sec.html)) !== null) {
    const label = decodeEntities(m[1].replace(/[:.]\s*$/, '')).trim();
    const value = decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim();
    if (label && value) out.push({ label, value });
  }
  return out;
}

function parseCoC(frontmatter, sections, system) {
  const fm = frontmatter || {};
  const secs = sections || [];
  const variant = /regency/i.test(String(system || '')) ? 'regency' : 'base';
  const stat = findSectionByTitle(secs, 'stat sheet');
  const statHtml = stat ? stat.html : '';
  const rawSkills = parseRawSkills(secs);
  return {
    variant,
    identity: {
      occupation: fm.occupation || '', nationality: fm.nationality || '',
      player: fm.player_name || '',
      ageSex: [fm.age, fm.gender].filter(Boolean).join(' · '),
      firstAppearance: fm.first_appearance || '', asOf: fm.asOfSession || '',
      era: fm.era || '',
    },
    chars: parseChars(statHtml),
    derived: parseDerived(statHtml),
    reputation: parseReputation(statHtml),
    combat: parseCombat(statHtml),
    conditions: parseConditions(statHtml),
    backstory: parseBackstory(secs),
    skills: mergeSkills(rawSkills, variant),
    weapons: parseWeapons(secs),
  };
}

module.exports = { parseCoC };
