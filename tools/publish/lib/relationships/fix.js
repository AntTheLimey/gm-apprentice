'use strict';
// `relationships fix`: the certain repairs `check` names (fix.certain === true), written into the
// notes through the `yaml` library's source tokens. Every edit splices the text of the one node it
// changes (or adds or drops whole lines); the rest of the file comes back byte for byte: line
// endings, a BOM, comments, a missing final newline. The whole frontmatter is never re-serialised.
//
//   planFix(model, findings, { vaultPath, kinds?, ontology? })
//     -> { changes: [{ kind, rel, line, before, after }], kept: [{ rel, line, why }],
//          texts: Map<rel, newText>, originals: Map<rel, Buffer> }
//   applyFix(vaultPath, plan, { rename? })   all notes or none; refuses if any file changed since planning
//
// A change is one unit: a move off one note and onto another is both edits or neither. A unit that
// cannot be placed cleanly (map form, flow list, a field the move would lose, a missing note, a
// duplicate) is a KEEP row and none of its edits are made.
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { applyEdits, addLines, dropLines, endOf, dashOffset, parseText } = require('../settings/write');
const { parseNote } = require('../frontmatter');
const { ontology: defaultOntology } = require('../ontology');

const FORM = 'written in a form the fix does not edit';
const CARRIED = ['tone', 'strength', 'description', 'gm_only'];
const KNOWN_KEYS = new Set(['type', 'target', 'bidirectional', ...CARRIED]);
const COMPARED = ['description', 'tone', 'strength', 'gm_only'];

const quote = (s) => JSON.stringify(s);
const keyName = (p) => String(YAML.isScalar(p.key) ? p.key.value : p.key);
const pairOf = (map, name) => (YAML.isMap(map) ? map.items.find((p) => keyName(p) === name) || null : null);
const textOf = (node) => (YAML.isScalar(node) && node.value !== null && node.value !== undefined ? String(node.value) : '');
const pairEnd = (pair, yaml) => Math.max(pair.key.range[1], pair.value ? endOf(pair.value, yaml) : 0);
const eolOf = (t) => { const i = t.indexOf('\n'); return i > 0 && t[i - 1] === '\r' ? '\r\n' : '\n'; };
const columnOf = (t, i) => i - (i <= 0 ? 0 : t.lastIndexOf('\n', i - 1) + 1);
const isEmptyValue = (node) => !node || (YAML.isScalar(node) && node.value === null && node.range[0] === node.range[1]);

// ---- A note's text, split into the parts the edits need ---------------------------------------------

// { whole, eol, bom, kind: 'none'|'empty'|'front', off, yaml, doc, root } or { why }.
// `off` is where the frontmatter's own text starts in the file; document offsets add to it.
function openText(whole, rel) {
  const eol = eolOf(whole);
  const bom = whole.charCodeAt(0) === 0xFEFF ? 1 : 0;
  const rest = whole.slice(bom);
  let parsed;
  try { parsed = parseNote(rest); } catch { return { why: 'its frontmatter does not read' }; }
  const m = parsed.matter || ''; // an empty file has none
  const base = { whole, eol, bom, rel };
  if (m === '') {
    const empty = /^---\r?\n---/.exec(rest);
    if (!empty) return { ...base, kind: 'none', yaml: '', doc: null, root: null, off: bom };
    return { ...base, kind: 'empty', off: bom + (rest.startsWith('---\r\n') ? 5 : 4), yaml: '', doc: null, root: null };
  }
  const lead = m.startsWith('\r\n') ? 2 : m.startsWith('\n') ? 1 : 0;
  const cr = m.endsWith('\r') ? 1 : 0;
  if (!lead || rest.slice(3, 3 + m.length) !== m) return { why: FORM };
  const yaml = m.slice(lead, m.length - cr);
  let doc;
  try { doc = parseText(yaml, rel); } catch { return { why: FORM }; }
  return { ...base, kind: 'front', off: bom + 3 + lead, yaml, doc, root: YAML.isMap(doc.contents) ? doc.contents : null };
}

// ---- Finding an edge in the note as it is now ------------------------------------------------------

