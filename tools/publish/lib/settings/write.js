'use strict';
// The one writer of a vault's settings, on the yaml library, for either layout. A change is
// found in the document the library parses (every node knows where its text sits), and only
// that node's text is replaced, so everything else in the GM's file (comments, quoting, blank
// lines, flow lists, indentation, line endings, the old file's body) comes back byte for byte.
// The new text for a changed node is made by the library too. Every change is checked before
// anything is written, the result is read back and compared with what was meant, and the file
// is replaced through a temp file and a rename.
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const YAML = require('yaml');
const matter = require('gray-matter');
const { REGISTRY, resolve, legacyNameOf } = require('./registry');
const { TYPES, isMap, getPath } = require('./types');
const { makeFault } = require('./faults');
const { isLeaf } = require('./describe');
const { NEW_FILE, OLD_FILE, layoutOf, at } = require('./layout');
const { LAYOUT_VERSION, NEWER_VERSION } = require('./read');
const { OLD_BLOCK, hasLegacy } = require('./legacy');
const { parseNote } = require('../frontmatter');

const { Scalar, isScalar, isMap: isYMap, isSeq: isYSeq, isCollection } = YAML;
const BY_NAME = new Map(REGISTRY.map((e) => [e.name, e]));

// An error whose text is already for the GM, passed on as it is.
function plain(message) {
  const e = new Error(message);
  e.plain = true;
  return e;
}

// The one line for a change the writer could not make safely: the file this command was given is read
// fine, but the text it made did not read back as intended (or could not be made). Nothing was written.
function notMade(setting, rel, text, keys) {
  const at = lineOfKey(text, keys);
  return plain(`The change to ${setting} was not made and ${rel} is untouched: this file is written in a way this command cannot edit safely. Change that setting by hand${at ? ` (near line ${at})` : ''}.`);
}

// The 1-based line of the deepest entry on `keys` that the text holds, or null.
function lineOfKey(text, keys) {
  try {
    const lc = new YAML.LineCounter();
    const doc = YAML.parseDocument(text, { lineCounter: lc });
    let node = doc.contents;
    let pair = null;
    for (const k of keys || []) {
      const found = findPair(node, k);
      if (!found) break;
      pair = found;
      node = found.value;
    }
    return pair ? lc.linePos(pair.key.range[0]).line : null;
  } catch (e) {
    return null;
  }
}

// ---- Text helpers (offsets come from the library; these only find line edges) -----------------

const lineStart = (t, i) => (i <= 0 ? 0 : t.lastIndexOf('\n', i - 1) + 1);
const lineFullEnd = (t, i) => { const nl = t.indexOf('\n', i); return nl < 0 ? t.length : nl + 1; };
const columnOf = (t, i) => i - lineStart(t, i);
const eolOf = (t) => { const i = t.indexOf('\n'); return i > 0 && t[i - 1] === '\r' ? '\r\n' : '\n'; };

// Where a node's own content ends: a block collection's `range` runs on through the comments and
// blank lines after it, so its last child says where it really ends.
function endOf(node, text) {
  if (!node) return 0;
  if (isYMap(node) && !node.flow) {
    const last = node.items[node.items.length - 1];
    if (!last) return node.range[0];
    return Math.max(last.key.range[1], last.value ? endOf(last.value, text) : 0);
  }
  if (isYSeq(node) && !node.flow) {
    const last = node.items[node.items.length - 1];
    return last ? endOf(last, text) : node.range[0];
  }
  // A block scalar's range runs through its last line break; the content ends before it.
  if (isScalar(node) && (node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED')) {
    let end = node.range[1];
    while (end > node.range[0] && (text[end - 1] === '\n' || text[end - 1] === '\r')) end--;
    return end;
  }
  return node.range[1];
}
const isEmptyNode = (n) => !n || (isScalar(n) && n.range[0] === n.range[1]);

function applyEdits(text, edits) {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.from - a.from || b.to - a.to)) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return out;
}

// An edit that adds whole lines after the line holding `pos`; keeps a file without a final newline without one.
function addLines(text, pos, lines, eol) {
  const nl = text.indexOf('\n', pos);
  if (nl < 0) return { from: text.length, to: text.length, text: eol + lines.join(eol) };
  return { from: nl + 1, to: nl + 1, text: lines.join(eol) + eol };
}

// An edit that removes whole lines [from the start of the line at `a`, through the line at `b`].
function dropLines(text, a, b, eol) {
  let from = lineStart(text, a);
  const to = lineFullEnd(text, b);
  if (to === text.length && !text.endsWith('\n') && from > 0) from -= eol.length;
  return { from, to, text: '' };
}

// ---- Making text with the library --------------------------------------------------------------

