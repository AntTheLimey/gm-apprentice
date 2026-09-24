const GENRE_ALIASES = {
  horror: 'horror',
  gothic: 'horror',
  cthulhu: 'horror',
  fantasy: 'fantasy',
  adventure: 'fantasy',
  noir: 'noir',
  industrial: 'noir',
  heist: 'noir',
  military: 'military',
  tactical: 'military',
  modern: 'military',
  scifi: 'scifi',
  'sci-fi': 'scifi',
  'science-fiction': 'scifi',
  space: 'scifi',
  'space-opera': 'scifi',
  'space-noir': 'scifi',
};

const VALID_PRESETS = new Set(['horror', 'fantasy', 'noir', 'military', 'scifi']);

const GENERIC_FAMILIES = new Set([
  'system-ui', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
]);

function resolveGenrePreset(genre) {
  if (!genre) return null;
  const key = String(genre).toLowerCase().trim();
  return GENRE_ALIASES[key] || null;
}

function cssFontValue(font, fallback) {
  if (GENERIC_FAMILIES.has(font)) return `${font}, ${fallback}`;
  return `'${font}', ${fallback}`;
}

function googleFontsImport(fonts) {
  const toImport = ['heading', 'body']
    .map(k => fonts[k])
    .filter(f => f && !GENERIC_FAMILIES.has(f))
    .filter((v, i, a) => a.indexOf(v) === i);
  if (toImport.length === 0) return '';
  const families = toImport.map(f => `family=${f.replace(/ /g, '+')}`).join('&');
  return `@import url('https://fonts.googleapis.com/css2?${families}&display=swap');\n\n`;
}

const FONT_FORMATS = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };

// Normalizes a theme.fonts.files[].path into the path used both as the @font-face src
// (relative to css/theme.css, under "../fonts/") and as the copy destination under the
// output fonts/ directory. The FULL relative path is kept, not just the basename: two
// fonts organized under subfolders that happen to share a filename (fonts/Cinzel/
// Regular.woff2 and fonts/Inter/Regular.woff2) must not collide by both collapsing to
// "Regular.woff2" (#211 follow-up). build.js copies to this exact same path, so the
// emitted src always resolves to what actually got copied.
function fontOutputPath(rawPath) {
  return String(rawPath).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function fontExtension(outputPath) {
  return outputPath.includes('.') ? outputPath.split('.').pop().toLowerCase() : '';
}

// Every visitor's browser hitting fonts.googleapis.com directly leaks their IP to Google on
// every page load, with no config flag to stop it short of only using generic keywords
// (#211). `theme.fonts.source: local` opts out of that request entirely: the build copies
// each listed file into the output and this emits @font-face rules pointing at it instead
// of the Google Fonts import. A path whose extension isn't a real font format (a mistyped
// path, e.g. a GM's .md page) is warned about and skipped rather than emitted — build.js
// applies the same extension check before it will copy anything (#211 follow-up).
function localFontFaceCSS(files) {
  if (!Array.isArray(files) || files.length === 0) return '';
  const rules = files
    .filter(f => f && f.family && f.path)
    .map(f => {
      const outPath = fontOutputPath(f.path);
      const ext = fontExtension(outPath);
      if (!Object.prototype.hasOwnProperty.call(FONT_FORMATS, ext)) {
        console.warn(`theme: theme.fonts.files path "${f.path}" is not a supported font file (.woff2/.woff/.ttf/.otf) — skipped.`);
        return null;
      }
      const format = FONT_FORMATS[ext];
      const weight = f.weight || 400;
      const style = f.style || 'normal';
      return `@font-face {\n  font-family: '${f.family}';\n  src: url('../fonts/${outPath}') format('${format}');\n  font-weight: ${weight};\n  font-style: ${style};\n  font-display: swap;\n}`;
    })
    .filter(Boolean);
  if (rules.length === 0) return '';
  return rules.join('\n') + '\n\n';
}

// Chooses the Google import or the local @font-face rules, or neither (`source: local`
// with no `files`, or nothing custom configured at all). Shared by both generateThemeCSS
// branches so a genre preset with a custom font honours the same setting as a full palette.
function fontsPreamble(fonts) {
  if (fonts.source === 'local') return localFontFaceCSS(fonts.files);
  return googleFontsImport(fonts);
}

function parseHex(hex) {
  const raw = String(hex || '').trim().replace('#', '');
  const h = raw.length === 3
    ? raw.split('').map(ch => ch + ch).join('')
    : raw;
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  };
}

