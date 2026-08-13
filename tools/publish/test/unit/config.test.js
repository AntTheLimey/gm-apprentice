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

  it('excludes secrets, current_plan, plan_progress, gm_notes, prep_notes by default', () => {
    assert.deepStrictEqual(PUBLISH_DEFAULTS.exclude_fields, ['secrets', 'current_plan', 'plan_progress', 'gm_notes', 'prep_notes']);
  });

  it('excludes _meta and _Templates dirs by default', () => {
    assert.ok(PUBLISH_DEFAULTS.exclude_dirs.includes('_meta'));
    assert.ok(PUBLISH_DEFAULTS.exclude_dirs.includes('_Templates'));
  });
});

describe('exclude_sections default (issue #144)', () => {
  // Reconcile / session-wrapup write '## Reconciliation Context' and
  // '## Handoff to Reconcile' straight into vault files — GM plot state that
  // must never reach a published player-mode site. The built-in default and
  // the scaffold template (templates-scaffold/vault.config.json.tmpl) had
  // drifted apart; this guards both independently, plus a sync check so they
  // can't drift again.
  const EXPECTED = [
    'GM Notes',
    'DM Notes',
    'Player Notes',
    'Source References',
    'Reconciliation Context',
    'Handoff to Reconcile',
  ];

  it('includes the six reconcile-bookkeeping sections by default', () => {
    assert.deepStrictEqual(PUBLISH_DEFAULTS.exclude_sections, EXPECTED);
  });

  it('loadPublishConfig uses the six-item default when no vault config is present', () => {
    const config = loadPublishConfig('/nonexistent/path');
    assert.deepStrictEqual(config.exclude_sections, EXPECTED);
  });

  it('a vault-config.md exclude_sections list fully replaces the default (no default leakage)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    fs.writeFileSync(
      path.join(metaDir, 'vault-config.md'),
      '---\npublish:\n  exclude_sections:\n    - "Custom Section"\n---\n',
    );
    const result = loadPublishConfig(tmpDir);
    assert.deepStrictEqual(result.exclude_sections, ['Custom Section']);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('unions vault-config.md with a stale vault.config.json excludeSections list, with no default injection', () => {
    // Regression for the exact upgrade scenario #144 leaves unfixed: a site
    // scaffolded before this change has a stale 4-item excludeSections in
    // vault.config.json. Adding a vault-config.md list must union with that
    // stale list (neither shadows the other, per the existing union
    // semantics), and the six-item built-in default must not sneak in on
    // top of either explicit source.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    fs.writeFileSync(
      path.join(metaDir, 'vault-config.md'),
      '---\npublish:\n  exclude_sections:\n    - "Custom Section"\n---\n',
    );
    const staleFallback = {
      excludeSections: ['GM Notes', 'DM Notes', 'Player Notes', 'Source References'],
    };
    const result = loadPublishConfig(tmpDir, staleFallback);
    assert.deepStrictEqual(result.exclude_sections, [
      'Custom Section',
      'GM Notes',
      'DM Notes',
      'Player Notes',
      'Source References',
    ]);
    assert.ok(!result.exclude_sections.includes('Reconciliation Context'));
    assert.ok(!result.exclude_sections.includes('Handoff to Reconcile'));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scaffold template excludeSections stays in sync with PUBLISH_DEFAULTS.exclude_sections', () => {
    const tmplPath = path.join(__dirname, '../../templates-scaffold/vault.config.json.tmpl');
    const parsed = JSON.parse(fs.readFileSync(tmplPath, 'utf8'));
    assert.deepStrictEqual(parsed.excludeSections, PUBLISH_DEFAULTS.exclude_sections);
  });
});

describe('exclude_drafts', () => {
  it('defaults to false', () => {
    const config = loadPublishConfig('/nonexistent/path');
    assert.strictEqual(config.exclude_drafts, false);
  });
});