function locateEdge(ctx, edge) {
  if (edge.mobrpg) return { why: 'a machine-managed edge is never edited' };
  if (edge.form !== 'list') return { why: FORM };
  if (!ctx.root) return { why: FORM };
  const relPair = pairOf(ctx.root, 'relationships');
  const seq = relPair && relPair.value;
  if (!YAML.isSeq(seq) || seq.flow) return { why: FORM };
  const item = seq.items[edge.index];
  if (!YAML.isMap(item)) return { why: 'the tie is no longer where it was; run the check again' };
  const typePair = pairOf(item, 'type');
  const targetPair = pairOf(item, 'target');
  if (!typePair || textOf(typePair.value) !== edge.type || (targetPair ? textOf(targetPair.value) : '') !== edge.rawTarget) {
    return { why: 'the tie is no longer where it was; run the check again' };
  }
  return { seq, item, typePair, targetPair };
}

// ---- Edits -------------------------------------------------------------------------------------------

// Whole item removed (its dash line through its last line).
// A comment anywhere in the item would go with it (the move carries values, not comments).
function hasComment(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.comment || node.commentBefore) return true;
  if (YAML.isPair(node)) return hasComment(node.key) || hasComment(node.value);
  return Array.isArray(node.items) && node.items.some(hasComment);
}

function removeItemEdit(ctx, hit, index) {
  if (hasComment(hit.item)) return { why: 'the tie has a comment that removing it would lose' };
  let dash;
  try { dash = dashOffset(hit.seq, index); } catch { return { why: FORM }; }
  return { edit: dropLines(ctx.whole, ctx.off + dash, ctx.off + endOf(hit.item, ctx.yaml), ctx.eol) };
}

// The type value replaced in place, keeping its quotes.
function retypeEdit(ctx, hit, to) {
  const node = hit.typePair.value;
  if (!YAML.isScalar(node)) return { why: FORM };
  const text = node.type === 'QUOTE_DOUBLE' ? `"${to}"` : node.type === 'QUOTE_SINGLE' ? `'${to}'` : to;
  return { edit: { from: ctx.off + node.range[0], to: ctx.off + node.range[1], text } };
}

// bidirectional set to true (in place or as a new last line of the item) or dropped.
function bidirectionalEdit(ctx, hit, on) {
  const pair = pairOf(hit.item, 'bidirectional');
  if (on) {
    if (pair) {
      if (!YAML.isScalar(pair.value) || isEmptyValue(pair.value)) return { why: FORM };
      return { edit: { from: ctx.off + pair.value.range[0], to: ctx.off + pair.value.range[1], text: 'true' } };
    }
    if (hit.item.flow || !hit.item.items.length) return { why: FORM };
    const last = hit.item.items[hit.item.items.length - 1];
    const first = hit.item.items[0];
    const col = columnOf(ctx.whole, ctx.off + first.key.range[0]);
    return { insert: addLines(ctx.whole, ctx.off + pairEnd(last, ctx.yaml), [`${' '.repeat(col)}bidirectional: true`], ctx.eol) };
  }
  if (!pair) return {};
  const from = ctx.off + pair.key.range[0];
  const ls = from <= 0 ? 0 : ctx.whole.lastIndexOf('\n', from - 1) + 1;
  const end = ctx.off + pairEnd(pair, ctx.yaml);
  if (!/^[ \t]*$/.test(ctx.whole.slice(ls, from)) || ctx.whole.slice(from, end).includes('\n') || hit.item.flow) return { why: FORM };
  return { edit: dropLines(ctx.whole, from, end, ctx.eol) };
}

// The block for new list items, in the style of the list they join.
function itemLines(entries, style) {
  const pad = ' '.repeat(Math.max(1, style.k - style.d - 1));
  return entries.flatMap((item) => item.map((line, i) => (i === 0 ? `${' '.repeat(style.d)}-${pad}${line}` : `${' '.repeat(style.k)}${line}`)));
}

