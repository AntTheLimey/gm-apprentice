const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadPublishConfig, PUBLISH_DEFAULTS } = require('../../lib/config');

describe('PUBLISH_DEFAULTS', () => {
  it('has player mode by default', () => {
    assert.strictEqual(PUBLISH_DEFAULTS.mode, 'player');
  });

  it('excludes GM Notes sections by default', () => {
    assert.ok(PUBLISH_DEFAULTS.exclude_sections.includes('GM Notes'));
  });

  it('excludes secrets, current_plan, plan_progress by default', () => {
    assert.deepStrictEqual(PUBLISH_DEFAULTS.exclude_fields, ['secrets', 'current_plan', 'plan_progress']);
  });

  it('excludes _meta and _Templates dirs by default', () => {
    assert.ok(PUBLISH_DEFAULTS.exclude_dirs.includes('_meta'));
    assert.ok(PUBLISH_DEFAULTS.exclude_dirs.includes('_Templates'));
  });
});

describe('loadPublishConfig', () => {
  it('returns defaults when vault-config.md has no publish section', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    fs.writeFileSync(path.join(metaDir, 'vault-config.md'), '---\ntitle: Test\n---\nSome config');
    const result = loadPublishConfig(tmpDir);
    assert.strictEqual(result.mode, 'player');
    assert.deepStrictEqual(result.exclude_fields, ['secrets', 'current_plan', 'plan_progress']);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('merges vault-config.md publish section over defaults', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    const yaml = [
      '---',
      'publish:',
      '  mode: full',
      '  exclude_fields:',
      '    - secrets',
      '  theme:',
      '    genre: "noir"',
      '    palette:',
      '      primary: "#111"',
      '---',
    ].join('\n');
    fs.writeFileSync(path.join(metaDir, 'vault-config.md'), yaml);
    const result = loadPublishConfig(tmpDir);
    assert.strictEqual(result.mode, 'full');
    assert.deepStrictEqual(result.exclude_fields, ['secrets']);
    assert.strictEqual(result.theme.genre, 'noir');
    assert.strictEqual(result.theme.palette.primary, '#111');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when vault-config.md does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const result = loadPublishConfig(tmpDir);
    assert.strictEqual(result.mode, 'player');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('falls back to vault.config.json excludeSections when vault-config.md has none', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const fallback = { excludeSections: ['DM Notes', 'Hidden'], excludeDirs: ['_meta', '_Prep'] };
    const result = loadPublishConfig(tmpDir, fallback);
    assert.ok(result.exclude_sections.includes('DM Notes'));
    assert.ok(result.exclude_sections.includes('Hidden'));
    assert.ok(result.exclude_dirs.includes('_Prep'));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('vault-config.md values take precedence over vault.config.json fallback', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    const yaml = '---\npublish:\n  exclude_sections:\n    - "Spoilers"\n---\n';
    fs.writeFileSync(path.join(metaDir, 'vault-config.md'), yaml);
    const fallback = { excludeSections: ['DM Notes'] };
    const result = loadPublishConfig(tmpDir, fallback);
    assert.deepStrictEqual(result.exclude_sections, ['Spoilers']);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts setting_year from vault-config.md frontmatter', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    const yaml = [
      '---',
      'setting_year: 2019',
      'publish:',
      '  mode: player',
      '---',
    ].join('\n');
    fs.writeFileSync(path.join(metaDir, 'vault-config.md'), yaml);
    const result = loadPublishConfig(tmpDir);
    assert.strictEqual(result.setting_year, 2019);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('setting_year defaults to null when absent', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const result = loadPublishConfig(tmpDir);
    assert.strictEqual(result.setting_year, null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
