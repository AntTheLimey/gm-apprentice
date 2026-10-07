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

test('sets the campaign sheet skin under publish and keeps the rest', () => {
  const s = scratch('  mode: player   # who reads\n  theme:\n    genre: horror\n');
  const before = config(s);
  const { rc, data } = run(s, ['sheet_skin="ledger"']);
  assert.equal(rc, 0);
  assert.deepEqual(data, { written: ['sheet_skin'] });
  assert.match(config(s), /^ {2}sheet_skin: ledger$/m);
  assert.equal(config(s).replace(/^ {2}sheet_skin: ledger\n/m, ''), before);
});

test('sheet_frame takes none, and a skin and a frame land in one call', () => {
  const s = scratch('  mode: player\n');
  assert.equal(run(s, ['sheet_frame="none"']).rc, 0);
  assert.match(config(s), /^ {2}sheet_frame: none$/m);
  assert.deepEqual(run(s, ['sheet_skin="case-file"', 'sheet_frame="thorns"']).data, { written: ['sheet_skin', 'sheet_frame'] });
  assert.match(config(s), /^ {2}sheet_skin: case-file$/m);
  assert.match(config(s), /^ {2}sheet_frame: thorns$/m);
  assert.ok(!/sheet_frame: none/.test(config(s)));
});

// Driven from the registry, so a skin or frame added there is settable with no edit here,
// and read back through the build's own reader, so what is written is what the build takes.
test('every skin and every frame in the registry, and none, is accepted and reads back', () => {
  const { SKINS, FRAME_IDS, siteLook } = require('../lib/skins');
  const { parseNote } = require('../lib/frontmatter');
  const look = (s) => siteLook(parseNote(config(s)).data.publish);
  const skins = Object.keys(SKINS);
  const frames = [...FRAME_IDS, 'none'];
  assert.ok(skins.length > 1 && frames.length > 1);
  const s = scratch('  mode: player\n');
  for (const id of skins) {
    assert.equal(run(s, [`sheet_skin=${JSON.stringify(id)}`]).rc, 0, id);
    assert.deepEqual(look(s), { skin: id, frame: null, notes: [] }, id);
  }
  for (const id of frames) {
    assert.equal(run(s, [`sheet_frame=${JSON.stringify(id)}`]).rc, 0, id);
    assert.deepEqual(look(s), { skin: skins[skins.length - 1], frame: id, notes: [] }, id);
  }
});

test('refuses a skin or a frame that is not an exact id, and writes nothing', () => {
  const s = scratch('  mode: player\n');
  const before = config(s);
  const refused = [
    ['sheet_skin', '"vellum"'], ['sheet_frame', '"plain"'], ['sheet_skin', '"none"'], ['sheet_skin', '"laurel"'],
    ['sheet_skin', '"Ledger"'], ['sheet_skin', '" ledger"'], ['sheet_frame', '"Ring"'], ['sheet_frame', '""'],
    ['sheet_skin', '"constructor"'], ['sheet_skin', 'null'], ['sheet_frame', '["ring"]'], ['sheet_frame', '0'],
  ];
  for (const [key, json] of refused) {
    const { rc, err } = run(s, [`${key}=${json}`]);
    assert.equal(rc, 1, `${key}=${json}`);
    assert.deepEqual(err, [`Error: ${json} is not a value ${key} takes`], `${key}=${json}`);
    assert.equal(config(s), before, `${key}=${json}`);
  }
  // One bad value refuses the whole call: the good one is not written either.
  assert.equal(run(s, ['sheet_skin="ledger"', 'sheet_frame="vellum"']).rc, 1);
  assert.equal(config(s), before);
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

const THEME = '  mode: player   # who reads\n  theme:\n    # palette tried 2026-09: too red\n    preset: gothic   # the one I like\n    accent: #c0a060\n    fonts:\n      heading: Cinzel   # display\n      body: system-ui\n  footer: F\n';

test('writing default_mode changes only its own line: comments and an unquoted hex survive', () => {
  const s = scratch(THEME);
  const before = config(s);
  assert.equal(run(s, ['theme.default_mode="dark"']).rc, 0);
  assert.equal(config(s), before.replace('      body: system-ui\n', '      body: system-ui\n    default_mode: dark\n'));
});

test('replacing default_mode rewrites that one line and nothing else', () => {
  const s = scratch(THEME.replace('    accent', '    default_mode: light\n    accent'));
  const before = config(s);
  assert.equal(run(s, ['theme.default_mode="dark"']).rc, 0);
  assert.equal(config(s), before.replace('default_mode: light', 'default_mode: dark'));
});

test('writing fonts.source goes inside the existing fonts block, comments kept', () => {
  const s = scratch(THEME);
  const before = config(s);
  assert.equal(run(s, ['theme.fonts.source="self-host"']).rc, 0);
  assert.equal(config(s), before.replace('      body: system-ui\n', '      body: system-ui\n      source: self-host\n'));
});

test('writing fonts.source creates fonts: only when the theme has none', () => {
  const s = scratch('  theme:\n    # keep me\n    preset: gothic\n  footer: F\n');
  const before = config(s);
  assert.equal(run(s, ['theme.fonts.source="self-host"']).rc, 0);
  assert.equal(config(s), before.replace('    preset: gothic\n', '    preset: gothic\n    fonts:\n      source: self-host\n'));
});

test('two settings in one call both land, and a theme written on one line still works', () => {
  const s = scratch('  theme: {preset: gothic}\n');
  assert.equal(run(s, ['theme.default_mode="dark"', 'theme.fonts.source="self-host"']).rc, 0);
  assert.deepEqual(run(s, []).data.defaultModeSet, true);
  assert.match(config(s), /source: self-host/);
});

test('a fonts block it creates uses the publish block\'s indent step', () => {
  const s = scratch('    mode: player\n    theme:\n        preset: gothic\n');
  assert.equal(run(s, ['theme.fonts.source="self-host"']).rc, 0);
  assert.match(config(s), /\n {8}fonts:\n {12}source: self-host\n/);
  assert.deepEqual(run(s, []).data.googleFonts, []);
});

test('a multi-line string is written on one line and parses back equal', () => {
  const { editPublishBlock } = require('../lib/vault-config-edit.js');
  const { parseNote } = require('../lib/frontmatter');
  const footer = 'Line one\n"quoted" and C:\\path\n\nlast line';
  const out = editPublishBlock('---\ntype: meta\npublish:\n  mode: player\n---\n', { set: { footer, nested: { note: 'a\nb' } } });
  assert.ok(!out.error, out.error);
  assert.ok(!/[|>]-?\n/.test(out.text), out.text);
  assert.ok(out.text.split('\n').every((l) => !/^\s+(Line one|last line|b)/.test(l)), out.text);
  const pub = parseNote(out.text).data.publish;
  assert.equal(pub.footer, footer);
  assert.equal(pub.nested.note, 'a\nb');
});
