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

// #211: theme.fonts.source: local copies the listed font files into the build output and
// references them from css/theme.css with @font-face, instead of the Google Fonts @import.
describe('theme.fonts.source: local copies font files into the build (#211)', () => {
  let work, outputDir, themeCss;

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-theme-fonts-'));
    const vault = path.join(work, 'vault');
    outputDir = path.join(work, 'docs');

    write(vault, '_meta/vault-config.md', [
      '---',
      'publish:',
      '  theme:',
      '    fonts:',
      '      heading: Cinzel',
      '      body: Inter',
      '      source: local',
      '      files:',
      '        - family: Cinzel',
      '          path: _attachments/fonts/Cinzel-Regular.woff2',
      '        - family: Inter',
      '          path: _attachments/fonts/Inter-Regular.woff2',
      '          weight: 400',
      '---',
      '',
    ].join('\n'));
    write(vault, '_attachments/fonts/Cinzel-Regular.woff2', 'fake-woff2-bytes-cinzel');
    write(vault, '_attachments/fonts/Inter-Regular.woff2', 'fake-woff2-bytes-inter');
    write(vault, 'Characters/NPCs/Someone.md', '---\ntype: npc\n---\n\n# Someone\n');

    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Theme Fonts Site',
      siteUrl: 'https://example.github.io/theme-fonts',
      vaultPath: vault,
      outputDir,
      attachmentsDir: '_attachments',
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { 'Characters/NPCs': 'characters/npcs' },
    }, null, 2));

    build({ configPath });
    themeCss = fs.readFileSync(path.join(outputDir, 'css', 'theme.css'), 'utf8');
  });

  after(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('copies each listed font file into the output fonts/ directory, preserving its subpath', () => {
    // The full vault-relative subpath is mirrored under fonts/, not flattened to a
    // basename (#211 follow-up) — that's what prevents a basename collision between
    // two files organized under different subfolders.
    assert.ok(fs.existsSync(path.join(outputDir, 'fonts', '_attachments', 'fonts', 'Cinzel-Regular.woff2')));
    assert.ok(fs.existsSync(path.join(outputDir, 'fonts', '_attachments', 'fonts', 'Inter-Regular.woff2')));
  });

  it('copies the font bytes unchanged', () => {
    assert.strictEqual(
      fs.readFileSync(path.join(outputDir, 'fonts', '_attachments', 'fonts', 'Cinzel-Regular.woff2'), 'utf8'),
      'fake-woff2-bytes-cinzel',
    );
  });

  it('theme.css references the local fonts via @font-face, not a Google import', () => {
    assert.ok(!themeCss.includes('fonts.googleapis.com'));
    assert.ok(themeCss.includes('@font-face'));
    assert.ok(themeCss.includes("url('../fonts/_attachments/fonts/Cinzel-Regular.woff2')"), themeCss);
  });
});

