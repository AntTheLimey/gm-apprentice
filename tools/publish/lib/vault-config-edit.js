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

const CONFIG_REL = path.join('_meta', 'vault-config.md');
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
  let end = start + 1;
  for (let i = start + 1; i < limit; i++) if (!isBlank(lines[i]) && !isComment(lines[i])) end = i + 1;
  const first = lines.slice(start + 1, end).find((l) => !isBlank(l) && !isComment(l));
  const indent = first === undefined ? 2 : indentOf(first);
  // Lines indented deeper than the keys (a block scalar ending in a `#` line) belong to the
  // last key; only comments at the key indent or shallower sit outside the block.
  for (let i = end; i < limit; i++) {
    if (isBlank(lines[i])) continue;
    if (indentOf(lines[i]) <= indent) break;
    end = i + 1;
  }
  for (let i = start + 1; i < end; i++) {
    if (/^ *\t/.test(lines[i])) return { error: 'the publish block is indented with a tab' };
  }
  const starts = [];
  for (let i = start + 1; i < end; i++) {
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
  return { start, end, indent, keys };
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

function verify(oldData, newData, set, remove) {
  const bad = { error: 'the edit did not verify' };
  const oldPub = oldData.publish ?? {};
  const newPub = newData.publish ?? {};
  const rest = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'publish'));
  if (!isDeepStrictEqual(rest(oldData), rest(newData))) return bad;
  const touched = new Set([...Object.keys(set), ...remove]);
  for (const k of new Set([...Object.keys(oldPub), ...Object.keys(newPub)])) {
    if (touched.has(k)) continue;
    if (!isDeepStrictEqual(oldPub[k], newPub[k])) return bad;
  }
  for (const [k, v] of Object.entries(set)) if (!isDeepStrictEqual(newPub[k], v)) return bad;
  for (const k of remove) if (k in newPub) return bad;
  return null;
}

// editPublishBlock(text, { set, remove }) -> { text } | { error }
function editPublishBlock(text, changes = {}) {
  const set = changes.set || {};
  const remove = changes.remove || [];
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
    const next = cur.head + cur.lines.map((l) => l + cur.eol).join('') + cur.tail;
    if (next === text) return { text };
    const after = readOrReason(next);
    if (after.error) return { error: `the edit did not verify (${after.error})` };
    const bad = verify(old.data, after.data, set, remove);
    if (bad) return bad;
    return { text: next };
  } catch (e) {
    return { error: `the edit failed: ${e.message}` };
  }
}

// setPublishKeys(vaultPath, set, remove) -> { changed }. Throws Error(reason) on refusal.
// deps.rename replaces fs.renameSync (tests inject a failing one).
function setPublishKeys(vaultPath, set, remove = [], deps = {}) {
  const file = path.join(vaultPath, CONFIG_REL);
  const exists = fs.existsSync(file);
  const before = exists ? fs.readFileSync(file, 'utf8') : '---\ntype: meta\n---\n';
  const out = editPublishBlock(before, { set, remove });
  if (out.error) throw new Error(`cannot edit ${CONFIG_REL}: ${out.error}`);
  if (out.text === before && (exists || !Object.keys(set).length)) return { changed: false };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write beside the target and rename over it, so a crash never leaves a truncated file.
  const tmp = path.join(path.dirname(file), `.vault-config.md.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, out.text);
    (deps.rename || fs.renameSync)(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return { changed: true };
}

module.exports = { editPublishBlock, setPublishKeys };
