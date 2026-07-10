const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../../lib/build');

// A star map whose nodes link to entity pages — the case that forces inlining rather than
// an <img>, since an <img> would never run these anchors.
const STAR_MAP_SVG = '<svg viewBox="0 0 10 10"><a href="../locations/corwin-system.html"><circle cx="5" cy="5" r="2"/></a></svg>';

function setupSite({ banners, conventionFile, linkFile }) {
  const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-banners-'));
  const vaultPath = path.join(siteDir, 'vault');
  const outputDir = path.join(siteDir, 'docs');

  fs.mkdirSync(path.join(vaultPath, '_meta'), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, 'Locations'), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, '_attachments'), { recursive: true });

  fs.writeFileSync(path.join(vaultPath, '_meta/vault-config.md'),
    banners ? `---\npublish:\n  banners:\n${banners}\n---\n` : '---\n---\n');

  if (conventionFile) fs.writeFileSync(path.join(vaultPath, 'Locations', conventionFile), STAR_MAP_SVG);
  fs.writeFileSync(path.join(vaultPath, '_attachments/Sector Map.webp'), 'fake-webp-bytes');
  if (linkFile) fs.writeFileSync(path.join(vaultPath, '_attachments/Sector Map.svg'), STAR_MAP_SVG);

  fs.writeFileSync(path.join(vaultPath, 'Locations/Corwin System.md'),
    '---\ntype: location\nlocation_type: system\n---\n\n# Corwin System\n\nA star system.\n');

  const configPath = path.join(siteDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    vaultPath, outputDir,
    attachmentsDir: '_attachments',
    siteTitle: 'Banner Site',
    siteUrl: 'https://example.github.io/banner-site',
    excludeDirs: ['_meta'],
    folderMap: { 'Locations': 'locations' },
  }, null, 2));

  build({ configPath });
  return { siteDir, outputDir };
}

const locationsIndex = outputDir => fs.readFileSync(path.join(outputDir, 'locations/index.html'), 'utf8');

