'use strict';
// A session's Table Log, read: its `##` sections and its end-of-session vitals (the shape is in
// skills/shared/session-document-chain.md §3c). Read-only and pure. Works with what it has: a log that
// is empty, hand-made, missing a section or holding an odd cell reads to what is there, never a throw.

const pt = require('./plan-text');
const { canonicalNfc } = require('../unicode');

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
// The columns a header row names (any case); a table with no header row is read by position.
const COLUMNS = { who: /^who$/, hp: /^(?:hp|hit points)$/, conditions: /^conditions?$/ };
const BY_POSITION = { who: 0, hp: 1, conditions: 2 };

// A Who cell's note: its first link's target (a pipe alias dropped), else the cell's own text.
function whoOf(cell) {
  const target = pt.links(cell)[0] || String(cell || '');
  return target.replace(/\\+$/, '').trim();
}

// Each table under the vitals section as { columns, rows }: the columns from its header row when it
// has one that names any of them, else by position.
function vitalsTables(text) {
  const lines = text.split('\n');
  return pt.tableRanges(text).map((r) => {
    const headed = r.start + 1 <= r.end && pt.isSeparatorRow(lines[r.start + 1]);
    const all = pt.tableRows(lines.slice(r.start, r.end + 1).join('\n'));
    let columns = BY_POSITION;
    if (headed) {
      const head = pt.tableRows(lines[r.start])[0].map(low);
      const named = {};
      for (const [k, re] of Object.entries(COLUMNS)) {
        const i = head.findIndex((h) => re.test(h));
        if (i >= 0) named[k] = i;
      }
      if (Object.keys(named).length) columns = { who: named.who === undefined ? 0 : named.who, hp: named.hp, conditions: named.conditions };
    }
    return { columns, rows: all };
  });
}

// `unread`: the rows whose HP cell holds something that is not a number, `{ who, cell }` (an empty
// cell is no figure and not listed), for the reader to warn about.
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
  const cell = (cells, i) => (i === undefined ? '' : String(cells[i] || '').trim());
  for (const { columns, rows } of vitalsTables(sections.get(VITALS) || '')) {
    for (const cells of rows) {
      const who = whoOf(cell(cells, columns.who));
      if (!who) continue;
      const hpText = cell(cells, columns.hp);
      const hp = HP_CELL.exec(hpText.replace(/\u2212/g, '-'));
      if (!hp && hpText) unread.push({ who, cell: hpText });
      vitals.push({
        who,
        hpNow: hp ? Number(hp[1]) : null,
        hpMax: hp && hp[2] !== undefined ? Number(hp[2]) : null,
        conditions: cell(cells, columns.conditions),
      });
    }
  }
  return { sections, vitals, unread };
}

module.exports = { readTableLog, VITALS };
