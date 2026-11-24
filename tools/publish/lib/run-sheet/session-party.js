'use strict';
// The session's own party: who sat at this session's table, as PC note paths for `readPcs`.
// The order, first source that names at least one PC wins (one that names none falls through):
//   1. a list field on the session index (`pcs`, `party`, `players_present`, `present`, `attendance`, `characters`);
//   2. the session's wrap-up, the subjects of its `### PC Carry-Forward` entries;
//   3. the Plan's `## PC Roster & Arcs`;
//   4. `given`, the caller's list (the active PCs).
// In the live app source 2 never fires: a wrapped-up session cannot be opened (`pickSession`), so
// tonight's party comes from the index field, the Plan roster or the active PCs [P-S1]. It is here
// for the reader on its own and for the no-Plan page.
// Names and links resolve through `index.resolve`. Never throws.
// `warnings` (final review O3): one `missing-pc` for each name or link the index field lists, and each link the
// Plan's roster holds (a plain roster name, a heading or a bold label, may be a label, so only a link counts
// there), that is no PC: the GM sees who was left out, as 5b's party said. A link to a note that is no PC (an NPC
// Ben) is that note's, never a PC's first name.

const path = require('node:path');
const pt = require('./plan-text');
const { stemOf } = require('./notes');
const { wrapUpOf } = require('./sessions');
const { displayTitleOf } = require('../scanner');
const { canonicalNfc } = require('../unicode');

const FIELDS = ['pcs', 'party', 'players_present', 'present', 'attendance', 'characters'];
const low = (s) => canonicalNfc(String(s == null ? '' : s)).replace(/[_*`]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

function sessionParty({ index, sessionPath, planBody, given, planPath = null }) {
  const warnings = [];
  const fmOf = (p) => (p && index.has(p) ? index.read(p).fm || {} : {});
  // A note whose frontmatter does not parse is let through a link: `readPcs` warns about it by name.
  const isPc = (p) => !!p && index.has(p) && (String(fmOf(p).type || '').trim().toLowerCase() === 'pc' || !!index.read(p).unreadable);
  const pcNotes = index.notes().filter((n) => String(fmOf(n).type || '').trim().toLowerCase() === 'pc');
  const byName = new Map();
  const firsts = new Map();
  for (const n of pcNotes) {
    const full = low(stemOf(n));
    byName.set(full, n);
    const f = full.split(' ')[0];
    firsts.set(f, firsts.has(f) ? null : n);
  }
  // A link or a plain name to a PC note path, or null. A first name counts only when one PC has it.
  const pcOf = (link, name) => {
    if (link) {
      const hit = index.resolve(link);
      if (isPc(hit)) return hit;
      if (hit && index.has(hit)) return null;
    }
    const k = low(name || link);
    return (k && (byName.get(k) || firsts.get(k))) || null;
  };
  // `where` names the source for a warning (null: none, the wrap-up's); `strict` warns for plain names too (the
  // index field), else links only
  const collect = (items, where, note, strict) => {
    const out = [];
    for (const [link, name] of items) {
      const p = pcOf(link, name);
      if (p) { if (!out.includes(p)) out.push(p); continue; }
      const shown = link ? `[[${link}]]` : String(name || '').trim();
      if (!where || !shown || (!link && !strict)) continue;
      const hit = link ? index.resolve(link) : null;
      const why = hit && index.has(hit) ? 'links a note that is no PC' : 'names no PC in the vault';
      warnings.push({ kind: 'missing-pc', note, text: `${where} lists ${shown}, which ${why}: left out of tonight's party` });
    }
    return out;
  };
  const items = (text) => {
    const l = pt.links(text)[0] || null;
    return [l, l ? null : String(text).replace(/\|.*$/, '').trim()];
  };

  // 1. the session index's list field
  const fm = fmOf(sessionPath);
  const field = FIELDS.find((k) => fm[k] !== undefined && fm[k] !== null && fm[k] !== '');
  if (field) {
    const v = fm[field];
    const party = collect((Array.isArray(v) ? v : String(v).split(/[,;\n]/)).map((x) => items(String(x))).filter(([l, n]) => l || n),
      `the session's \`${field}\``, sessionPath, true);
    if (party.length) return { party, from: 'index', warnings };
  }

  // 2. the wrap-up's PC Carry-Forward entries
  if (sessionPath) {
    const pages = index.notes().map((p) => ({
      title: stemOf(p), vaultPath: p.replace(/\.md$/i, ''), displayTitle: displayTitleOf(fmOf(p), stemOf(p)),
      frontmatter: fmOf(p), sourcePath: path.posix.join('/', p), rel: p,
    }));
    const wrap = wrapUpOf(index, sessionPath, pages);
    const sec = wrap ? [3, 2].map((n) => pt.sections(index.read(wrap).body, n).find((s) => /^pc\s+carry[- ]?forward/i.test(s.title))).find(Boolean) : null;
    if (sec) {
      const lines = sec.text.split('\n');
      const heads = lines.filter((l) => /^#{4}\s/.test(l)).map((l) => items(l.replace(/^#+\s+/, '').split(/\s[—–-]\s|\s\(/)[0]));
      // an entry is a heading when the section has any; else a top-level bullet led by a bold subject
      const subjects = heads.length ? heads : lines.map((l) => /^[-*]\s+\*\*(.+?)\*\*/.exec(l)).filter(Boolean).map((m) => items(m[1].replace(/:\s*$/, '')));
      const party = collect(subjects, null, wrap, false);
      if (party.length) return { party, from: 'wrapup', warnings };
    }
  }

  // 3. the Plan's PC Roster & Arcs
  const roster = pt.sections(planBody || '', 2).find((s) => /^pc\s+roster/i.test(s.title));
  if (roster) {
    const subjects = [];
    for (const h of roster.text.split('\n').filter((l) => /^#{3,}\s/.test(l))) subjects.push(items(h.replace(/^#+\s+/, '').split(/\s[—–-]\s|\s\(/)[0]));
    for (const cells of pt.tableRows(roster.text)) if (cells[0]) subjects.push(items(cells[0].replace(/[*]/g, '')));
    for (const b of pt.bullets(roster.text)) {
      const m = /^\*\*(.+?)\*\*/.exec(b.text);
      if (!m) continue;
      const subject = items(m[1].replace(/:\s*$/, ''));
      // A bullet led by a nickname and its player ("Wen (Sam)") takes the one PC its "Sheet:" link names. Only that
      // shape: a label ("State:", "Next beat:", "Note:") never does, and a link not after "Sheet:" names no one.
      const nick = /^[^()]+\([^()]+\)\s*:?$/.test(m[1].trim());
      const sheet = nick && !subject[0] && !pcOf(null, subject[1]) ? /\bSheet:\s*(\[\[[^\]]+\]\])/i.exec(b.text) : null;
      const linked = sheet ? index.resolve(pt.links(sheet[1])[0]) : null;
      subjects.push(linked && isPc(linked) ? [linked, null] : subject);
    }
    const party = collect(subjects, 'the Plan\'s PC Roster', planPath, false);
    if (party.length) return { party, from: 'plan', warnings };
  }

  // 4. the caller's list
  return { party: Array.isArray(given) ? given : [], from: 'given', warnings };
}

module.exports = { sessionParty };
