// tools/publish/lib/vault-config-edit.js
//
// Edit the `publish:` block of _meta/vault-config.md in place. The file is hand-edited by
// the GM, so this works on lines and touches only the keys it was asked to change: every
// other byte (comments, spacing, other keys, the body) comes back as it went in. Anything
// it cannot edit safely is refused, and the result is parsed again and compared before
// any text is returned.
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const yaml = require('js-yaml');
const { parseNote } = require('./frontmatter');

// Shown in messages, so always forward-slashed; path.join accepts it on every platform.
const CONFIG_REL = '_meta/vault-config.md';
const KEY_RE = /^(?:"([^"]*)"|'([^']*)'|([^\s#:'"-][^:]*?))([ \t]*):(?:\s|$)/;

const indentOf = (line) => line.length - line.trimStart().length;
const isBlank = (line) => line.trim() === '';
const isComment = (line) => line.trimStart().startsWith('#');

// { key, spaced } for a `key:` line; spaced is true when blanks sit between the key and its
// colon (a form this editor does not rewrite). null for a line that is not a key.
function keyOf(line) {
  const m = KEY_RE.exec(line);
  if (!m) return null;
  const key = m[1] ?? m[2] ?? m[3];
  return { key: m[3] !== undefined ? key.trim() : key, spaced: m[4] !== '' || (m[3] !== undefined && key !== key.trim()) };
}

function readOrReason(text) {
  try {
    return { data: parseNote(text).data || {} };
  } catch (e) {
    return { error: `the frontmatter does not parse: ${String(e.message).split('\n')[0]}` };
  }
}

// Split into { head, lines, eol, tail }: head is the opening fence line as written, tail is
// the closing fence line onward, lines are the frontmatter lines without their endings.
function splitFrontmatter(text) {
  const raw = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  if (!raw.length || raw[0].replace(/\r?\n$/, '') !== '---') return { error: 'the file has no frontmatter' };
  const close = raw.findIndex((l, i) => i > 0 && l.replace(/\r?\n$/, '') === '---');
  if (close < 0) return { error: 'the frontmatter has no closing --- line' };
  const ends = raw.slice(0, close).map((l) => (l.endsWith('\r\n') ? '\r\n' : '\n'));
  if (new Set(ends).size > 1) return { error: 'the frontmatter mixes line endings' };
  const eol = ends[0];
  return {
    head: raw[0],
    lines: raw.slice(1, close).map((l) => l.slice(0, -eol.length)),
    eol,
    tail: raw.slice(close).join(''),
  };
}

