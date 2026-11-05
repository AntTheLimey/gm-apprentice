'use strict';
// YAML reads a bare `007` as the number 7, `1e3` as 1000 and `true` as a switch. An entry of a hiding list written that
// way would be matched as other text than the GM wrote, and what it hides would publish: it stops, naming the entry
// and saying to quote it. A number whose text reads back as written (`1999`) is fine.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSettings } = require('../lib/settings');
const { build } = require('../lib/build');

let roots = [];
afterEach(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); roots = []; });

function vaultWith(yamlText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-hiding-'));
  roots.push(root);
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.yaml'), yamlText);
  return { root, vault };
}
const stopsFor = (vault, name) => readSettings({ vaultPath: vault }).faults.filter((f) => f.level === 'stop' && f.setting === name);

describe('a hiding-list entry YAML would read as other than its text stops', () => {
  for (const list of ['folders', 'sections']) {
    const name = `player_site.hide.${list}`;
    for (const [written, readAs] of [['007', 'the number 7'], ['1e3', 'the number 1000'], ['0x1F', 'the number 31'], ['1.50', 'the number 1.5'], ['true', 'true, not text']]) {
      it(`${list}: ${written}`, () => {
        const { vault } = vaultWith(`player_site:\n  hide:\n    ${list}:\n      - ${written}\n`);
        const [f] = stopsFor(vault, name);
        assert.ok(f, `a stop for ${written}`);
        assert.ok(f.message.includes(`${name} entry ${written} is read as ${readAs}`), f.message);
        assert.ok(f.message.includes(`write it in quotes: '${written}'`), f.message);
      });
    }
    it(`${list}: null`, () => {
      const { vault } = vaultWith(`player_site:\n  hide:\n    ${list}:\n      - null\n`);
      assert.ok(stopsFor(vault, name).length, 'a stop for null');
    });
    it(`${list}: '007' quoted and 1999 bare read cleanly`, () => {
      const { vault } = vaultWith(`player_site:\n  hide:\n    ${list}:\n      - '007'\n      - 1999\n`);
      const read = readSettings({ vaultPath: vault });
      assert.deepStrictEqual(read.faults.filter((f) => f.setting === name), []);
      assert.ok(read.values.player_site.hide[list].includes('007'));
    });
  }

  it('a quoted 007 folder is hidden from the built site', () => {
    const { root, vault } = vaultWith("player_site:\n  title: T\n  hide:\n    folders:\n      - '007'\n  folder_map:\n    '007': Locations\n    NPCs: NPCs\n");
    for (const dir of ['007', 'NPCs']) {
      fs.mkdirSync(path.join(vault, dir));
      fs.writeFileSync(path.join(vault, dir, 'plot.md'), '---\ntype: npc\n---\n\nThe plot.\n');
    }
    const siteDir = path.join(root, 'site');
    fs.mkdirSync(siteDir);
    const configPath = path.join(siteDir, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ vaultPath: '../vault' }));
    const saved = { warn: console.warn, log: console.log };
    console.warn = () => {}; console.log = () => {};
    try { build({ configPath }); } finally { Object.assign(console, saved); }
    assert.ok(fs.existsSync(path.join(siteDir, 'docs', 'NPCs', 'plot.html')), 'the control page is built');
    assert.ok(!fs.existsSync(path.join(siteDir, 'docs', 'Locations', 'plot.html')), 'the hidden folder is not');
  });

  it('a bare 007 in hide.folders stops the build', () => {
    const { root, vault } = vaultWith('player_site:\n  title: T\n  hide:\n    folders:\n      - 007\n');
    const siteDir = path.join(root, 'site');
    fs.mkdirSync(siteDir);
    const configPath = path.join(siteDir, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ vaultPath: '../vault' }));
    const saved = { warn: console.warn, log: console.log };
    console.warn = () => {}; console.log = () => {};
    try { assert.throws(() => build({ configPath }), /entry 007 is read as the number 7/); } finally { Object.assign(console, saved); }
  });
});

describe('a folder_map entry that names no folder stops', () => {
  for (const [label, value] of [['null', 'null'], ['a number', '5'], ['a list', '[a]']]) {
    it(label, () => {
      const { vault } = vaultWith(`player_site:\n  folder_map:\n    Plots: ${value}\n`);
      const [f] = stopsFor(vault, 'player_site.folder_map');
      assert.ok(f, `a stop for ${label}`);
      assert.match(f.message, /"Plots"/);
    });
  }
  it('a folder name reads cleanly', () => {
    const { vault } = vaultWith('player_site:\n  folder_map:\n    Plots: Stories\n');
    assert.deepStrictEqual(stopsFor(vault, 'player_site.folder_map'), []);
  });
});
