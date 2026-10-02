const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { resolveConfig } = require('../../lib/config');

describe('resolveConfig', () => {
  it('fills the old-spelling keys from the vault file', () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-rc-'));
    fs.mkdirSync(path.join(vault, '_meta'));
    fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'),
      '---\npublish:\n  site_title: Canticle\n  footer: "© GM"\n  search: false\n  attachments_dir: _img\n  folder_map:\n    NPCs: npcs\n  system: gurps-4e\n---\n');
    const { config, publishConfig } = resolveConfig({ vaultPath: vault, outputDir: './docs', siteTitle: 'Old', folderMap: { X: 'x' } }, vault);
    assert.strictEqual(config.siteTitle, 'Canticle');
    assert.strictEqual(config.footer, '© GM');
    assert.strictEqual(config.searchEnabled, false);
    assert.strictEqual(config.attachmentsDir, '_img');
    assert.deepStrictEqual(config.folderMap, { NPCs: 'npcs' });
    assert.strictEqual(config.system, 'gurps-4e');
    assert.strictEqual(config.outputDir, './docs');
    assert.strictEqual(publishConfig.site_title, 'Canticle');
    fs.rmSync(vault, { recursive: true, force: true });
  });
  it('does not mutate the raw config', () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-rc-'));
    const raw = { vaultPath: vault, siteTitle: 'Old' };
    resolveConfig(raw, vault);
    assert.deepStrictEqual(raw, { vaultPath: vault, siteTitle: 'Old' });
    fs.rmSync(vault, { recursive: true, force: true });
  });
  it('carries exclude_dirs under the old spelling', () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-rc-'));
    fs.mkdirSync(path.join(vault, '_meta'));
    fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), '---\npublish:\n  exclude_dirs: [_meta]\n---\n');
    const { config, publishConfig } = resolveConfig({ vaultPath: vault }, vault);
    assert.deepStrictEqual(config.excludeDirs, publishConfig.exclude_dirs);
    assert.ok(config.excludeDirs.includes('_meta'));
    fs.rmSync(vault, { recursive: true, force: true });
  });
});