function luminance(hex) {
  const { r, g, b } = parseHex(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function mixColors(hex1, hex2, weight) {
  const c1 = parseHex(hex1);
  const c2 = parseHex(hex2);
  const w = weight;
  const r = Math.round(c1.r * (1 - w) + c2.r * w);
  const g = Math.round(c1.g * (1 - w) + c2.g * w);
  const b = Math.round(c1.b * (1 - w) + c2.b * w);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function generateThemeCSS(config) {
  const palette = config.palette;
  const fonts = config.fonts || {};

  // When a genre preset is active and no custom palette was provided,
  // preset CSS owns colors AND fonts; only explicitly-chosen (non-generic)
  // fonts override the preset.
  if (!palette && config.genre && resolveGenrePreset(config.genre)) {
    const fontVars = [];
    if (fonts.heading && !GENERIC_FAMILIES.has(fonts.heading)) fontVars.push(`  --font-heading: ${cssFontValue(fonts.heading, 'serif')};`);
    if (fonts.body && !GENERIC_FAMILIES.has(fonts.body)) fontVars.push(`  --font-body: ${cssFontValue(fonts.body, 'sans-serif')};`);
    // Computed even when there are no --font-* overrides to emit: with source: local,
    // the GM may be self-hosting the preset's OWN font (e.g. scifi's Rajdhani) under
    // its own family name, with no heading/body override at all — the preset's static
    // CSS already references that family name via its own --font-heading value, and
    // copyGenreCSS strips its Google import when source is local, so the @font-face
    // rule supplying the real file is the only thing left standing between that name
    // and a silent fallback (CodeRabbit review, PR #234). Returning before this ran
    // meant a files entry with no matching heading/body override never got emitted.
    const fontsImport = fontsPreamble(fonts);
    if (fontVars.length === 0) {
      return fontsImport
        ? `${fontsImport}/* Genre preset active — no --font-heading/--font-body overrides */\n`
        : '/* Genre preset active — no overrides */\n';
    }
    return `${fontsImport}:root {\n${fontVars.join('\n')}\n}\n`;
  }

  const pal = palette || {};
  const vars = [];

  const bg = pal.background || '#1a1f25';
  const text = pal.text || '#c9d1d9';
  const accent = pal.accent || '#58a6ff';
  const primary = pal.primary || '#0d1117';

  vars.push(`  --bg: ${bg};`);
  vars.push(`  --text: ${text};`);
  vars.push(`  --accent: ${accent};`);
  vars.push(`  --bg-header: ${primary};`);
  vars.push(`  --bg-hero: ${primary};`);

  const isLight = luminance(bg) > 0.5;

  if (isLight) {
    vars.push(`  --bg-card: ${mixColors(bg, '#ffffff', 0.6)};`);
    vars.push(`  --text-muted: ${mixColors(text, bg, 0.45)};`);
    vars.push(`  --border: ${mixColors(bg, text, 0.2)};`);
  } else {
    vars.push(`  --bg-card: ${mixColors(bg, '#ffffff', 0.05)};`);
    vars.push(`  --text-muted: ${mixColors(text, bg, 0.4)};`);
    vars.push(`  --border: ${mixColors(bg, '#ffffff', 0.12)};`);
  }

  vars.push(`  --accent-dim: ${hexToRgba(accent, isLight ? 0.08 : 0.15)};`);

  const headerIsLight = luminance(primary) > 0.5;
  vars.push(`  --text-on-header: ${headerIsLight ? '#1a1a1a' : '#e0e4e8'};`);
  vars.push(`  --text-muted-on-header: ${headerIsLight ? '#555' : '#9da5ae'};`);

  if (fonts.heading) vars.push(`  --font-heading: ${cssFontValue(fonts.heading, 'serif')};`);
  if (fonts.body) vars.push(`  --font-body: ${cssFontValue(fonts.body, 'sans-serif')};`);

  const fontsImport = fontsPreamble(fonts);

  return `${fontsImport}:root {\n${vars.join('\n')}\n}\n`;
}

module.exports = { generateThemeCSS, resolveGenrePreset, GENRE_ALIASES, VALID_PRESETS, FONT_FORMATS, fontOutputPath };
