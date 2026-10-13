'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const YAML = require('yaml');
const { TYPES } = require('../../lib/settings/types');
const { entry } = require('../../lib/settings/registry');
const { schema } = require('../../lib/settings/describe');
const { runSettings } = require('../../lib/settings/cli');
const { readSettings } = require('../../lib/settings');
const { writeNewConfig, writeOldConfig } = require('../helpers/settings-files');

const E = entry('player_site.menu_extra');
const NAME = 'player_site.menu_extra';

test('menu_extra is a list of maps with the fields the brief names', () => {
  assert.equal(E.type, 'listOfMaps');
  assert.deepEqual(E.fields, { label: { required: true }, link: { required: true }, group: {} });
  assert.deepEqual(E.default, []);
  assert.equal(E.same, 'label');
});

test('a list of maps reads items with known keys, plain values and every required key present', () => {
  const read = (raw) => TYPES.listOfMaps.read(raw, E);
  assert.deepEqual(read([]), { ok: true, value: [] });
  assert.deepEqual(read([{ label: 'A', link: 'a.html' }, { label: 'B', link: 'b', group: 'World' }]),
    { ok: true, value: [{ label: 'A', link: 'a.html' }, { label: 'B', link: 'b', group: 'World' }] });
  assert.deepEqual(read([{ label: 7, link: 'x' }]), { ok: true, value: [{ label: '7', link: 'x' }] });
  assert.deepEqual(read([{ label: 'A', link: 'a', group: '  ' }]), { ok: true, value: [{ label: 'A', link: 'a' }] });
  for (const bad of ['a', null, {}, ['a'], [null], [{ label: 'A' }], [{ link: 'a' }], [{ label: ' ', link: 'a' }],
    [{ label: 'A', link: 'a', colour: 'red' }], [{ label: 'A', link: ['a'] }], [{ label: 'A', link: { x: 1 } }], [{ label: true, link: 'a' }]]) {
    assert.deepEqual(read(bad), { ok: false }, JSON.stringify(bad));
  }
});

test('it says what it takes', () => {
  assert.equal(TYPES.listOfMaps.takes(E), 'a list of entries, each with `label`, `link`, and optionally `group`');
});

test('the schema is an array of closed objects with the required keys', () => {
  const s = schema().properties.player_site.properties.menu_extra;
  const items = (s.anyOf ? s.anyOf.find((x) => x.type === 'array') : s).items;
  assert.equal(items.type, 'object');
  assert.equal(items.additionalProperties, false);
  assert.deepEqual(Object.keys(items.properties).sort(), ['group', 'label', 'link']);
  assert.deepEqual(items.required.sort(), ['label', 'link']);
});

// ---- The command ----

