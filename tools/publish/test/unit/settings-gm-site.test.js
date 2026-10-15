'use strict';
// The GM site's settings: its own entries, the twins of the player site's, and their faults.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSettings, REGISTRY, entry, stops } = require('../../lib/settings');
const { NOT_PER_SITE } = require('../../lib/settings/registry');
const { schema } = require('../../lib/settings/describe');
const { runSettings } = require('../../lib/settings/cli');
const { writeNewConfig } = require('../helpers/settings-files');

const read = (text) => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-read-'));
  writeNewConfig(v, text);
  return readSettings({ vaultPath: v });
};

test('the GM site has its own switch, folder and nine show switches', () => {
  assert.equal(entry('gm_site.publish').default, false);
  assert.equal(entry('gm_site.folder').type, 'text');
  const show = REGISTRY.filter((e) => e.name.startsWith('gm_site.show.')).map((e) => [e.name.slice(13), e.default]);
  assert.deepEqual(show, [['notes', true], ['sections', true], ['fields', true], ['relationships', true],
    ['gm_only_blocks', true], ['spoilers', true], ['callouts', true], ['withheld_names', true], ['comments', false]]);
});

test('every per-site player setting has a twin under gm_site, and only those', () => {
  const leaves = REGISTRY.filter((e) => e.name.startsWith('player_site.') && !e.twinOf);
  for (const e of leaves) {
    const twin = entry(e.name.replace(/^player_site\./, 'gm_site.'));
    // The GM site has its own switch and folder, which are not twins; the rest of the shared ones have nothing.
    if (e.name === 'player_site.publish' || e.name === 'player_site.folder') assert.equal(twin.twinOf, undefined, e.name);
    else if (NOT_PER_SITE.has(e.name) || e.legacyOnly) assert.equal(twin, undefined, e.name);
    else assert.equal(twin && twin.twinOf, e.name, e.name);
  }
  assert.equal(entry('gm_site.hide.sections').guards, undefined);
  assert.equal(entry('gm_site.hide.sections').default, undefined);
  assert.deepEqual(entry('gm_site.after_build').gmDefault, []);
  assert.deepEqual(entry('gm_site.before_build').gmDefault, []);
});

test('a twin keeps its group and description, and none carries the build-step source', () => {
  const twins = REGISTRY.filter((e) => e.twinOf);
  assert.ok(twins.length > 40);
  for (const t of twins) {
    assert.equal(t.group, 'gm-twin', t.name);
    assert.equal(t.stepsFrom, undefined, t.name);
  }
  assert.ok(entry('gm_site.title').does);
  assert.deepEqual(REGISTRY.filter((e) => e.stepsFrom).map((e) => e.name), ['player_site.before_build', 'player_site.after_build']);
});

test('an empty gm_site reads no fault, every show switch at its default', () => {
  const r = read('version: 1\ngm_site: {}\n');
  assert.deepEqual(r.faults, []);
  assert.equal(r.values.gm_site.publish, false);
  assert.equal(r.values.gm_site.show.comments, false);
  assert.equal(r.values.gm_site.show.spoilers, true);
});

test('a twin the file sets is read; one it does not set is not in values', () => {
  const r = read('gm_site:\n  title: Table copy\n  hide:\n    sections: [Secrets]\n');
  assert.equal(r.values.gm_site.title, 'Table copy');
  assert.deepEqual(r.values.gm_site.hide.sections, ['Secrets']);
  assert.equal(r.origins['gm_site.title'], 'file');
  assert.equal(r.origins['gm_site.footer'], 'inherit');
  assert.equal(r.values.gm_site.footer, undefined);
});

test('a setting shared by both sites, written under gm_site, is a warning naming it', () => {
  const r = read('gm_site:\n  url: https://x.example\n');
  const f = r.faults.find((x) => x.name === 'gm_site.url');
  assert.equal(f.level, 'warn');
  assert.match(f.message, /player_site\.url/);
  assert.match(f.message, /both sites/);
});

test('a twin of a hiding setting that cannot be read warns, never stops', () => {
  const r = read('gm_site:\n  hide:\n    sections: 3\n');
  assert.equal(stops(r.faults).length, 0);
  assert.ok(r.faults.some((x) => x.name === 'gm_site.hide.sections' && x.level === 'warn'));
  assert.equal(r.origins['gm_site.hide.sections'], 'fault');
});

test('a name under gm_site that is not a setting warns, even one that says it hides', () => {
  const r = read('gm_site:\n  hide:\n    secions: [x]\n  exclude_things: [y]\n');
  assert.equal(stops(r.faults).length, 0);
  assert.ok(r.faults.some((x) => x.name === 'gm_site.hide.secions' && x.level === 'warn'));
});

test('a gm_site that is not a map warns and never stops', () => {
  const r = read('gm_site: 3\n');
  assert.equal(stops(r.faults).length, 0);
  assert.ok(r.faults.some((x) => x.name === 'gm_site' && x.level === 'warn'));
});

test('a GM site on a vault kept by a player stops', () => {
  const r = read('vault:\n  kept_by: player\ngm_site:\n  publish: on\n');
  const f = r.faults.find((x) => x.kind === 'gm-kept-by-player');
  assert.equal(f.level, 'stop');
  assert.equal(f.setting, 'gm_site.publish');
  assert.match(f.message, /vault\.kept_by/);
});

test('the schema describes gm_site from the list, twins included', () => {
  const s = schema();
  assert.ok(s.properties.gm_site.properties.show.properties.spoilers);
  assert.ok(s.properties.gm_site.properties.hide.properties.sections);
  assert.equal(s.properties.gm_site.properties.url, undefined);
});

test('settings list and describe leave twins out of the list and say what a twin overrides', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-cli-'));
  writeNewConfig(vault, 'version: 1\n');
  const run = (verb, args, json) => {
    const out = [];
    const rc = runSettings({ verb, args, vault, json }, { out: (l) => out.push(l), err: () => {} });
    assert.equal(rc, 0);
    return out.join('\n');
  };
  const names = JSON.parse(run('list', [], true)).names.map((n) => n.name);
  assert.ok(names.includes('gm_site.publish'));
  assert.ok(names.includes('gm_site.show.spoilers'));
  assert.ok(!names.includes('gm_site.title'));
  assert.match(run('list', [], false), /can also be written under gm_site/);
  assert.match(run('describe', ['gm_site.title'], false), /For the GM site only; left out, the GM site uses player_site\.title\./);
  const all = Object.keys(JSON.parse(run('get', [], true)).values);
  assert.ok(!all.includes('gm_site.title'));
  assert.ok(all.includes('gm_site.show.comments'));
});