// #211 follow-up: two font files that share a basename but live in different vault
// subfolders must both survive the copy — the old basename-only destination made the
// second file silently overwrite the first.
describe('theme.fonts.source: local does not collide two files sharing a basename (#211 follow-up)', () => {
  let work, outputDir, themeCss;

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-theme-fonts-collide-'));
    const vault = path.join(work, 'vault');
    outputDir = path.join(work, 'docs');

    write(vault, '_meta/vault-config.md', [
      '---',
      'publish:',
      '  theme:',
      '    fonts:',
      '      source: local',
      '      files:',
      '        - family: Cinzel',
      '          path: fonts/Cinzel/Regular.woff2',
      '        - family: Inter',
      '          path: fonts/Inter/Regular.woff2',
      '---',
      '',
    ].join('\n'));
    write(vault, 'fonts/Cinzel/Regular.woff2', 'cinzel-bytes');
    write(vault, 'fonts/Inter/Regular.woff2', 'inter-bytes');
    write(vault, 'Characters/NPCs/Someone.md', '---\ntype: npc\n---\n\n# Someone\n');

    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Theme Fonts Collide',
      siteUrl: 'https://example.github.io/theme-fonts-collide',
      vaultPath: vault,
      outputDir,
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { 'Characters/NPCs': 'characters/npcs' },
    }, null, 2));

    build({ configPath });
    themeCss = fs.readFileSync(path.join(outputDir, 'css', 'theme.css'), 'utf8');
  });

  after(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('copies both files to their own distinct subpaths', () => {
    const cinzel = path.join(outputDir, 'fonts', 'fonts', 'Cinzel', 'Regular.woff2');
    const inter = path.join(outputDir, 'fonts', 'fonts', 'Inter', 'Regular.woff2');
    assert.ok(fs.existsSync(cinzel));
    assert.ok(fs.existsSync(inter));
    assert.strictEqual(fs.readFileSync(cinzel, 'utf8'), 'cinzel-bytes');
    assert.strictEqual(fs.readFileSync(inter, 'utf8'), 'inter-bytes');
  });

  it('theme.css references both distinct subpaths', () => {
    assert.ok(themeCss.includes("url('../fonts/fonts/Cinzel/Regular.woff2')"), themeCss);
    assert.ok(themeCss.includes("url('../fonts/fonts/Inter/Regular.woff2')"), themeCss);
  });
});

// #211 follow-up: a mistyped files[].path (extension not a real font format) must be
// rejected — not copied into the public output — with a clear warning.
describe('theme.fonts.source: local rejects a non-font file extension', () => {
  it('does not copy a mistyped path and warns instead', () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-theme-fonts-badext-'));
    const vault = path.join(work, 'vault');
    const outputDir = path.join(work, 'docs');

    write(vault, '_meta/vault-config.md', [
      '---',
      'publish:',
      '  theme:',
      '    fonts:',
      '      source: local',
      '      files:',
      '        - family: Mistyped',
      '          path: _meta/gm-plans.md',
      '---',
      '',
    ].join('\n'));
    write(vault, '_meta/gm-plans.md', '---\ntype: meta\n---\n\nSecret GM plans.\n');
    write(vault, 'Characters/NPCs/Someone.md', '---\ntype: npc\n---\n\n# Someone\n');

    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Theme Fonts Bad Ext',
      siteUrl: 'https://example.github.io/theme-fonts-bad-ext',
      vaultPath: vault,
      outputDir,
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { 'Characters/NPCs': 'characters/npcs' },
    }, null, 2));

    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try {
      build({ configPath });
    } finally {
      console.warn = orig;
    }

    assert.ok(!fs.existsSync(path.join(outputDir, 'fonts', '_meta', 'gm-plans.md')));
    assert.ok(warns.some((w) => w.includes('not a supported font file')), warns.join(' | '));
    fs.rmSync(work, { recursive: true, force: true });
  });
});

describe('theme.fonts default source stays google (regression guard)', () => {
  let work, outputDir, themeCss;

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-theme-fonts-google-'));
    const vault = path.join(work, 'vault');
    outputDir = path.join(work, 'docs');

    write(vault, '_meta/vault-config.md',
      '---\npublish:\n  theme:\n    fonts:\n      heading: Cinzel\n---\n');
    write(vault, 'Characters/NPCs/Someone.md', '---\ntype: npc\n---\n\n# Someone\n');

    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Theme Fonts Google',
      siteUrl: 'https://example.github.io/theme-fonts-google',
      vaultPath: vault,
      outputDir,
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { 'Characters/NPCs': 'characters/npcs' },
    }, null, 2));

    build({ configPath });
    themeCss = fs.readFileSync(path.join(outputDir, 'css', 'theme.css'), 'utf8');
  });

  after(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('still emits the Google Fonts import with no source set', () => {
    assert.ok(themeCss.includes('fonts.googleapis.com'));
  });

  it('writes no fonts/ directory when no local files are configured', () => {
    assert.ok(!fs.existsSync(path.join(outputDir, 'fonts')));
  });
});
