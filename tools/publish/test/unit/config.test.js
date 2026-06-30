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

describe('exclude_drafts', () => {
  it('defaults to false', () => {
    const config = loadPublishConfig('/nonexistent/path');
    assert.strictEqual(config.exclude_drafts, false);
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

  it('unions vault-config.md and vault.config.json exclude lists (neither shadows the other)', () => {
    // Regression for the spoiler-filter gap: a section listed only in vault.config.json
    // used to be silently ignored whenever vault-config.md defined exclude_sections.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    const yaml = '---\npublish:\n  exclude_sections:\n    - "GM Notes"\n  exclude_dirs:\n    - "_meta"\n---\n';
    fs.writeFileSync(path.join(metaDir, 'vault-config.md'), yaml);
    const fallback = {
      excludeSections: ['GM Notes', 'DM Notes', 'Player Notes', 'Source References'],
      excludeDirs: ['_meta', '_QA'],
    };
    const result = loadPublishConfig(tmpDir, fallback);
    for (const s of ['GM Notes', 'DM Notes', 'Player Notes', 'Source References']) {
      assert.ok(result.exclude_sections.includes(s), `expected '${s}' to be excluded`);
    }
    assert.ok(result.exclude_dirs.includes('_QA'), 'exclude_dirs should union too');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('dedupes the unioned exclude_sections case-insensitively', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    fs.writeFileSync(
      path.join(metaDir, 'vault-config.md'),
      '---\npublish:\n  exclude_sections:\n    - "GM Notes"\n---\n',
    );
    const result = loadPublishConfig(tmpDir, { excludeSections: ['gm notes', 'Secrets'] });
    const gmCount = result.exclude_sections.filter((s) => s.toLowerCase() === 'gm notes').length;
    assert.strictEqual(gmCount, 1, 'case-insensitive duplicate should collapse to one');
    assert.ok(result.exclude_sections.includes('Secrets'));
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

describe('system field', () => {
  it('passes through system from publish config', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const { loadPublishConfig } = require('../../lib/config');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-system-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(path.join(metaDir, 'vault-config.md'),
      '---\npublish:\n  system: coc-7e-regency\n---\n');

    const result = loadPublishConfig(tmpDir, {});
    assert.strictEqual(result.system, 'coc-7e-regency');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('defaults system to null when not set', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const { loadPublishConfig } = require('../../lib/config');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-nosystem-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(path.join(metaDir, 'vault-config.md'),
      '---\npublish:\n  mode: player\n---\n');

    const result = loadPublishConfig(tmpDir, {});
    assert.strictEqual(result.system, null);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
