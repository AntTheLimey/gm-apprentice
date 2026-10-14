'use strict';
// A setting is stated in one place: lib/settings/. Nothing outside it restates a default,
// the words a switch takes, or which files read the vault's settings file; and every name
// the code reads off the settings is in the list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { entry } = require('../lib/settings');
const { REGISTRY, names } = require('../lib/settings/registry');
const { loadPublishConfig } = require('../lib/config');

const ROOT = path.join(__dirname, '..');
const SETTINGS = path.join(ROOT, 'lib', 'settings');
function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (p !== SETTINGS && e.name !== 'node_modules') files(p, out); } else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
const sources = [...files(path.join(ROOT, 'lib')), ...files(path.join(ROOT, 'bin'))];
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const text = (f) => fs.readFileSync(f, 'utf8');
// A source file with its comments taken out, so a sentence about a setting is not code: whole
// comment lines, block comments that start a line, and `  // ...` after code.
const code = (f) => text(f).replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\s\/\/\s.*$/gm, '');
const grep = (re, read = text) => sources.filter((f) => re.test(read(f))).map(rel);

test('the scan sees the code it is meant to check', () => {
  assert.ok(sources.length > 40, `only ${sources.length} source files found`);
  assert.ok(!sources.some((f) => f.startsWith(SETTINGS)), 'the settings package is scanned');
});

// A note's yes/no flags (gm_only, withheld) are read with the same words, from lib/settings/types.js.
// A file states the switch words when it quotes both `yes` and `off`, or when a pattern
// alternates yes, on and true.
test('the switch words are written in one place', () => {
  const quoted = (word) => new RegExp(`['"\`]${word}['"\`]`);
  const both = (src) => quoted('yes').test(src) && quoted('off').test(src);
  const alternation = /\b(?:true|yes|on)\|(?:true|yes|on|false|no|off)\b|\b(?:false|no|off)\|(?:true|yes|on|false|no|off)\b/;
  const found = sources.filter((f) => { const src = code(f); return both(src) || alternation.test(src); }).map(rel);
  assert.deepEqual(found, []);
});

// The headings and field names a site hides by default are read from the list, not typed here.
// A file states one of those lists when it quotes two or more of its entries.
test('no default list is restated', () => {
  for (const name of ['player_site.hide.sections', 'player_site.hide.fields']) {
    const defaults = entry(name).default;
    assert.ok(defaults.length >= 3, `${name} has no default list to check`);
    const found = sources.filter((f) => {
      const src = code(f);
      return defaults.filter((d) => src.includes(`'${d}'`) || src.includes(`"${d}"`) || src.includes(`\`${d}\``)).length >= 2;
    }).map(rel);
    assert.deepEqual(found, [], name);
  }
});