describe('exclude_callouts (issue #137)', () => {
  it('defaults to false', () => {
    assert.strictEqual(PUBLISH_DEFAULTS.exclude_callouts, false);
    const config = loadPublishConfig('/nonexistent/path');
    assert.strictEqual(config.exclude_callouts, false);
  });

  it('reads excludeCallouts from vault.config.json fallback', () => {
    const config = loadPublishConfig('/nonexistent/path', { excludeCallouts: true });
    assert.strictEqual(config.exclude_callouts, true);
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
    assert.deepStrictEqual(result.exclude_fields, ['secrets', 'current_plan', 'plan_progress', 'gm_notes', 'prep_notes']);
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

describe('section_titles passthrough', () => {
  it('defaults to an empty object', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const result = loadPublishConfig(tmpDir);
    assert.deepStrictEqual(result.section_titles, {});
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('survives the merge from vault-config.md publish.section_titles', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    const yaml = [
      '---',
      'publish:',
      '  section_titles:',
      '    locations: "Star Charts"',
      '---',
    ].join('\n');
    fs.writeFileSync(path.join(metaDir, 'vault-config.md'), yaml);
    const result = loadPublishConfig(tmpDir);
    assert.deepStrictEqual(result.section_titles, { locations: 'Star Charts' });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('exclude_fields union merge', () => {
  it('unions vault-config.md and vault.config.json exclude_fields (neither shadows the other)', () => {
    // Regression: exclude_fields still had the A || B shadowing bug after
    // exclude_sections/exclude_dirs were already fixed to union.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    fs.writeFileSync(
      path.join(metaDir, 'vault-config.md'),
      '---\npublish:\n  exclude_fields:\n    - "secrets"\n---\n',
    );
    const fallback = { excludeFields: ['secrets', 'custom_field'] };
    const result = loadPublishConfig(tmpDir, fallback);
    assert.ok(result.exclude_fields.includes('secrets'));
    assert.ok(result.exclude_fields.includes('custom_field'), 'field listed only in vault.config.json must still be excluded');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('dedupes the unioned exclude_fields case-insensitively', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    fs.writeFileSync(
      path.join(metaDir, 'vault-config.md'),
      '---\npublish:\n  exclude_fields:\n    - "Secrets"\n---\n',
    );
    const result = loadPublishConfig(tmpDir, { excludeFields: ['secrets', 'gm_notes'] });
    const secretsCount = result.exclude_fields.filter((f) => f.toLowerCase() === 'secrets').length;
    assert.strictEqual(secretsCount, 1, 'case-insensitive duplicate should collapse to one');
    assert.ok(result.exclude_fields.includes('gm_notes'));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('sheet_crest', () => {
  // Regression for #112: the field-by-field allow-list in loadPublishConfig
  // silently dropped sheet_crest, so the CoC sheet crest/seal never rendered.
  it('preserves sheet_crest from the vault-config.md publish block', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    fs.writeFileSync(
      path.join(metaDir, 'vault-config.md'),
      '---\npublish:\n  sheet_crest: "_attachments/factions/order.webp"\n---\n',
    );
    const result = loadPublishConfig(tmpDir);
    assert.strictEqual(result.sheet_crest, '_attachments/factions/order.webp');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('falls back to vault.config.json sheet_crest when the publish block has none', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const result = loadPublishConfig(tmpDir, { sheet_crest: 'images/crest.png' });
    assert.strictEqual(result.sheet_crest, 'images/crest.png');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lets the publish block win over the vault.config.json fallback', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    fs.writeFileSync(
      path.join(metaDir, 'vault-config.md'),
      '---\npublish:\n  sheet_crest: "block.webp"\n---\n',
    );
    const result = loadPublishConfig(tmpDir, { sheet_crest: 'fallback.webp' });
    assert.strictEqual(result.sheet_crest, 'block.webp');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('defaults sheet_crest to null when unset', () => {
    const result = loadPublishConfig('/nonexistent/path');
    assert.strictEqual(result.sheet_crest, null);
  });
});

describe('overrides.fields unicode normalization (#139)', () => {
  const { canonicalPath } = require('../../lib/manifest');

  // Built with explicit \u escapes (never a literal accented character) so the test
  // file itself cannot be silently re-normalized by an editor or formatter. NFC types
  // the accent as one precomposed codepoint; NFD types the same visible character as
  // base letter + a separate combining acute accent codepoint. build.js looks up
  // overrides via fieldOverrides[vaultRelPathOf(page)], and vaultRelPathOf() now
  // canonicalizes the scanned page path to NFC (#139) — so an overrides.fields key
  // must land in the same NFC form at config-load time, or it silently stops matching
  // whenever the config author's normal form differs from the page's.
  const NFC_PATH = 'Characters/PCs/Alena Gonz\u00e1lez.md';
  const NFD_PATH = 'Characters/PCs/Alena Gonza\u0301lez.md';

  function writeVaultConfig(tmpDir, fieldKey) {
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    const yaml = [
      '---',
      'publish:',
      '  overrides:',
      '    fields:',
      `      "${fieldKey}":`,
      '        some_field: "override value"',
      '---',
    ].join('\n');
    fs.writeFileSync(path.join(metaDir, 'vault-config.md'), yaml);
  }

  it('canonicalizes an NFD-keyed overrides.fields entry to NFC, matching an NFC page path', () => {
    assert.notStrictEqual(NFC_PATH, NFD_PATH); // sanity: the two source strings really do differ byte-for-byte
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    writeVaultConfig(tmpDir, NFD_PATH);
    const result = loadPublishConfig(tmpDir);
    assert.deepStrictEqual(Object.keys(result.overrides.fields), [NFC_PATH]);
    assert.strictEqual(result.overrides.fields[canonicalPath(NFC_PATH)].some_field, 'override value');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('canonicalizes an NFC-keyed overrides.fields entry, matching an NFD page path (vice versa)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    writeVaultConfig(tmpDir, NFC_PATH);
    const result = loadPublishConfig(tmpDir);
    assert.deepStrictEqual(Object.keys(result.overrides.fields), [NFC_PATH]);
    assert.strictEqual(result.overrides.fields[canonicalPath(NFD_PATH)].some_field, 'override value');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('overrides surface (dead top-level keys)', () => {
  // `overrides.fields` is the only override the build reads: build.js takes
  // `publishConfig.overrides.fields[vaultRelPath]` and hands that per-file object to
  // filterFields, which reads `.include` off it. A top-level `overrides.exclude` or
  // `overrides.include` was declared in the defaults but never read anywhere, so a GM who
  // wrote one got a silent no-op.
  function writeConfig(tmpDir, yamlBody) {
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(path.join(metaDir, 'vault-config.md'), `---\n${yamlBody}---\n`);
  }

  function captureWarns(fn) {
    const warns = [];
    const orig = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));
    try { return { result: fn(), warns }; } finally { console.warn = orig; }
  }

  it('declares only the override the build actually reads', () => {
    assert.deepStrictEqual(Object.keys(PUBLISH_DEFAULTS.overrides), ['fields']);
  });

  it('warns instead of silently ignoring an unread top-level override key', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    try {
      writeConfig(tmpDir, 'publish:\n  overrides:\n    exclude:\n      - "Notes/Secret.md"\n');
      const { warns } = captureWarns(() => loadPublishConfig(tmpDir));
      const hits = warns.filter(w => w.includes('overrides.exclude'));
      assert.strictEqual(hits.length, 1, `expected one warning, got: ${warns.join(' | ')}`);
      assert.match(hits[0], /overrides\.fields/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('stays quiet for the supported overrides.fields block', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    try {
      writeConfig(tmpDir, 'publish:\n  overrides:\n    fields:\n      "Characters/NPCs/Vex.md":\n        include:\n          - secrets\n');
      const { result, warns } = captureWarns(() => loadPublishConfig(tmpDir));
      assert.deepStrictEqual(warns.filter(w => w.includes('overrides')), []);
      assert.deepStrictEqual(result.overrides.fields['Characters/NPCs/Vex.md'].include, ['secrets']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('leaves overrides.fields as the only key when nothing is configured', () => {
    assert.deepStrictEqual(loadPublishConfig('/nonexistent/path').overrides, { fields: {} });
  });
});
