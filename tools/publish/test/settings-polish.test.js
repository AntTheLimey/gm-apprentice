'use strict';
// Message and report polish left over from the settings work (#373, #375, #380, #386): one case each.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runSettings } = require('../lib/settings/cli.js');

function scratch(yaml, site) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-'));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  if (yaml !== null) fs.writeFileSync(path.join(vault, '_meta', 'vault-config.yaml'), yaml);
  fs.writeFileSync(path.join(root, 'vault.config.json'), JSON.stringify(site || { vaultPath: './vault' }));
  return { root, vault, config: path.join(root, 'vault.config.json'), yaml: path.join(vault, '_meta', 'vault-config.yaml') };
}

function run(s, verb, args = [], extra = {}) {
  const out = [];
  const err = [];
  const rc = runSettings({ verb, args, vault: s.vault, config: s.config, ...extra }, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { rc, out: out.join('\n'), err };
}

test('add of an empty list says there is nothing to add, and exits 1 (#373)', () => {
  const s = scratch('version: 1\nplayer_site:\n  hide:\n    sections: [Rumours]\n');
  const before = fs.readFileSync(s.yaml, 'utf8');
  const { rc, out, err } = run(s, 'add', ['player_site.hide.sections', '[]']);
  assert.equal(rc, 1);
  assert.equal(out, '', 'no blank line');
  assert.match(err[0], /player_site\.hide\.sections.*no entries/);
  assert.equal(fs.readFileSync(s.yaml, 'utf8'), before);
});

test('removing two spellings of one built-in entry says "no longer hidden" once (#373)', () => {
  const s = scratch('version: 1\nplayer_site:\n  hide:\n    sections: [GM Notes, gm notes, Rumours]\n');
  const { rc, out } = run(s, 'remove', ['player_site.hide.sections', 'GM Notes']);
  assert.equal(rc, 0, out);
  assert.equal(out.split('\n').filter((l) => l.includes('no longer hidden')).length, 1, out);
});

test('a stop and a warning together: the stop message carries the warning too (#373)', () => {
  const s = scratch('version: 1\nplayer_site:\n  title: [a, b]\n  hide:\n    sections: {a: 1}\n');
  const { loadPublishConfig, assertNoStops } = require('../lib/config');
  const cfg = loadPublishConfig(s.vault, { vaultPath: s.vault }, () => {}, { siteDir: s.root });
  let message = '';
  try { assertNoStops(cfg, 'build'); } catch (e) { message = e.message; }
  assert.match(message, /hide\.sections/);
  assert.match(message, /player_site\.title/, message);
});

test('get prints a setting nobody set as "not set", not null (#373)', () => {
  const s = scratch('version: 1\nvault:\n  campaign: X\n');
  const { rc, out } = run(s, 'get', ['vault.setting_year']);
  assert.equal(rc, 0);
  assert.equal(out, 'vault.setting_year: not set (default)');
});
