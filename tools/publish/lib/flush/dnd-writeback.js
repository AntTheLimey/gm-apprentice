'use strict';

const { splitTableRow } = require('../wikilink');
const { findHeadings, renderInline } = require('../processor');
const { splitReason, COLS, countCells, wholeNumber } = require('../templates/dnd/parse');
const { ATTRIBUTE_COLUMNS, cellText, filled, yesNo } = require('../templates/sheet-parse');
const { normalizeTitle } = require('../templates/gurps/tables');
const { liveKey, shown, trackable } = require('../templates/dnd/live-key');

// Pure D&D vault-sheet write-back: put a live record's numbers into the note's own
// table cells. The principle: it changes only a cell the build treated as live. So it
// finds the sections, the table and the rows the way the build's parser does (the
// first section of a title, the first table in it, a row only when the parser would
// place it, a key only at its first row) and reads a cell with the build's
// own rules (whole numbers, splitReason, countCells, trackable, yesNo). A cell the
// build drew as written is left alone and named in `skipped`; a missing cell is
// skipped and named, never added. Concentrating is never written.
// No KV, no fs, no config.

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
    const sepCells = splitTableRow(clean[i + 1]).slice(1, -1);
    if (!/^\s*\|/.test(clean[i + 1]) || !sepCells.length || !sepCells.every(c => /^\s*:?-+:?\s*$/.test(c))) continue;
    const cellsOf = line => { const segs = splitTableRow(line); return (/\|\s*$/.test(line) ? segs.slice(1, -1) : segs.slice(1)).map(c => c.trim()); };
    const table = { header: cellsOf(clean[i]).map(plain), rows: [] };
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
  const has = k => typeof used[k] === 'number';
  const carries = {
    hp: typeof blob.hp === 'number',
    temp: typeof blob.temp === 'number',
    exhaustion: typeof blob.exhaustion === 'number',
    conditions: Array.isArray(blob.conditions),
    inspiration: typeof blob.inspiration === 'boolean',
  };
  const lines = String(markdown).split('\n');
  const sections = readNote(lines);
  const section = title => sections.find(s => s.norm === normalizeTitle(title));
  const subsection = (sec, key) => sec && sec.subs.find(s => s.key === key);

  const resolved = new Set();   // blob.used keys whose cell was read and is now right
  const okScalar = new Set();

  // Rewrite content cell `idx` of a row to `to`; no change when it already reads so.
  const write = (row, idx, field, to) => {
    const segs = splitTableRow(lines[row.i]);
    const at = idx + 1;
    if (at >= segs.length - (row.trailing ? 1 : 0)) return;
    const inner = segs[at].trim();
    if (to === inner) return;
    segs[at] = inner ? segs[at].replace(inner, () => to) : ` ${to} `;
    lines[row.i] = segs.join('|');
    changes.push({ field, from: inner === '' ? null : inner, to });
  };

  // A table's rows the build would place, for an `Attribute | Value` table. The first
  // table of the subsection; none when its header is not that shape.
  const attributeRows = (sec, key) => {
    const table = subsection(sec, key) && subsection(sec, key).tables[0];
    if (!table || !ATTRIBUTE_COLUMNS.every((p, i) => p.test(table.header[i] || ''))) return [];
    return table.rows.filter(row => {
      if (!row.cells.some(c => plain(c))) return false;
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
  const readNumber = raw => {
    const t = filled(plain(raw));
    if (t === '') return { blank: true };
    const v = splitReason(t).value;
    return /^\d+$/.test(v) ? { value: Number(v) } : { other: true };
  };
  const swapLeading = (raw, n) => { const m = raw.trim().match(/^(\d+)([\s\S]*)$/); return m ? String(n) + m[2] : null; };
  const putNumber = (r, idx, label, n, raw) => {
    if (r.blank) { write(r.row, idx, label, String(n)); return true; }
    const to = swapLeading(raw, n);
    if (to === null) return false;
    write(r.row, idx, label, to);
    return true;
  };

  const stat = section('stat sheet');
  const combat = stat ? attributeRows({ subs: firstOfEach(stat.subs) }, 'combat') : [];
  const core = stat ? attributeRows({ subs: firstOfEach(stat.subs) }, 'core') : [];
  const firstRow = re => combat.find(r => re.test(r.label));

  // Scalars.
  const scalar = (key, re, dflt) => {
    const hit = firstRow(re);
    if (!hit || !carries[key]) return;
    const r = readNumber(hit.raw);
    if (r.other) return;
    const current = r.blank ? dflt : (key === 'exhaustion' ? Math.min(r.value, 6) : r.value);
    okScalar.add(key);
    if (blob[key] === current) return;
    r.row = hit.row;
    if (!putNumber(r, 1, hit.label, blob[key], hit.raw)) okScalar.delete(key);
  };
  const maxRow = firstRow(/^HP\s*\(\s*max(imum)?\.?\s*\)$/i);
  const hpMax = maxRow && readNumber(maxRow.raw).value !== undefined ? readNumber(maxRow.raw).value : null;
  if (hpMax !== null) {
    const hit = firstRow(/^HP\s*(\(\s*cur(r(ent)?)?\.?\s*\))?$/i);
    if (hit && carries.hp) {
      const r = readNumber(hit.raw);
      if (!r.other) {
        const current = r.blank ? hpMax : Math.min(r.value, hpMax);
        okScalar.add('hp');
        if (blob.hp !== current) { r.row = hit.row; if (!putNumber(r, 1, hit.label, blob.hp, hit.raw)) okScalar.delete('hp'); }
      }
    }
  }
  scalar('temp', /^temp(orary)? HP$/i, 0);
  scalar('exhaustion', /^exhaustion$/i, 0);

  const cond = firstRow(/^conditions?$/i);
  if (cond && carries.conditions) {
    okScalar.add('conditions');
    const now = filled(plain(cond.raw)).split(',').map(t => t.trim()).filter(t => t && !/^[—–-]$/.test(t));
    if (now.join('\n') !== blob.conditions.join('\n')) write(cond.row, 1, cond.label, blob.conditions.length ? blob.conditions.join(', ') : '—');
  }

  // The last placed Heroic Inspiration row is the one the build reads.
  const insp = core.filter(r => /^heroic inspiration$/i.test(r.label)).pop();
  if (insp && carries.inspiration) {
    const now = yesNo(filled(plain(insp.raw)));
    if (now !== null) {
      okScalar.add('inspiration');
      if (now !== blob.inspiration) write(insp.row, 1, insp.label, blob.inspiration ? 'Yes' : 'No');
    }
  }

  // Counts: the first row of a key is the live one, as the build has it; if that row is not
  // trackable the key is not live and no later row of the name takes it over.
  const claimed = new Set();
  const count = (key, label, row, idx, max, spent, raw) => {
    if (claimed.has(key)) return;
    claimed.add(key);
    if (!trackable(max, spent)) return;
    if (!has(key)) return;
    if (!/^\d*$/.test(raw.trim())) return;
    resolved.add(key);
    if (used[key] !== spent) write(row, idx, label, String(used[key]));
  };

  const hitDiceSeen = new Set();
  for (const { row, label, raw } of combat) {
    if (/^hit dice/i.test(label)) {
      const m = filled(plain(raw)).match(/^(\d+)\s*\/\s*(\d+)$/);
      if (!m) continue;
      const key = liveKey('hd', shown(label.replace(/\s*\(\s*spent\s*\/\s*max\s*\)\s*$/i, '')));
      const cell = raw.trim().match(/^(\d+)(\s*\/\s*\d+)$/);
      if (hitDiceSeen.has(key)) continue;
      hitDiceSeen.add(key);
      if (!trackable(+m[2], +m[1])) continue;
      if (!has(key)) continue;
      if (!cell) continue;
      resolved.add(key);
      if (used[key] !== +m[1]) write(row, 1, label, used[key] + cell[2]);
    }
  }
  const ds = combat.find(r => /^death saves/i.test(r.label));
  if (ds) {
    const m = filled(plain(ds.raw)).match(/^(\d+)\s*\/\s*(\d+)$/);
    const cell = ds.raw.trim().match(/^(\d+)(\s*\/\s*)(\d+)$/);
    if (m && +m[1] <= 3 && +m[2] <= 3 && has('ds:s') && has('ds:f') && cell) {
      resolved.add('ds:s'); resolved.add('ds:f');
      if (used['ds:s'] !== +m[1] || used['ds:f'] !== +m[2]) write(ds.row, 1, ds.label, `${used['ds:s']}${cell[2]}${used['ds:f']}`);
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

  for (const k of ['hp', 'temp', 'exhaustion', 'conditions', 'inspiration']) if (carries[k] && !okScalar.has(k)) skipped.push(k);
  for (const k of Object.keys(used)) if (has(k) && !resolved.has(k)) skipped.push(k);
  return { markdown: changes.length ? lines.join('\n') : markdown, changes, skipped };
}

// The build reads only the first subsection of each title.
function firstOfEach(subs) {
  const seen = new Set();
  return subs.filter(s => (seen.has(s.key) ? false : (seen.add(s.key), true)));
}

module.exports = { applyDnDFlush };
