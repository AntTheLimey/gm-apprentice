'use strict';

const { splitTableRow } = require('../wikilink');
const { findHeadings, renderInline } = require('../processor');
const { splitReason, COLS, countCells, wholeNumber } = require('../templates/dnd/parse');
const { ATTRIBUTE_COLUMNS, cellText, filled, yesNo } = require('../templates/sheet-parse');
const { normalizeTitle } = require('../templates/gurps/tables');
const { liveKey, shown, trackable, holdsNothing, saysNone } = require('../templates/dnd/live-key');
const { conditionsOf } = require('../templates/dnd/live-data');
const { fitConditions } = require('../../js/dnd-live');

// Pure D&D vault-sheet write-back: put a live record's numbers into the note's own
// table cells. The principle: it changes only a cell the build treated as live. So it
// finds the sections, the table and the rows the way the build's parser does (the
// first section of a title, the first table in it, a row only when the parser would
// place it, a key only at its first row) and reads a cell with the build's
// own rules (whole numbers, splitReason, countCells, trackable, yesNo). A cell the
// build drew as written is left alone; a missing cell is never added. A saved value that
// could not be written is named in `skipped`, unless it is what its missing cell already
// means (0, none, No), when nothing is lost. Concentrating is never written.
// A saved record can be sent by anyone. A number is fitted before it is written. A
// condition is written only when it passes the page's own rule (fitConditions: letters,
// digits, spaces, apostrophes, hyphens, round brackets), and only into a Conditions cell
// that already holds nothing but such names. Text read from the note through the renderer
// is never written back as markdown: a cell holding anything else is left exactly as it is.
// No KV, no fs, no config.

const MAX_NAMED = 20;
const KEY_SHAPE = /^(?:hd|slot|class|species|feat|item|ds):[^\u0000-\u001f\u007f-\u009f\u2028\u2029]{1,80}$/;
const wellFormedKey = k => KEY_SHAPE.test(k);

const FEATURE_SECTIONS = [['class features', 'class'], ['species traits', 'species'], ['feats', 'feat']];

