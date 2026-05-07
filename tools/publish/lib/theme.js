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
};

const VALID_PRESETS = new Set(['horror', 'fantasy', 'noir', 'military']);

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
  const toImport = Object.values(fonts)
    .filter(f => f && !GENERIC_FAMILIES.has(f))
    .filter((v, i, a) => a.indexOf(v) === i);
  if (toImport.length === 0) return '';
  const families = toImport.map(f => `family=${f.replace(/ /g, '+')}`).join('&');
  return `@import url('https://fonts.googleapis.com/css2?${families}&display=swap');\n\n`;
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
  const palette = config.palette || {};
  const fonts = config.fonts || {};

  const vars = [];

  const bg = palette.background || '#1a1f25';
  const text = palette.text || '#c9d1d9';
  const accent = palette.accent || '#58a6ff';
  const primary = palette.primary || '#0d1117';

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

  const fontsImport = googleFontsImport(fonts);

  return `${fontsImport}:root {\n${vars.join('\n')}\n}\n`;
}

module.exports = { generateThemeCSS, resolveGenrePreset, GENRE_ALIASES, VALID_PRESETS };
