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

// #211: a custom font always pulled from fonts.googleapis.com with no way to opt out —
// every visitor's browser leaked its IP to Google on every page load. theme.fonts.source:
// 'local' turns that import off and emits @font-face for self-hosted files instead.
describe('generateThemeCSS — theme.fonts.source: local (#211)', () => {
  it('emits no Google Fonts import when source is local', () => {
    const css = generateThemeCSS({ fonts: { heading: 'Cinzel', source: 'local' } });
    assert.ok(!css.includes('fonts.googleapis.com'));
  });

  it('still defaults to the Google import when source is unset (unchanged behaviour)', () => {
    const css = generateThemeCSS({ fonts: { heading: 'Cinzel' } });
    assert.ok(css.includes('fonts.googleapis.com'));
  });

  it('still defaults to Google when source is explicitly "google"', () => {
    const css = generateThemeCSS({ fonts: { heading: 'Cinzel', source: 'google' } });
    assert.ok(css.includes('fonts.googleapis.com'));
  });

  it('emits an @font-face rule per configured local file', () => {
    const css = generateThemeCSS({
      fonts: {
        heading: 'Cinzel',
        body: 'Inter',
        source: 'local',
        files: [
          { family: 'Cinzel', path: '_attachments/fonts/Cinzel-Regular.woff2' },
          { family: 'Inter', path: '_attachments/fonts/Inter-Regular.woff2', weight: 400, style: 'normal' },
        ],
      },
    });
    assert.ok(css.includes("@font-face"));
    assert.ok(css.includes("font-family: 'Cinzel'"));
    // The full vault-relative subpath is kept under fonts/, not just the basename
    // (#211 follow-up) — build.js copies to this exact same path.
    assert.ok(css.includes("url('../fonts/_attachments/fonts/Cinzel-Regular.woff2') format('woff2')"), css);
    assert.ok(css.includes("font-family: 'Inter'"));
    assert.ok(css.includes("url('../fonts/_attachments/fonts/Inter-Regular.woff2') format('woff2')"), css);
    assert.ok(!css.includes('fonts.googleapis.com'));
  });

  it('keeps distinct subpaths for two files that share a basename (collision guard, #211 follow-up)', () => {
    const css = generateThemeCSS({
      fonts: {
        source: 'local',
        files: [
          { family: 'Cinzel', path: 'fonts/Cinzel/Regular.woff2' },
          { family: 'Inter', path: 'fonts/Inter/Regular.woff2' },
        ],
      },
    });
    assert.ok(css.includes("url('../fonts/fonts/Cinzel/Regular.woff2')"), css);
    assert.ok(css.includes("url('../fonts/fonts/Inter/Regular.woff2')"), css);
  });

  it('rejects a files[] path with an unsupported extension, with a warning, and emits no rule for it', () => {
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    let css;
    try {
      css = generateThemeCSS({
        fonts: {
          source: 'local',
          files: [
            { family: 'Mistyped', path: '_meta/vault-config.md' },
            { family: 'Cinzel', path: 'fonts/Cinzel.woff2' },
          ],
        },
      });
    } finally {
      console.warn = orig;
    }
    assert.ok(!css.includes('Mistyped'), css);
    assert.ok(!css.includes('vault-config.md'), css);
    assert.ok(css.includes('Cinzel'), css);
    assert.ok(warns.some((w) => w.includes('not a supported font file')), warns.join(' | '));
  });

  it('honours a custom weight/style on a font-face rule', () => {
    const css = generateThemeCSS({
      fonts: {
        source: 'local',
        files: [{ family: 'Cinzel', path: 'fonts/Cinzel-Bold.woff2', weight: 700, style: 'italic' }],
      },
    });
    assert.ok(css.includes('font-weight: 700'));
    assert.ok(css.includes('font-style: italic'));
  });

  it('emits no import at all when source is local with no files', () => {
    const css = generateThemeCSS({ fonts: { heading: 'system-ui', body: 'system-ui', source: 'local' } });
    assert.ok(!css.includes('fonts.googleapis.com'));
    assert.ok(!css.includes('@font-face'));
  });

  it('picks the right format() for woff/ttf/otf extensions', () => {
    const css = generateThemeCSS({
      fonts: {
        source: 'local',
        files: [
          { family: 'A', path: 'fonts/a.woff' },
          { family: 'B', path: 'fonts/b.ttf' },
          { family: 'C', path: 'fonts/c.otf' },
        ],
      },
    });
    assert.ok(css.includes("format('woff')"));
    assert.ok(css.includes("format('truetype')"));
    assert.ok(css.includes("format('opentype')"));
  });

  it('applies source: local under an active genre preset too', () => {
    const css = generateThemeCSS({
      fonts: { heading: 'Cinzel', source: 'local', files: [{ family: 'Cinzel', path: 'fonts/Cinzel.woff2' }] },
      genre: 'fantasy',
      palette: null,
    });
    assert.ok(!css.includes('fonts.googleapis.com'));
    assert.ok(css.includes('@font-face'));
    assert.ok(css.includes("--font-heading: 'Cinzel', serif"));
  });

  // CodeRabbit (PR #234): the "no --font-heading/--font-body overrides" branch returned
  // before fontsPreamble ever ran, so a GM self-hosting the PRESET's own font (e.g.
  // scifi's Rajdhani) under files — with no heading/body override at all, since they
  // want the preset's own family name, not a replacement — got no @font-face rule.
  // copyGenreCSS already strips the preset's Google import for source: local, so the
  // font silently fell back to the next family in the stack.
  it('emits @font-face for a genre preset with source: local and files but no heading/body override', () => {
    const css = generateThemeCSS({
      fonts: { source: 'local', files: [{ family: 'Rajdhani', path: 'fonts/Rajdhani.woff2' }] },
      genre: 'scifi',
      palette: null,
    });
    assert.ok(!css.includes('fonts.googleapis.com'), css);
    assert.ok(css.includes('@font-face'), css);
    assert.ok(css.includes("font-family: 'Rajdhani'"), css);
    assert.ok(css.includes("url('../fonts/fonts/Rajdhani.woff2')"), css);
  });

  it('does not mistake the source/files keys for font family values (regression guard)', () => {
    // googleFontsImport used to iterate Object.values(fonts), which would have picked up
    // "local"/"google" (the source string) and the files array as if they were families.
    const css = generateThemeCSS({ fonts: { heading: 'Cinzel', source: 'google', files: [] } });
    assert.ok(!css.includes('family=local'));
    assert.ok(!css.includes('family=google'));
  });
});
