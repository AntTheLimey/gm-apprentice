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

function generateThemeCSS(config) {
  const palette = config.palette || {};
  const fonts = config.fonts || {};

  const vars = [];

  if (palette.primary) vars.push(`  --bg-header: ${palette.primary};`);
  if (palette.accent) vars.push(`  --accent: ${palette.accent};`);
  if (palette.background) vars.push(`  --bg: ${palette.background};`);
  if (palette.text) vars.push(`  --text: ${palette.text};`);

  if (fonts.heading) vars.push(`  --font-heading: ${cssFontValue(fonts.heading, 'serif')};`);
  if (fonts.body) vars.push(`  --font-body: ${cssFontValue(fonts.body, 'sans-serif')};`);

  const fontsImport = googleFontsImport(fonts);
  const varsBlock = vars.length > 0 ? vars.join('\n') : '  /* no overrides */';

  return `${fontsImport}:root {\n${varsBlock}\n}\n`;
}

module.exports = { generateThemeCSS, resolveGenrePreset, GENRE_ALIASES, VALID_PRESETS };
