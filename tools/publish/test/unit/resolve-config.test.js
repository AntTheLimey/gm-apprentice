const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { resolveConfig } = require('../../lib/config');
const { surveyVault } = require('../../lib/manifest-cli');

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
  it('takes a key from the site file when the vault file is silent', () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-rc-'));
    fs.mkdirSync(path.join(vault, '_meta'));
    fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), '---\npublish:\n  mode: player\n---\n');
    const { config, publishConfig } = resolveConfig({ vaultPath: vault, siteTitle: 'From Site', system: 'coc-7e' }, vault);
    assert.strictEqual(config.siteTitle, 'From Site');
    assert.strictEqual(config.system, 'coc-7e');
    assert.strictEqual(publishConfig.site_title, 'From Site');
    assert.deepStrictEqual(publishConfig.legacy.map((l) => [l.key, l.status]), [['siteTitle', 'used'], ['system', 'used']]);
    fs.rmSync(vault, { recursive: true, force: true });
  });
  it('leaves a key neither file sets as the raw object had it', () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-rc-'));
    const { config, publishConfig } = resolveConfig({ vaultPath: vault }, vault);
    assert.strictEqual(config.siteTitle, undefined);
    assert.strictEqual(config.system, undefined);
    assert.strictEqual(publishConfig.site_title, null);
    assert.deepStrictEqual(publishConfig.legacy, []);
    fs.rmSync(vault, { recursive: true, force: true });
  });
  it('is what a converted command sees: surveyVault reads site_title and system from the vault file alone', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-rc-'));
    const vault = path.join(root, 'vault');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), '---\npublish:\n  site_title: Vault Only\n  system: gurps-4e\n---\n');
    const configPath = path.join(root, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ vaultPath: './vault', outputDir: './docs' }));
    const survey = surveyVault({ configPath }, {});
    assert.strictEqual(survey.config.siteTitle, 'Vault Only');
    assert.strictEqual(survey.config.system, 'gurps-4e');
    assert.strictEqual(survey.publishConfig.system, 'gurps-4e');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