// Find the publish block in the frontmatter lines. Returns { start, end, indent, keys }
// where start is the `publish:` line, end is one past the block's last content line, and
// keys are the child entries [{ key, from, to }] (to is exclusive, comments above the next
// key are left out of the span). Returns { absent: true } when there is no publish key.
function locateBlock(lines) {
  const start = lines.findIndex((l) => /^["']?publish["']?:/.test(l));
  if (start < 0) return { absent: true };
  if (!/^publish:[ \t]*(#.*)?$/.test(lines[start])) return { error: 'publish: is not written as a block' };
  // The block runs to the next top-level line; trailing blanks and comments are not part of it.
  const stop = lines.findIndex((l, i) => i > start && !isBlank(l) && !isComment(l) && !/^[ \t]/.test(l));
  const limit = stop < 0 ? lines.length : stop;
  const span = spanOf(lines, start + 1, limit);
  const end = span.end;
  const indent = span.indent === null ? 2 : span.indent;
  const scanned = scanKeys(lines, start + 1, end, indent);
  if (scanned.error) return scanned;
  return { start, end, indent, keys: scanned.keys };
}

// Where the entries under a key end. `from` is the line after the key, `limit` one past the
// last line that may belong to it. Returns { end, indent }: end is one past the last content
// line (lines indented deeper than the keys, such as a block scalar ending in a `#` line,
// belong to the last key; only comments at the key indent or shallower sit outside), and
// indent is the entries' indent, or null when there are none.
function spanOf(lines, from, limit) {
  let end = from;
  let indent = null;
  for (let i = from; i < limit; i++) {
    if (isBlank(lines[i]) || isComment(lines[i])) continue;
    if (indent === null) indent = indentOf(lines[i]);
    end = i + 1;
  }
  if (indent === null) return { end, indent };
  for (let i = end; i < limit; i++) {
    if (isBlank(lines[i])) continue;
    if (indentOf(lines[i]) <= indent) break;
    end = i + 1;
  }
  return { end, indent };
}

// The entries [{ key, from, to }] written at `indent` in lines[from, end); to is exclusive,
// and comments above the next key are left out of a span.
function scanKeys(lines, from, end, indent) {
  for (let i = from; i < end; i++) {
    if (/^ *\t/.test(lines[i])) return { error: 'the publish block is indented with a tab' };
  }
  const starts = [];
  for (let i = from; i < end; i++) {
    if (indentOf(lines[i]) === indent && !isBlank(lines[i]) && !isComment(lines[i])) {
      const found = keyOf(lines[i].slice(indent));
      if (found !== null && found.spaced) return { error: `the key "${found.key}" has a space before its colon` };
      if (found !== null) starts.push({ key: found.key, from: i });
    }
  }
  const keys = starts.map((s, n) => {
    let to = n + 1 < starts.length ? starts[n + 1].from : end;
    const outside = (l) => isBlank(l) || (isComment(l) && indentOf(l) <= indent);
    while (to > s.from + 1 && outside(lines[to - 1]) && n + 1 < starts.length) to--;
    return { key: s.key, from: s.from, to };
  });
  return { keys };
}

function dumpAt(key, value, indent) {
  const body = yaml.safeDump({ [key]: value }, { lineWidth: -1 }).replace(/\n$/, '');
  const pad = ' '.repeat(indent);
  return body.split('\n').map((l) => (l === '' ? l : pad + l));
}

function applyOne(fm, change) {
  const lines = fm.lines.slice();
  let block = locateBlock(lines);
  if (block.error) return { error: block.error };
  if (block.absent) {
    if (change.remove) return { lines };
    lines.push('publish:');
    block = locateBlock(lines);
  }
  const hit = block.keys.find((k) => k.key === (change.set ?? change.remove));
  if (change.remove !== undefined) {
    if (hit) lines.splice(hit.from, hit.to - hit.from);
    return { lines };
  }
  const added = dumpAt(change.set, change.value, block.indent);
  if (hit) lines.splice(hit.from, hit.to - hit.from, ...added);
  else lines.splice(block.end, 0, ...added);
  return { lines };
}

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A nested value for the path `keys` ending in `value`.
const nestOf = (keys, value) => keys.reduceRight((acc, k) => ({ [k]: acc }), value);

// `data` with the leaf at `keys` set (maps created, a non-map in the way replaced).
function withLeaf(data, keys, value) {
  const out = isMap(data) ? { ...data } : {};
  out[keys[0]] = keys.length === 1 ? value : withLeaf(out[keys[0]], keys.slice(1), value);
  return out;
}

// Set the one entry at `keys` inside the map whose entries sit at `indent` in
// lines[from, end), and touch no other line. `data` is the map as parsed, for the one case
// (an entry written on one line, `theme: {a: 1}`) where the entry has to be written again.
function setLeaf(lines, from, end, indent, keys, value, data) {
  const scanned = scanKeys(lines, from, end, indent);
  if (scanned.error) return scanned;
  const [head, ...rest] = keys;
  const hit = scanned.keys.find((k) => k.key === head);
  if (!hit) {
    lines.splice(end, 0, ...dumpAt(head, nestOf(rest, value), indent));
    return {};
  }
  if (!rest.length) {
    lines.splice(hit.from, hit.to - hit.from, ...dumpAt(head, value, indent));
    return {};
  }
  if (!/:[ \t]*(#.*)?$/.test(lines[hit.from])) {
    lines.splice(hit.from, hit.to - hit.from, ...dumpAt(head, withLeaf(data && data[head], rest, value), indent));
    return {};
  }
  const inner = spanOf(lines, hit.from + 1, hit.to);
  const innerIndent = inner.indent === null ? indent + 2 : inner.indent;
  return setLeaf(lines, hit.from + 1, inner.end, innerIndent, rest, value, data && data[head]);
}

// The publish map as the frontmatter lines now parse (what a one-line entry is rewritten from).
function publishOf(fm) {
  const read = readOrReason(fm.head + fm.lines.map((l) => l + fm.eol).join('') + fm.tail);
  return read.data && isMap(read.data.publish) ? read.data.publish : {};
}

function applyLeaf(fm, leaf, data) {
  const lines = fm.lines.slice();
  let block = locateBlock(lines);
  if (block.error) return { error: block.error };
  if (block.absent) {
    lines.push('publish:');
    block = locateBlock(lines);
  }
  const done = setLeaf(lines, block.start + 1, block.end, block.indent, leaf.path, leaf.value, data);
  return done.error ? done : { lines };
}

function verify(oldData, newData, set, remove, leaves = []) {
  const bad = { error: 'the edit did not verify' };
  const oldPub = oldData.publish ?? {};
  const newPub = newData.publish ?? {};
  const rest = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'publish'));
  if (!isDeepStrictEqual(rest(oldData), rest(newData))) return bad;
  const touched = new Set([...Object.keys(set), ...remove, ...leaves.map((l) => l.path[0])]);
  for (const k of new Set([...Object.keys(oldPub), ...Object.keys(newPub)])) {
    if (touched.has(k)) continue;
    if (!isDeepStrictEqual(oldPub[k], newPub[k])) return bad;
  }
  for (const [k, v] of Object.entries(set)) if (!isDeepStrictEqual(newPub[k], v)) return bad;
  for (const k of remove) if (k in newPub) return bad;
  // A leaf changes its one entry; everything else in its top-level map comes back as it was.
  let expected = oldPub;
  for (const { path: keys, value } of leaves) expected = withLeaf(expected, keys, value);
  for (const { path: keys } of leaves) if (!isDeepStrictEqual(newPub[keys[0]], expected[keys[0]])) return bad;
  return null;
}

// editPublishBlock(text, { set, remove, leaves }) -> { text } | { error }
// `set` writes a whole top-level key; `leaves` ([{ path: ['theme', 'tagline'], value }])
// writes one entry inside a map and leaves every other line of it as the GM wrote it.
function editPublishBlock(text, changes = {}) {
  const set = changes.set || {};
  const remove = changes.remove || [];
  const leaves = changes.leaves || [];
  try {
    const overlap = remove.find((k) => k in set);
    if (overlap) return { error: `${overlap} is both set and removed` };
    const fm = splitFrontmatter(text);
    if (fm.error) return { error: fm.error };
    const firstLine = fm.lines.find((l) => !isBlank(l) && !isComment(l));
    if (firstLine !== undefined && /^[ \t]/.test(firstLine)) return { error: 'the top-level keys are indented' };
    const old = readOrReason(text);
    if (old.error) return { error: old.error };
    const oldPub = old.data.publish;
    if (oldPub != null && (typeof oldPub !== 'object' || Array.isArray(oldPub))) {
      return { error: 'publish: is not a map' };
    }
    let cur = fm;
    for (const k of remove) {
      const r = applyOne(cur, { remove: k });
      if (r.error) return { error: r.error };
      cur = { ...cur, lines: r.lines };
    }
    for (const [k, value] of Object.entries(set)) {
      if (oldPub && isDeepStrictEqual(oldPub[k], value) && k in oldPub) continue;
      const r = applyOne(cur, { set: k, value });
      if (r.error) return { error: r.error };
      cur = { ...cur, lines: r.lines };
    }
    for (const leaf of leaves) {
      const r = applyLeaf(cur, leaf, publishOf(cur));
      if (r.error) return { error: r.error };
      cur = { ...cur, lines: r.lines };
    }
    const next = cur.head + cur.lines.map((l) => l + cur.eol).join('') + cur.tail;
    if (next === text) return { text };
    const after = readOrReason(next);
    if (after.error) return { error: `the edit did not verify (${after.error})` };
    const bad = verify(old.data, after.data, set, remove, leaves);
    if (bad) return bad;
    return { text: next };
  } catch (e) {
    return { error: `the edit failed: ${e.message}` };
  }
}

// The existing map plus the entries of `additions` it leaves unset (missing, null or empty
// text); null when there is nothing to add. The one rule for adding keys beside a GM's own
// (init's seeded theme keys, migrate-config's tagline).
function fillUnset(existing, additions) {
  const add = Object.entries(additions).filter(([k]) => existing[k] === undefined || existing[k] === null || existing[k] === '');
  return add.length ? { ...existing, ...Object.fromEntries(add) } : null;
}

// Write beside the target and rename over it, so a crash never leaves a truncated file.
// Writes through a symlink to the real file and keeps its permission bits; a file that is
// not there yet is created with the default mode. `rename` replaces fs.renameSync (tests).
function writeAtomic(link, text, { rename } = {}) {
  const existing = fs.existsSync(link);
  const file = existing ? fs.realpathSync(link) : link;
  const mode = existing ? fs.statSync(file).mode & 0o7777 : null;
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

// setPublishKeys(vaultPath, set, remove) -> { changed }. Throws Error(reason) on refusal.
// deps.rename replaces fs.renameSync (tests inject a failing one).
function setPublishKeys(vaultPath, set, remove = [], deps = {}) {
  return writeChanges(vaultPath, { set, remove }, deps);
}

// setPublishLeaves(vaultPath, leaves, deps) -> { changed }: editPublishBlock's `leaves`, written.
function setPublishLeaves(vaultPath, leaves, deps = {}) {
  return writeChanges(vaultPath, { leaves }, deps);
}

// setPublishChanges(vaultPath, { set, remove, leaves }, deps) -> { changed }: all three at once.
function setPublishChanges(vaultPath, changes, deps = {}) {
  return writeChanges(vaultPath, changes, deps);
}

function writeChanges(vaultPath, changes, deps) {
  const file = path.join(vaultPath, CONFIG_REL);
  const exists = fs.existsSync(file);
  const before = exists ? fs.readFileSync(file, 'utf8') : '---\ntype: meta\n---\n';
  const out = editPublishBlock(before, changes);
  if (out.error) throw new Error(`cannot edit ${CONFIG_REL}: ${out.error}`);
  if (out.text === before && (exists || (!Object.keys(changes.set || {}).length && !(changes.leaves || []).length))) return { changed: false };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, out.text, { rename: deps.rename });
  return { changed: true };
}

module.exports = { editPublishBlock, setPublishKeys, setPublishLeaves, setPublishChanges, writeAtomic, fillUnset };