// Where new items go in this note: { why } or an edit builder (items -> edits).
function appendTo(ctx) {
  const { whole, eol } = ctx;
  if (ctx.kind === 'none') {
    return { build: (items) => [{ from: ctx.off, to: ctx.off, text: `---${eol}${['relationships:', ...itemLines(items, { d: 2, k: 4 })].join(eol)}${eol}---${eol}` }] };
  }
  if (ctx.doc && ctx.doc.contents !== null && !ctx.root) return { why: FORM };
  if (ctx.root && ctx.root.flow) return { why: FORM };
  const relPair = ctx.root && pairOf(ctx.root, 'relationships');
  if (!relPair) {
    return {
      build: (items) => {
        const lines = ['relationships:', ...itemLines(items, { d: 2, k: 4 })];
        if (!ctx.yaml.length) return [{ from: ctx.off, to: ctx.off, text: lines.join(eol) + eol }];
        const at = ctx.off + ctx.yaml.length;
        return [{ from: at, to: at, text: /\n$/.test(ctx.yaml) ? lines.join(eol) + eol : eol + lines.join(eol) }];
      },
    };
  }
  const value = relPair.value;
  if (YAML.isSeq(value) && !value.flow && value.items.length) {
    const last = value.items[value.items.length - 1];
    if (!YAML.isMap(last) || last.flow || !last.items.length) return { why: FORM };
    let dash;
    try { dash = dashOffset(value, value.items.length - 1); } catch { return { why: FORM }; }
    const d = columnOf(whole, ctx.off + dash);
    const keyAt = ctx.off + last.items[0].key.range[0];
    const sameLine = !whole.slice(ctx.off + dash, keyAt).includes('\n');
    const k = sameLine ? columnOf(whole, keyAt) : d + 2;
    return { build: (items) => [addLines(whole, ctx.off + endOf(last, ctx.yaml), itemLines(items, { d, k }), eol)] };
  }
  const emptyFlow = YAML.isSeq(value) && value.flow && !value.items.length;
  if (emptyFlow || isEmptyValue(value)) {
    return {
      build: (items) => {
        const lines = itemLines(items, { d: 2, k: 4 });
        if (emptyFlow) {
          const colon = ((relPair.srcToken && relPair.srcToken.sep) || []).find((t) => t.type === 'map-value-ind');
          if (!colon) return null;
          return [
            { from: ctx.off + colon.offset + 1, to: ctx.off + value.range[1], text: '' },
            addLines(whole, ctx.off + value.range[1], lines, eol),
          ];
        }
        return [addLines(whole, ctx.off + relPair.key.range[1], lines, eol)];
      },
    };
  }
  return { why: FORM };
}

// ---- The plan ----------------------------------------------------------------------------------------

const comparable = (node) => JSON.stringify(YAML.isNode(node) ? node.toJS(new YAML.Document()) : node);

