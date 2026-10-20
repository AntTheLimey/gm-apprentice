'use strict';

// `manifest never-publish`: puts `publish: false` in a note's own frontmatter, so a working
// note (raw play notes, a plan, an NPC sketch) is marked as never publishing without a
// `type:` that would make it a publish candidate. The change is a line of text: the rest of
// the note comes back byte for byte, and a note with no frontmatter gets a block of one line.
// Preview by default; `--write` makes the change.
const fs = require('fs');
const path = require('path');
const { canonicalPath } = require('./manifest');
const { publishesPage } = require('./publish-decision');
const { writeAtomic } = require('./settings/write');
const { publishMode } = require('./processor');
const { parseNote } = require('./frontmatter');
const { vaultSpelling } = require('./vault-reader');

// The frontmatter block at the top of a note: the `---` line, whatever follows up to the closing
// `---` line. A note whose `---` never closes has none (it is a rule line, not frontmatter).
const BLOCK = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

// The root files that tell an agent how to work in the vault. Adding frontmatter to them
// would change a file another tool reads, so `--untyped` leaves them be.
const AGENT_FILES = new Set(['agents.md', 'claude.md']);

// The note's text with `publish: false` added, or { skip } with the plain reason it was not.
function markNeverPublish(text) {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const body = text.slice(bom.length);
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const block = BLOCK.exec(body);
  if (!block) return { text: `${bom}---${eol}publish: false${eol}---${eol}${body}` };
  // The frontmatter is read by the YAML reader the build uses, so a quoted `"publish":` key is the same key.
  const read = (text) => { try { return parseNote(text).data; } catch { return null; } };
  const data = read(body);
  if (!data) return { skip: 'its frontmatter cannot be read; fix that first' };
  if (Object.prototype.hasOwnProperty.call(data, 'publish')) {
    return { skip: publishMode(data) === 'none' ? 'already marked' : 'it has a publish: line already; change it by hand' };
  }
  const opener = /^---[ \t]*\r?\n/.exec(body)[0];
  const made = `${opener}publish: false${eol}${body.slice(opener.length)}`;
  // The note read back must be the note as it was plus `publish: false`. Frontmatter written as one `{ ... }`
  // value, say, does not take a line of its own.
  const back = read(made);
  const rest = back && Object.fromEntries(Object.entries(back).filter(([k]) => k !== 'publish'));
  if (!back || back.publish !== false || JSON.stringify(rest) !== JSON.stringify(data)) {
    return { skip: 'its frontmatter is not written one field to a line, so the line cannot be added safely; add publish: false by hand' };
  }
  return { text: `${bom}${made}` };
}

// The path as the vault spells it on disk (a disk that ignores case finds `npcs/bob.md` for `NPCs/Bob.md`, and the
// verdicts are keyed by the vault's own spelling), or null when no note is there.
function inVault(vaultPath, rel) {
  const full = path.resolve(vaultPath, rel);
  if (!full.startsWith(path.resolve(vaultPath) + path.sep) || !/\.md$/i.test(rel)) return null;
  const spelt = vaultSpelling(vaultPath, rel);
  return spelt ? canonicalPath(spelt) : null;
}

async function runNeverPublish(options, deps, survey) {
  const out = deps.out || console.log;
  const readFile = deps.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const writeFile = deps.writeFile || ((p, c) => writeAtomic(p, c));
  const { vaultPath, verdicts, report } = survey;

  const given = (options.paths || []).map((p) => canonicalPath(String(p).trim().replace(/^\.\//, '')));
  if (given.length === 0 && !options.untyped) {
    out('manifest never-publish needs --path <note> (repeatable) or --untyped');
    return 1;
  }
  const missing = given.filter((rel) => !inVault(vaultPath, rel));
  const named = given.map((rel) => inVault(vaultPath, rel)).filter(Boolean);
  if (missing.length > 0) {
    for (const rel of missing) out(`no such file in the vault: ${rel}`);
    out('Nothing was written. Run `gm-publish manifest diff` for the paths the vault actually has.');
    return 1;
  }
  const untyped = options.untyped
    ? report.untyped.map(canonicalPath).filter((rel) => rel.includes('/') || !AGENT_FILES.has(rel.toLowerCase()))
    : [];

  const marked = [];
  const skipped = [];
  for (const rel of [...new Set([...named, ...untyped])]) {
    const verdict = verdicts.get(rel);
    // A note the site's survey does not hold (an excluded folder, say) has no verdict to go by: left alone.
    if (!verdict) { skipped.push({ path: rel, reason: 'the site does not read it, so there is no publish verdict to go by; nothing to mark' }); continue; }
    if (publishesPage(verdict)) { skipped.push({ path: rel, reason: 'it publishes now; this command never touches a note that does' }); continue; }
    if (verdict && verdict.code === 'FILE_UNPARSEABLE') { skipped.push({ path: rel, reason: 'its frontmatter cannot be read; fix that first' }); continue; }
    const made = markNeverPublish(readFile(path.join(vaultPath, rel)));
    if (made.skip) skipped.push({ path: rel, reason: made.skip });
    else marked.push({ path: rel, text: made.text });
  }

  if (options.write) {
    for (const { path: rel, text } of marked) writeFile(path.join(vaultPath, rel), text);
  }
  const paths = marked.map((m) => m.path);
  if (options.json) {
    out(JSON.stringify({ write: !!options.write, marked: paths, skipped }, null, 2));
    return 0;
  }
  const verb = options.write ? 'marked' : 'would mark';
  out(`manifest never-publish: ${verb} ${marked.length} note(s) publish: false`);
  for (const rel of paths) out(`  ${rel}`);
  if (skipped.length > 0) {
    out(`Left alone (${skipped.length}):`);
    for (const s of skipped) out(`  ${s.path} — ${s.reason}`);
  }
  if (!options.write && marked.length > 0) out('Nothing was written. Run again with --write to mark them.');
  return 0;
}

module.exports = { runNeverPublish, markNeverPublish };
