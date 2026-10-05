'use strict';

const { splitTableRow } = require('../wikilink');
const { liveKey, shown } = require('../templates/dnd/live-key');

// Pure D&D vault-sheet write-back: put a live record's numbers into the note's own
// table cells. It changes a cell only when the value differs, keeps a reason
// written after a number, and never adds a row. Owns the D&D note's cell names;
// no KV, no fs, no config. A row is matched to the page's key the way the page
// builds the key: liveKey(kind, shown(name cell)). Concentrating is never written.

const FEATURE_KINDS = { 'class features': 'class', 'species traits': 'species', 'feats': 'feat' };
const USED_COLUMN = /^(used|expended|spent)$/i;
const SCALARS = ['hp', 'temp', 'exhaustion', 'conditions', 'inspiration'];

// A whole number at the start of a cell replaced, whatever follows it kept.
function swapNumber(inner, n) {
  if (inner === '') return n === 0 ? null : String(n);
  const m = inner.match(/^(\d+)([\s\S]*)$/);
  if (!m || Number(m[1]) === n) return null;
  return String(n) + m[2];
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
  const found = new Set();
  const lines = String(markdown).split('\n');
  let h2 = '', h3 = '', header = null, fence = false;

  // Rewrite content cell `idx` of line `i` with `next(inner)`; null means leave it.
  const write = (i, idx, field, next) => {
    const segs = splitTableRow(lines[i]);
    const at = idx + 1;
    if (at < 1 || at >= segs.length - 1) return;
    const inner = segs[at].trim();
    const to = next(inner);
    if (to === null || to === undefined || to === inner) return;
    segs[at] = inner ? segs[at].replace(inner, () => to) : ` ${to} `;
    lines[i] = segs.join('|');
    changes.push({ field, from: inner === '' ? null : inner, to });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; header = null; continue; }
    if (fence) continue;
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      if (heading[1].length <= 2) { h2 = heading[1].length === 2 ? heading[2].toLowerCase() : ''; h3 = ''; }
      else if (heading[1].length === 3) h3 = heading[2].toLowerCase();
      header = null;
      continue;
    }
    if (!/^\s*\|/.test(line)) { header = null; continue; }
    const cells = splitTableRow(line).slice(1, -1).map(c => c.trim());
    if (!header) { header = cells.map(c => c.toLowerCase()); continue; }
    if (cells.every(c => /^:?-+:?$/.test(c))) continue;
    const label = cells[0] || '';

    if (h2 === 'stat sheet' && h3 === 'core') {
      if (/^heroic inspiration$/i.test(label) && carries.inspiration && !found.has('inspiration')) {
        found.add('inspiration');
        write(i, 1, label, (inner) => {
          const now = /^(yes|y|true)$/i.test(inner) ? true : /^(no|n|false|—|–|-)?$/i.test(inner) ? false : null;
          return (now === null || now === blob.inspiration) ? null : (blob.inspiration ? 'Yes' : 'No');
        });
      }
    } else if (h2 === 'stat sheet' && h3 === 'combat') {
      const scalar = (key) => {
        if (found.has(key)) return;
        found.add(key);
        write(i, 1, label, inner => swapNumber(inner, blob[key]));
      };
      if (/^HP\s*(\(\s*cur(r(ent)?)?\.?\s*\))?$/i.test(label) && carries.hp) scalar('hp');
      else if (/^temp(orary)? HP$/i.test(label) && carries.temp) scalar('temp');
      else if (/^exhaustion$/i.test(label) && carries.exhaustion) scalar('exhaustion');
      else if (/^conditions?$/i.test(label) && carries.conditions && !found.has('conditions')) {
        found.add('conditions');
        write(i, 1, label, (inner) => {
          const now = inner.split(',').map(t => t.trim()).filter(t => t && !/^[—–-]$/.test(t));
          if (now.join('\n') === blob.conditions.join('\n')) return null;
          return blob.conditions.length ? blob.conditions.join(', ') : '—';
        });
      } else if (/^hit dice/i.test(label)) {
        const key = liveKey('hd', shown(label.replace(/\s*\(\s*spent\s*\/\s*max\s*\)\s*$/i, '')));
        if (has(key)) {
          found.add(key);
          write(i, 1, label, (inner) => {
            const m = inner.match(/^(\d+)(\s*\/\s*\d+[\s\S]*)$/);
            return (!m || Number(m[1]) === used[key]) ? null : used[key] + m[2];
          });
        }
      } else if (/^death saves/i.test(label) && has('ds:s') && has('ds:f')) {
        found.add('ds:s'); found.add('ds:f');
        write(i, 1, label, (inner) => {
          const m = inner.match(/^(\d+)\s*\/\s*(\d+)([\s\S]*)$/);
          if (!m || (Number(m[1]) === used['ds:s'] && Number(m[2]) === used['ds:f'])) return null;
          return `${used['ds:s']}/${used['ds:f']}${m[3]}`;
        });
      }
    } else {
      const col = header.findIndex(h => USED_COLUMN.test(h));
      if (col < 1) continue;
      const kind = h3 === 'spell slots' ? 'slot' : h3 === 'magic items' ? 'item' : (h3 === '' ? FEATURE_KINDS[h2] : null);
      if (!kind) continue;
      const name = shown(label);
      const key = liveKey(kind, name);
      if (!has(key)) continue;
      found.add(key);
      write(i, col, name, inner => swapNumber(inner, used[key]));
    }
  }

  for (const k of SCALARS) if (carries[k] && !found.has(k)) skipped.push(k);
  for (const k of Object.keys(used)) if (has(k) && !found.has(k)) skipped.push(k);
  return { markdown: changes.length ? lines.join('\n') : markdown, changes, skipped };
}

module.exports = { applyDnDFlush };
