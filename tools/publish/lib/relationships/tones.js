'use strict';
// The tone side of `relationships`: a read-only listing of every tone on the notes' own
// relationships (`list`), and the rewrite of tone words (`fix --kind tone --set OLD=NEW`).
//
// Both stand on the reader in read.js, so a tone is found by the `yaml` library, not by a line
// pattern. The rewrite splices the one scalar it changes (its quotes kept; spacing, a trailing
// comment, other lines and line endings are never touched) and writes all notes or none, through
// the same applyFix the other repairs use.
//
//   listTones(model, { skip })        -> [{ rel, line, tone, target, description, gmOnly, hidesRelationships, siteFamily, accepted }]
//   planTones(model, { vaultPath, sets, skip, readBack? })
//        -> { changes: [{ kind: 'tone', rel, line, before, after }],
//             kept: [{ rel, line, tone, why }], texts, originals }
//
// `line` is the line of the `tone:` key in the FILE (the opening `---` is line 1). `tone` is the
// value as written, unquoted; `target` the edge's target text as written; `description` the YAML
// value, whitespace and all. Only the note's own `relationships:` list is read: a tie in the map
// form carries no tone, and the machine-managed `mobrpg:` node is never listed or edited.
//
// `skip` is a list of top-level folders whose notes are left out (the QA reports and the archive,
// which the tone tidy has never touched).
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { applyEdits } = require('../settings/write');
const { ontology, toneFamily } = require('../ontology');
const { openText } = require('./fix');
const { isAccepted } = require('../accepted-ties');

const keyName = (p) => String(YAML.isScalar(p.key) ? p.key.value : p.key);
const pairOf = (map, name) => (YAML.isMap(map) ? map.items.find((p) => keyName(p) === name) || null : null);
const textOf = (node) => (YAML.isScalar(node) && node.value !== null && node.value !== undefined ? String(node.value) : '');

const LISTED = new Set(Object.values(ontology.tones).flat());

function skipped(rel, skip) {
  const parts = rel.split('/');
  return parts.length > 1 && (skip || []).includes(parts[0]);
}

// The edges of the notes' own list that give a tone, in note then line order.
function toneEdges(model, skip) {
  const out = [];
  for (const note of model.notes) {
    if (!note.inScope || skipped(note.rel, skip)) continue;
    for (const e of note.edges) if (e.form === 'list' && !e.mobrpg && e.tone) out.push({ note, edge: e });
  }
  return out.sort((a, b) => (a.note.rel < b.note.rel ? -1 : a.note.rel > b.note.rel ? 1 : 0) || a.edge.toneLine - b.edge.toneLine);
}

function listTones(model, { skip, accepted = new Set() } = {}) {
  return toneEdges(model, skip).map(({ note, edge }) => ({
    rel: note.rel,
    line: edge.toneLine,
    tone: edge.tone,
    target: edge.rawTarget,
    description: edge.description || '',
    gmOnly: !!edge.gmOnly,
    hidesRelationships: !!note.hidesRelationships,
    siteFamily: LISTED.has(edge.tone.trim().toLowerCase()) ? toneFamily(edge.tone) : null,
    accepted: isAccepted(accepted, { rel: note.rel, tone: edge.tone, target: edge.rawTarget, description: edge.description }),
  }));
}

// `OLD=NEW` pairs (as given on the command line) -> Map(OLD -> NEW). The split is at the last `=`,
// so a word holding one is still a word; NEW must be a listed tone, and one OLD may not become two.
function parseSets(pairs) {
  const sets = new Map();
  for (const pair of pairs || []) {
    const at = String(pair).lastIndexOf('=');
    const old = at < 0 ? '' : pair.slice(0, at);
    const next = at < 0 ? '' : pair.slice(at + 1).trim().toLowerCase();
    if (!old.trim() || !next) throw new Error(`--set takes OLD=NEW, got ${pair}`);
    if (!LISTED.has(next)) throw new Error(`${next} is not a listed tone`);
    if (sets.has(old) && sets.get(old) !== next) throw new Error(`${old} is set to both ${sets.get(old)} and ${next}`);
    sets.set(old, next);
  }
  return sets;
}

function planTones(model, { vaultPath, sets, skip, readBack = openText } = {}) {
  const changes = [];
  const kept = [];
  const byRel = new Map();
  for (const hit of toneEdges(model, skip)) {
    if (!sets.has(hit.edge.tone)) continue;
    if (!byRel.has(hit.note.rel)) byRel.set(hit.note.rel, []);
    byRel.get(hit.note.rel).push(hit.edge);
  }

  const texts = new Map();
  const originals = new Map();
  for (const [rel, edges] of byRel) {
    const buf = fs.readFileSync(path.join(vaultPath, ...rel.split('/')));
    const whole = buf.toString('utf8');
    if (Buffer.compare(Buffer.from(whole, 'utf8'), buf) !== 0) throw new Error(`${rel} is not UTF-8 text; fix the file, then run it again`);
    const ctx = openText(whole, rel);
    const keep = (e, why) => kept.push({ rel, line: e.toneLine, tone: e.tone, why });
    const seq = ctx.root && pairOf(ctx.root, 'relationships') && pairOf(ctx.root, 'relationships').value;
    const edits = [];
    const mine = [];
    for (const e of edges) {
      const item = !ctx.why && YAML.isSeq(seq) ? seq.items[e.index] : null;
      const pair = pairOf(item, 'tone');
      if (!pair || textOf(pair.value) !== e.tone) { keep(e, ctx.why || 'the tie is no longer where it was; run the fix again'); continue; }
      const node = pair.value;
      const type = node.type;
      const written = whole.slice(ctx.off + node.range[0], ctx.off + node.range[1]);
      if (!(type === 'PLAIN' || type === 'QUOTE_DOUBLE' || type === 'QUOTE_SINGLE') || node.anchor || node.tag || written.includes('\n')) {
        keep(e, 'not a plain tone line');
        continue;
      }
      const to = sets.get(e.tone);
      const text = type === 'QUOTE_DOUBLE' ? `"${to}"` : type === 'QUOTE_SINGLE' ? `'${to}'` : to;
      edits.push({ from: ctx.off + node.range[0], to: ctx.off + node.range[1], text });
      mine.push({ kind: 'tone', rel, line: e.toneLine, before: e.tone, after: to });
    }
    if (!edits.length) continue;
    const text = applyEdits(whole, edits);
    const back = readBack(text, rel);
    if (back.why || (back.kind === 'front' && back.doc.errors.length)) {
      for (const e of edges) if (mine.some((c) => c.line === e.toneLine)) keep(e, 'the edit did not read back, so nothing was changed');
      continue;
    }
    changes.push(...mine);
    texts.set(rel, text);
    originals.set(rel, buf);
  }
  const order = (a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0) || a.line - b.line;
  changes.sort(order);
  kept.sort(order);
  return { changes, kept, texts, originals };
}

module.exports = { listTones, planTones, parseSets, skipped };
