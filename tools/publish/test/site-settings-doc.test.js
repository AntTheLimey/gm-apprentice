'use strict';
// docs/site-settings.md is the GM's list of every setting. It must name each setting the
// tool reads, and must not name one the tool does not read. Names only: the values and
// defaults the page gives are not checked here.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { MOVED_KEYS, DEPLOY_KEYS } = require('../lib/config-keys');
const { PUBLISH_DEFAULTS } = require('../lib/config');

const ROOT = path.join(__dirname, '..');
const DOC = fs.readFileSync(path.join(ROOT, '..', '..', 'docs', 'site-settings.md'), 'utf8');

// Names the code reads off the resolved config that are not settings a GM writes: values
// the build works out (`switches`, `live`, `sheet`, `legacy`), the old `backend` block
// (covered in the page's last section), a file extension in a comment (`js`), and
// `total_sessions`, which the landing page looks for and nothing sets.
const NOT_A_SETTING = new Set(['switches', 'live', 'sheet', 'legacy', 'backend', 'js', 'total_sessions']);
// Read off the resolved config like the rest, but written beside `publish:`, not under it.
const BESIDE_PUBLISH = ['setting_year'];

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

// Every top-level name under `publish:` that the tool reads: by property access on the
// config, from the table of settings that moved out of the site file, and from the keys
// `vault-setting` can write.
function settingsTheToolReads() {
  const names = new Set();
  for (const file of [...sources(path.join(ROOT, 'lib')), ...sources(path.join(ROOT, 'bin'))]) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\b(?:publishConfig|publish)\??\.([a-z][a-z_0-9]*)\b/g)) names.add(m[1]);
  }
  // The switches and the sheet look are read off a short name, `p`.
  for (const file of ['switches.js', path.join('skins', 'index.js')]) {
    const text = fs.readFileSync(path.join(ROOT, 'lib', file), 'utf8');
    for (const m of text.matchAll(/\bp\.([a-z][a-z_0-9]*)\b/g)) names.add(m[1]);
  }
  for (const e of MOVED_KEYS) names.add(e.publish);
  for (const key of Object.keys(PUBLISH_DEFAULTS)) names.add(key);
  const cli = fs.readFileSync(path.join(ROOT, 'lib', 'vault-setting-cli.js'), 'utf8');
  const settable = cli.match(/const SETTABLE = \{([\s\S]*?)\n\};/);
  assert.ok(settable, 'vault-setting-cli.js still has its SETTABLE table');
  for (const m of settable[1].matchAll(/^\s*'([a-z_]+)[.']/gm)) names.add(m[1]);
  for (const n of [...NOT_A_SETTING, ...BESIDE_PUBLISH]) names.delete(n);
  return names;
}

const documented = new Set([...DOC.matchAll(/`publish\.([a-z][a-z_0-9]*)/g)].map((m) => m[1]));

test('the settings page names every setting the tool reads', () => {
  const read = settingsTheToolReads();
  assert.ok(read.size >= 25, `the scan found only ${read.size} settings; it has stopped working`);
  const missing = [...read].filter((n) => !documented.has(n)).sort();
  assert.deepStrictEqual(missing, [], `docs/site-settings.md has no \`publish.${missing[0]}\`; add a row for each setting listed`);
});

test('the settings page names no setting the tool does not read', () => {
  const read = settingsTheToolReads();
  const stale = [...documented].filter((n) => !read.has(n)).sort();
  assert.deepStrictEqual(stale, [], `docs/site-settings.md lists \`publish.${stale[0]}\`, which the tool does not read`);
});

test('the settings page names the six settings kept in the site file, and setting_year', () => {
  for (const key of [...DEPLOY_KEYS, ...BESIDE_PUBLISH]) assert.ok(DOC.includes('`' + key + '`'), key);
});

// One level down: the names inside the maps. The tool's own defaults name most of them;
// the landing page and the locations list read a few more off their own map.
function nestedSettingsTheToolReads() {
  const names = new Set();
  for (const [map, value] of Object.entries(PUBLISH_DEFAULTS)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const sub of Object.keys(value)) names.add(`${map}.${sub}`);
  }
  for (const file of sources(path.join(ROOT, 'lib'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\blandingConfig\.([a-z][a-z_0-9]*)\b/g)) names.add(`landing.${m[1]}`);
    for (const m of text.matchAll(/\blocations\.(group_by|ungrouped_label)\b/g)) names.add(`locations.${m[1]}`);
  }
  names.delete('four_oh_four.style'); // a default nothing reads
  return names;
}

const documentedNested = new Set([...DOC.matchAll(/`publish\.([a-z][a-z_0-9]*\.[a-z][a-z_0-9]*)/g)].map((m) => m[1]));

test('the settings page names every setting inside a map', () => {
  const read = nestedSettingsTheToolReads();
  assert.ok(read.size >= 20, `the scan found only ${read.size} nested settings; it has stopped working`);
  const missing = [...read].filter((n) => !documentedNested.has(n)).sort();
  assert.deepStrictEqual(missing, [], `docs/site-settings.md has no \`publish.${missing[0]}\``);
});

test('the settings page names no landing, picture or locations setting the tool does not read', () => {
  const read = nestedSettingsTheToolReads();
  const stale = [...documentedNested].filter((n) => /^(landing|images|locations)\./.test(n) && !read.has(n)).sort();
  assert.deepStrictEqual(stale, [], `docs/site-settings.md lists \`publish.${stale[0]}\`, which the tool does not read`);
});
