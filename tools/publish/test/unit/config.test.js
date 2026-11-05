const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadPublishConfig } = require('../../lib/config');
const { resolve } = require('../../lib/settings');
const { writeFromOldText } = require('../helpers/vault-files');
// The built-in default of a setting, asked by the name the old vault file gave it.
const defaultOf = (name) => resolve(`publish.${name}`).entry.default;

describe('the built-in defaults', () => {
  it('excludes GM Notes sections by default', () => {
    assert.ok(defaultOf('exclude_sections').includes('GM Notes'));
  });

  it('excludes secrets, current_plan, plan_progress, gm_notes, prep_notes by default', () => {
    assert.deepStrictEqual(defaultOf('exclude_fields'), ['secrets', 'current_plan', 'plan_progress', 'gm_notes', 'prep_notes', 'reliability']);
  });

  it('excludes _meta and _Templates dirs by default', () => {
    assert.ok(defaultOf('exclude_dirs').includes('_meta'));
    assert.ok(defaultOf('exclude_dirs').includes('_Templates'));
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
    assert.deepStrictEqual(defaultOf('exclude_sections'), EXPECTED);
  });

  it('loadPublishConfig uses the six-item default when no vault config is present', () => {
    const config = loadPublishConfig('/nonexistent/path');
    assert.deepStrictEqual(config.exclude_sections, EXPECTED);
  });

  it('a vault-config.md exclude_sections list fully replaces the default (no default leakage)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    writeFromOldText(metaDir,
      '---\npublish:\n  exclude_sections:\n    - "Custom Section"\n---\n',
    );
    const result = loadPublishConfig(tmpDir);
    assert.deepStrictEqual(result.exclude_sections, ['Custom Section']);
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
    assert.strictEqual(defaultOf('exclude_callouts'), false);
    const config = loadPublishConfig('/nonexistent/path');
    assert.strictEqual(config.exclude_callouts, false);
  });

  });

