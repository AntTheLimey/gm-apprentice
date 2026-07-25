'use strict';

// Pure GURPS vault-sheet writeback: sync live current HP/FP from a KV blob into
// the PC's `## Current Status` block, format-preservingly and idempotently.
// Updates an existing `**HP:** N/M` line in place; injects the line (using the
// sheet-derived max) when absent. Owns GURPS Current-Status format knowledge;
// no KV, no fs, no config, no model. HP/FP only — loadout/hero points are out of
// scope (Slice 5).

const HEADING = /^##\s+current status\s*$/i;
const BLOCK_END = /^(#{1,6}\s|---\s*$)/;
const LABEL = /^\s*\*\*[^*]+:\*\*/;

// A `**HP:** 12/12 (note)` line -> replace the leading current integer, keeping
// the `/max` suffix and any trailing note. Returns { line, from } or null when
// the line is not a vital line.
function replaceVital(line, cur) {
  const m = line.match(/^(\s*\*\*\s*(?:HP|FP)\s*:\s*\*\*\s*)(-?\d+)(.*)$/i);
  if (!m) return null;
  const from = m[2];
  if (from === String(cur)) return { line: line, from: from }; // already current
  return { line: m[1] + cur + m[3], from: from };
}

function vitalKind(line) {
  const m = line.match(/^\s*\*\*\s*(HP|FP)\s*:\s*\*\*/i);
  return m ? m[1].toUpperCase() : null;
}

function applyGURPSFlush(markdown, blob, max) {
  const changes = [];
  if (!blob || typeof blob !== 'object') return { markdown: markdown, changes: changes };
  const want = {
    HP: typeof blob.hp === 'number' && isFinite(blob.hp) ? blob.hp : null,
    FP: typeof blob.fp === 'number' && isFinite(blob.fp) ? blob.fp : null,
  };
  if (want.HP == null && want.FP == null) return { markdown: markdown, changes: changes };

  const lines = String(markdown).split('\n');
  const start = lines.findIndex(function (l) { return HEADING.test(l); });
  if (start === -1) return { markdown: markdown, changes: changes };
  let end = start + 1;
  while (end < lines.length && !BLOCK_END.test(lines[end])) end++;

  const seen = { HP: false, FP: false };
  let lastVitalIdx = -1;
  for (let i = start + 1; i < end; i++) {
    const kind = vitalKind(lines[i]);
    if (!kind) continue;
    lastVitalIdx = i;
    if (want[kind] == null) continue;
    seen[kind] = true;
    const r = replaceVital(lines[i], want[kind]);
    if (r && r.line !== lines[i]) {
      changes.push({ field: kind, from: r.from, to: String(want[kind]) });
      lines[i] = r.line;
    }
  }

  // Inject any absent vital whose max is known. HP before FP.
  const maxOf = { HP: max ? max.maxHp : null, FP: max ? max.maxFp : null };
  const toInject = [];
  ['HP', 'FP'].forEach(function (kind) {
    if (want[kind] == null || seen[kind]) return;
    const mx = maxOf[kind];
    if (typeof mx !== 'number' || !isFinite(mx)) return; // can't seed without max
    toInject.push({ kind: kind, line: '**' + kind + ':** ' + want[kind] + '/' + mx });
  });
  if (toInject.length) {
    let at = -1;
    if (lastVitalIdx >= 0) {
      at = lastVitalIdx + 1;
    } else {
      for (let i = start + 1; i < end; i++) { if (LABEL.test(lines[i])) { at = i; break; } }
      if (at === -1) { for (let i = start + 1; i < end; i++) { if (lines[i].trim() !== '') { at = i; break; } } }
      if (at === -1) at = start + 1;
    }
    lines.splice(at, 0, ...toInject.map(function (t) { return t.line; }));
    toInject.forEach(function (t) { changes.push({ field: t.kind, from: null, to: String(want[t.kind]) }); });
  }

  return { markdown: changes.length ? lines.join('\n') : markdown, changes: changes };
}

module.exports = { applyGURPSFlush };
