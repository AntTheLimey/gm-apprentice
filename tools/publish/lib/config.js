const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const PUBLISH_DEFAULTS = {
  mode: 'player',
  exclude_sections: ['GM Notes'],
  exclude_fields: ['secrets', 'current_plan', 'plan_progress'],
  exclude_dirs: ['_meta', '_Templates'],
  theme: {
    genre: null,
    palette: {
      primary: '#1a2f3a',
      accent: '#3d8a7a',
      background: '#e8f0f3',
      text: '#1a1a1a',
    },
    fonts: {
      heading: 'system-ui',
      body: 'system-ui',
    },
    campaign_image: null,
  },
  four_oh_four: {
    style: 'in-world',
    message: 'This page is not available.',
  },
  overrides: {
    exclude: [],
    include: [],
    fields: {},
  },
};

function loadPublishConfig(vaultPath, jsonConfigFallback = {}) {
  const configFile = path.join(vaultPath, '_meta', 'vault-config.md');
  let publish = {};
  let settingYear = null;

  if (fs.existsSync(configFile)) {
    const raw = fs.readFileSync(configFile, 'utf-8');
    const { data } = matter(raw);
    if (data.publish) {
      publish = data.publish;
    }
    if (data.setting_year !== undefined) {
      settingYear = data.setting_year;
    }
  }

  const merged = {
    mode: publish.mode || PUBLISH_DEFAULTS.mode,
    exclude_sections: publish.exclude_sections
      || (jsonConfigFallback.excludeSections
        ? [...jsonConfigFallback.excludeSections]
        : [...PUBLISH_DEFAULTS.exclude_sections]),
    exclude_fields: publish.exclude_fields || [...PUBLISH_DEFAULTS.exclude_fields],
    exclude_dirs: publish.exclude_dirs
      || (jsonConfigFallback.excludeDirs
        ? [...jsonConfigFallback.excludeDirs]
        : [...PUBLISH_DEFAULTS.exclude_dirs]),
    theme: {
      ...PUBLISH_DEFAULTS.theme,
      ...publish.theme,
      palette: {
        ...PUBLISH_DEFAULTS.theme.palette,
        ...(publish.theme && publish.theme.palette),
      },
      fonts: {
        ...PUBLISH_DEFAULTS.theme.fonts,
        ...(publish.theme && publish.theme.fonts),
      },
    },
    four_oh_four: {
      ...PUBLISH_DEFAULTS.four_oh_four,
      ...publish.four_oh_four,
    },
    overrides: {
      ...PUBLISH_DEFAULTS.overrides,
      ...publish.overrides,
    },
    setting_year: settingYear,
  };

  return merged;
}

module.exports = { loadPublishConfig, PUBLISH_DEFAULTS };
