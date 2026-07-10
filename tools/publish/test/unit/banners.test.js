const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveBanner, renderBanner, normalizeEntry, sourceFolderFor, findConventionBanner, defaultAlt,
} = require('../../lib/banners');

describe('normalizeEntry', () => {
  it('accepts a bare path as the image', () => {
    assert.deepStrictEqual(normalizeEntry('_attachments/map.svg'), {
      image: '_attachments/map.svg', link: null, alt: null,
    });
  });

  it('accepts the full object form', () => {
    assert.deepStrictEqual(normalizeEntry({ image: 'a.webp', link: 'a.svg', alt: 'Star chart' }), {
      image: 'a.webp', link: 'a.svg', alt: 'Star chart',
    });
  });

  it('rejects anything without an image', () => {
    for (const raw of [null, undefined, '', '   ', 0, {}, { link: 'a.svg' }, []]) {
      assert.strictEqual(normalizeEntry(raw), null, `${JSON.stringify(raw)} should not resolve`);
    }
  });
});

describe('sourceFolderFor', () => {
  const folderMap = { 'Locations': 'locations', 'Factions & Organizations': 'factions' };

  it('inverts the folder map', () => {
    assert.strictEqual(sourceFolderFor('locations', folderMap), 'Locations');
    assert.strictEqual(sourceFolderFor('factions', folderMap), 'Factions & Organizations');
  });

  it('returns null for a dir no folder maps to, and for no map at all', () => {
    assert.strictEqual(sourceFolderFor('creatures', folderMap), null);
    assert.strictEqual(sourceFolderFor('locations', undefined), null);
  });
});

describe('defaultAlt', () => {
  it('humanizes the filename', () => {
    assert.strictEqual(defaultAlt('/v/Locations/_banner.svg'), 'banner');
    assert.strictEqual(defaultAlt('_attachments/sector-map_wide.webp'), 'sector map wide');
  });
});

describe('findConventionBanner / resolveBanner', () => {
  let vault;
  before(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-banner-'));
    fs.mkdirSync(path.join(vault, 'Locations'), { recursive: true });
    fs.mkdirSync(path.join(vault, 'Creatures'), { recursive: true });
    fs.mkdirSync(path.join(vault, '_attachments'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'Locations/_banner.svg'), '<svg/>');
    fs.writeFileSync(path.join(vault, 'Locations/_banner.png'), 'raster');
    fs.writeFileSync(path.join(vault, '_attachments/chosen.webp'), 'x');
  });
  after(() => fs.rmSync(vault, { recursive: true, force: true }));

  const folderMap = { 'Locations': 'locations', 'Creatures': 'creatures' };

  it('finds the conventional _banner in the section folder', () => {
    assert.strictEqual(findConventionBanner(vault, 'Locations'), 'Locations/_banner.svg');
  });

  it('prefers svg over a raster sibling', () => {
    // Both exist; svg wins because it is first in the extension preference order.
    assert.strictEqual(findConventionBanner(vault, 'Locations'), 'Locations/_banner.svg');
  });

  it('returns null for a folder with no banner, or no folder', () => {
    assert.strictEqual(findConventionBanner(vault, 'Creatures'), null);
    assert.strictEqual(findConventionBanner(vault, null), null);
  });

  it('resolves the convention when nothing is configured', () => {
    const b = resolveBanner('locations', { vaultPath: vault, folderMap, banners: {} });
    assert.deepStrictEqual(b, { image: 'Locations/_banner.svg', link: null, alt: null });
  });

  it('lets config override the convention', () => {
    const banners = { locations: { image: '_attachments/chosen.webp', link: '_attachments/x.svg' } };
    const b = resolveBanner('locations', { vaultPath: vault, folderMap, banners });
    assert.strictEqual(b.image, '_attachments/chosen.webp');
    assert.strictEqual(b.link, '_attachments/x.svg');
  });

  it('is null for a section with neither config nor convention', () => {
    assert.strictEqual(resolveBanner('creatures', { vaultPath: vault, folderMap, banners: {} }), null);
  });
});

describe('renderBanner', () => {
  it('inlines an SVG so its internal <a> links stay clickable', () => {
    const svg = '<svg><a href="../locations/corwin.html"><circle/></a></svg>';
    const html = renderBanner({ svg });
    assert.ok(html.includes('section-banner-inline'));
    assert.ok(html.includes('<a href="../locations/corwin.html">'), 'internal link survives');
    assert.ok(!html.includes('<img'), 'an <img> would not run the internal links');
  });

  it('never wraps an inlined SVG in an outer anchor', () => {
    const html = renderBanner({ svg: '<svg><a href="x.html"/></svg>' });
    assert.ok(!html.includes('section-banner-link'),
      'an outer <a> would swallow the SVG\'s own links');
  });

  it('renders a raster as a plain img when there is no link target', () => {
    const html = renderBanner({ imageHref: '../images/banners/map.webp', alt: 'Star chart' });
    assert.ok(html.includes('<img src="../images/banners/map.webp"'));
    assert.ok(html.includes('alt="Star chart"'));
    assert.ok(!html.includes('<a '));
  });

  it('wraps the img in an anchor when a link target is given', () => {
    const html = renderBanner({
      imageHref: '../images/banners/map.webp',
      linkHref: '../images/banners/map.svg',
      alt: 'Star chart',
    });
    assert.ok(html.includes('<a class="section-banner-link" href="../images/banners/map.svg">'));
    assert.ok(html.includes('<img src="../images/banners/map.webp"'));
  });

  it('URL-encodes hrefs with spaces', () => {
    const html = renderBanner({ imageHref: '../images/banners/Sector 7G.webp', alt: '' });
    assert.ok(html.includes('Sector%207G.webp'));
  });

  it('escapes the alt text', () => {
    const html = renderBanner({ imageHref: 'a.webp', alt: '"><script>alert(1)</script>' });
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('renders nothing without an svg or an image', () => {
    assert.strictEqual(renderBanner({}), '');
    assert.strictEqual(renderBanner({ linkHref: 'a.svg' }), '');
  });
});
