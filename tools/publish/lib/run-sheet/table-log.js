'use strict';
// A session's Table Log, read: its `##` sections and its end-of-session vitals (the shape is in
// skills/shared/session-document-chain.md §3c). Read-only and pure. Works with what it has: a log that
// is empty, hand-made, missing a section or holding an odd cell reads to what is there, never a throw.

const pt = require('./plan-text');
const { canonicalNfc } = require('../unicode');
const { SYSTEM_VITALS } = require('../shared-lists');

const low = (s) => canonicalNfc(String(s == null ? '' : s)).trim().toLowerCase();

// The sections by title, matched in any case: `get('Vitals at the end')` finds `## vitals AT the end`.
class Sections extends Map {
  get(name) { return super.get(low(name)); }
  has(name) { return super.has(low(name)); }
  set(name, text) { return super.set(low(name), text); }
}

const VITALS = 'Vitals at the end';
// `current/max`, `current of max` or `current`, then an optional `hp` and a `(note)`; current may be
// below zero (a dying ally, GURPS), written with a hyphen or a typed minus sign (U+2212).
const HP_CELL = /^(-?\d+)\s*(?:(?:\/|\bof\b)\s*(\d+))?\s*(?:hp\b)?\s*(?:\([^)]*\))?$/i;
// The columns a header row names (any case): Who, HP and Conditions, and the pools a system adds (step 6b, the
// ontology's `run_sheet.vitals` of every system: CoC's MP, SAN and Luck, GURPS's FP), by their column word or the long
// name a hand-writer may use. A table with no header row is read by position, Who, HP, Conditions, in every system:
// it is someone's hand-written log, and its third cell is never a pool.
const LONG = { hp: 'hit points', mp: 'magic points', san: 'sanity', fp: 'fatigue points' };
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Each pool column once (the first system to name it), with its max field: { field, column, max }.
const POOL_COLUMNS = [];
for (const cols of Object.values(SYSTEM_VITALS)) {
  for (const c of cols) {
    if (c.field === 'hp' || c.field === 'conditions' || POOL_COLUMNS.some((x) => x.field === c.field)) continue;
    POOL_COLUMNS.push({ field: c.field, column: c.column, max: c.max || null });
  }
}
const COLUMNS = { who: /^who$/, hp: /^(?:hp|hit points)$/, conditions: /^conditions?$/ };
for (const c of POOL_COLUMNS) {
  COLUMNS[c.field] = new RegExp(`^(?:${[c.column, LONG[c.field]].filter(Boolean).map((w) => escRe(w.toLowerCase())).join('|')})$`);
}
const BY_POSITION = { who: 0, hp: 1, conditions: 2 };
// A pool's figure on a vitals entry is named as a PC sheet's readers name it: `mpNow`, `sanNow`, `fpNow`, and Luck's
// `luck`; its max is the column's `max` field (`mpMax`), null when the cell gives none. Luck has no max.
const nowName = (field) => (field === 'luck' ? 'luck' : `${field}Now`);

// A Who cell's note: its first link's target (a pipe alias dropped), else the cell's own text.
function whoOf(cell) {
  const target = pt.links(cell)[0] || String(cell || '');
  return target.replace(/\\+$/, '').trim();
}

// A copy number: the trailing number after the Who cell's link (`[[Guard]] 2` is the second Guard).
function copyOf(cell) {
  const m = /\]\]\s*(\d+)\s*$/.exec(String(cell || ''));
  return m ? Number(m[1]) : null;
}

// Each table under the vitals section as { columns, rows }: the columns from its header row (a row
// directly above a `---` separator; `*` and `_` emphasis ignored), else by position. A header row that
// names none of them gives `columns: null`: the table is not read, never guessed by position.
function vitalsTables(text) {
  const lines = text.split('\n');
  return pt.tableRanges(text).map((r) => {
    const headed = r.start + 1 <= r.end && pt.isSeparatorRow(lines[r.start + 1]);
    const all = pt.tableRows(lines.slice(r.start, r.end + 1).join('\n'));
    let columns = BY_POSITION;
    if (headed) {
      const head = pt.tableRows(lines[r.start])[0].map((h) => low(String(h).replace(/[*_]/g, '')));
      const named = {};
      for (const [k, re] of Object.entries(COLUMNS)) {
        const i = head.findIndex((h) => re.test(h));
        if (i >= 0) named[k] = i;
      }
      columns = Object.keys(named).length ? { ...named, who: named.who === undefined ? 0 : named.who } : null;
    }
    return { columns, rows: all };
  });
}

// `unread`: the rows whose HP cell holds something that is not a number, `{ who, copy, cell }` (an empty
// cell is no figure and not listed), and the same for a pool's cell with its `field` ('mp', 'san', 'luck',
// 'fp'); `unnamed`: how many tables have a header row naming no column. Both are for the reader to warn about.
// A pool's figures are on an entry only when its table has that column, so a log before 6b reads as it did.
function readTableLog(text) {
  const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const body = src.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '');
  const sections = new Sections();
  for (const sec of pt.sections(body, 2)) {
    // The text before the first `##` (the title) is no section; the first of two same-named ones counts.
    if (!sec.title || sections.has(sec.title)) continue;
    sections.set(sec.title, sec.text);
  }
  const vitals = [];
  const unread = [];
  let unnamed = 0;
  const cell = (cells, i) => (i === undefined ? '' : String(cells[i] || '').trim());
  for (const { columns, rows } of vitalsTables(sections.get(VITALS) || '')) {
    if (!columns) { unnamed++; continue; }
    for (const cells of rows) {
      const who = whoOf(cell(cells, columns.who));
      if (!who) continue;
      const hpText = cell(cells, columns.hp);
      const hp = HP_CELL.exec(hpText.replace(/\u2212/g, '-'));
      const copy = copyOf(cell(cells, columns.who));
      if (!hp && hpText) unread.push({ who, copy, cell: hpText });
      const entry = {
        who,
        copy,
        hpNow: hp ? Number(hp[1]) : null,
        hpMax: hp && hp[2] !== undefined ? Number(hp[2]) : null,
      };
      for (const { field, max } of POOL_COLUMNS) {
        const now = nowName(field);
        if (columns[field] === undefined) continue;
        const text = cell(cells, columns[field]);
        const m = HP_CELL.exec(text.replace(/\u2212/g, '-'));
        if (!m && text) unread.push({ who, copy, cell: text, field });
        entry[now] = m ? Number(m[1]) : null;
        if (max) entry[max] = m && m[2] !== undefined ? Number(m[2]) : null;
      }
      entry.conditions = cell(cells, columns.conditions);
      vitals.push(entry);
    }
  }
  return { sections, vitals, unread, unnamed };
}

module.exports = { readTableLog, VITALS };
