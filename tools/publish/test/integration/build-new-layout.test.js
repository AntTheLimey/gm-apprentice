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

  it('publishes nothing from a hidden folder written with a slash, a dot-slash or a backslash', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-new-folders-'));
    const note = (word) => `---\ntype: npc\n---\n\n${word}\n`;
    const folderMap = { People: 'people', Secrets: 'secrets', Private: 'private', 'GM/Stuff': 'gmstuff' };
    const put = (vault) => {
      fs.mkdirSync(path.join(vault, 'GM'), { recursive: true });
      for (const [rel, word] of [['People/Ok.md', 'okword'], ['Secrets/A.md', 'secretword'], ['Private/B.md', 'privateword'], ['GM/Stuff/C.md', 'stuffword']]) {
        fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
        fs.writeFileSync(path.join(vault, rel), note(word));
      }
    };
    const entries = ['Secrets/', './Private', 'GM\\Stuff', '_meta'];
    const everything = (out) => filesUnder(out).map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n');
    const old = buildWith('folders-old', (vault) => { put(vault); writeOldConfig(vault, { mode: 'player', exclude_dirs: entries, folder_map: folderMap }); });
    const next = buildWith('folders-new', (vault) => { put(vault); writeNewConfig(vault, { version: 1, player_site: { folder_map: folderMap, hide: { mode: 'player', folders: entries } } }); });
    for (const built of [old, next]) {
      const all = everything(built.out);
      assert.ok(all.includes('okword'), 'the folder that is not hidden is published');
      for (const word of ['secretword', 'privateword', 'stuffword']) assert.ok(!all.includes(word), `${word} is published`);
    }
    assert.deepStrictEqual(filesUnder(next.out), filesUnder(old.out));
  });
});
