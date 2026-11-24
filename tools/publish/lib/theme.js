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

function cssFontValue(font, fallback) {
  if (GENERIC_FAMILIES.has(font)) return `${font}, ${fallback}`;
  return `'${font}', ${fallback}`;
}

// The theme's typefaces: heading, body, and label (#363: the menu, labels, table heads, badges and buttons).
const FONT_ROLES = ['heading', 'body', 'label'];

function googleFontsImport(fonts) {
  const toImport = FONT_ROLES
    .map(k => fonts[k])
    .filter(f => f && !GENERIC_FAMILIES.has(f))
    .filter((v, i, a) => a.indexOf(v) === i);
  if (toImport.length === 0) return '';
  const families = toImport.map(f => `family=${f.replace(/ /g, '+')}`).join('&');
  return `@import url('https://fonts.googleapis.com/css2?${families}&display=swap');\n\n`;
}

// Non-generic families the Google import would name (source: google), for the build warning.
function googleFontNames(fonts) {
  return FONT_ROLES
    .map(k => fonts[k])
    .filter(f => f && !GENERIC_FAMILIES.has(f))
    .filter((v, i, a) => a.indexOf(v) === i);
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
function fontsPreamble(fonts, selfHostCss) {
  // self-host (#270): the build resolved the vault's font cache into local @font-face
  // rules (selfHostCss, possibly empty). Never falls through to the Google import.
  if (fonts.source === 'self-host') return selfHostCss || '';
  if (fonts.source === 'local') return localFontFaceCSS(fonts.files);
  return googleFontsImport(fonts); // 'google'; the reader refuses any other source
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

const isLightBackground = (bg) => luminance(bg) > 0.5;

// 'light' or 'dark': the colour scheme generateThemeCSS gives a custom palette (the default background is dark).
// A tool that predicts the build's look calls this rather than keeping its own copy of the rule.
function paletteScheme(palette) {
  return isLightBackground((palette && palette.background) || '#1a1f25') ? 'light' : 'dark';
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

// WCAG contrast between two hex colours (1 to 21).
function contrast(hex1, hex2) {
  const rel = (hex) => {
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const { r, g, b } = parseHex(hex);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const [a, b] = [rel(hex1), rel(hex2)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
// A hex colour as HSL: hue in sixths of the wheel (0 to 6), saturation and lightness 0 to 1.
function toHsl(hex) {
  const { r, g, b } = parseHex(hex);
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min, l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === R ? (((G - B) / d) % 6 + 6) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h, s, l };
}

function fromHsl({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h % 2) - 1)), m = l - c / 2;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.min(5, Math.floor(h))];
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

// The palette's accent as small words on the header colour: the accent itself when it reads there, else made lighter
// (on a dark header) or darker (on a light one), same hue and saturation, just far enough to read (#868). The menu bar
// and the hero banner carry small labels in it, and a dark accent on a dark header (the built-in palette's) could
// hardly be seen. It must read on the header and on the no-picture banner's far corner (style.css: 8% of the way to
// the header's text); 5:1 leaves room for a badge's faint accent tint. Null for a colour that isn't hex.
function accentOnHeader(accent, header, headerText, headerIsLight, min = 5) {
  if (![accent, header, headerText].every((c) => HEX.test(String(c).trim()))) return null;
  const grounds = [header, mixColors(header, headerText, 0.08)];
  const reads = (c) => grounds.every((g) => contrast(c, g) >= min);
  if (reads(accent)) return accent;
  const hsl = toHsl(accent);
  // From the accent's own lightness, a hundredth at a time, away from the header's, to black or white itself.
  const from = Math.round(hsl.l * 100);
  for (let k = from; k >= 0 && k <= 100; k += headerIsLight ? -1 : 1) {
    const c = fromHsl({ ...hsl, l: k / 100 });
    if (reads(c)) return c;
  }
  return headerText;
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function generateThemeCSS(config, opts = {}) {
  const selfHostCss = opts.selfHostCss || '';
  const palette = config.palette;
  const fonts = config.fonts || {};

  // When a genre preset is active and no custom palette was provided,
  // preset CSS owns colors AND fonts; only explicitly-chosen (non-generic)
  // fonts override the preset.
  if (!palette && config.genre) {
    const fontVars = [];
    // A PC's backstory and hook are read in the heading face (--font-reading, style.css).
    if (fonts.heading && !GENERIC_FAMILIES.has(fonts.heading)) fontVars.push(`  --font-heading: ${cssFontValue(fonts.heading, 'serif')};`, `  --font-reading: ${cssFontValue(fonts.heading, 'serif')};`);
    if (fonts.body && !GENERIC_FAMILIES.has(fonts.body)) fontVars.push(`  --font-body: ${cssFontValue(fonts.body, 'sans-serif')};`);
    // A label face has no preset default to keep, so a generic family here is a choice and is written.
    if (fonts.label) fontVars.push(`  --font-label: ${cssFontValue(fonts.label, 'sans-serif')};`);
    // Computed even when there are no --font-* overrides to emit: with source: local,
    // the GM may be self-hosting the preset's OWN font (e.g. scifi's Rajdhani) under
    // its own family name, with no heading/body override at all — the preset's static
    // CSS already references that family name via its own --font-heading value, and
    // copyGenreCSS strips its Google import when source is local, so the @font-face
    // rule supplying the real file is the only thing left standing between that name
    // and a silent fallback (CodeRabbit review, PR #234). Returning before this ran
    // meant a files entry with no matching heading/body override never got emitted.
    const fontsImport = fontsPreamble(fonts, selfHostCss);
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

  const isLight = isLightBackground(bg);

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
  // Browser scrollbars and form controls match a custom palette's own lightness;
  // style.css's dark-first default would give a light palette dark controls.
  vars.push(`  color-scheme: ${paletteScheme(pal)};`);

  // The header's words: dark or light, whichever stands out more on the header (a mid-grey header reads in dark).
  const headerIsLight = contrast('#1a1a1a', primary) > contrast('#e0e4e8', primary);
  const headerText = headerIsLight ? '#1a1a1a' : '#e0e4e8';
  vars.push(`  --text-on-header: ${headerText};`);
  vars.push(`  --text-muted-on-header: ${headerIsLight ? '#555' : '#9da5ae'};`);
  const headerAccent = accentOnHeader(accent, primary, headerText, headerIsLight);
  if (headerAccent) vars.push(`  --accent-on-header: ${headerAccent};`);

  if (fonts.heading) vars.push(`  --font-heading: ${cssFontValue(fonts.heading, 'serif')};`);
  // A PC's backstory and hook are read in a heading face the GM chose; a generic one (the
  // default system-ui) leaves style.css's serif reading face.
  if (fonts.heading && !GENERIC_FAMILIES.has(fonts.heading)) vars.push(`  --font-reading: ${cssFontValue(fonts.heading, 'serif')};`);
  if (fonts.body) vars.push(`  --font-body: ${cssFontValue(fonts.body, 'sans-serif')};`);
  // Unset, the label face is left out: each element the label rule covers keeps the face it has, inherited or its own.
  if (fonts.label) vars.push(`  --font-label: ${cssFontValue(fonts.label, 'sans-serif')};`);

  const fontsImport = fontsPreamble(fonts, selfHostCss);

  return `${fontsImport}:root {\n${vars.join('\n')}\n}\n`;
}

module.exports = { generateThemeCSS, paletteScheme, googleFontNames, GENRE_ALIASES, VALID_PRESETS, FONT_FORMATS, fontOutputPath };
