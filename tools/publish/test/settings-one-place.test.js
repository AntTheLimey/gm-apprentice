'use strict';
// A setting is stated in one place: lib/settings/. Nothing outside it restates a default,
// the words a switch takes, or which files read the vault's settings file; and every name
// the code reads off the settings is in the list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { names, entry } = require('../lib/settings');
const { REGISTRY } = require('../lib/settings/registry');

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
  for (const name of ['publish.exclude_sections', 'publish.exclude_fields']) {
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
//   vault-config-edit.js  the editor that writes the `publish:` block in place, keeping the file's layout
//   init.js               setting up a site seeds the file with site, site_dir and the standard map
//   migrate-config.js     moves the settings an older site kept in vault.config.json into the file
//   setup-backend.js      turns the live-stats or inbox switch on in the file after the host is set up
//   rename-refs.js        renames a note inside the settings that name it (featured_npcs and so on), through the editor
//   site-doctor.js        names the file as the place of a finding; it reads nothing from it
// The first five write or move the file; the settings package reads it for the build.
test('nothing reads the vault settings file but the settings package', () => {
  const allowed = new Set([
    'lib/vault-config-edit.js', 'lib/init.js', 'lib/migrate-config.js', 'lib/setup-backend.js', 'lib/rename-refs.js', 'lib/site-doctor.js',
  ]);
  // Any string that ends in the file's name: a path joined, a template, either quote style.
  const named = /vault-config\.md['"`]/;
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
// `setting_year` is a setting, written beside `publish:`; it is checked below as a top-level name.
const DERIVED = ['switches', 'live', 'legacy', 'faults'];

// Only reads through the name `publishConfig` are checked (`publishConfig.x`, `publishConfig['x']`,
// and one level further for the groups). A read through another name (`p.x`, `cfg.publish.x`)
// cannot be told from other objects by a pattern without false alarms, so it is not checked.
test('every setting the code reads is in the list', () => {
  const known = new Set(names().map((n) => (n.startsWith('publish.') ? n.split('.')[1] : n)));
  const derived = new Set(DERIVED);
  const read = new Set();
  const first = /\bpublishConfig(?:\??\.([a-z][a-z_0-9]*)\b|\[\s*['"]([a-z][a-z_0-9]*)['"]\s*\])/g;
  for (const f of sources) for (const m of code(f).matchAll(first)) read.add(m[1] || m[2]);
  assert.ok(read.size >= 10, `the scan found only ${read.size} names; it has stopped working`);
  assert.deepEqual([...read].filter((n) => !known.has(n) && !derived.has(n)).sort(), []);
});

test('every setting the code reads inside a group is in the list', () => {
  const groups = ['theme', 'landing', 'images', 'locations', 'four_oh_four'];
  const known = new Set(names().filter((n) => groups.some((g) => n.startsWith(`publish.${g}.`))).map((n) => n.split('.').slice(1, 3).join('.')));
  const read = new Set();
  const second = new RegExp(`\\bpublishConfig\\??\\.(${groups.join('|')})(?:\\??\\.([a-z][a-z_0-9]*)\\b|\\[\\s*['"]([a-z][a-z_0-9]*)['"]\\s*\\])`, 'g');
  for (const f of sources) for (const m of code(f).matchAll(second)) read.add(`${m[1]}.${m[2] || m[3]}`);
  assert.ok(read.size >= 5, `the scan found only ${read.size} names; it has stopped working`);
  assert.deepEqual([...read].filter((n) => !known.has(n)).sort(), []);
});

test('every landing setting the code reads is in the list', () => {
  const known = new Set(names().filter((n) => n.startsWith('publish.landing.')).map((n) => n.split('.')[2]));
  const read = new Set();
  for (const f of sources) for (const m of code(f).matchAll(/\blandingConfig\??\.([a-z][a-z_0-9]*)\b/g)) read.add(m[1]);
  assert.ok(read.size >= 4, `the scan found only ${read.size} names; it has stopped working`);
  assert.deepEqual([...read].filter((n) => !known.has(n)).sort(), []);
});

// Client-side strings and modules that cannot require the list state a few allowed values
// themselves; they must not drift from it.
test('the colour modes the page script knows are the list\'s', () => {
  assert.deepEqual(require('../lib/color-mode').MODES, entry('publish.theme.default_mode').values);
});

test('the connection and link-preview modes the templates use come from the list', () => {
  const base = fs.readFileSync(path.join(ROOT, 'lib', 'templates', 'base.js'), 'utf8');
  const conn = fs.readFileSync(path.join(ROOT, 'lib', 'templates', 'connections.js'), 'utf8');
  assert.match(base, /entry\('publish\.link_previews'\)\.values/);
  assert.match(base, /entry\('publish\.connections'\)\.values/);
  assert.match(conn, /entry\('publish\.connections'\)\.values/);
  assert.match(fs.readFileSync(path.join(ROOT, 'lib', 'image-optimize.js'), 'utf8'), /entry\('publish\.images\.format'\)\.values/);
});