const toStringOptions = (ctx) => ({ indent: ctx.step, indentSeq: ctx.indentSeq, lineWidth: 0, blockQuote: false, flowCollectionPadding: false, minContentWidth: 0 });
// On the old file (`ctx.v11`) the build reads with another YAML reader (js-yaml, YAML 1.1), which takes some plain
// text for a number or a date ("12:30", "2024-10-13"). A string that reader would not give back as written is
// quoted, so both readers agree on it; asked of the reader itself, not of a list of words.
const buildReadsAsWritten = (text) => {
  try { return parseNote(`---\nk: ${new YAML.Document(text).toString().trim()}\n---\n`).data.k === text; } catch { return false; }
};
// A string with a line break is always written double-quoted on one line: the library would otherwise
// spread it over lines, which a one-line (flow) group cannot hold.
function documentOf(value, ctx = {}) {
  const doc = new YAML.Document(value, { aliasDuplicateObjects: false });
  YAML.visit(doc, {
    Scalar(_, node) {
      if (typeof node.value !== 'string') return;
      if (/[\r\n]/.test(node.value) || (ctx.v11 && !buildReadsAsWritten(node.value))) node.type = 'QUOTE_DOUBLE';
    },
  });
  return doc;
}

// A scalar, an empty list or map, or (flow) a whole collection, on one line. `old` is the node it
// replaces: a string keeps the quoting it had.
function inline(value, old, ctx, flow = false) {
  if (isScalar(old) && typeof value === 'string' && (old.type === 'QUOTE_DOUBLE' || old.type === 'QUOTE_SINGLE')) {
    const s = new Scalar(value);
    s.type = old.type;
    return documentOf(s, ctx).toString(toStringOptions(ctx)).trimEnd();
  }
  const doc = documentOf(value, ctx);
  if (flow && doc.contents && doc.contents.items) doc.contents.flow = true;
  return doc.toString(toStringOptions(ctx)).trimEnd();
}

// The lines for `key: value` as the library writes them, indented by `pad` spaces.
function entryLines(key, value, ctx, pad) {
  const out = documentOf({ [key]: value }, ctx).toString(toStringOptions(ctx)).replace(/\n$/, '').split('\n');
  return out.map((l) => (l === '' ? l : ' '.repeat(pad) + l));
}

const isFilled = (v) => (Array.isArray(v) ? v.length > 0 : (isMap(v) && Object.keys(v).length > 0));

// The indent step and the sequence style the file already uses, so new lines match it.
function styleOf(doc, text) {
  let step = null;
  let indentSeq = null;
  (function walk(node, parentCol) {
    if (isYMap(node) && !node.flow) {
      for (const p of node.items) {
        const col = columnOf(text, p.key.range[0]);
        if (step === null && parentCol !== null && col > parentCol) step = col - parentCol;
        const v = p.value;
        if (isYSeq(v) && !v.flow && v.items.length && indentSeq === null) {
          indentSeq = columnOf(text, dashOffset(v, 0)) > col;
        }
        walk(v, col);
      }
    }
  }(doc.contents, null));
  return { step: step || 2, indentSeq: indentSeq === null ? true : indentSeq, eol: eolOf(text) };
}

// ---- Walking the document ----------------------------------------------------------------------

const keyOfPair = (p) => String(isScalar(p.key) ? p.key.value : p.key);
const findPair = (map, key) => (isYMap(map) ? map.items.find((p) => keyOfPair(p) === key) : undefined);

function parseText(text, label) {
  const doc = YAML.parseDocument(text, { keepSourceTokens: true });
  if (doc.errors.length) throw new Error(`${label} is not valid YAML: ${String(doc.errors[0].message).split('\n')[0].trim().replace(/:$/, '')}`);
  if (doc.contents !== null && !isYMap(doc.contents)) throw new Error(`${label} must hold settings written as name: value`);
  return doc;
}

// Where a pair's colon ends (the value, if it sits on the key's line, starts after it).
// The library's own tokens for the pair say where its `:` is.
function colonEnd(pair) {
  const colon = ((pair.srcToken && pair.srcToken.sep) || []).find((t) => t.type === 'map-value-ind');
  if (!colon) throw new Error('a key in the settings file is written in a form this command does not edit');
  return colon.offset + 1;
}

// Where the dash of a block list's item `i` is, from the library's tokens.
function dashOffset(seq, i) {
  const item = seq.srcToken && seq.srcToken.items && seq.srcToken.items[i];
  const dash = item && (item.start || []).find((t) => t.type === 'seq-item-ind');
  if (!dash) throw new Error('a list in the settings file is written in a form this command does not edit');
  return dash.offset;
}

