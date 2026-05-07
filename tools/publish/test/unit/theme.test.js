const { describe, it } = require('node:test');
const assert = require('node:assert');
const { generateThemeCSS, resolveGenrePreset, GENRE_ALIASES } = require('../../lib/theme');

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
});