// `readBack` is the check that a new text still reads; a test may replace it.
function planFix(model, findings, { vaultPath, kinds, ontology = defaultOntology, readBack = openText } = {}) {
  const byRel = new Map(model.notes.map((n) => [n.rel, n]));
  const symmetric = new Set((ontology.predicates || []).filter((p) => p.symmetric).map((p) => p.type));
  const contexts = new Map();
  const ctxOf = (rel) => {
    if (contexts.has(rel)) return contexts.get(rel);
    let ctx;
    try {
      const buf = fs.readFileSync(path.join(vaultPath, ...rel.split('/')));
      const whole = buf.toString('utf8');
      ctx = Buffer.compare(Buffer.from(whole, 'utf8'), buf) === 0 ? { ...openText(whole, rel), buf } : { why: 'the file is not valid UTF-8' };
    } catch (e) {
      ctx = { why: `the file cannot be read: ${e.message}` };
    }
    contexts.set(rel, ctx);
    return ctx;
  };
  const edgeOf = (note, f) => note.edges.find((e) => e.index === f.edgeIndex && e.form === f.form && !!e.mobrpg === !!f.mobrpg);
  const nameOf = (rel) => path.posix.basename(rel, '.md');

  const wanted = findings.filter((f) => f.fix && f.fix.certain === true && !f.mobrpg && (!kinds || kinds.includes(f.kind)));
  // Moves and removals first, so a change that only adjusts a tie another change removes is not made twice.
  const weight = (f) => (f.kind === 'off-vocabulary' ? 0 : f.kind === 'mirrored' ? 1 : 2);
  const ordered = wanted.map((f, i) => [f, i]).sort((a, b) => weight(a[0]) - weight(b[0]) || a[1] - b[1]).map((p) => p[0]);

  // ---- one unit per finding: { ops, change } or { why } ----
  const added = new Set(); // dest|type|targetRel, planned already
  const touched = new Set(); // rel|index of an item another unit changes
  const removed = new Map();
  const units = [];
  const kept = [];
  const changes = [];
  const dup = (dest, type, targetRel) => `${dest}\u0000${type}\u0000${targetRel}`;
  // Why adding this tie would double one, or null.
  const hasTie = (destRel, type, targetRel) => {
    const dest = byRel.get(destRel);
    if (added.has(dup(destRel, type, targetRel))) return 'would duplicate a tie another change in this run adds';
    return dest && dest.edges.some((e) => !e.mobrpg && e.type === type && e.targetRel === targetRel)
      ? 'would duplicate a tie the other note already has' : null;
  };

  // A two-way type written from both ends is a `mirrored` finding of its own: a change that would make one is KEEP.
  const bothWays = (fromRel, type, toRel) => {
    if (!symmetric.has(type)) return null;
    const from = byRel.get(fromRel);
    const there = added.has(dup(fromRel, type, toRel)) || (from && from.edges.some((e) => !e.mobrpg && e.type === type && e.targetRel === toRel));
    return there ? 'would store a two-way tie on both notes' : null;
  };

  const keep = (f, why) => kept.push({ rel: f.rel, line: f.line, why });

  for (const f of ordered) {
    const note = byRel.get(f.rel);
    const src = ctxOf(f.rel);
    if (!note || src.why) { keep(f, src.why || 'the note is not in the vault'); continue; }
    const unit = { f, ops: [], rels: new Set([f.rel]), claims: [], marks: [] };
    const fail = (why) => { keep(f, why); };
    const claim = (rel, index) => {
      const key = `${rel}\u0000${index}`;
      if (touched.has(key)) return false;
      unit.marks.push(key);
      return true;
    };

    if (f.kind === 'off-vocabulary' || f.kind === 'mirrored' || f.kind === 'bidirectional') {
      const edge = edgeOf(note, f);
      if (!edge) { fail('the tie is no longer where it was; run the check again'); continue; }
      const remover = removed.get(`${f.rel}\u0000${edge.index}`);
      if (remover) {
        // No edit of its own: it stands only while the unit that removes the tie stands.
        units.push({ f, ops: [], rels: new Set(), needs: remover,
          change: { before: `${edge.type} [[${edge.target}]]`, after: 'removed with the copy on the other note' } });
        continue;
      }
      const hit = locateEdge(src, edge);
      if (hit.why) { fail(hit.why); continue; }
      if (!claim(f.rel, edge.index)) { fail('another change already edits this tie'); continue; }

      if (f.kind === 'bidirectional') {
        const on = symmetric.has(edge.type);
        const r = bidirectionalEdit(src, hit, on);
        if (r.why) { fail(r.why); continue; }
        unit.ops.push({ rel: f.rel, ...r });
        unit.change = { before: `${edge.type} [[${edge.target}]]`, after: on ? 'bidirectional: true' : 'bidirectional removed' };
      } else if (f.kind === 'mirrored') {
        const other = byRel.get(edge.targetRel);
        const twin = other && other.edges.find((e) => !e.mobrpg && e.type === edge.type && e.targetRel === f.rel);
        const otherCtx = twin && ctxOf(other.rel);
        const twinHit = otherCtx && !otherCtx.why ? locateEdge(otherCtx, twin) : null;
        if (!twinHit || twinHit.why) { fail(`the other copy cannot be read: ${(twinHit && twinHit.why) || (otherCtx && otherCtx.why) || 'it is gone'}`); continue; }
        const differs = COMPARED.find((k) => {
          const mine = pairOf(hit.item, k);
          if (!mine) return false;
          const theirs = pairOf(twinHit.item, k);
          return !theirs || comparable(mine.value) !== comparable(theirs.value);
        });
        if (differs) { fail(`the two copies differ: ${differs}`); continue; }
        const r = removeItemEdit(src, hit, edge.index);
        if (r.why) { fail(r.why); continue; }
        unit.ops.push({ rel: f.rel, ...r });
        unit.remove = `${f.rel}\u0000${edge.index}`;
        unit.change = { before: `${edge.type} [[${edge.target}]]`, after: `removed (kept on ${other.name})` };
      } else {
        const use = f.fix.choices && f.fix.choices[0];
        if (!use) { fail('no single repair is known'); continue; }
        const want = symmetric.has(use);
        if (!f.fix.flip) {
          if (edge.targetRel) {
            const problem = hasTie(f.rel, use, edge.targetRel) || bothWays(edge.targetRel, use, f.rel);
            if (problem) { fail(problem); continue; }
            unit.dup = dup(f.rel, use, edge.targetRel);
          }
          const r = retypeEdit(src, hit, use);
          if (r.why) { fail(r.why); continue; }
          unit.ops.push({ rel: f.rel, ...r });
          const flag = want && edge.bidirectional !== true ? true : !want && edge.bidirectional === true ? false : null;
          if (flag !== null) {
            const b = bidirectionalEdit(src, hit, flag);
            if (b.why) { fail(b.why); continue; }
            unit.ops.push({ rel: f.rel, ...b });
          }
          unit.change = { before: `${edge.type} [[${edge.target}]]`, after: `${use} [[${edge.target}]]` };
        } else {
          if (!edge.targetRel) {
            const unread = model.faults.some((x) => path.posix.basename(x.rel, '.md') === edge.target);
            fail(unread ? "the other note's frontmatter does not parse" : 'the other note does not exist');
            continue;
          }
          if (edge.targetRel === f.rel) { fail('the tie points at its own note'); continue; }
          const stray = hit.item.items.map(keyName).find((k) => !KNOWN_KEYS.has(k));
          if (stray) { fail(`the tie carries a field the move does not carry: ${stray}`); continue; }
          const twice = hasTie(edge.targetRel, use, f.rel) || bothWays(f.rel, use, edge.targetRel);
          if (twice) { fail(twice); continue; }
          const dest = ctxOf(edge.targetRel);
          if (dest.why) { fail(`the other note cannot be edited: ${dest.why}`); continue; }
          const place = appendTo(dest);
          if (place.why) { fail(`the other note is ${place.why}`); continue; }
          const entries = [`target: ${quote(`[[${note.name}]]`)}`, `type: ${use}`];
          if (want) entries.push('bidirectional: true');
          let bad = null;
          for (const k of CARRIED) {
            const pair = pairOf(hit.item, k);
            if (!pair) continue;
            const text = src.yaml.slice(pair.key.range[0], pairEnd(pair, src.yaml));
            if (text.includes('\n')) { bad = k; break; }
            entries.push(text);
          }
          if (bad) { fail(`the ${bad} spans lines and the move does not carry it`); continue; }
          const r = removeItemEdit(src, hit, edge.index);
          if (r.why) { fail(r.why); continue; }
          unit.ops.push({ rel: f.rel, ...r });
          unit.ops.push({ rel: edge.targetRel, append: entries });
          unit.rels.add(edge.targetRel);
          unit.remove = `${f.rel}\u0000${edge.index}`;
          unit.dup = dup(edge.targetRel, use, f.rel);
          unit.change = { before: `${edge.type} [[${edge.target}]]`, after: `${use} [[${note.name}]] on ${nameOf(edge.targetRel)}` };
        }
      }
    } else if (f.kind === 'place-missing-tie') {
      const pf = ontology.place_fields.find((p) => note.fields[p.field] && note.fields[p.field].line === f.line);
      const field = pf && note.fields[pf.field];
      const rootPair = pf && src.root && pairOf(src.root, pf.field);
      if (!field || !rootPair || textOf(rootPair.value) !== field.raw) { fail('the place field is no longer where it was; run the check again'); continue; }
      const self = pf.stored_on === 'self';
      const destRel = self ? f.rel : field.target;
      const targetText = self ? field.raw.trim() : `[[${note.name}]]`;
      const targetRel = self ? field.target : f.rel;
      const twice = hasTie(destRel, pf.predicate, targetRel);
      if (twice) { fail(twice); continue; }
      const dest = ctxOf(destRel);
      if (dest.why) { fail(`the note to edit cannot be edited: ${dest.why}`); continue; }
      const place = appendTo(dest);
      if (place.why) { fail(`the note to edit is ${place.why}`); continue; }
      unit.ops.push({ rel: destRel, append: [`target: ${quote(targetText)}`, `type: ${pf.predicate}`] });
      unit.rels.add(destRel);
      unit.dup = dup(destRel, pf.predicate, targetRel);
      unit.change = self
        ? { before: `${pf.field} ${field.raw.trim()}`, after: `${pf.predicate} ${field.raw.trim()} added` }
        : { before: `${pf.field} ${field.raw.trim()}`, after: `${pf.predicate} [[${note.name}]] added on ${nameOf(destRel)}` };
    } else if (f.kind === 'place-missing-field') {
      const edge = edgeOf(note, f);
      const place = f.fix.choices && f.fix.choices[0];
      if (!edge || !place) { fail('the tie is no longer where it was; run the check again'); continue; }
      const hit = locateEdge(src, edge);
      if (hit.why) { fail(hit.why); continue; }
      const typePair = src.root && pairOf(src.root, 'type');
      if (!typePair || src.root.flow || pairOf(src.root, 'parent_location')) { fail(FORM); continue; }
      const col = columnOf(src.whole, src.off + typePair.key.range[0]);
      unit.ops.push({ rel: f.rel, insert: addLines(src.whole, src.off + pairEnd(typePair, src.yaml), [`${' '.repeat(col)}parent_location: ${quote(`[[${place}]]`)}`], src.eol) });
      unit.change = { before: `${edge.type} [[${edge.target}]]`, after: `parent_location [[${place}]] added` };
    } else {
      keep(f, 'no repair is known for this kind');
      continue;
    }
    for (const k of unit.marks) touched.add(k);
    if (unit.remove) removed.set(unit.remove, unit);
    if (unit.dup) added.add(unit.dup);
    units.push(unit);
  }

  // ---- put the units together, note by note; a note whose new text does not read drops its units ----
  let live = units;
  let texts;
  for (;;) {
    const acc = new Map();
    const accOf = (rel) => { if (!acc.has(rel)) acc.set(rel, { edits: [], inserts: new Map(), items: [] }); return acc.get(rel); };
    for (const u of live) {
      for (const op of u.ops) {
        const a = accOf(op.rel);
        if (op.edit) a.edits.push(op.edit);
        if (op.insert) a.inserts.set(op.insert.from, (a.inserts.get(op.insert.from) || '') + op.insert.text);
        if (op.append) a.items.push(op.append);
      }
    }
    texts = new Map();
    const bad = new Set();
    for (const [rel, a] of acc) {
      const ctx = ctxOf(rel);
      const edits = [...a.edits];
      for (const [from, text] of a.inserts) edits.push({ from, to: from, text });
      if (a.items.length) {
        const built = appendTo(ctx).build(a.items);
        if (!built) { bad.add(rel); continue; }
        edits.push(...built);
      }
      const merged = mergeInserts(edits);
      const text = applyEdits(ctx.whole, merged);
      const back = readBack(text, rel);
      if (back.why || (back.kind === 'front' && back.doc.errors.length)) bad.add(rel);
      else texts.set(rel, text);
    }
    if (!bad.size) break;
    const next = [];
    const dropped = new Set();
    for (const u of live) {
      if ([...u.rels].some((r) => bad.has(r))) { keep(u.f, 'the edit did not read back, so nothing was changed'); dropped.add(u); } else next.push(u);
    }
    live = next.filter((u) => {
      if (!u.needs || !dropped.has(u.needs)) return true;
      keep(u.f, 'the edit did not read back, so nothing was changed');
      return false;
    });
  }
  for (const u of live) changes.push({ kind: u.f.kind, rel: u.f.rel, line: u.f.line, ...u.change });
  changes.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0) || a.line - b.line);
  kept.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0) || a.line - b.line);
  const originals = new Map([...texts.keys()].map((rel) => [rel, ctxOf(rel).buf]));
  return { changes, kept, texts, originals };
}

