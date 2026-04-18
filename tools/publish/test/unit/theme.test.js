const { describe, it } = require('node:test');
const assert = require('node:assert');
const { generateThemeCSS, GENRE_PRESETS } = require('../../lib/theme');

describe('GENRE_PRESETS', () => {
  it('has presets for all documented genres', () => {
    const genres = ['horror', 'high fantasy', 'noir', 'sci-fi', 'pulp', 'historical'];
    for (const genre of genres) {
      assert.ok(GENRE_PRESETS[genre], `Missing preset for "${genre}"`);
    }
  });

  it('each preset has palette and fonts', () => {
    for (const [name, preset] of Object.entries(GENRE_PRESETS)) {
      assert.ok(preset.palette, `${name} missing palette`);
      assert.ok(preset.palette.primary, `${name} missing palette.primary`);
      assert.ok(preset.fonts, `${name} missing fonts`);
      assert.ok(preset.fonts.heading, `${name} missing fonts.heading`);
      assert.ok(preset.fonts.body, `${name} missing fonts.body`);
    }
  });
});

describe('generateThemeCSS', () => {
  it('generates CSS with custom properties from palette', () => {
    const config = {
      palette: { primary: '#222', accent: '#f00', background: '#fff', text: '#000' },
      fonts: { heading: 'Georgia', body: 'Arial' },
    };
    const css = generateThemeCSS(config);
    assert.ok(css.includes('--theme-primary: #222'));
    assert.ok(css.includes('--theme-accent: #f00'));
    assert.ok(css.includes('--theme-bg: #fff'));
    assert.ok(css.includes('--theme-text: #000'));
  });

  it('includes Google Fonts import for non-system fonts', () => {
    const config = {
      palette: { primary: '#000', accent: '#000', background: '#fff', text: '#000' },
      fonts: { heading: 'Cinzel', body: 'Libre Baskerville' },
    };
    const css = generateThemeCSS(config);
    assert.ok(css.includes('@import'));
    assert.ok(css.includes('Cinzel'));
    assert.ok(css.includes('Libre+Baskerville'));
  });

  it('skips Google Fonts import for system-ui', () => {
    const config = {
      palette: { primary: '#000', accent: '#000', background: '#fff', text: '#000' },
      fonts: { heading: 'system-ui', body: 'system-ui' },
    };
    const css = generateThemeCSS(config);
    assert.ok(!css.includes('@import'));
  });

  it('uses genre preset when genre is provided and no overrides', () => {
    const config = { genre: 'horror' };
    const css = generateThemeCSS(config);
    assert.ok(css.includes(GENRE_PRESETS['horror'].palette.primary));
  });

  it('palette overrides take precedence over genre preset', () => {
    const config = {
      genre: 'horror',
      palette: { primary: '#custom' },
    };
    const css = generateThemeCSS(config);
    assert.ok(css.includes('--theme-primary: #custom'));
  });
});
