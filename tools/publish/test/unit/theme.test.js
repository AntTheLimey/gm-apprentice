const { describe, it } = require('node:test');
const assert = require('node:assert');
const { generateThemeCSS, resolveGenrePreset, GENRE_ALIASES, VALID_PRESETS } = require('../../lib/theme');

describe('resolveGenrePreset', () => {
  it('returns preset filename for exact genre match', () => {
    assert.strictEqual(resolveGenrePreset('horror'), 'horror');
    assert.strictEqual(resolveGenrePreset('fantasy'), 'fantasy');
    assert.strictEqual(resolveGenrePreset('noir'), 'noir');
    assert.strictEqual(resolveGenrePreset('military'), 'military');
  });

  it('resolves genre aliases', () => {
    assert.strictEqual(resolveGenrePreset('gothic'), 'horror');
    assert.strictEqual(resolveGenrePreset('cthulhu'), 'horror');
    assert.strictEqual(resolveGenrePreset('adventure'), 'fantasy');
    assert.strictEqual(resolveGenrePreset('industrial'), 'noir');
    assert.strictEqual(resolveGenrePreset('heist'), 'noir');
    assert.strictEqual(resolveGenrePreset('tactical'), 'military');
    assert.strictEqual(resolveGenrePreset('modern'), 'military');
  });

  it('returns null for unknown genre', () => {
    assert.strictEqual(resolveGenrePreset('steampunk'), null);
    assert.strictEqual(resolveGenrePreset(null), null);
    assert.strictEqual(resolveGenrePreset(undefined), null);
  });

  it('resolves scifi aliases', () => {
    for (const alias of ['scifi', 'sci-fi', 'science-fiction', 'space', 'space-opera', 'space-noir']) {
      assert.strictEqual(resolveGenrePreset(alias), 'scifi', alias);
    }
  });

  it('scifi is a valid preset with a css file', () => {
    const fs = require('fs');
    const path = require('path');
    assert.ok(VALID_PRESETS.has('scifi'));
    const css = fs.readFileSync(path.join(__dirname, '../../css/themes/scifi.css'), 'utf-8');
    assert.ok(css.includes('--accent: #f0a23a'), 'K-star amber accent');
    assert.ok(css.includes('prefers-color-scheme: light'), 'light variant present');
  });
});

describe('generateThemeCSS', () => {
  it('returns empty :root when no overrides', () => {
    const css = generateThemeCSS({});
    assert.ok(css.includes(':root'));
  });

  it('generates palette overrides', () => {
    const css = generateThemeCSS({ palette: { accent: '#ff4444' } });
    assert.ok(css.includes('--accent: #ff4444'));
  });

  it('generates font overrides', () => {
    const css = generateThemeCSS({ fonts: { heading: 'Cinzel' } });
    assert.ok(css.includes("--font-heading: 'Cinzel', serif"));
  });

  it('adds Google Fonts import for non-system fonts', () => {
    const css = generateThemeCSS({ fonts: { heading: 'Cinzel' } });
    assert.ok(css.includes('fonts.googleapis.com'));
    assert.ok(css.includes('Cinzel'));
  });

  it('skips Google Fonts import for system fonts', () => {
    const css = generateThemeCSS({ fonts: { heading: 'system-ui' } });
    assert.ok(!css.includes('fonts.googleapis.com'));
  });

  it('ignores genre (handled by CSS file selection, not generation)', () => {
    const css = generateThemeCSS({ genre: 'horror' });
    assert.ok(!css.includes('#1a1410'));
  });

  it('does not let default generic fonts clobber a genre preset', () => {
    const css = generateThemeCSS({
      fonts: { heading: 'system-ui', body: 'system-ui' },
      genre: 'scifi',
      palette: null,
    });
    assert.strictEqual(css, '/* Genre preset active — no overrides */\n');
  });

  it('lets an explicit non-generic font override a genre preset, per-property', () => {
    const css = generateThemeCSS({
      fonts: { heading: 'Cinzel', body: 'system-ui' },
      genre: 'fantasy',
      palette: null,
    });
    assert.ok(css.includes("--font-heading: 'Cinzel', serif"));
    assert.ok(css.includes('fonts.googleapis.com'));
    assert.ok(css.includes('Cinzel'));
    assert.ok(!css.includes('--font-body'));
  });
});