// Insertions that land at one place (and a removal that ends there) keep the order they were made in.
function mergeInserts(edits) {
  const out = [];
  const at = new Map();
  for (const e of edits) {
    if (e.from === e.to) {
      const prior = at.get(e.from);
      if (prior) { prior.text += e.text; continue; }
      const copy = { ...e };
      at.set(e.from, copy);
      out.push(copy);
    } else out.push(e);
  }
  return out;
}

// ---- Writing: all notes or none --------------------------------------------------------------------

// A temp file is `<note>.md.fix-tmp-<pid>`: visible, not a note, and recognisable. A run killed between
// writing and renaming leaves them; the next `fix --write` removes exactly the files of that pattern.
const LEFTOVER = '.fix-tmp-';
const LEFTOVER_RE = /\.md\.fix-tmp-\d+$/;

function removeLeftovers(vaultPath) {
  const gone = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && LEFTOVER_RE.test(entry.name)) { fs.rmSync(full, { force: true }); gone.push(path.relative(vaultPath, full).split(path.sep).join('/')); }
    }
  })(vaultPath);
  return gone;
}

function applyFix(vaultPath, plan, { rename = fs.renameSync, restore = fs.writeFileSync } = {}) {
  const files = [...plan.texts.keys()].map((rel) => ({ rel, full: path.join(vaultPath, ...rel.split('/')) }));
  for (const f of files) {
    let now;
    try { now = fs.readFileSync(f.full); } catch (e) { throw new Error(`${f.rel} cannot be read, so nothing was written: ${e.message}`); }
    if (Buffer.compare(now, plan.originals.get(f.rel)) !== 0) {
      throw new Error(`${f.rel} has changed since the plan was made, so nothing was written; run the fix again`);
    }
  }
  const temps = [];
  const cleanTemps = () => { for (const t of temps) fs.rmSync(t, { force: true }); };
  try {
    for (const f of files) {
      const tmp = path.join(path.dirname(f.full), `${path.basename(f.full)}${LEFTOVER}${process.pid}`);
      temps.push(tmp);
      const mode = fs.statSync(f.full).mode & 0o7777;
      fs.writeFileSync(tmp, plan.texts.get(f.rel), { mode });
      fs.chmodSync(tmp, mode);
    }
  } catch (e) {
    cleanTemps();
    throw new Error(`nothing was written: ${e.message}`);
  }
  const done = [];
  try {
    files.forEach((f, i) => { rename(temps[i], f.full); done.push(f); });
  } catch (e) {
    const failed = [];
    for (const f of done) {
      try { restore(f.full, plan.originals.get(f.rel)); } catch (r) { failed.push(`${f.rel} (${r.message})`); }
    }
    cleanTemps();
    throw new Error(`${e.message}; ${done.length - failed.length} note(s) already written were put back${failed.length ? `, but these could not be, so they hold the new text: ${failed.join(', ')}` : '; nothing is changed'}`);
  }
  cleanTemps();
  return files.map((f) => f.rel);
}

function renderPlan(plan, written) {
  const rows = [
    `# changes: ${plan.changes.length}, kept: ${plan.kept.length}, notes: ${plan.texts.size}`,
    ...plan.changes.map((c) => `${written ? 'CHANGED' : 'WOULD-CHANGE'}\t${c.rel}:${c.line}\t${c.before} -> ${c.after}`),
    ...plan.kept.map((k) => `KEEP\t${k.rel}:${k.line}\t${k.why}`),
  ];
  return rows.join('\n');
}

module.exports = { planFix, applyFix, renderPlan, removeLeftovers };
