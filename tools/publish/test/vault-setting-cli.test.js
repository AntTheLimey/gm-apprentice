'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runVaultSetting } = require('../lib/vault-setting-cli.js');

function scratch(publish) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-'));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), `---\ntype: meta\npublish:\n${publish}---\n`);
  fs.writeFileSync(path.join(root, 'vault.config.json'), JSON.stringify({ vaultPath: './vault' }));
  return { root, vault, configPath: path.join(root, 'vault.config.json') };
}
const run = (s, set) => {
  const out = [];
  const err = [];
  const rc = runVaultSetting({ configPath: s.configPath, vault: s.vault, set, json: true }, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { rc, data: out.length ? JSON.parse(out.join('\n')) : null, text: out.join('\n'), err };
};
const config = (s) => fs.readFileSync(path.join(s.vault, '_meta', 'vault-config.md'), 'utf8');

test('reports a Google font and an unset default mode', () => {
  const s = scratch('  mode: player\n  theme:\n    fonts:\n      heading: Cinzel\n      body: system-ui\n');
  const { rc, data } = run(s, []);
  assert.equal(rc, 0);
  assert.deepEqual(data, { defaultModeSet: false, fontSource: null, googleFonts: ['Cinzel'] });
});

test('self-hosted or local fonts report no Google fonts', () => {
  const s = scratch('  theme:\n    fonts:\n      heading: Cinzel\n      source: self-host\n');
  assert.deepEqual(run(s, []).data.googleFonts, []);
});

test('a genre preset that imports a font reports it', () => {
  const s = scratch('  theme:\n    genre: scifi\n');
  assert.deepEqual(run(s, []).data.googleFonts, ['Rajdhani']);
});

test('sets default_mode and keeps the rest of the theme', () => {
  const s = scratch('  mode: player\n  theme:\n    genre: horror\n');
  const { rc, data } = run(s, ['theme.default_mode="dark"']);
  assert.equal(rc, 0);
  assert.deepEqual(data, { written: ['theme.default_mode'] });
  assert.match(config(s), /genre: horror/);
  assert.match(config(s), /default_mode: dark/);
  assert.equal(run(s, []).data.defaultModeSet, true);
});

test('sets fonts.source where there is no theme block yet', () => {
  const s = scratch('  mode: player\n');
  assert.equal(run(s, ['theme.fonts.source="self-host"']).rc, 0);
  assert.match(config(s), /theme:\n\s+fonts:\n\s+source: self-host/);
});

test('refuses a key or a value it does not know, and writes nothing', () => {
  const s = scratch('  mode: player\n');
  const before = config(s);
  for (const set of ['mode="gm"', 'theme.default_mode="purple"', 'theme.fonts.source="google"', 'theme.default_mode=dark']) {
    const { rc, err } = run(s, [set]);
    assert.equal(rc, 1, set);
    assert.equal(err.length, 1, set);
    assert.equal(config(s), before, set);
  }
});

test('a vault file the editor refuses exits 1 with one line and is left as it was', () => {
  const s = scratch('  mode: player\n');
  fs.writeFileSync(path.join(s.vault, '_meta', 'vault-config.md'), '---\ntype: meta\npublish: [a, b]\n---\n');
  const before = config(s);
  const { rc, err } = run(s, ['theme.default_mode="dark"']);
  assert.equal(rc, 1);
  assert.equal(err.length, 1);
  assert.equal(config(s), before);
});