describe('loadPublishConfig', () => {
  it('returns defaults when vault-config.md has no publish section', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    writeFromOldText(metaDir, '---\ntitle: Test\n---\nSome config');
    const result = loadPublishConfig(tmpDir);
    assert.strictEqual(result.mode, undefined);
    assert.deepStrictEqual(result.exclude_fields, ['secrets', 'current_plan', 'plan_progress', 'gm_notes', 'prep_notes', 'reliability']);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('merges vault-config.md publish section over defaults', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    const yaml = [
      '---',
      'publish:',
      '  exclude_fields:',
      '    - secrets',
      '  theme:',
      '    genre: "noir"',
      '    palette:',
      '      primary: "#111"',
      '---',
    ].join('\n');
    writeFromOldText(metaDir, yaml);
    const result = loadPublishConfig(tmpDir);
    assert.deepStrictEqual(result.exclude_fields, ['secrets']);
    assert.strictEqual(result.theme.genre, 'noir');
    assert.strictEqual(result.theme.palette.primary, '#111');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when vault-config.md does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const result = loadPublishConfig(tmpDir);
    assert.strictEqual(result.mode, undefined);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

      });

describe('exclude_dirs spelling normalization', () => {
  it('strips a trailing slash', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-excl-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    writeFromOldText(metaDir,
      '---\npublish:\n  exclude_dirs:\n    - "NPCs/Hidden/"\n---\n');
    const result = loadPublishConfig(tmpDir);
    assert.ok(result.exclude_dirs.includes('NPCs/Hidden'), result.exclude_dirs.join(', '));
    assert.ok(!result.exclude_dirs.includes('NPCs/Hidden/'), result.exclude_dirs.join(', '));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('strips a leading "./"', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-excl-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    writeFromOldText(metaDir,
      '---\npublish:\n  exclude_dirs:\n    - "./NPCs/Hidden"\n---\n');
    const result = loadPublishConfig(tmpDir);
    assert.ok(result.exclude_dirs.includes('NPCs/Hidden'), result.exclude_dirs.join(', '));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('converts backslashes to forward slashes', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-excl-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    writeFromOldText(metaDir,
      '---\npublish:\n  exclude_dirs:\n    - "NPCs\\\\Hidden"\n---\n');
    const result = loadPublishConfig(tmpDir);
    assert.ok(result.exclude_dirs.includes('NPCs/Hidden'), result.exclude_dirs.join(', '));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rewrites an absolute path resolving inside the vault to vault-relative', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-excl-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    const absolute = path.join(tmpDir, 'NPCs', 'Hidden');
    writeFromOldText(metaDir,
      `---\npublish:\n  exclude_dirs:\n    - "${absolute.replace(/\\/g, '\\\\')}"\n---\n`);
    const result = loadPublishConfig(tmpDir);
    assert.ok(result.exclude_dirs.includes('NPCs/Hidden'), result.exclude_dirs.join(', '));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('drops an absolute path resolving outside the vault, with a warning', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-excl-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    const outside = path.join(os.tmpdir(), 'somewhere-else-entirely');
    writeFromOldText(metaDir,
      `---\npublish:\n  exclude_dirs:\n    - "${outside.replace(/\\/g, '\\\\')}"\n---\n`);
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    let result;
    try {
      result = loadPublishConfig(tmpDir);
    } finally {
      console.warn = orig;
    }
    assert.ok(!result.exclude_dirs.some((d) => d.includes('somewhere-else-entirely')), result.exclude_dirs.join(', '));
    assert.ok(warns.some((w) => w.includes('outside the vault')), warns.join(' | '));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('dedupes case-insensitively across a JSON-cased and a YAML-cased spelling, keeping one', () => {
    // GM: JSON legacy field spells it "GM", vault-config.md spells it "gm" — on a
    // case-sensitive filesystem (Linux) only one spelling can ever match the real
    // folder, so both scanner call sites must compare case-insensitively regardless
    // of which spelling the union kept.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-excl-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    writeFromOldText(metaDir,
      '---\npublish:\n  exclude_dirs:\n    - "gm"\n---\n');
    const result = loadPublishConfig(tmpDir, { excludeDirs: ['GM'] });
    const gmCount = result.exclude_dirs.filter((d) => d.toLowerCase() === 'gm').length;
    assert.strictEqual(gmCount, 1, result.exclude_dirs.join(', '));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('trailing-slash and bare spellings of the same folder dedupe to one entry', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-excl-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    writeFromOldText(metaDir,
      '---\npublish:\n  exclude_dirs:\n    - "NPCs/Hidden/"\n---\n');
    const result = loadPublishConfig(tmpDir, { excludeDirs: ['NPCs/Hidden'] });
    const count = result.exclude_dirs.filter((d) => d.toLowerCase() === 'npcs/hidden').length;
    assert.strictEqual(count, 1, result.exclude_dirs.join(', '));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('loadPublishConfig — setting_year', () => {
  it('extracts setting_year from vault-config.md frontmatter', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    const yaml = [
      '---',
      'setting_year: 2019',
      'publish:',
      '---',
    ].join('\n');
    writeFromOldText(metaDir, yaml);
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
    writeFromOldText(metaDir,
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
    writeFromOldText(metaDir,
      '---\npublish:\n  exclude_drafts: false\n---\n');

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
    writeFromOldText(metaDir, yaml);
    const result = loadPublishConfig(tmpDir);
    assert.deepStrictEqual(result.section_titles, { locations: 'Star Charts' });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('exclude_fields resolution', () => {
    });

describe('sheet_crest', () => {
  // Regression for #112: the field-by-field allow-list in loadPublishConfig
  // silently dropped sheet_crest, so the CoC sheet crest/seal never rendered.
  it('preserves sheet_crest from the vault-config.md publish block', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    writeFromOldText(metaDir,
      '---\npublish:\n  sheet_crest: "_attachments/factions/order.webp"\n---\n',
    );
    const result = loadPublishConfig(tmpDir);
    assert.strictEqual(result.sheet_crest, '_attachments/factions/order.webp');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

    it('lets the publish block win over the vault.config.json fallback', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    writeFromOldText(metaDir,
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
    writeFromOldText(metaDir, yaml);
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
    writeFromOldText(metaDir, `---\n${yamlBody}---\n`);
  }

  function captureWarns(fn) {
    const warns = [];
    const orig = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));
    try { return { result: fn(), warns }; } finally { console.warn = orig; }
  }

  it('warns instead of silently ignoring an unread top-level override key', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    try {
      writeConfig(tmpDir, 'publish:\n  overrides:\n    exclude:\n      - "Notes/Secret.md"\n');
      const { warns } = captureWarns(() => loadPublishConfig(tmpDir));
      const hits = warns.filter(w => w.includes('player_site.overrides'));
      assert.strictEqual(hits.length, 1, `expected one warning, got: ${warns.join(' | ')}`);
      assert.match(hits[0], /not a setting/);
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

describe('malformed publish.overrides blocks', () => {
  function writeConfig(tmpDir, yamlBody) {
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir, { recursive: true });
    writeFromOldText(metaDir, `---\n${yamlBody}---\n`);
  }

  function loadWithWarns(yamlBody) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const warns = [];
    const orig = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));
    try {
      writeConfig(tmpDir, yamlBody);
      return { result: loadPublishConfig(tmpDir), warns };
    } finally {
      console.warn = orig;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  it('ignores a non-map overrides.fields instead of inventing per-character keys', () => {
    const { result, warns } = loadWithWarns('publish:\n  overrides:\n    fields: secrets\n');
    assert.deepStrictEqual(result.overrides.fields, {});
    assert.ok(warns.some(w => w.includes('field_exceptions')), `no warning in: ${warns.join(' | ')}`);
  });

  it('reaches the validator for an explicitly falsy fields value', () => {
    // `||` swapped `false` for the default before it could be reported, so a
    // GM who wrote `fields: false` got silence and no overrides.
    const { result, warns } = loadWithWarns('publish:\n  overrides:\n    fields: false\n');
    assert.deepStrictEqual(result.overrides.fields, {});
    assert.ok(warns.some(w => w.includes('field_exceptions') && w.includes('is false')),
      `no 'is false' warning in: ${warns.join(' | ')}`);
  });

  it('drops a per-file override whose include is a string, not a list', () => {
    // filterFields does `overrides.include.includes(field)`; on a string that is
    // substring matching, so `include: sec` would re-admit `secrets`.
    const { result, warns } = loadWithWarns(
      'publish:\n  overrides:\n    fields:\n      "Characters/NPCs/Vex.md":\n        include: sec\n');
    assert.deepStrictEqual(result.overrides.fields, {});
    assert.ok(warns.some(w => w.includes('Characters/NPCs/Vex.md') && w.includes('include')),
      `no include warning in: ${warns.join(' | ')}`);
  });

  it('drops a per-file override that is not a map at all', () => {
    // A truthy non-array `include` (or a scalar override) makes filterFields throw.
    const { result, warns } = loadWithWarns(
      'publish:\n  overrides:\n    fields:\n      "Characters/NPCs/Vex.md": secrets\n');
    assert.deepStrictEqual(result.overrides.fields, {});
    assert.ok(warns.some(w => w.includes('Characters/NPCs/Vex.md')),
      `no per-file warning in: ${warns.join(' | ')}`);
  });

  it('drops a per-file override whose include list holds a non-string', () => {
    const { result, warns } = loadWithWarns(
      'publish:\n  overrides:\n    fields:\n      "Characters/NPCs/Vex.md":\n        include:\n          - 7\n');
    assert.deepStrictEqual(result.overrides.fields, {});
    assert.ok(warns.some(w => w.includes('Characters/NPCs/Vex.md')),
      `no per-file warning in: ${warns.join(' | ')}`);
  });

  it('keeps a well-formed per-file override untouched', () => {
    const { result, warns } = loadWithWarns(
      'publish:\n  overrides:\n    fields:\n      "Characters/NPCs/Vex.md":\n        include:\n          - secrets\n');
    assert.deepStrictEqual(result.overrides.fields['Characters/NPCs/Vex.md'], { include: ['secrets'] });
    assert.deepStrictEqual(warns.filter(w => w.includes('overrides')), []);
  });

  it('keeps a per-file override with no include key', () => {
    // `{}` is a legal entry — it just re-admits nothing. Warning here would be noise.
    const { result, warns } = loadWithWarns(
      'publish:\n  overrides:\n    fields:\n      "Characters/NPCs/Vex.md": {}\n');
    assert.deepStrictEqual(result.overrides.fields['Characters/NPCs/Vex.md'], {});
    assert.deepStrictEqual(warns.filter(w => w.includes('overrides')), []);
  });
});

describe('landing config (#169)', () => {
  const withVaultConfig = (yaml) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-landing-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    writeFromOldText(metaDir, yaml);
    return tmpDir;
  };

  it('ships defaults so the key is never undefined', () => {
    // build.js reads publishConfig.landing.*; loadPublishConfig never set the
    // key at all, so every knob was silently ignored and the landing page was
    // permanently 6 NPCs / 4 locations / window 3.
    const config = loadPublishConfig('/nonexistent/path');
    assert.strictEqual(config.landing.recency_window, 3);
    assert.strictEqual(config.landing.max_npcs, 6);
    assert.strictEqual(config.landing.max_locations, 4);
    assert.deepStrictEqual(config.landing.featured_npcs, []);
    assert.deepStrictEqual(config.landing.featured_locations, []);
    assert.deepStrictEqual(config.landing.quick_links, []);
  });

  it('reads landing from a vault-config.md publish block', () => {
    const dir = withVaultConfig(
      '---\npublish:\n  landing:\n    recency_window: 1\n    max_npcs: 8\n    max_locations: 6\n---\n');
    const config = loadPublishConfig(dir);
    assert.strictEqual(config.landing.recency_window, 1);
    assert.strictEqual(config.landing.max_npcs, 8);
    assert.strictEqual(config.landing.max_locations, 6);
    fs.rmSync(dir, { recursive: true, force: true });
  });

    it('lets the publish block win over vault.config.json', () => {
    const dir = withVaultConfig('---\npublish:\n  landing:\n    max_npcs: 8\n---\n');
    const config = loadPublishConfig(dir, { landing: { max_npcs: 2 } });
    assert.strictEqual(config.landing.max_npcs, 8);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('merges per key rather than replacing the whole block', () => {
    const dir = withVaultConfig('---\npublish:\n  landing:\n    max_npcs: 8\n---\n');
    const config = loadPublishConfig(dir);
    assert.strictEqual(config.landing.max_npcs, 8);
    assert.strictEqual(config.landing.recency_window, 3);  // default survives
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads the pinning lists', () => {
    const dir = withVaultConfig(
      '---\npublish:\n  landing:\n    featured_npcs: ["Hugh_Cavendish", "Margaret_Cavendish"]\n'
      + '    featured_locations: ["Cavendish_Compound"]\n    quick_links: ["Calcutta_City_Map"]\n---\n');
    const config = loadPublishConfig(dir);
    assert.deepStrictEqual(config.landing.featured_npcs, ['Hugh_Cavendish', 'Margaret_Cavendish']);
    assert.deepStrictEqual(config.landing.featured_locations, ['Cavendish_Compound']);
    assert.deepStrictEqual(config.landing.quick_links, ['Calcutta_City_Map']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
