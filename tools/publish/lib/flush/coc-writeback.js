'use strict';

// Pure CoC vault-sheet writeback: map a live blob onto the specific markdown
// table cells / checkbox markers, format-preservingly and idempotently. Owns all
// CoC-sheet format knowledge; no KV, no fs, no config. Skill values are never
// touched — Advancement (SP4) owns those.

// Derived table row label (upper) -> live blob scalar field.
const DERIVED_FIELDS = { HP: 'hp', MP: 'mp', LUCK: 'luck', SANITY: 'san' };

// [ needle in the item text, blob.conditions key ]. Order/labels mirror
// coc/parse.js CONDITION_KEYS so parse and writeback never drift.
const CONDITIONS = [
  ['temporary insanity', 'temporaryInsanity'],
  ['indefinite insanity', 'indefiniteInsanity'],
  ['major wound', 'majorWound'],
  ['unconscious', 'unconscious'],
  ['dying', 'dying'],
];

// First cell (the row label) of a `| a | b | c |` markdown table row, else null.
function labelOfRow(line) {
  const segs = line.split('|');
  return segs.length >= 3 ? segs[1].trim() : null;
}

// Replace the leading integer of content cell `idx` (0-based among cells between
// the pipes), preserving pipe spacing and any trailing note like "(starting 60)".
// Returns { line, from } — `from` is the previous integer (or null if none).
function replaceCell(line, idx, newVal) {
  const segs = line.split('|'); // segs[0] is the piece before the first pipe
  const segIdx = idx + 1;
  if (segIdx < 1 || segIdx >= segs.length - 1) return { line: line, from: null };
  const cell = segs[segIdx];
  const m = cell.match(/-?\d+/);
  const from = m ? m[0] : null;
  if (from === String(newVal)) return { line: line, from: from }; // already current
  segs[segIdx] = cell.replace(/-?\d+/, String(newVal));
  return { line: segs.join('|'), from: from };
}

function applyCoCFlush(markdown, blob) {
  const changes = [];
  if (!blob || typeof blob !== 'object') return { markdown: markdown, changes: changes };
  const lines = String(markdown).split('\n');
  let section = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) { section = heading[1].trim().toLowerCase(); continue; }

    if (section === 'derived') {
      const label = labelOfRow(line);
      const key = label ? DERIVED_FIELDS[label.toUpperCase()] : null;
      if (key && typeof blob[key] === 'number') {
        const r = replaceCell(line, 2, blob[key]); // Current is content cell 2
        if (r.line !== line) { changes.push({ field: label, from: r.from, to: String(blob[key]) }); lines[i] = r.line; }
      }
    } else if (section === 'reputation') {
      const label = labelOfRow(line);
      if (label && /current reputation/i.test(label) && typeof blob.rep === 'number') {
        const r = replaceCell(line, 1, blob.rep); // Value is content cell 1
        if (r.line !== line) { changes.push({ field: 'Reputation', from: r.from, to: String(blob.rep) }); lines[i] = r.line; }
      }
    } else if (section === 'status') {
      const m = line.match(/^(\s*)- \[([ xX])\]\s+(.*\S)\s*$/);
      if (m && blob.conditions) {
        const indent = m[1];
        const wasOn = m[2].toLowerCase() === 'x';
        const plain = m[3].replace(/\*\*/g, '').trim(); // authored label without bold
        const cond = CONDITIONS.find(function (c) { return plain.toLowerCase().indexOf(c[0]) !== -1; });
        if (cond) {
          const isOn = !!blob.conditions[cond[1]];
          if (isOn !== wasOn) {
            lines[i] = indent + '- [' + (isOn ? 'x' : ' ') + '] ' + (isOn ? '**' + plain + '**' : plain);
            changes.push({ field: plain, from: wasOn, to: isOn });
          }
        }
      }
    }
  }

  return { markdown: changes.length ? lines.join('\n') : markdown, changes: changes };
}

module.exports = { applyCoCFlush };