// A cell as the build's parser sees it: the cell rendered by the build's own markdown
// instance (links, emphasis, the typographer's quotes), then its text.
const plain = cell => cellText(renderInline(shown(String(cell == null ? '' : cell))));
const hasLink = raw => /\[\[|\]\(/.test(raw);

// The note's sections, subsections and tables, found as the build finds them: headings
// and code from the renderer's own parser (so a fence of either kind is exact), the
// front matter blanked out.
function readNote(lines) {
  const clean = lines.map(l => l.replace(/\r$/, ''));
  if (clean[0] && clean[0].trim() === '---') {
    const end = clean.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end > 0) for (let i = 0; i <= end; i++) clean[i] = '';
  }
  let headingAt = new Map(), inCode = new Set();
  try { ({ headingAt, inCode } = findHeadings(clean.join('\n'))); } catch (e) { return []; }
  const sections = [];
  let sec = null, sub = null;
  for (let i = 0; i < clean.length; i++) {
    const h = headingAt.get(i);
    if (h && !h.nested && h.level <= 3 && h.title !== '') {
      if (h.level === 2) { sec = { norm: normalizeTitle(h.title), subs: [], tables: [] }; sections.push(sec); sub = null; }
      else if (sec) { sub = { key: plain(h.title).toLowerCase(), tables: [] }; sec.subs.push(sub); }
      i = h.end - 1;
      continue;
    }
    if (!sec || inCode.has(i) || !/^\s*\|/.test(clean[i]) || i + 1 >= clean.length) continue;
    const cellsOf = line => { const segs = splitTableRow(line); return (/\|\s*$/.test(line) ? segs.slice(1, -1) : segs.slice(1)).map(c => c.trim()); };
    // A table as the renderer has it: a line of dashes under the header, one for each header cell.
    const headCells = cellsOf(clean[i]);
    const sepCells = cellsOf(clean[i + 1]);
    if (!/^\s*\|/.test(clean[i + 1]) || !sepCells.length || sepCells.length !== headCells.length || !sepCells.every(c => /^:?-+:?$/.test(c))) continue;
    const table = { header: headCells.map(plain), rows: [] };
    let j = i + 2;
    for (; j < clean.length && /^\s*\|/.test(clean[j]) && !inCode.has(j) && !headingAt.has(j); j++) {
      table.rows.push({ i: j, cells: cellsOf(clean[j]), trailing: /\|\s*$/.test(clean[j]) });
    }
    if (sub) sub.tables.push(table);
    sec.tables.push(table);
    i = j - 1;
  }
  return sections;
}

function applyDnDFlush(markdown, blob) {
  const changes = [];
  const skipped = [];
  if (!blob || typeof blob !== 'object') return { markdown, changes, skipped };
  const used = (blob.used && typeof blob.used === 'object') ? blob.used : {};
  // A saved number is fitted to the note as the page fits it (fit in js/dnd-live.js): a whole
  // number, never below 0, never above the cell's own maximum. A record saved before a
  // level-up must not leave a row over-spent: the build draws such a row as written.
  const number = v => typeof v === 'number' && Number.isFinite(v);
  const fitted = (v, max) => Math.max(0, Math.min(max, Math.round(v)));
  const has = k => number(used[k]);
  const carries = {
    hp: number(blob.hp),
    temp: number(blob.temp),
    exhaustion: number(blob.exhaustion),
    conditions: Array.isArray(blob.conditions),
    inspiration: typeof blob.inspiration === 'boolean',
  };
  const lines = String(markdown).split('\n');
  const sections = readNote(lines);
  const section = title => sections.find(s => s.norm === normalizeTitle(title));
  const subsection = (sec, key) => sec && sec.subs.find(s => s.key === key);

  const resolved = new Set();   // blob.used keys whose cell was read and is now right
  const tried = new Set();      // blob.used keys with a live row whose cell could not take the value
  const okScalar = new Set();

  // Rewrite content cell `idx` of a row to `to`; no change when it already reads so.
  // False when the row is short of that cell: the renderer pads such a row, so the page
  // shows it, but a cell is never added, and the caller names the value instead.
  const write = (row, idx, field, to) => {
    const segs = splitTableRow(lines[row.i]);
    const at = idx + 1;
    if (at >= segs.length - (row.trailing ? 1 : 0)) return false;
    const inner = segs[at].trim();
    if (to === inner) return true;
    segs[at] = inner ? segs[at].replace(inner, () => to) : ` ${to} `;
    lines[row.i] = segs.join('|');
    changes.push({ field, from: inner === '' ? null : inner, to });
    return true;
  };

  // A table's rows the build would place, for an `Attribute | Value` table. The first
  // table of the subsection; none when its header is not that shape.
  const attributeRows = (sec, key, everyRow) => {
    const table = subsection(sec, key) && subsection(sec, key).tables[0];
    if (!table || !ATTRIBUTE_COLUMNS.every((p, i) => p.test(table.header[i] || ''))) return [];
    return table.rows.filter(row => {
      if (!row.cells.some(c => plain(c))) return false;
      if (everyRow) return true;
      if (row.cells.slice(2).some(c => plain(c))) return false;
      if (hasLink(row.cells[0] || '')) return false;
      const value = row.cells[1] || '';
      if (hasLink(value)) {                      // only a reason may hold a link
        const m = value.match(/^(.*?\S)\s*\(([^()]+)\)$/);
        return !!m && !hasLink(m[1]) && hasLink(m[2]);
      }
      return true;
    }).map(row => ({ row, label: plain(row.cells[0]), raw: row.cells[1] || '' }));
  };
  // A cell read as the build reads a number: blank, a whole number (a reason may follow), or other.
  // `words`: a word that says none (None, N/A) is a blank too, as for Temp HP and Exhaustion.
  const readNumber = (raw, words) => {
    const t = filled(plain(raw));
    if (words ? saysNone(t) : holdsNothing(t)) return { blank: true };
    const v = splitReason(t).value;
    return /^\d+$/.test(v) ? { value: Number(v) } : { other: true };
  };
  // Change only the digits of a raw cell, keeping emphasis marks, a reason, spacing. The digit
  // runs the page reads (from the rendered text) must be the raw cell's own first runs, with
  // nothing but emphasis marks before them (and a slash between a pair); a link or markup that
  // merely renders as a number is not mappable and gives null. A blank cell takes the digits.
  const swapDigits = (raw, values) => {
    const r = raw.trim();
    if (r === '') return values.join('/');
    const want = plain(r).match(/\d+/g) || [];
    const have = [...r.matchAll(/\d+/g)];
    if (have.length < values.length || want.length < values.length) return null;
    if (!values.every((_, i) => have[i][0] === want[i])) return null;
    if (!/^[\s*_~`]*$/.test(r.slice(0, have[0].index))) return null;
    if (values.length === 2) {
      const between = r.slice(have[0].index + have[0][0].length, have[1].index);
      if (!/^[\s*_~`]*\/[\s*_~`]*$/.test(between)) return null;
    }
    let out = r;
    for (let i = values.length - 1; i >= 0; i--) out = out.slice(0, have[i].index) + values[i] + out.slice(have[i].index + have[i][0].length);
    return out;
  };
  // True when the cell now holds `n`. A cell that reads as blank (a dash, a placeholder) takes the number whole.
  const putNumber = (row, idx, label, n, raw, words) => {
    const to = readNumber(raw, words).blank ? String(n) : swapDigits(raw, [n]);
    return to !== null && write(row, idx, label, to);
  };

  const stat = section('stat sheet');
  const combat = stat ? attributeRows({ subs: firstOfEach(stat.subs) }, 'combat') : [];
  const core = stat ? attributeRows({ subs: firstOfEach(stat.subs) }, 'core') : [];
  const firstRow = re => combat.find(r => re.test(r.label));

  // Scalars. `live` is whether the page tracks the value at all; a cell in words is not live
  // either. A value is settled (not named) when its cell now holds it, or when it is what a
  // blank or missing cell already means: the page saves that for a value it does not track.
  const scalar = (key, re, dflt, most, live) => {
    if (!carries[key]) return;
    const to = fitted(blob[key], most);
    const hit = firstRow(re);
    const r = hit ? readNumber(hit.raw, true) : { blank: true };
    if (!live || r.other) { if (to === dflt) okScalar.add(key); return; }
    const current = r.blank ? dflt : Math.min(r.value, most);
    if (to === current || (hit && putNumber(hit.row, 1, hit.label, to, hit.raw, true))) okScalar.add(key);
  };
  // Hit points are live when the maximum is a number and the current cell is a number or
  // holds nothing, as the build has it (live-data.js); a missing current row reads as the maximum.
  const maxRow = firstRow(/^HP\s*\(\s*max(imum)?\.?\s*\)$/i);
  const maxRead = maxRow ? readNumber(maxRow.raw) : {};
  const curRow = firstRow(/^HP\s*(\(\s*cur(r(ent)?)?\.?\s*\))?$/i);
  const cur = curRow ? readNumber(curRow.raw) : { blank: true };
  const hpMax = maxRead.value !== undefined && !cur.other ? maxRead.value : null;
  if (hpMax !== null && carries.hp) {
    const current = cur.blank ? hpMax : Math.min(cur.value, hpMax);
    const to = fitted(blob.hp, hpMax);
    if (to === current || (curRow && putNumber(curRow.row, 1, curRow.label, to, curRow.raw))) okScalar.add('hp');
  }
  // Temporary hit points are set from the hit point tile: without one they are not live.
  scalar('temp', /^temp(orary)? HP$/i, 0, 9999, hpMax !== null);
  scalar('exhaustion', /^exhaustion$/i, 0, 6, true);

  // Conditions. The first Conditions row is live when the build placed it, it is plain text (no
  // link, no markup), and every name in it passes the rule; the same test as live-data.js. A live
  // cell is written with names that pass the rule, joined by `, `, or a dash for none. A cell that
  // is not live is the GM's own writing and is never rewritten: the page holds such conditions to
  // the note's, so the record is named only when it says something else.
  if (carries.conditions) {
    const isCond = r => /^conditions?$/i.test(r.label);
    const first = stat ? attributeRows({ subs: firstOfEach(stat.subs) }, 'combat', true).find(isCond) : undefined;
    const cond = combat.find(isCond);
    const names = row => conditionsOf(filled(plain(row.raw)));
    const all = cond ? names(cond) : [];
    const plainCell = !first || (cond && cond.row === first.row && !hasLink(cond.raw) && !/</.test(renderInline(shown(cond.raw))));
    const live = plainCell && fitConditions(all).join('\n') === all.join('\n');
    const said = blob.conditions.filter(c => typeof c === 'string');
    if (!live) {
      if (!said.length || said.join('\n') === all.join('\n') || (first && said.join('\n') === names(first).join('\n'))) okScalar.add('conditions');
    } else {
      const want = fitConditions(blob.conditions);
      if (want.join('\n') === all.join('\n') || (cond && write(cond.row, 1, cond.label, want.join(', ') || '—'))) okScalar.add('conditions');
    }
  }

  // The last placed Heroic Inspiration row is the one the build reads. A cell in words is not live.
  if (carries.inspiration) {
    const insp = core.filter(r => /^heroic inspiration$/i.test(r.label)).pop();
    const now = insp ? yesNo(filled(plain(insp.raw))) : false;
    if (now === blob.inspiration || (now === null && !blob.inspiration)
      || (insp && now !== null && write(insp.row, 1, insp.label, blob.inspiration ? 'Yes' : 'No'))) okScalar.add('inspiration');
  }

  // Counts: the first row of a key is the live one, as the build has it; if that row is not
  // trackable the key is not live and no later row of the name takes it over.
  const claimed = new Set();
  const count = (key, label, row, idx, max, spent, raw) => {
    if (claimed.has(key)) return;
    claimed.add(key);
    if (!trackable(max, spent)) return;
    if (!has(key)) return;
    const to = fitted(used[key], max);
    if (to === spent || putNumber(row, idx, label, to, raw)) resolved.add(key);
    else tried.add(key);
  };

  const hitDiceSeen = new Set();
  for (const { row, label, raw } of combat) {
    if (/^hit dice/i.test(label)) {
      const m = filled(plain(raw)).match(/^(\d+)\s*\/\s*(\d+)$/);
      if (!m) continue;
      const key = liveKey('hd', shown(label.replace(/\s*\(\s*spent\s*\/\s*max\s*\)\s*$/i, '')));
      if (hitDiceSeen.has(key)) continue;
      hitDiceSeen.add(key);
      if (!trackable(+m[2], +m[1])) continue;
      if (!has(key)) continue;
      const spent = fitted(used[key], +m[2]);
      if (spent === +m[1]) { resolved.add(key); continue; }
      const to = swapDigits(raw, [spent]);
      if (to !== null && write(row, 1, label, to)) resolved.add(key);
      else tried.add(key);
    }
  }
  const ds = combat.find(r => /^death saves/i.test(r.label));
  if (ds) {
    const m = filled(plain(ds.raw)).match(/^(\d+)\s*\/\s*(\d+)$/);
    if (m && +m[1] <= 3 && +m[2] <= 3 && has('ds:s') && has('ds:f')) {
      const made = fitted(used['ds:s'], 3), failed = fitted(used['ds:f'], 3);
      if (made === +m[1] && failed === +m[2]) { resolved.add('ds:s'); resolved.add('ds:f'); }
      else {
        const to = swapDigits(ds.raw, [made, failed]);
        if (to !== null && write(ds.row, 1, ds.label, to)) { resolved.add('ds:s'); resolved.add('ds:f'); }
        else { tried.add('ds:s'); tried.add('ds:f'); }
      }
    }
  }

  // A table of counted rows: the first table of its place, read by the build's own columns.
  const countedRows = (table, columns) => {
    if (!table || !columns.every((p, i) => p.test(table.header[i] || ''))) return [];
    return table.rows.filter(r => r.cells.some(c => plain(c)) && !r.cells.slice(columns.length).some(c => plain(c)));
  };
  for (const [title, kind] of FEATURE_SECTIONS) {
    const sec = section(title);
    for (const row of countedRows(sec && sec.tables[0], COLS.features)) {
      const c = row.cells.map(plain);
      const n = countCells(c[2], c[3]);
      if (!c[0] || !n || !Number.isInteger(n.uses)) continue;
      count(liveKey(kind, shown(c[0])), c[0], row, 3, n.uses, n.used || 0, row.cells[3] || '');
    }
  }
  const spell = section('spellcasting');
  const slotTable = subsection({ subs: firstOfEach(spell ? spell.subs : []) }, 'spell slots');
  for (const row of countedRows(slotTable && slotTable.tables[0], COLS.slots)) {
    if (row.cells.some(hasLink)) continue;
    const c = row.cells.map(plain);
    if (!c[1] && !c[2]) continue;
    const t = wholeNumber(c[1]);
    const e = c[2] ? wholeNumber(c[2]) : 0;
    if (t === null || e === null || e > t) continue;
    count(liveKey('slot', shown(c[0])), c[0], row, 2, t, e, row.cells[2] || '');
  }
  const equipment = section('equipment');
  const items = subsection({ subs: firstOfEach(equipment ? equipment.subs : []) }, 'magic items');
  for (const row of countedRows(items && items.tables[0], COLS.magicItems)) {
    const c = row.cells.map(plain);
    const n = countCells(c[2], c[3]);
    if (!c[0] || yesNo(c[1]) === null || !n || !Number.isInteger(n.uses)) continue;
    count(liveKey('item', shown(c[0])), c[0], row, 3, n.uses, n.used || 0, row.cells[3] || '');
  }

  // Named: a value the record carries that the note could not take. A count of 0 with no
  // live row to hold it has lost nothing (a renamed feature, a row the page shows as written).
  for (const k of ['hp', 'temp', 'exhaustion', 'conditions', 'inspiration']) if (carries[k] && !okScalar.has(k)) skipped.push(k);
  // A key is named only when it has the shape of a real one (the kinds live-key.js makes, a
  // short name with no control or line-separator character). The record is public, so any
  // other key is only counted, and past MAX_NAMED the rest are counted too: no text from the
  // record reaches the report except a well-formed key.
  const unplaced = Object.keys(used).filter(k => has(k) && !resolved.has(k) && (tried.has(k) || Math.round(used[k]) > 0));
  const named = unplaced.filter(wellFormedKey);
  const unrecognised = unplaced.length - named.length;
  skipped.push(...named.slice(0, MAX_NAMED));
  if (named.length > MAX_NAMED) skipped.push(`and ${named.length - MAX_NAMED} more`);
  if (unrecognised) skipped.push(`${unrecognised} unrecognised ${unrecognised === 1 ? 'entry' : 'entries'}`);
  return { markdown: changes.length ? lines.join('\n') : markdown, changes, skipped };
}

// The build reads only the first subsection of each title.
function firstOfEach(subs) {
  const seen = new Set();
  return subs.filter(s => (seen.has(s.key) ? false : (seen.add(s.key), true)));
}

module.exports = { applyDnDFlush };
