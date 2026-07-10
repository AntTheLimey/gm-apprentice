const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const PUBLISH_DEFAULTS = {
  mode: 'player',
  exclude_drafts: false,
  exclude_sections: ['GM Notes'],
  exclude_fields: ['secrets', 'current_plan', 'plan_progress', 'gm_notes', 'prep_notes'],
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
  // Opt-in. Off means images are copied byte-for-byte, as they always were.
  images: {
    optimize: false,
    format: 'webp',
    max_width: 1600,
    quality: 82,
  },
  overrides: {
    exclude: [],
    include: [],
    fields: {},
  },
  section_titles: {},
};

// Union exclude lists from both config sources (vault-config.md and vault.config.json),
// case-insensitively de-duplicated, preserving first-seen casing/order. Falls back to
// `defaults` only when NEITHER source provides a list. A spoiler filter must never strip
// LESS than either source asked for, so the sources merge rather than shadow each other.
function unionExcludeList(primary, fallback, defaults) {
  const sources = [primary, fallback].filter(Array.isArray);
  if (sources.length === 0) return [...defaults];
  const seen = new Set();
  const out = [];
  for (const list of sources) {
    for (const item of list) {
      const key = String(item).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
  }
  return out;
}

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
    system: publish.system || null,
    exclude_drafts: publish.exclude_drafts ?? PUBLISH_DEFAULTS.exclude_drafts,
    exclude_sections: unionExcludeList(
      publish.exclude_sections,
      jsonConfigFallback.excludeSections,
      PUBLISH_DEFAULTS.exclude_sections,
    ),
    exclude_fields: unionExcludeList(
      publish.exclude_fields,
      jsonConfigFallback.excludeFields,
      PUBLISH_DEFAULTS.exclude_fields,
    ),
    exclude_dirs: unionExcludeList(
      publish.exclude_dirs,
      jsonConfigFallback.excludeDirs,
      PUBLISH_DEFAULTS.exclude_dirs,
    ),
    theme: {
      ...PUBLISH_DEFAULTS.theme,
      ...publish.theme,
      palette: (publish.theme && publish.theme.palette)
        ? { ...PUBLISH_DEFAULTS.theme.palette, ...publish.theme.palette }
        : ((publish.theme && publish.theme.genre) ? null : { ...PUBLISH_DEFAULTS.theme.palette }),
      fonts: {
        ...PUBLISH_DEFAULTS.theme.fonts,
        ...(publish.theme && publish.theme.fonts),
      },
    },
    four_oh_four: {
      ...PUBLISH_DEFAULTS.four_oh_four,
      ...publish.four_oh_four,
    },
    images: {
      ...PUBLISH_DEFAULTS.images,
      ...jsonConfigFallback.images,
      ...publish.images,
    },
    // Per-section index banners, keyed by output dir ("locations", "factions", …). No
    // defaults: absent means "look for the conventional _banner.* in the section folder".
    banners: { ...jsonConfigFallback.banners, ...publish.banners },
    // Deliberately not merged with a default: the Locations index needs to tell
    // "group_by never mentioned" (fall back to the genre's pivot) apart from
    // "group_by explicitly falsy" (grouping off), and a default would erase that.
    locations: { ...jsonConfigFallback.locations, ...publish.locations },
    overrides: {
      ...PUBLISH_DEFAULTS.overrides,
      ...publish.overrides,
    },
    section_titles: { ...PUBLISH_DEFAULTS.section_titles, ...publish.section_titles },
    setting_year: settingYear,
  };

  return merged;
}

module.exports = { loadPublishConfig, PUBLISH_DEFAULTS };
