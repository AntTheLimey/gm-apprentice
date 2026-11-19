'use strict';
// The party's PCs for the run sheet. Who is in the party comes from the caller (the Plan only says
// what to do with them); the Plan's Spotlight, Touchpoint and Roster lines are matched onto them.
// Never throws: a PC missing rows reads with null numbers and '' text, and a warning where it helps.

const { canonicalNfc } = require('../unicode');
const { replaceWikilinks, parseWikilink } = require('../wikilink');
const { sections, tableRows, tableRanges, bullets, unclaimed, labels, cleanText, links } = require('./plan-text');
const { stemOf } = require('./notes');
const { SIGNED_SOURCE, toNumber } = require('./signed');

const low = (s) => canonicalNfc(String(s || '')).trim().toLowerCase();
// The note names a cell links, as plain words: `[[Ada Moss|Ada]]` is `Ada Moss`. Matches a PC by name.
const linkedNames = (cell) => replaceWikilinks(String(cell), (_l, body) => parseWikilink(body).name)
  .replace(/[*_`]/g, '').trim();

// A bullet line's subject, the parenthesis after a bold name (or ''), and the rest:
// `**Name:** rest`, `**[[Name]]:** rest`, `**[[Name]]** (Player): rest`.
function bulletSubject(text) {
  const m = text.match(/^\*\*(.+?)\*\*[ \t]*(.*)$/s);
  if (!m) return null;
  let name = m[1];
  let rest = m[2];
  let paren = '';
  if (/:\s*$/.test(name)) {
    name = name.replace(/:\s*$/, '');
  } else {
    const p = rest.match(/^\(([^)]*)\)/);
    if (p) paren = p[1].trim();
    rest = rest.replace(/^(?:\([^)]*\))?[ \t]*:?[ \t]*/, '');
  }
  return { name: linkedNames(name), link: links(name)[0] || null, paren, rest: rest.trim() };
}

const SECTIONS = [
  { re: /^spotlight/i, field: 'spotlight' },
  { re: /^touchpoint/i, field: 'touchpoint' },
  { re: /^pc\s+roster/i, field: 'roster' },
];

const numberFrom = (cell, signed) => {
  const t = String(cell || '').trim();
  if (signed && new RegExp(`^(?:${SIGNED_SOURCE}|\\d+)(?:\\.\\d+)?$`).test(t)) return toNumber(t);
  return /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
};

function statsOf(body) {
  const rows = tableRows(body);
  const pick = (label, signed) => {
    for (const r of rows) {
      if (r[0] !== label) continue;
      const n = numberFrom(r[1], signed);
      if (n !== null) return n;
    }
    return null;
  };
  return { ac: pick('AC'), hpMax: pick('HP (Max)'), hpNow: pick('HP (Current)'), init: pick('Initiative', true) };
}

function threadOf(body) {
  const lines = cleanText(body).split('\n');
  const l = labels(body).find((x) => low(x.name) === 'open threads');
  if (!l) return '';
  if (l.value && !/^[—–-]+$/.test(l.value)) return l.value;
  if (l.value) return '';
  const after = lines.slice(l.end + 1).join('\n');
  const first = bullets(after)[0];
  // the bullet must start the text that follows, not some later list
  return first && first.start <= after.split('\n').findIndex((x) => x.trim() !== '') ? first.text.trim() : '';
}

function readPcs(planBody, index, party) {
  const warnings = [];
  const seen = new Set();
  const warn = (kind, note, text) => {
    const k = JSON.stringify([kind, note, text]);
    if (!seen.has(k)) { seen.add(k); warnings.push({ kind, note, text }); }
  };
  const list = Array.isArray(party) ? party : [];
  if (list.length === 0) warn('no-party', null, 'no party was given: the sheet shows no PCs');

  const all = index.notes();
  const pcs = [];
  for (const given of list) {
    const want = canonicalNfc(String(given || ''));
    const p = all.find((n) => canonicalNfc(n) === want) || null;
    const note = index.read && p ? p : null;
    const fm = note ? index.read(note).fm : null;
    if (!note || String(fm.type || '').toLowerCase() !== 'pc') {
      if (!note) warn('missing-pc', null, `${given} is in the party but not in the vault`);
      else if (index.read(note).unreadable) warn('unreadable-pc', note, `${given}: frontmatter does not parse, so it cannot be read as a PC: left out of the party`);
      else warn('not-a-pc', note, `${given} is not a PC note in the vault: left out of the party`);
      continue;
    }
    if (pcs.some((x) => x.note === note)) continue;
    const body = index.read(note).body;
    // a portrait that cannot be found is the index's warning, never a throw
    const portrait = index.portrait(note);
    pcs.push({
      note,
      name: stemOf(note),
      player: String(fm.player_name || ''),
      portrait,
      role: '', moment: '', touch: '', arc: '',
      thread: threadOf(body),
      ...statsOf(body),
    });
  }
  pcs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const matchPc = (name, link) => {
    const target = link ? index.resolve(link) : null;
    if (target) { const hit = pcs.find((p) => p.note === target); if (hit) return hit; }
    const k = low(name);
    if (!k) return null;
    const full = pcs.find((p) => low(p.name) === k);
    if (full) return full;
    const firsts = pcs.filter((p) => low(p.name).split(/\s+/)[0] === k);
    if (firsts.length > 1) {
      warn('ambiguous-pc', null, `"${name}" is the first name of ${firsts.length} party PCs (${firsts.map((p) => p.name).join(', ')}): the line is left unmatched`);
      return null;
    }
    return firsts[0] || null;
  };
  const add = (pc, field, text) => { if (text) pc[field] = pc[field] ? `${pc[field]}\n${text}` : text; };

  const unmatched = [];
  for (const sec of sections(planBody, 2)) {
    const kind = SECTIONS.find((s) => s.re.test(sec.title));
    if (!kind) continue;
    const apply = (name, link, cells, given, raw, paren = '') => {
      const pc = matchPc(name, link);
      if (!pc) { unmatched.push({ section: sec.title, text: raw }); return; }
      // a parenthesis that is not the PC's player says something about the line: it is kept
      const rest = paren && low(paren) !== low(pc.player) ? `(${paren}) ${given}`.trim() : given;
      if (kind.field === 'spotlight') {
        if (cells) { add(pc, 'role', cells[1] || ''); add(pc, 'moment', cells.slice(2).join(' · ')); } else add(pc, 'moment', rest);
      } else if (kind.field === 'touchpoint') {
        add(pc, 'touch', cells ? cells.slice(1).join(' · ') : rest);
      } else {
        add(pc, 'arc', cells ? cells.slice(1).join(' · ') : rest);
      }
    };
    for (const cells of tableRows(sec.text)) {
      if (!cells[0]) { if (cells.some(Boolean)) unmatched.push({ section: sec.title, text: cells.join(' | ').trim() }); continue; }
      apply(linkedNames(cells[0]), links(cells[0])[0] || null, cells, '', cells.join(' | '));
    }
    for (const b of bullets(sec.text)) {
      const s = bulletSubject(b.text);
      if (!s) { unmatched.push({ section: sec.title, text: b.text }); continue; }
      apply(s.name, s.link, null, s.rest, b.text, s.paren);
    }
    // prose lines no row or bullet took are kept, one per line
    for (const line of unclaimed(sec.text, [...tableRanges(sec.text), ...bullets(sec.text)]).split('\n')) {
      if (line.trim()) unmatched.push({ section: sec.title, text: line.trim() });
    }
  }
  return { pcs, unmatched, warnings };
}

module.exports = { readPcs, SECTIONS };