// ---- The edits ---------------------------------------------------------------------------------

// Replaces the value of `pair` with `value`, leaving the key, its comment and everything else alone.
function replaceValue(text, pair, value, ctx) {
  const { eol } = ctx;
  const v = pair.value;
  const empty = isEmptyNode(v);
  const cEnd = colonEnd(pair);
  const keyCol = columnOf(text, pair.key.range[0]);
  const sameLine = empty || !text.slice(cEnd, v.range[0]).includes('\n');
  const flowKeep = v && isCollection(v) && v.flow && isFilled(value);
  if (flowKeep) return [{ from: v.range[0], to: endOf(v, text), text: inline(value, v, ctx, true) }];
  if (!isFilled(value)) {
    const text1 = ` ${inline(value, v, ctx)}`;
    if (sameLine) return [{ from: cEnd, to: empty ? cEnd : endOf(v, text), text: text1 }];
    return [{ from: cEnd, to: cEnd, text: text1 }, dropLines(text, v.range[0], endOf(v, text), eol)];
  }
  const block = entryLines('k', value, ctx, keyCol).slice(1);
  if (empty) return [addLines(text, cEnd, block, eol)];
  if (sameLine) return [{ from: cEnd, to: endOf(v, text), text: '' }, addLines(text, endOf(v, text), block, eol)];
  const to = lineFullEnd(text, endOf(v, text));
  return [{ from: lineStart(text, v.range[0]), to, text: block.join(eol) + (to === text.length && !text.endsWith('\n') ? '' : eol) }];
}

// Adds `key: value` at the end of the block map `map`.
function appendEntry(text, map, key, value, ctx) {
  const first = map.items[0];
  const col = columnOf(text, first.key.range[0]);
  const last = map.items[map.items.length - 1];
  const end = Math.max(last.key.range[1], last.value ? endOf(last.value, text) : 0);
  return [addLines(text, end, entryLines(key, value, ctx, col), ctx.eol)];
}

const nest = (keys, value) => keys.reduceRight((acc, k) => ({ [k]: acc }), value);

// Sets the value at `keys` (maps made on the way; a value that is not a map in the way is replaced).
function setAt(text, doc, keys, value, ctx) {
  if (doc.contents === null || (isYMap(doc.contents) && doc.contents.items.length === 0 && !doc.contents.flow)) {
    const body = text.trimEnd();
    const lines = entryLines(keys[0], nest(keys.slice(1), value), ctx, 0);
    // The text keeps its ending: a file that ended in a line break still does; the old file's frontmatter
    // (cut before its closing ---) has none, and an empty one gets none.
    const ends = text === '' ? !ctx.keepBlock : /\n$/.test(text);
    return [{ from: 0, to: text.length, text: (body ? body + ctx.eol : '') + lines.join(ctx.eol) + (ends ? ctx.eol : '') }];
  }
  let map = doc.contents;
  for (let i = 0; i < keys.length; i++) {
    if (map.flow) return flowRewrite(text, map, ctx, doc, (js) => withValue(js, keys.slice(i), value));
    const pair = findPair(map, keys[i]);
    if (!pair) return appendEntry(text, map, keys[i], nest(keys.slice(i + 1), value), ctx);
    if (i === keys.length - 1) return replaceValue(text, pair, value, ctx);
    if (isYMap(pair.value) && pair.value.items.length) { map = pair.value; continue; }
    if (i === 0 && !isEmptyNode(pair.value) && !isYMap(pair.value)) throw plain(`${keys[0]} in the settings file is not a group of settings, so nothing can be written under it`);
    return replaceValue(text, pair, nest(keys.slice(i + 1), value), ctx);
  }
  return [];
}

function withValue(obj, keys, value) {
  const out = isMap(obj) ? { ...obj } : {};
  out[keys[0]] = keys.length === 1 ? value : withValue(out[keys[0]], keys.slice(1), value);
  return out;
}
// `keep` is the one top-level block left (bare) when its last child goes, as the old file's `publish:` is.
function withoutValue(obj, keys, keep, top = true) {
  if (!isMap(obj) || !Object.prototype.hasOwnProperty.call(obj, keys[0])) return obj;
  const out = { ...obj };
  if (keys.length === 1) { delete out[keys[0]]; return out; }
  const child = withoutValue(obj[keys[0]], keys.slice(1), keep, false);
  if (isMap(child) && Object.keys(child).length === 0) {
    if (top && keys[0] === keep) out[keys[0]] = null;
    else delete out[keys[0]];
  } else out[keys[0]] = child;
  return out;
}

// A one-line (flow) map is written again, whole, with the change made.
function flowRewrite(text, map, ctx, doc, change) {
  const js = change(map.toJS(doc));
  return [{ from: map.range[0], to: endOf(map, text), text: inline(js, map, ctx, true) }];
}