describe('section index banners', () => {
  describe('conventional Locations/_banner.svg', () => {
    let outputDir;
    before(() => { ({ outputDir } = setupSite({ conventionFile: '_banner.svg' })); });

    it('is picked up with no configuration at all', () => {
      assert.ok(locationsIndex(outputDir).includes('section-banner'));
    });

    it('is inlined, so the map nodes keep linking to entity pages', () => {
      const html = locationsIndex(outputDir);
      assert.ok(html.includes('section-banner-inline'));
      assert.ok(html.includes('<a href="../locations/corwin-system.html">'), 'internal link survives');
      assert.ok(!html.includes('<img src="../images/banners/locations/_banner.svg"'), 'must not degrade to an <img>');
    });

    it('sits above the page title', () => {
      const html = locationsIndex(outputDir);
      assert.ok(html.indexOf('section-banner') < html.indexOf('page-title'));
    });

    it('does not put a banner on a section that has none', () => {
      const characters = fs.readFileSync(path.join(outputDir, 'characters/index.html'), 'utf8');
      assert.ok(!characters.includes('section-banner'));
    });
  });

  describe('configured raster linking to the full-size SVG', () => {
    let outputDir;
    before(() => {
      ({ outputDir } = setupSite({
        linkFile: true,
        banners: [
          '    locations:',
          '      image: _attachments/Sector Map.webp',
          '      link: _attachments/Sector Map.svg',
          '      alt: Sector 7-G star chart',
        ].join('\n'),
      }));
    });

    it('copies both assets into the output', () => {
      assert.ok(fs.existsSync(path.join(outputDir, 'images/banners/locations/Sector Map.webp')));
      assert.ok(fs.existsSync(path.join(outputDir, 'images/banners/locations/Sector Map.svg')));
    });

    it('renders a clickable img, URL-encoded, at the right relative depth', () => {
      const html = locationsIndex(outputDir);
      assert.ok(html.includes('<a class="section-banner-link" href="../images/banners/locations/Sector%20Map.svg">'));
      assert.ok(html.includes('<img src="../images/banners/locations/Sector%20Map.webp"'));
      assert.ok(html.includes('alt="Sector 7-G star chart"'));
    });

    it('does not inline, because a link target was declared', () => {
      assert.ok(!locationsIndex(outputDir).includes('section-banner-inline'));
    });
  });

  describe('config overrides the convention', () => {
    let outputDir;
    before(() => {
      ({ outputDir } = setupSite({
        conventionFile: '_banner.svg',
        banners: '    locations: _attachments/Sector Map.webp',
      }));
    });

    it('uses the configured image, not the conventional file', () => {
      const html = locationsIndex(outputDir);
      assert.ok(html.includes('images/banners/locations/Sector%20Map.webp'));
      assert.ok(!html.includes('section-banner-inline'));
    });

    it('derives alt text from the filename when none is given', () => {
      assert.ok(locationsIndex(outputDir).includes('alt="Sector Map"'));
    });
  });

  describe('two sections whose banners share a filename', () => {
    // The conventional basename is identical in every section folder, so this is the common
    // case, not a corner one: unnamespaced, whichever copied last would show on both pages.
    let outputDir;
    before(() => {
      const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-banner-clash-'));
      const vaultPath = path.join(siteDir, 'vault');
      outputDir = path.join(siteDir, 'docs');
      for (const folder of ['_meta', 'Locations', 'Creatures']) {
        fs.mkdirSync(path.join(vaultPath, folder), { recursive: true });
      }
      fs.writeFileSync(path.join(vaultPath, '_meta/vault-config.md'), '---\n---\n');
      // Raster, not SVG: an SVG with no link is inlined and never copied.
      fs.writeFileSync(path.join(vaultPath, 'Locations/_banner.png'), 'LOCATIONS-BYTES');
      fs.writeFileSync(path.join(vaultPath, 'Creatures/_banner.png'), 'CREATURES-BYTES');
      fs.writeFileSync(path.join(vaultPath, 'Locations/Corwin.md'), '---\ntype: location\n---\n# Corwin\n');
      fs.writeFileSync(path.join(vaultPath, 'Creatures/Xeno.md'), '---\ntype: creature\n---\n# Xeno\n');

      const configPath = path.join(siteDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        vaultPath, outputDir, attachmentsDir: '_attachments',
        siteTitle: 'Clash', siteUrl: 'https://example.github.io/clash',
        excludeDirs: ['_meta'],
        folderMap: { 'Locations': 'locations', 'Creatures': 'creatures' },
      }, null, 2));
      build({ configPath });
    });

    it('keeps both assets on disk instead of one overwriting the other', () => {
      const locations = path.join(outputDir, 'images/banners/locations/_banner.png');
      const creatures = path.join(outputDir, 'images/banners/creatures/_banner.png');
      assert.ok(fs.existsSync(locations), 'locations banner survives');
      assert.ok(fs.existsSync(creatures), 'creatures banner survives');
      assert.strictEqual(fs.readFileSync(locations, 'utf8'), 'LOCATIONS-BYTES');
      assert.strictEqual(fs.readFileSync(creatures, 'utf8'), 'CREATURES-BYTES');
    });

    it('points each index at its own banner', () => {
      const locations = locationsIndex(outputDir);
      const creatures = fs.readFileSync(path.join(outputDir, 'creatures/index.html'), 'utf8');
      assert.ok(locations.includes('src="../images/banners/locations/_banner.png"'));
      assert.ok(creatures.includes('src="../images/banners/creatures/_banner.png"'));
    });
  });

  describe('bad banner paths', () => {
    it('skips a banner that escapes the vault, and still builds', () => {
      const { outputDir } = setupSite({ banners: '    locations: ../../../../etc/passwd' });
      const html = locationsIndex(outputDir);
      assert.ok(!html.includes('section-banner'), 'traversal must not produce a banner');
      assert.ok(!fs.existsSync(path.join(outputDir, 'images/banners')), 'nothing copied out of the vault');
    });

    it('skips a banner whose file is missing, and still builds', () => {
      const { outputDir } = setupSite({ banners: '    locations: _attachments/nope.svg' });
      assert.ok(!locationsIndex(outputDir).includes('section-banner'));
    });
  });
});