function scratch(layout = 'new', body = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-extra-'));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  if (layout === 'new') writeNewConfig(vault, { version: 1, ...body });
  else writeOldConfig(vault, {});
  return { root, vault, file: path.join(vault, '_meta', layout === 'new' ? 'vault-config.yaml' : 'vault-config.md') };
}
function run(s, verb, args) {
  const out = [];
  const err = [];
  const rc = runSettings({ verb, args, vault: s.vault, json: true }, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { rc, out: out.join('\n'), err: err.join('\n') };
}
const menu = (s) => (readSettings({ vaultPath: s.vault }).values.player_site.menu_extra);
const text = (s) => fs.readFileSync(s.file, 'utf8').replace(/\r\n/g, '\n');

test('add makes one entry from the key=value words, and a second add keeps the first', () => {
  const s = scratch();
  assert.equal(run(s, 'add', [NAME, 'label=Gazetteer', 'link=gazetteer/index.html', 'group=World']).rc, 0);
  assert.deepEqual(menu(s), [{ label: 'Gazetteer', link: 'gazetteer/index.html', group: 'World' }]);
  assert.equal(run(s, 'add', [NAME, 'label=Map', 'link=https://example.com/map']).rc, 0);
  assert.deepEqual(menu(s), [{ label: 'Gazetteer', link: 'gazetteer/index.html', group: 'World' }, { label: 'Map', link: 'https://example.com/map' }]);
});

test('add of an entry with the same label says it is already there', () => {
  const s = scratch();
  run(s, 'add', [NAME, 'label=Map', 'link=a']);
  const r = run(s, 'add', [NAME, 'label=Map', 'link=b']);
  assert.equal(r.rc, 0);
  assert.deepEqual(menu(s), [{ label: 'Map', link: 'a' }]);
  assert.match(r.out, /already/);
});

test('add refuses an entry with no link, an unknown key, or a word that is not key=value', () => {
  const s = scratch();
  for (const args of [['label=Map'], ['label=Map', 'link=a', 'colour=red'], ['label=Map', 'link=a', 'oops']]) {
    const r = run(s, 'add', [NAME, ...args]);
    assert.notEqual(r.rc, 0, args.join(' '));
  }
  assert.deepEqual(menu(s), []);
});

test('remove takes an entry out by its label, and leaves comments on the others', () => {
  const s = scratch('new', {});
  fs.writeFileSync(s.file, 'version: 1\nplayer_site:\n  menu_extra:\n    # the map\n    - label: Map\n      link: a\n    # the gazetteer\n    - label: Gazetteer\n      link: b\n');
  assert.equal(run(s, 'remove', [NAME, 'Map']).rc, 0);
  assert.deepEqual(menu(s), [{ label: 'Gazetteer', link: 'b' }]);
  assert.match(text(s), /# the gazetteer/);
  assert.doesNotMatch(text(s), /label: Map/);
});

test('add leaves the comments on the entries already there', () => {
  const s = scratch('new', {});
  fs.writeFileSync(s.file, 'version: 1\nplayer_site:\n  menu_extra:\n    # the map\n    - label: Map\n      link: a\n');
  assert.equal(run(s, 'add', [NAME, 'label=Gazetteer', 'link=b']).rc, 0);
  assert.match(text(s), /# the map/);
  assert.deepEqual(menu(s), [{ label: 'Map', link: 'a' }, { label: 'Gazetteer', link: 'b' }]);
  assert.deepEqual(YAML.parse(text(s)).player_site.menu_extra, [{ label: 'Map', link: 'a' }, { label: 'Gazetteer', link: 'b' }]);
});

test('set takes the whole list as JSON, and refuses an unreadable one', () => {
  const s = scratch();
  const good = JSON.stringify([{ label: 'A', link: 'a', group: 'Story' }]);
  assert.equal(run(s, 'set', [`${NAME}=${good}`]).rc, 0);
  assert.deepEqual(menu(s), [{ label: 'A', link: 'a', group: 'Story' }]);
  const bad = run(s, 'set', [`${NAME}=${JSON.stringify([{ label: 'A' }])}`]);
  assert.notEqual(bad.rc, 0);
  assert.deepEqual(menu(s), [{ label: 'A', link: 'a', group: 'Story' }]);
});

test('on the old settings file set and add are refused with the update line', () => {
  const s = scratch('legacy');
  const before = text(s);
  const a = run(s, 'add', [NAME, 'label=Map', 'link=a']);
  const b = run(s, 'set', [`${NAME}=[]`]);
  for (const r of [a, b]) {
    assert.notEqual(r.rc, 0);
    assert.match(r.out + r.err, /update/i);
  }
  assert.equal(text(s), before);
});

test('an entry the reader cannot use is a warning and the list is left empty', () => {
  const s = scratch('new', { player_site: { menu_extra: [{ label: '', link: 'a' }] } });
  const read = readSettings({ vaultPath: s.vault });
  assert.deepEqual(read.values.player_site.menu_extra, []);
  assert.ok(read.faults.some((f) => f.setting === NAME && f.level === 'warn'));
});
