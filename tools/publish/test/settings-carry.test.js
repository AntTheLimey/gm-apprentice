'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runSettings } = require('../lib/settings/cli.js');
const { readSettings } = require('../lib/settings/read');

function vaultWith(yaml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'carry-'));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.yaml'), yaml);
  return vault;
}
const text = (v) => fs.readFileSync(path.join(v, '_meta', 'vault-config.yaml'), 'utf8');
function run(vault, verb, args) {
  const out = [];
  const err = [];
  const rc = runSettings({ verb, args, vault, json: true }, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { rc, out: out.join('\n'), err: err.join('\n') };
}

test('unset takes a key the list does not know out of the new file as written; a setting or a group is refused', () => {
  const v = vaultWith('version: 1\nplayer_site:\n  publish: true\n  hide:\n    sectoins: [A]\n');
  assert.equal(run(v, 'unset', ['player_site.hide.sectoins']).rc, 0);
  assert.equal(text(v), 'version: 1\nplayer_site:\n  publish: true\n');
  assert.equal(run(v, 'unset', ['player_site.hide']).rc, 1);
  assert.equal(run(v, 'unset', ['version']).rc, 1);
});

test('carry puts a stray hiding list into the right list (added to the built-in ones) and removes the stray', () => {
  const v = vaultWith('version: 1\nplayer_site:\n  exclude_sections: [Rumours]\n');
  const r = run(v, 'carry', ['player_site.exclude_sections', 'player_site.hide.sections']);
  assert.equal(r.rc, 0, r.err);
  const now = readSettings({ vaultPath: v });
  assert.ok(now.values.player_site.hide.sections.includes('Rumours'));
  assert.ok(now.values.player_site.hide.sections.includes('GM Notes'), 'the built-in list is kept');
  assert.deepEqual(now.faults.filter((f) => f.level === 'stop'), []);
  assert.ok(!text(v).includes('exclude_sections'));
});

test('carry sets a plain value, and refuses (changing nothing) a value the setting does not take', () => {
  const v = vaultWith('version: 1\nplayer_site:\n  site_title: Hollow\n  searchh: maybe\n');
  assert.equal(run(v, 'carry', ['player_site.site_title', 'player_site.title']).rc, 0);
  assert.equal(readSettings({ vaultPath: v }).values.player_site.title, 'Hollow');
  const before = text(v);
  const bad = run(v, 'carry', ['player_site.searchh', 'player_site.features.search']);
  assert.equal(bad.rc, 1);
  assert.match(bad.err, /player_site\.features\.search takes/);
  assert.equal(text(v), before);
  assert.equal(run(v, 'carry', ['player_site.nothing_here', 'player_site.title']).rc, 1);
});

// #381: a hiding group written under the wrong group (`features:` under player_site) is one fault per setting inside
// it that has one right place, so the Settings check can carry each across.
test('a misplaced group inside a known group names the setting each leaf belongs to, and carry moves it', () => {
  const v = vaultWith('version: 1\nplayer_site:\n  features:\n    hide:\n      drafts: true\n');
  const faults = readSettings({ vaultPath: v }).faults;
  const leaf = faults.find((f) => f.name === 'player_site.features.hide.drafts');
  assert.ok(leaf, JSON.stringify(faults.map((f) => f.name)));
  assert.equal(leaf.setting, 'player_site.hide.drafts');
  assert.equal(leaf.level, 'stop');
  const r = run(v, 'carry', ['player_site.features.hide.drafts', 'player_site.hide.drafts']);
  assert.equal(r.rc, 0, r.err);
  const now = readSettings({ vaultPath: v });
  assert.equal(now.values.player_site.hide.drafts, true);
  assert.ok(!now.faults.some((f) => f.name.startsWith('player_site.features.hide.drafts')));
});
