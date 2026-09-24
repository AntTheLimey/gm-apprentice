const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');
const { VALID_PRESETS } = require('../../lib/theme');

function write(base, rel, body) {
  const full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// #211 follow-up: a genre preset's own CSS can hardcode a Google Fonts @import for its
// default look (scifi's Rajdhani), independent of theme.fonts.heading/body — that import
// lives in the static css/themes/<preset>.css file, so theme.js's fontsPreamble (which
// only ever sees the GM's configured fonts, not the preset's own baked-in ones) never
// touches it. theme.fonts.source: local must mean NO request to Google anywhere in the
// built output, not just in theme.css.
describe('every genre preset with theme.fonts.source: local ships zero Google Fonts references', () => {
  const dirsToClean = [];

  after(() => {
    for (const d of dirsToClean) fs.rmSync(d, { recursive: true, force: true });
  });

  for (const preset of VALID_PRESETS) {
    it(`${preset}: no output file contains googleapis or gstatic`, () => {
      const work = fs.mkdtempSync(path.join(os.tmpdir(), `gm-genre-local-${preset}-`));
      dirsToClean.push(work);
      const vault = path.join(work, 'vault');
      const outputDir = path.join(work, 'docs');

      write(vault, '_meta/vault-config.md', [
        '---',
        'publish:',
        '  theme:',
        `    genre: ${preset}`,
        '    fonts:',
        '      source: local',
        '---',
        '',
      ].join('\n'));
      write(vault, 'Characters/NPCs/Someone.md', '---\ntype: npc\n---\n\n# Someone\n');

      const configPath = path.join(work, 'vault.config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        siteTitle: `${preset} Local Fonts`,
        siteUrl: `https://example.github.io/${preset}-local-fonts`,
        vaultPath: vault,
        outputDir,
        excludeDirs: ['_meta', '_Templates'],
        folderMap: { 'Characters/NPCs': 'characters/npcs' },
      }, null, 2));

      build({ configPath });

      const files = walk(outputDir);
      assert.ok(files.length > 0, 'build produced no files');
      for (const f of files) {
        // Binary-safe: image/font fixtures in other tests are fake text, but a real
        // build's images/lunr bundle could contain non-UTF8 bytes — read as latin1
        // (lossless byte-for-byte) so a search for an ASCII substring is still valid.
        const content = fs.readFileSync(f, 'latin1');
        assert.ok(!content.includes('googleapis'), `${f} contains "googleapis"`);
        assert.ok(!content.includes('gstatic'), `${f} contains "gstatic"`);
      }
    });
  }

  it('scifi WITHOUT source: local still ships the Rajdhani import (regression guard)', () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-genre-local-scifi-control-'));
    dirsToClean.push(work);
    const vault = path.join(work, 'vault');
    const outputDir = path.join(work, 'docs');

    write(vault, '_meta/vault-config.md', '---\npublish:\n  theme:\n    genre: scifi\n---\n');
    write(vault, 'Characters/NPCs/Someone.md', '---\ntype: npc\n---\n\n# Someone\n');

    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Scifi Control',
      siteUrl: 'https://example.github.io/scifi-control',
      vaultPath: vault,
      outputDir,
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { 'Characters/NPCs': 'characters/npcs' },
    }, null, 2));

    build({ configPath });
    const themeGenreCss = fs.readFileSync(path.join(outputDir, 'css', 'themes', 'scifi.css'), 'utf8');
    assert.ok(themeGenreCss.includes('googleapis'), 'default (google) behaviour must be unchanged');
  });
});