// Removes the entry at `keys`; a group it leaves empty goes too. [] when it is not there.
function removeAt(text, doc, keys, ctx) {
  const chain = [];
  let emptiedFlow = false;
  let map = doc.contents;
  for (const k of keys) {
    if (!isYMap(map)) return [];
    if (map.flow) {
      const rest = keys.slice(chain.length);
      const now = map.toJS(doc);
      const next = withoutValue(now, rest);
      if (isDeepStrictEqual(next, now)) return [];
      // A one-line group left with nothing goes with its key (below), as a block group does.
      if (Object.keys(next).length || chain.length === 0) return [{ from: map.range[0], to: endOf(map, text), text: inline(next, map, ctx, true) }];
      emptiedFlow = true;
      break;
    }
    const pair = findPair(map, k);
    if (!pair) return [];
    chain.push({ map, pair });
    map = pair.value;
  }
  // Climb while the entry is the only one in its group. The old file's `publish:` block is left (bare)
  // when its last child goes, as it always was; on the new layout the emptied group goes too.
  const floor = ctx.keepBlock && keys.length > 1 && keys[0] === ctx.keepBlock ? 1 : 0;
  let at = chain.length - 1;
  // The old file's bare `publish:` keeps its key when the one-line group under it empties.
  if (emptiedFlow && at < floor) return [{ from: colonEnd(chain[at].pair), to: endOf(chain[at].pair.value, text), text: '' }];
  while (at > floor && chain[at].map.items.length === 1) at--;
  const { pair } = chain[at];
  return [dropLines(text, pair.key.range[0], Math.max(pair.key.range[1], pair.value ? endOf(pair.value, text) : 0), ctx.eol)];
}

// Changes the list at `keys`: add or remove `entries` (items the list holds are compared with `same`).
// Returns { edits, list } where `list` is the whole list afterwards, or null when nothing changes.
function changeList(text, doc, keys, verb, entries, same, base, ctx) {
  const { eol } = ctx;
  const pair = (() => {
    let map = doc.contents;
    let found;
    for (const k of keys) {
      found = findPair(map, k);
      if (!found) return undefined;
      map = found.value;
    }
    return found;
  })();
  const node = pair && pair.value;
  if (pair && node && isYSeq(node) && node.items.length) {
    const held = node.items.map((i) => (isScalar(i) ? String(i.value) : null));
    if (verb === 'add') {
      const fresh = entries.filter((x, i) => !held.some((h) => h !== null && same(h, x)) && entries.findIndex((y) => same(y, x)) === i);
      if (!fresh.length) return null;
      const list = [...held, ...fresh];
      if (node.flow) {
        const last = node.items[node.items.length - 1];
        return { edits: [{ from: last.range[1], to: last.range[1], text: fresh.map((x) => `, ${inline(x, null, ctx)}`).join('') }], list };
      }
      const col = columnOf(text, dashOffset(node, 0));
      const lines = fresh.map((x) => `${' '.repeat(col)}- ${inline(x, null, ctx)}`);
      return { edits: [addLines(text, endOf(node, text), lines, eol)], list };
    }
    const gone = node.items.filter((i) => isScalar(i) && entries.some((x) => same(String(i.value), x)));
    if (!gone.length) return null;
    const list = node.items.filter((i) => !gone.includes(i)).map((i) => (isScalar(i) ? String(i.value) : null));
    if (!list.length) return { edits: replaceValue(text, pair, [], ctx), list: [] };
    if (node.flow) return { edits: [{ from: node.range[0], to: endOf(node, text), text: inline(list, node, ctx, true) }], list };
    return { edits: gone.map((i) => dropLines(text, i.range[0], i.range[1], eol)), list };
  }
  // No list in the file (missing, empty, or an empty `[]`): start from `base`.
  // A list written empty (`[]`) is empty; a key with nothing, or no key, starts from `base` (the built-in list).
  const start = pair && node && isYSeq(node) ? [] : (base || []);
  const list = verb === 'add'
    ? [...start, ...entries.filter((x, i) => !start.some((h) => same(h, x)) && entries.findIndex((y) => same(y, x)) === i)]
    : start.filter((h) => !entries.some((x) => same(h, x)));
  if (isDeepStrictEqual(list, start) && pair && node && isYSeq(node)) return null;
  return { edits: setAt(text, doc, keys, list, ctx), list };
}