// A fallback typed beside a setting (`attachmentsDir || '_attachments'`, `mode || 'player'`) is the
// default written a second time. The scan looks for `||` or `??` followed by any quoted text
// default or fallback word in the list.
test('no default is written as a fallback', () => {
  const words = new Set(REGISTRY.flatMap((e) => [e.default, e.fallback]).filter((d) => typeof d === 'string' && d.length >= 4));
  assert.ok(words.has('_attachments') && words.has('player') && words.has('plain'), 'the words to look for are missing');
  const found = [];
  for (const f of sources) {
    for (const m of code(f).matchAll(/(?:\|\||\?\?)\s*['"`]([^'"`]+)['"`]/g)) {
      if (words.has(m[1])) found.push(`${rel(f)}: ${m[0]}`);
    }
  }
  assert.deepEqual(found, []);
});

// Each file below names the settings file in code, and why:
//   (none: the old editor and the old migration command are gone)
// The settings package reads and writes the file for everything else (settings/write.js is the one writer),
// and layout.js is the one place that writes either file's name: a message to the GM gets the name from
// fileLabel / nameIn (or their `For` forms), which know which of the two files the vault is on.
test('nothing reads the vault settings file but the settings package', () => {
  const allowed = new Set([]);
  // Either file's name anywhere in code: a path joined, a template, a line of help text.
  const named = /vault-config\.(?:md|yaml)/;
  const hits = grep(named, code);
  const outside = hits.filter((f) => !allowed.has(f));
  assert.deepEqual(outside, []);
  // The list does not go stale: each allowed file still names the file.
  assert.deepEqual([...allowed].filter((f) => !hits.includes(f)), []);
});

// Names the code reads off the resolved config that are worked out by the build, not
// written by a GM:
//   switches  the resolved on/off switches, by name (build.js sets them; the sheet and sync code read them)
//   live      the live-play flags worked out from those switches (build.js, templates/pc.js)
//   legacy    the settings an older site file still holds (build.js lists them in its closing warning)
//   faults    the settings problems found while reading (config.js, site-doctor.js, build.js report them)
//   layout    which settings file the vault is on, for naming a setting in a message (not enumerable)
//   site      the site folder's own settings (url, host, output, cloudflare_project, keep), for code that has only the publishConfig (not enumerable)
// `setting_year` is a setting, written beside `publish:`; it is checked below as a top-level name.
//   steps     the vault's build steps, { before, after } (not enumerable; only `build` and `deploy` run them)
//   menu_extra  the GM's extra menu entries with a repeat left out (not enumerable; build.js reads each link)
//   limits, header_facts, withheld_words  the numbers, header facts and withheld words (not enumerable; passed down to the code that uses each)
//   statuses  the three status lists as sets, { out_of_play, fallen, gone } (not enumerable; passed down to the code that uses each)
const DERIVED = ['switches', 'live', 'legacy', 'faults', 'layout', 'site', 'steps', 'menu_extra', 'limits', 'header_facts', 'withheld_words', 'statuses'];

// Only reads through the name `publishConfig` are checked (`publishConfig.x`, `publishConfig['x']`,
// and one level further for the groups). A read through another name (`p.x`, `cfg.publish.x`)
// cannot be told from other objects by a pattern without false alarms, so it is not checked.
// The object config.js builds, read from config.js itself: a vault with no settings file gives every key.
const built = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-one-place-'));
  try { return loadPublishConfig(dir, {}, () => {}); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('every setting the code reads is in the list', () => {
  const known = new Set(Object.keys(built()));
  const derived = new Set(DERIVED);
  const read = new Set();
  const first = /\bpublishConfig(?:\??\.([a-z][a-z_0-9]*)\b|\[\s*['"]([a-z][a-z_0-9]*)['"]\s*\])/g;
  for (const f of sources) for (const m of code(f).matchAll(first)) read.add(m[1] || m[2]);
  assert.ok(read.size >= 10, `the scan found only ${read.size} names; it has stopped working`);
  assert.deepEqual([...read].filter((n) => !known.has(n) && !derived.has(n)).sort(), []);
});

test('every setting the code reads inside a group is in the list', () => {
  // Each group of publishConfig, and the part of the list's names that its keys are the last part of.
  const prefixes = { theme: 'player_site.theme', landing: 'player_site.landing', images: 'player_site.images', locations: 'player_site.lists.locations' };
  const groups = [...Object.keys(prefixes), 'four_oh_four'];
  const known = new Set([
    ...Object.entries(prefixes).flatMap(([g, prefix]) => names().filter((n) => n.startsWith(`${prefix}.`)).map((n) => `${g}.${n.slice(prefix.length + 1).split('.')[0]}`)),
    ...Object.keys(built().four_oh_four).map((k) => `four_oh_four.${k}`),
  ]);
  const read = new Set();
  const second = new RegExp(`\\bpublishConfig\\??\\.(${groups.join('|')})(?:\\??\\.([a-z][a-z_0-9]*)\\b|\\[\\s*['"]([a-z][a-z_0-9]*)['"]\\s*\\])`, 'g');
  for (const f of sources) for (const m of code(f).matchAll(second)) read.add(`${m[1]}.${m[2] || m[3]}`);
  assert.ok(read.size >= 5, `the scan found only ${read.size} names; it has stopped working`);
  assert.deepEqual([...read].filter((n) => !known.has(n)).sort(), []);
});

test('every landing setting the code reads is in the list', () => {
  const known = new Set(names().filter((n) => n.startsWith('player_site.landing.')).map((n) => n.split('.')[2]));
  const read = new Set();
  for (const f of sources) for (const m of code(f).matchAll(/\blandingConfig\??\.([a-z][a-z_0-9]*)\b/g)) read.add(m[1]);
  assert.ok(read.size >= 4, `the scan found only ${read.size} names; it has stopped working`);
  assert.deepEqual([...read].filter((n) => !known.has(n)).sort(), []);
});

// Client-side strings and modules that cannot require the list state a few allowed values
// themselves; they must not drift from it.
test('the colour modes the page script knows are the list\'s', () => {
  assert.deepEqual(require('../lib/color-mode').MODES, entry('player_site.theme.default_mode').values);
});

test('the connection and link-preview modes the templates use come from the list', () => {
  const base = fs.readFileSync(path.join(ROOT, 'lib', 'templates', 'base.js'), 'utf8');
  const conn = fs.readFileSync(path.join(ROOT, 'lib', 'templates', 'connections.js'), 'utf8');
  assert.match(base, /entry\('player_site\.features\.link_previews'\)\.values/);
  assert.match(base, /entry\('player_site\.features\.connections'\)\.values/);
  assert.match(conn, /entry\('player_site\.features\.connections'\)\.values/);
  assert.match(fs.readFileSync(path.join(ROOT, 'lib', 'image-optimize.js'), 'utf8'), /entry\('player_site\.images\.format'\)\.values/);
});

// A message names a setting as the vault's own file writes it: the old name on the old file, the new
// one on the new. So no file outside the settings package holds a setting's old name as text; the
// pair lives in the list (`was`), and the helpers in layout.js read it.
test('no message states a setting under its old name', () => {
  const old = new Set(REGISTRY.filter((e) => !e.legacyOnly).flatMap((e) => (e.was || []).filter((w) => w.in === 'vault').map((w) => w.name)));
  const exempt = new Set(['bin/gm-publish.js']);
  const found = [];
  for (const f of sources) {
    if (exempt.has(rel(f))) continue;
    for (const m of code(f).matchAll(/['"`]([^'"`\n]*)['"`]/g)) {
      for (const word of m[1].match(/[A-Za-z_][A-Za-z_.0-9]*[A-Za-z_0-9]/g) || []) if (old.has(word)) found.push(`${rel(f)}: ${word}`);
    }
  }
  assert.deepEqual(found, []);
});
