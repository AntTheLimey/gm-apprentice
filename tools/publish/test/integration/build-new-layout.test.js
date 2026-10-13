'use strict';
// A vault on the new settings file builds the same site as the same vault on the old one.
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../../lib/build');
const { writeNewConfig, writeOldConfig } = require('../helpers/settings-files');

const FIXTURE = path.join(__dirname, '../fixtures/with-landing-config');

function filesUnder(dir, rel = '') {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((d) => {
    const here = path.join(rel, d.name);
    return d.isDirectory() ? filesUnder(dir, here) : [here];
  }).sort();
}

describe('build with the new settings file', () => {
  let root;
  after(() => root && fs.rmSync(root, { recursive: true, force: true }));

  // One vault copy, one site folder, one build; `write` puts the settings file in.
  function buildWith(name, write) {
    const vault = path.join(root, name, 'vault');
    fs.cpSync(FIXTURE, vault, { recursive: true });
    fs.rmSync(path.join(vault, '_meta'), { recursive: true, force: true });
    write(vault);
    const out = path.join(root, name, 'docs');
    const configPath = path.join(root, name, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: out, siteUrl: 'https://example.github.io/landing' }));
    const original = { warn: console.warn, log: console.log };
    const lines = [];
    console.warn = (...a) => lines.push(a.join(' '));
    console.log = (...a) => lines.push(a.join(' '));
    try { build({ configPath }); } finally { Object.assign(console, original); }
    return { out, lines };
  }

  it('writes file for file what the old settings file wrote', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-new-layout-'));
    const landing = { max_npcs: 3, max_locations: 2, featured_npcs: ['Zenobia_Marr', 'Ghost_Npc'], quick_links: ['Calcutta_City_Map', 'Nonexistent_Page'] };
    const folderMap = { 'Characters/NPCs': 'characters/npcs', Locations: 'locations', Sessions: 'sessions' };
    const old = buildWith('old', (vault) => writeOldConfig(vault, {
      mode: 'player', site_title: 'Landing Test', attachments_dir: '_attachments', exclude_dirs: ['_meta'], exclude_sections: [],
      folder_map: folderMap, landing,
    }));
    const next = buildWith('new', (vault) => writeNewConfig(vault, {
      version: 1,
      vault: { attachments: '_attachments' },
      player_site: { title: 'Landing Test', folder_map: folderMap, hide: { mode: 'player', folders: ['_meta'], sections: [] }, landing },
    }));
    const a = filesUnder(old.out);
    assert.ok(a.length > 5, 'the old build wrote a site');
    assert.deepStrictEqual(filesUnder(next.out), a);
    for (const rel of a) {
      assert.ok(fs.readFileSync(path.join(old.out, rel)).equals(fs.readFileSync(path.join(next.out, rel))), rel);
    }
  });
});