// Renames the key at `keys` to `to`, in place.
function renameKey(text, doc, keys, to, ctx) {
  let map = doc.contents;
  let pair;
  for (const k of keys) {
    pair = findPair(map, k);
    if (!pair) return [];
    map = pair.value;
  }
  const k = pair.key;
  const s = new Scalar(to);
  if (isScalar(k) && (k.type === 'QUOTE_DOUBLE' || k.type === 'QUOTE_SINGLE')) s.type = k.type;
  return [{ from: k.range[0], to: k.range[1], text: documentOf(s, ctx).toString(toStringOptions(ctx)).trimEnd() }];
}

// Renames one entry of the list at `keys` in place (text only changes at the entry).
function renameItem(text, doc, keys, from, to, ctx) {
  let node = doc.contents;
  for (const k of keys) { node = isYMap(node) ? (findPair(node, k) || {}).value : undefined; }
  if (!isYSeq(node)) return [];
  const edits = [];
  for (const i of node.items) {
    if (isScalar(i) && String(i.value) === from) edits.push({ from: i.range[0], to: i.range[1], text: inline(to, i, ctx) });
  }
  return edits;
}


// ---- The layouts -------------------------------------------------------------------------------

// The document text of a settings file and how to put an edited text back.
function open(vaultPath, layout, create) {
  if (layout === 'new') {
    const text = fs.readFileSync(at(vaultPath, NEW_FILE), 'utf8');
    return { rel: NEW_FILE, label: NEW_FILE, whole: text, text, eol: eolOf(text), join: (t) => t };
  }
  if (layout === 'legacy') {
    const whole = fs.readFileSync(at(vaultPath, OLD_FILE), 'utf8');
    if (!whole.startsWith('---')) throw new Error(`${OLD_FILE} has no frontmatter to edit`);
    const m = splitFront(whole).matter;
    if (whole.slice(3, 3 + m.length) !== m || !whole.slice(3 + m.length).startsWith('\n') && !whole.slice(3 + m.length).startsWith('\r\n') && whole.slice(3 + m.length) !== '') {
      throw new Error(`${OLD_FILE} frontmatter is not in a form this command edits`);
    }
    const eol = eolOf(whole);
    return { rel: OLD_FILE, label: OLD_FILE, whole, eol, ...editableFront(whole, eol) };
  }
  if (!create) throw new Error(`this vault has no settings file yet; add --create to make ${NEW_FILE}`);
  return { rel: NEW_FILE, label: NEW_FILE, whole: null, text: 'version: 1\n', eol: '\n', join: (t) => t, created: true };
}

// The old file split by gray-matter (its own YAML engine turned off): `matter` is the text between the --- lines
// exactly as written, `content` what follows the closing ---. The one split, used here and by the move.
const splitFront = (whole) => matter(whole, { engines: { yaml: () => ({}) } });

// The part of the old file that is edited: { text (the frontmatter without its edges), join (puts an edited
// text back between the same --- lines) }.
function editableFront(whole, eol) {
  const m = splitFront(whole).matter;
  const cr = m.endsWith('\r') ? '\r' : '';
  let body = cr ? m.slice(0, -1) : m;
  let lead = '';
  if (body.startsWith('\r\n')) { lead = '\r\n'; body = body.slice(2); } else if (body.startsWith('\n')) { lead = '\n'; body = body.slice(1); } else if (body === '') lead = eol;
  const rest = whole.slice(3 + m.length);
  return { text: body, join: (t) => `---${lead}${t}${cr}${rest}` };
}

