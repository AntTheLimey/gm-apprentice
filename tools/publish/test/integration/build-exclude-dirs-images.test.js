const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');

function write(base, rel, body) {
  const full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

// #209: publish.exclude_dirs (vault-config.md) was computed into publishConfig.exclude_dirs
// but nothing ever read that field — the scanner only saw vault.config.json's legacy
// excludeDirs, so a GM who wrote publish.exclude_dirs in the documented per-vault config
// file got silently ignored.
describe('publish.exclude_dirs from vault-config.md reaches the scanner (#209)', () => {
  let work, outputDir;

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-exclude-dirs-'));
    const vault = path.join(work, 'vault');
    outputDir = path.join(work, 'docs');

    // Only publish.exclude_dirs names "Secret Notes" — vault.config.json's legacy
    // excludeDirs does NOT. If the scanner only consulted the legacy field (the bug),
    // this folder would still publish.
    write(vault, '_meta/vault-config.md', '---\npublish:\n  exclude_dirs:\n    - "Secret Notes"\n---\n');
    write(vault, 'Secret Notes/Hidden.md', '---\ntype: npc\n---\n\n# Hidden\n\nShould never publish.\n');
    write(vault, 'Characters/NPCs/Visible.md', '---\ntype: npc\n---\n\n# Visible\n\nShould publish.\n');

    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Exclude Dirs Site',
      siteUrl: 'https://example.github.io/exclude-dirs',
      vaultPath: vault,
      outputDir,
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { 'Characters/NPCs': 'characters/npcs', 'Secret Notes': 'secret-notes' },
    }, null, 2));

    build({ configPath });
  });

  after(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('does not publish a page from a directory named only in publish.exclude_dirs', () => {
    assert.ok(!fs.existsSync(path.join(outputDir, 'secret-notes', 'hidden.html')));
  });

  it('still publishes pages outside the vault-config.md exclusion', () => {
    assert.ok(fs.existsSync(path.join(outputDir, 'characters', 'npcs', 'visible.html')));
  });
});

// #209 continued: vault.config.json's legacy excludeDirs must keep working too — the fix
// unions both sources, it does not swap one for the other.
describe('legacy vault.config.json excludeDirs still honoured alongside publish.exclude_dirs (#209)', () => {
  let work, outputDir;

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-exclude-dirs-legacy-'));
    const vault = path.join(work, 'vault');
    outputDir = path.join(work, 'docs');

    // vault-config.md names one folder; vault.config.json's excludeDirs names a different one.
    write(vault, '_meta/vault-config.md', '---\npublish:\n  exclude_dirs:\n    - "From Vault Config"\n---\n');
    write(vault, 'From Vault Config/A.md', '---\ntype: npc\n---\n\n# A\n');
    write(vault, 'From Json Config/B.md', '---\ntype: npc\n---\n\n# B\n');
    write(vault, 'Characters/NPCs/Visible.md', '---\ntype: npc\n---\n\n# Visible\n');

    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Legacy Exclude Dirs',
      siteUrl: 'https://example.github.io/legacy-exclude-dirs',
      vaultPath: vault,
      outputDir,
      excludeDirs: ['_meta', '_Templates', 'From Json Config'],
      folderMap: {
        'Characters/NPCs': 'characters/npcs',
        'From Vault Config': 'from-vault-config',
        'From Json Config': 'from-json-config',
      },
    }, null, 2));

    build({ configPath });
  });

  after(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('honours the vault-config.md source', () => {
    assert.ok(!fs.existsSync(path.join(outputDir, 'from-vault-config', 'a.html')));
  });

  it('still honours the legacy vault.config.json source', () => {
    assert.ok(!fs.existsSync(path.join(outputDir, 'from-json-config', 'b.html')));
  });

  it('publishes everything neither source excludes', () => {
    assert.ok(fs.existsSync(path.join(outputDir, 'characters', 'npcs', 'visible.html')));
  });
});

// #210 (excludeDirs half): scanAttachments walked the whole attachments tree with no
// exclude filtering at all, not even the directory-level excludeDirs the page scanner
// honours.
describe('scanAttachments honours exclude_dirs during a real build (#210)', () => {
  let work, outputDir;

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-attachments-exclude-'));
    const vault = path.join(work, 'vault');
    outputDir = path.join(work, 'docs');

    write(vault, '_meta/vault-config.md',
      '---\npublish:\n  mode: full\n  exclude_dirs:\n    - "_attachments/gm-maps"\n---\n');
    write(vault, '_attachments/gm-maps/Secret Map.png', 'fake-png-bytes');
    write(vault, '_attachments/Hero.png', 'fake-png-bytes');
    write(vault, 'Characters/NPCs/Someone.md', '---\ntype: npc\nportrait: Hero.png\n---\n\n# Someone\n');

    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Attachments Exclude',
      siteUrl: 'https://example.github.io/attachments-exclude',
      vaultPath: vault,
      outputDir,
      attachmentsDir: '_attachments',
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { 'Characters/NPCs': 'characters/npcs' },
    }, null, 2));

    build({ configPath });
  });

  after(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('does not copy an image under an excluded attachments subfolder', () => {
    // copyImages preserves the attachment's subfolder structure under images/.
    assert.ok(!fs.existsSync(path.join(outputDir, 'images', 'gm-maps', 'Secret Map.png')));
  });

  it('still copies images outside the excluded subfolder', () => {
    assert.ok(fs.existsSync(path.join(outputDir, 'images', 'Hero.png')));
  });
});

