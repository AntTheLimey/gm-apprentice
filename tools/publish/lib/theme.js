const GENRE_PRESETS = {
  'horror': {
    palette: { primary: '#2a1a0e', accent: '#8b6914', background: '#f4ecd8', text: '#1a1a1a' },
    fonts: { heading: 'Cinzel', body: 'Libre Baskerville' },
  },
  'high fantasy': {
    palette: { primary: '#4a0e0e', accent: '#b8860b', background: '#fdf5e6', text: '#1a1a1a' },
    fonts: { heading: 'MedievalSharp', body: 'Merriweather' },
  },
  'noir': {
    palette: { primary: '#1a1a2e', accent: '#4a90d9', background: '#2d2d3d', text: '#e0e0e0' },
    fonts: { heading: 'Oswald', body: 'Source Sans Pro' },
  },
  'sci-fi': {
    palette: { primary: '#0a0a0a', accent: '#00ff41', background: '#111111', text: '#cccccc' },
    fonts: { heading: 'Share Tech Mono', body: 'Exo 2' },
  },
  'pulp': {
    palette: { primary: '#5c3317', accent: '#c0392b', background: '#f5e6c8', text: '#1a1a1a' },
    fonts: { heading: 'Bungee', body: 'Nunito' },
  },
  'historical': {
    palette: { primary: '#2c3e50', accent: '#8b7355', background: '#faf0e6', text: '#1a1a1a' },
    fonts: { heading: 'Cormorant Garamond', body: 'EB Garamond' },
  },
};

const GENERIC_FAMILIES = ['system-ui', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded'];

function cssFontValue(font, fallback) {
  if (GENERIC_FAMILIES.includes(font)) return `${font}, ${fallback}`;
  return `'${font}', ${fallback}`;
}

function googleFontsImport(fonts) {
  const toImport = [fonts.heading, fonts.body]
    .filter(f => !GENERIC_FAMILIES.includes(f))
    .filter((v, i, a) => a.indexOf(v) === i);
  if (toImport.length === 0) return '';
  const families = toImport.map(f => `family=${f.replace(/ /g, '+')}`).join('&');
  return `@import url('https://fonts.googleapis.com/css2?${families}&display=swap');\n\n`;
}

function generateThemeCSS(config) {
  let palette = config.palette || {};
  let fonts = config.fonts || {};

  if (config.genre && GENRE_PRESETS[config.genre]) {
    const preset = GENRE_PRESETS[config.genre];
    palette = { ...preset.palette, ...palette };
    fonts = { ...preset.fonts, ...fonts };
  }

  palette = {
    primary: palette.primary || '#1a2f3a',
    accent: palette.accent || '#3d8a7a',
    background: palette.background || '#e8f0f3',
    text: palette.text || '#1a1a1a',
  };

  fonts = {
    heading: fonts.heading || 'system-ui',
    body: fonts.body || 'system-ui',
  };

  const fontsImport = googleFontsImport(fonts);

  return `${fontsImport}:root {
  --theme-primary: ${palette.primary};
  --theme-accent: ${palette.accent};
  --theme-bg: ${palette.background};
  --theme-text: ${palette.text};
  --theme-heading-font: ${cssFontValue(fonts.heading, 'serif')};
  --theme-body-font: ${cssFontValue(fonts.body, 'sans-serif')};
}
`;
}

module.exports = { generateThemeCSS, GENRE_PRESETS };