function writeAtomic(link, text, { rename } = {}) {
  const existing = fs.existsSync(link);
  const file = existing ? fs.realpathSync(link) : link;
  const mode = existing ? fs.statSync(file).mode & 0o7777 : null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, text, mode === null ? undefined : { mode });
    if (mode !== null) fs.chmodSync(tmp, mode);
    (rename || fs.renameSync)(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

// ---- Checking the changes ----------------------------------------------------------------------

const blank = (x) => typeof x === 'string' && x.trim() === '';

// Turns each change into steps on the file, or refuses it. { steps, refusals }.
function prepare(changes, layout, { allowState = false } = {}) {
  const refusals = [];
  const steps = [];
  const legacy = layout === 'legacy';
  for (const change of changes) {
    if (change.op === 'unset-raw') {
      if (!legacy) refusals.push('a raw path can be taken out only of the old settings file');
      else steps.push({ kind: 'del', keys: change.path, setting: change.path.join('.'), shown: change.path.join('.') });
      continue;
    }
    const name = change.label || change.name;
    const e = BY_NAME.get(change.name);
    if (!e) {
      const holds = REGISTRY.filter((x) => x.name.startsWith(`${name}.`) && isLeaf(x, REGISTRY)).map((x) => x.name);
      if (holds.length && change.op === 'unset') refusals.push(`${name} holds other settings; unset each setting in it: ${holds.join(', ')}.`);
      else if (holds.length) refusals.push(`${name} holds other settings; set the setting itself, for example ${holds[0]}.`);
      else refusals.push(`${name} is not a setting.`);
      continue;
    }
    // Only the set-up note command passes allowState, for the one state entry the old file holds.
    const state = allowState && e.state && e.legacyOnly;
    if (!state && (e.state || e.settable === false)) { refusals.push(`${name} is kept by the tool and cannot be set here.`); continue; }
    if (e.retired) { refusals.push(`${name} is no longer used and cannot be set.`); continue; }
    if (!state && (e.container || e.legacyOnly)) { refusals.push(`${name} only holds other settings and cannot be set.`); continue; }
    if (!state && !isLeaf(e, REGISTRY) && !e.open) {
      const child = REGISTRY.find((x) => x.name.startsWith(`${name}.`) && isLeaf(x, REGISTRY));
      refusals.push(change.op === 'unset' ? `${name} holds other settings; unset each setting in it.` : `${name} holds other settings; set the setting itself, for example ${child && child.name}.`);
      continue;
    }
    // On the new layout a setting is written under its own name, whatever name the command was given.
    let keys = (legacy ? name : e.name).split('.');
    let older = [];
    let spelling = legacy ? name : e.name;
    if (legacy) {
      const first = legacyNameOf(e);
      if (!first) { refusals.push(`${name} needs the new settings file; run the update first.`); continue; }
      keys = first.split('.');
      spelling = first;
      older = (e.was || []).filter((w) => w.in === 'vault' && w.name !== first).map((w) => w.name);
    }
    const base = { shown: legacy ? name : e.name, setting: change.name, keys, older: older.map((o) => o.split('.')), spelling, olderNames: older };
    if (change.op === 'set') {
      if (blank(change.value) && e.type !== 'text') { refusals.push(`${name} has no value; to take it out of the file, use settings unset ${name}.`); continue; }
      if (Array.isArray(change.value) && change.value.some(blank)) { refusals.push(`${name} has a blank entry; remove it.`); continue; }
      const read = TYPES[e.type].read(change.value, e);
      if (!read.ok) { refusals.push(makeFault({ name, kind: 'not-allowed', level: 'warn', value: change.value, entry: e }).message); continue; }
      steps.push({ ...base, kind: 'set', value: e.type === 'text' ? (typeof change.value === 'number' ? String(change.value) : change.value) : read.value, entry: e });
    } else if (change.op === 'unset') {
      // Given an older spelling, only that spelling goes; given the setting's name, every spelling the old file holds goes.
      steps.push({ ...base, kind: 'del', ...(change.spelling ? { keys: change.spelling.split('.'), older: [] } : {}) });
    } else if (change.op === 'add' || change.op === 'remove') {
      if (!(e.type === 'list' || e.type === 'switchOrList')) { refusals.push(`${name} is not a list, so entries cannot be ${change.op === 'add' ? 'added to' : 'removed from'} it.`); continue; }
      const entries = (change.entries || []).map((x) => (typeof x === 'string' ? x : String(x)));
      if (!entries.length) { refusals.push(`${name} needs at least one entry.`); continue; }
      if (entries.some(blank)) { refusals.push(`${name} has a blank entry; remove it.`); continue; }
      steps.push({ ...base, kind: 'list', verb: change.op, entries, same: change.same || ((a, b) => a === b), base: change.base, entry: e });
    } else {
      refusals.push(`${change.op} is not a change this command makes.`);
    }
  }
  return { steps, refusals };
}

// ---- Doing the changes -------------------------------------------------------------------------

// One step on one text. Returns { text, expected (the data it should parse to), wrote, removed, notes }.
function runStep(text, step, label, eol, keepBlock) {
  const doc = parseText(text, label);
  const ctx = { ...styleOf(doc, text), eol, keepBlock, v11: !!keepBlock };
  const before = doc.toJS() || {};
  const wrote = [];
  const removed = [];
  const notes = [];
  let edits = [];
  let expected = before;
  const nameOf = (keys) => keys.join('.');
  const presentAt = (keys) => getPath(before, keys) !== undefined || doc.hasIn(keys);

  if (step.kind === 'set') {
    const olderHere = (step.older || []).filter(presentAt);
    const sameParent = (o) => o.slice(0, -1).join('.') === step.keys.slice(0, -1).join('.');
    if (olderHere.length && !presentAt(step.keys) && olderHere.length === 1 && sameParent(olderHere[0])) {
      edits = renameKey(text, doc, olderHere[0], step.keys[step.keys.length - 1], ctx);
      notes.push(`Replaced ${nameOf(olderHere[0])} with ${step.spelling}.`);
      expected = withValue(withoutValue(before, olderHere[0], keepBlock), olderHere[0].slice(0, -1).concat(step.keys[step.keys.length - 1]), getPath(before, olderHere[0]));
      const mid = applyEdits(text, edits);
      const next = runStep(mid, { ...step, older: [] }, label, eol, keepBlock);
      return { ...next, notes: [...notes, ...next.notes], removed: [...removed, ...next.removed] };
    }
    if (!isDeepStrictEqual(getPath(before, step.keys), step.value) || !presentAt(step.keys)) edits = setAt(text, doc, step.keys, step.value, ctx);
    expected = withValue(before, step.keys, step.value);
    wrote.push(step.spelling);
    let cur = applyEdits(text, edits);
    for (const o of olderHere) {
      if (!presentAt(o)) continue;
      const d2 = parseText(cur, label);
      const rm = removeAt(cur, d2, o, ctx);
      cur = applyEdits(cur, rm);
      expected = withoutValue(expected, o, keepBlock);
      removed.push(nameOf(o));
      notes.push(`Replaced ${nameOf(o)} with ${step.spelling}.`);
    }
    return { text: cur, expected, wrote, removed, notes };
  }
  if (step.kind === 'del') {
    const all = [step.keys, ...(step.older || [])].filter(presentAt);
    let cur = text;
    for (const keys of all) {
      const d2 = parseText(cur, label);
      cur = applyEdits(cur, removeAt(cur, d2, keys, ctx));
      expected = withoutValue(expected, keys, keepBlock);
      removed.push(nameOf(keys));
    }
    return { text: cur, expected, wrote, removed, notes };
  }
  // list
  const held = getPath(before, step.keys);
  if (held === true || held === false) {
    if (step.entry.type === 'switchOrList' && held === true) throw plain(`${step.setting} is on, which hides every one of its kind, so a list cannot be changed; use settings set ${step.setting} to give a list or turn it off.`);
  }
  const base = step.base !== undefined ? step.base : (Array.isArray(step.entry.default) ? step.entry.default : []);
  const res = changeList(text, doc, step.keys, step.verb, step.entries, step.same, base, ctx);
  if (!res) return { text, expected: before, wrote, removed, notes };
  expected = withValue(before, step.keys, res.list);
  wrote.push(step.spelling);
  return { text: applyEdits(text, res.edits), expected, wrote, removed, notes };
}

// Plans the changes without writing: { rel, file, before, after, changed, notes, wrote, removed, created }.
// `siteConfig` is the site folder's vault.config.json, when the caller has it: a vault with no settings file whose
// site file still holds settings is not given a new one (the new file would switch those settings off).
function planChanges(vaultPath, changes, { create = false, allowState = false, siteConfig = null } = {}) {
  const layout = layoutOf(vaultPath);
  const { steps, refusals } = prepare(changes, layout, { allowState });
  if (refusals.length) {
    const err = new Error(refusals.join('\n'));
    err.refusals = refusals;
    throw err;
  }
  if (layout === 'none' && create && hasLegacy(siteConfig)) {
    throw plain("the site folder's vault.config.json still holds this vault's settings; run the update first, which brings them into the vault. Nothing was written.");
  }
  const doc = open(vaultPath, layout, create);
  if (layout === 'new' || doc.created) {
    const tree = parseText(doc.text, doc.label).toJS() || {};
    if (typeof tree.version === 'number' && tree.version > LAYOUT_VERSION) throw new Error(NEWER_VERSION);
  }
  let text = doc.text;
  // The file as given must read; "not valid YAML" is only ever said about that.
  parseText(text, doc.label);
  const result = { changed: [], notes: [], wrote: [], removed: [] };
  // Lines in the old file count the opening --- line too.
  const lineBase = layout === 'legacy' ? 1 : 0;
  for (const step of steps) {
    const before = text;
    let out;
    try {
      out = runStep(text, step, doc.label, doc.eol, layout === 'legacy' ? OLD_BLOCK : null);
      const after = parseText(out.text, doc.label).toJS() || {};
      if (!isDeepStrictEqual(after, out.expected)) throw new Error('did not read back as intended');
      // The old file is read by the build with another YAML reader (js-yaml, YAML 1.1): the changed setting must
      // come out of that reader as it was meant too.
      if (layout === 'legacy' && step.kind !== 'del' && out.text !== before) {
        const built = parseNote(doc.join(out.text)).data || {};
        if (!isDeepStrictEqual(getPath(built, step.keys), getPath(out.expected, step.keys))) throw new Error('the build would read it differently');
      }
    } catch (e) {
      if (e.plain) throw e;
      const err = notMade(step.shown || step.setting, doc.rel, before, step.keys);
      if (lineBase) err.message = err.message.replace(/near line (\d+)/, (m, n) => `near line ${Number(n) + lineBase}`);
      throw err;
    }
    text = out.text;
    if (text !== before && step.setting) result.changed.push(step.setting);
    result.notes.push(...out.notes);
    result.wrote.push(...out.wrote);
    result.removed.push(...out.removed);
  }
  return { ...result, rel: doc.rel, file: at(vaultPath, doc.rel), before: doc.whole, after: doc.join(text), created: !!doc.created, changed: [...new Set(result.changed)] };
}

// applyChanges(vaultPath, changes, { create }) -> { file, rel, changed, notes, wrote, removed }
// changes: { op: 'set', name, value } | { op: 'unset', name } | { op: 'add' | 'remove', name, entries, same?, base? }
//          | { op: 'unset-raw', path: [...] } (old file only)
// Throws one Error listing every refusal (error.refusals) and writes nothing unless all pass.
function applyChanges(vaultPath, changes, options = {}) {
  const plan = planChanges(vaultPath, changes, options);
  if (plan.after !== plan.before) writeAtomic(plan.file, plan.after, { rename: options.rename });
  return { file: plan.file, rel: plan.rel, changed: plan.changed, notes: plan.notes, wrote: plan.wrote, removed: plan.removed, created: plan.created };
}

// ---- For the callers that read or rename --------------------------------------------------------

// The settings file's name (relative) and text, or null with no file; { rel, text, data } where
// `data` is what the file's settings parse to, whichever layout it is on.
function settingsText(vaultPath) {
  const layout = layoutOf(vaultPath);
  if (layout === 'none') return null;
  const opened = open(vaultPath, layout, false);
  const data = parseText(opened.text, opened.label).toJS() || {};
  // The value the file holds for a setting (by its new name), wherever the layout keeps it; undefined when absent.
  const get = (name) => {
    const e = BY_NAME.get(name);
    const where = layout === 'legacy' ? (e && legacyNameOf(e)) : name;
    return where ? getPath(data, where.split('.')) : undefined;
  };
  return { rel: opened.rel, whole: opened.whole, data, layout, get };
}

// renameInSettings(vaultPath, renames, { text }) -> { rel, text } | null
// renames: { name, key: { from, to } } (rename a key of a map setting) or { name, item: { from, to } }
// (rename an entry of a list setting); `name` is the setting's new name. `text` is the settings file's
// text when an earlier rename already changed it. null when nothing changes.
function renameInSettings(vaultPath, renames, { text } = {}) {
  const layout = layoutOf(vaultPath);
  if (layout === 'none') return null;
  const opened = open(vaultPath, layout, false);
  let current = text === undefined ? opened.whole : text;
  const stage = layout === 'legacy' ? editableFront(current, opened.eol) : { text: current, join: (t) => t };
  let edit = stage.text;
  for (const r of renames) {
    const e = BY_NAME.get(r.name);
    if (!e) throw new Error(`${r.name} is not a setting.`);
    const keys = (layout === 'legacy' ? legacyNameOf(e) : e.name).split('.');
    const doc = parseText(edit, opened.label);
    const ctx = { ...styleOf(doc, edit), eol: opened.eol, v11: layout === 'legacy' };
    const before = doc.toJS() || {};
    const held = getPath(before, keys);
    let edits;
    let expected;
    if (r.key) {
      if (!isMap(held) || !Object.prototype.hasOwnProperty.call(held, r.key.from)) continue;
      edits = renameKey(edit, doc, [...keys, r.key.from], r.key.to, ctx);
      const { [r.key.from]: moved, ...others } = held;
      expected = withValue(before, keys, { ...others, [r.key.to]: moved });
    } else {
      if (!Array.isArray(held) || !held.includes(r.item.from)) continue;
      edits = renameItem(edit, doc, keys, r.item.from, r.item.to, ctx);
      expected = withValue(before, keys, held.map((x) => (x === r.item.from ? r.item.to : x)));
    }
    const next = applyEdits(edit, edits);
    let back;
    try { back = parseText(next, opened.label).toJS() || {}; } catch (e) { back = null; }
    if (!isDeepStrictEqual(back, expected)) throw notMade(r.name, opened.rel, edit, keys);
    edit = next;
  }
  if (edit === stage.text) return null;
  return { rel: opened.rel, text: stage.join(edit) };
}

// Every reason the changes would be refused, one line each; [] when they would go through.
function refusalsFor(vaultPath, changes) {
  return prepare(changes, layoutOf(vaultPath)).refusals;
}

module.exports = { applyChanges, refusalsFor, planChanges, renameInSettings, settingsText, writeAtomic, splitFront };
