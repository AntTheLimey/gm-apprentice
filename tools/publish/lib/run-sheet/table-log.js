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
const HP_CELL = /^(\d+)\s*(?:\/\s*(\d+))?$/;

// A Who cell's note: its first link's target (a pipe alias dropped), else the cell's own text.
function whoOf(cell) {
  const target = pt.links(cell)[0] || String(cell || '');
  return target.replace(/\\+$/, '').trim();
}

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
  for (const cells of pt.tableRows(sections.get(VITALS) || '')) {
    const who = whoOf(cells[0]);
    if (!who) continue;
    const hp = HP_CELL.exec(String(cells[1] || '').trim());
    vitals.push({
      who,
      hpNow: hp ? Number(hp[1]) : null,
      hpMax: hp && hp[2] !== undefined ? Number(hp[2]) : null,
      conditions: String(cells[2] || '').trim(),
    });
  }
  return { sections, vitals };
}

module.exports = { readTableLog, VITALS };