// CodeRabbit (PR #234): excludeDirs was only ever checked for CHILD directories of the
// attachments root — a GM excluding the attachments root itself wholesale still got
// every image directly under it (top-level, not just in a subfolder) scanned and copied.
describe('excluding the attachments root itself excludes every image, including top-level ones (#210 follow-up)', () => {
  let work, outputDir;

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-attachments-root-exclude-'));
    const vault = path.join(work, 'vault');
    outputDir = path.join(work, 'docs');

    write(vault, '_meta/vault-config.md',
      '---\npublish:\n  mode: full\n  exclude_dirs:\n    - "_attachments"\n---\n');
    write(vault, '_attachments/Top Level.png', 'fake-png-bytes');
    write(vault, '_attachments/portraits/Nested.png', 'fake-png-bytes');
    write(vault, 'Characters/NPCs/Someone.md', '---\ntype: npc\n---\n\n# Someone\n');

    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Attachments Root Exclude',
      siteUrl: 'https://example.github.io/attachments-root-exclude',
      vaultPath: vault,
      outputDir,
      attachmentsDir: '_attachments',
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { 'Characters/NPCs': 'characters/npcs' },
    }, null, 2));

    build({ configPath });
  });

  after(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('copies no images at all', () => {
    assert.ok(!fs.existsSync(path.join(outputDir, 'images', 'Top Level.png')));
    assert.ok(!fs.existsSync(path.join(outputDir, 'images', 'portraits', 'Nested.png')));
    assert.ok(!fs.existsSync(path.join(outputDir, 'images')) || fs.readdirSync(path.join(outputDir, 'images')).length === 0);
  });
});

// #210 (manifest-gating half): player mode only pruned images to "referenced by published
// pages" when a publish manifest file existed. A manifest-less player-mode vault shipped
// every attachment regardless of mode.
describe('player mode prunes unreferenced images with no manifest present (#210)', () => {
  let work, outputDir;

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-player-no-manifest-'));
    const vault = path.join(work, 'vault');
    outputDir = path.join(work, 'docs');

    // No _meta/publish-manifest.md anywhere in this vault.
    write(vault, '_meta/vault-config.md', '---\npublish:\n  mode: player\n---\n');
    write(vault, '_attachments/Referenced.png', 'fake-png-bytes');
    write(vault, '_attachments/Never Embedded.png', 'fake-png-bytes');
    write(vault, 'Characters/NPCs/Someone.md',
      '---\ntype: npc\nportrait: Referenced.png\n---\n\n# Someone\n');

    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Player No Manifest',
      siteUrl: 'https://example.github.io/player-no-manifest',
      vaultPath: vault,
      outputDir,
      attachmentsDir: '_attachments',
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { 'Characters/NPCs': 'characters/npcs' },
    }, null, 2));

    build({ configPath });
  });

  after(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('copies an image actually referenced by a published page', () => {
    assert.ok(fs.existsSync(path.join(outputDir, 'images', 'Referenced.png')));
  });

  it('does not copy an attachment no published page references', () => {
    assert.ok(!fs.existsSync(path.join(outputDir, 'images', 'Never Embedded.png')));
  });
});

// GM mode must stay unchanged: every attachment ships regardless of what's referenced.
describe('full/GM mode still copies every scanned image (#210 regression guard)', () => {
  let work, outputDir;

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-full-mode-images-'));
    const vault = path.join(work, 'vault');
    outputDir = path.join(work, 'docs');

    write(vault, '_meta/vault-config.md', '---\npublish:\n  mode: full\n---\n');
    write(vault, '_attachments/Referenced.png', 'fake-png-bytes');
    write(vault, '_attachments/Never Embedded.png', 'fake-png-bytes');
    write(vault, 'Characters/NPCs/Someone.md',
      '---\ntype: npc\nportrait: Referenced.png\n---\n\n# Someone\n');

    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Full Mode Images',
      siteUrl: 'https://example.github.io/full-mode-images',
      vaultPath: vault,
      outputDir,
      attachmentsDir: '_attachments',
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { 'Characters/NPCs': 'characters/npcs' },
    }, null, 2));

    build({ configPath });
  });

  after(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('copies images not referenced by any page', () => {
    assert.ok(fs.existsSync(path.join(outputDir, 'images', 'Never Embedded.png')));
  });
});
