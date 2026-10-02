const { normalizeDefaultMode } = require('./color-mode');
const fs = require('fs');
const path = require('path');
const { parseNote } = require('./frontmatter');
const { canonicalPath } = require('./manifest');
const { MOVED_KEYS } = require('./config-keys');
const { resolveSwitches } = require('./switches');

const PUBLISH_DEFAULTS = {
  mode: 'player',
  exclude_drafts: false,
  exclude_callouts: false,
  // Reconciliation Context / Handoff to Reconcile are written automatically by
  // reconcile and session-wrapup and carry GM plot state; they must never reach a
  // published player-mode site (#144).
  exclude_sections: ['GM Notes', 'DM Notes', 'Player Notes', 'Source References', 'Reconciliation Context', 'Handoff to Reconcile'],
  exclude_fields: ['secrets', 'current_plan', 'plan_progress', 'gm_notes', 'prep_notes', 'reliability'],
  exclude_dirs: ['_meta', '_Templates'],
  search: true,
  attachments_dir: '_attachments',
  folder_map: {},
  // Landing page selection. build.js has always read publishConfig.landing.*,
  // but `landing` was missing from the whitelist that builds `merged`, so the
  // key was permanently undefined and every knob here was silently ignored —
  // the page was fixed at 6 NPCs / 4 locations / window 3 no matter what the
  // GM configured (#169).
  //
  // featured_* pin entities to the front of their section, in the order given,
  // with recency filling whatever slots remain. They are the escape hatch from
  // the scoring heuristic: a GM who knows which five NPCs matter this session
  // should not have to reverse-engineer a score to feature them.
  landing: {
    recency_window: 3,
    max_npcs: 6,
    max_locations: 4,
    featured_npcs: [],
    featured_locations: [],
    quick_links: [],
  },
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
      // 'google' (default): custom fonts pull from fonts.googleapis.com, as always.
      // 'self-host' (#270): the build downloads the Google-hosted families once into the
      // vault's _meta/font-cache/ and serves them from the site (no request to Google
      // from visitors). Offline builds reuse the cache; a miss warns and uses the
      // fallback stack, never a Google import. New vaults are set up with this; the code
      // default stays 'google' so existing sites don't change look silently.
      // 'local': no Google import; the build copies theme.fonts.files into the site's
      // fonts/ and emits @font-face for them instead (#211). No files under 'local'
      // means no import at all — the fonts are whatever stack cssFontValue falls back to.
      source: 'google',
      files: [],
    },
    campaign_image: null,
    // Which palette a reader starts in (#260): 'system' follows their OS, as sites
    // always have; 'dark' or 'light' starts everyone there. A reader's own choice from
    // the nav toggle overrides it and is remembered.
    default_mode: 'system',
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
  // Per-file frontmatter overrides, keyed by vault-relative path:
  //   fields: { "Characters/NPCs/Vex.md": { include: ["secrets"] } }
  // `include` re-admits a field that exclude_fields strips, for that one file. `fields` is
  // the only override the build reads — top-level `exclude`/`include` keys were declared
  // here for years and read by nothing, so a GM who wrote one got a silent no-op. They are
  // gone rather than implemented; loadPublishConfig warns if a config still carries one.
  overrides: {
    fields: {},
  },
  section_titles: {},
};

// A mistyped default_mode falls back to 'system' — say so rather than silently.
function defaultModeFrom(raw, warn = console.warn) {
  const mode = normalizeDefaultMode(raw);
  if (raw != null && String(raw).trim().toLowerCase() !== mode) {
    warn(`publish.theme.default_mode "${raw}" is not system, dark or light — using system`);
  }
  return mode;
}

// exclude_dirs entries are matched against vault-relative POSIX paths the scanner walks
// (scanner.js), so an entry authored differently than the scanner spells it fails open —
// the folder still publishes. Normalizes the common spellings a GM or a JSON/YAML author
// would reasonably write: backslashes (Windows-authored config), a trailing slash
// ("NPCs/Hidden/"), a leading "./" ("./NPCs/Hidden"), and an absolute path that resolves
// inside the vault (rewritten relative to it). An absolute path resolving OUTSIDE the
// vault can never match anything the scanner walks, so it is dropped with a warning
// rather than silently doing nothing forever. Returns null for an entry that normalizes
// to nothing (empty, or outside the vault).
function normalizeExcludeDir(entry, vaultPath, warn = true) {
  // `warn`: true = console.warn, false = silent, or a function that takes the message.
  const say = typeof warn === 'function' ? warn : (warn ? console.warn : () => {});
  let raw = String(entry).trim().replace(/\\/g, '/');
  if (!raw) return null;
  const looksAbsolute = raw.startsWith('/') || /^[A-Za-z]:\//.test(raw);
  if (looksAbsolute) {
    const resolved = path.resolve(raw);
    const vaultRoot = path.resolve(vaultPath);
    if (resolved !== vaultRoot && !resolved.startsWith(vaultRoot + path.sep)) {
      say(`config: exclude_dirs entry "${entry}" resolves outside the vault — ignored.`);
      return null;
    }
    raw = path.relative(vaultRoot, resolved).split(path.sep).join('/');
  }
  raw = raw.replace(/^\.\//, '').replace(/\/+$/, '');
  return raw || null;
}

// Normalizes every entry of the chosen exclude_dirs list through normalizeExcludeDir, then
// de-duplicates case-insensitively (first-seen spelling wins) so dedup and the scanner's own
// matching operate on the same spelling. Not a union of sources: the caller has already
// picked one list. Kept separate from the other lists because exclude_sections/exclude_fields
// are not filesystem paths and must not be slash/absolute-path normalized.
function normalizeExcludeDirs(list, vaultPath, warn = true) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const normalized = normalizeExcludeDir(item, vaultPath, warn);
    if (normalized == null) continue;
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(normalized);
    }
  }
  return out;
}

// Vault file value when set, else the site file's, recording which was used. A moved key
// is "set" when it is not undefined: an explicit false or null is a value, not silence.
// `keyOf` spells a list entry the way the build will see it, so "Secrets/" in one file and
// "Secrets" in the other are the same entry.
function pick(publish, json, entry, legacy, normalize = (x) => x, keyOf = (s) => String(s).toLowerCase(), warn = console.warn) {
  const fromVault = publish[entry.publish];
  const fromSite = json[entry.json];
  const vaultMalformed = entry.kind === 'list' && fromVault !== undefined && !Array.isArray(fromVault);
  if (vaultMalformed) {
    // The vault file "sets" the key but gives no list, so the built-in default applies
    // (the safe direction) and nothing from the site file is carried over.
    const what = fromVault === null ? 'empty' : `${typeof fromVault}`;
    warn(`config: publish.${entry.publish} must be a list, but is ${what}. Using the built-in default, not the vault.config.json ${entry.json}.`);
  }
  if (fromSite !== undefined) {
    const rec = { key: entry.json, publishKey: entry.publish, status: fromVault !== undefined ? 'ignored' : 'used' };
    if (entry.kind === 'list' && fromVault !== undefined && Array.isArray(fromSite)) {
      if (vaultMalformed) {
        if (fromSite.length) rec.dropped = [...fromSite];
      } else {
        const have = new Set(fromVault.map((s) => keyOf(s)));
        const dropped = fromSite.filter((s) => !have.has(keyOf(s)));
        if (dropped.length) rec.dropped = dropped;
      }
    }
    legacy.push(rec);
  }
  return normalize(fromVault !== undefined ? fromVault : fromSite);
}

// build.js looks up per-page field overrides via `fieldOverrides[vaultRelPathOf(page)]`,
// and vaultRelPathOf() canonicalizes the scanned path to NFC (#139). An overrides.fields
// key typed by the config author in a different normal form (e.g. an NFD-decomposed
// accented filename) would otherwise never match — canonicalize once here, at load, so
// build.js's single query-side normalization is enough.
function canonicalizeOverrideFieldKeys(fields, warn = console.warn) {
  if (fields == null) return {};
  // Same trap as the block above: Object.entries on a string yields per-character keys, which
  // would become override entries no page path can ever match.
  if (typeof fields !== 'object' || Array.isArray(fields)) {
    warn(
      `config: publish.overrides.fields must be a map keyed by vault-relative path, but is ` +
      `${Array.isArray(fields) ? 'a list' : typeof fields}. No field overrides applied.`
    );
    return {};
  }
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    const problem = overrideEntryProblem(value);
    if (problem) {
      // Dropping the entry leaves the exclusions in force, which is the safe
      // direction: a malformed `include` must never re-admit a field by accident.
      warn(
        `config: publish.overrides.fields["${key}"] ${problem}. That override is ignored. ` +
        'Expected shape: "Characters/NPCs/Vex.md": { include: ["secrets"] }.'
      );
      continue;
    }
    out[canonicalPath(key)] = value;
  }
  return out;
}

// build.js hands each per-file entry straight to filterFields, which does
// `overrides.include.includes(field)`. A string there is substring matching
// (`include: sec` would re-admit `secrets`); any other truthy non-array throws.
// Say which it is rather than letting the build guess or crash.
function overrideEntryProblem(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return `must be a map, but is ${Array.isArray(value) ? 'a list' : typeof value}`;
  }
  if (!('include' in value)) return null;
  if (!Array.isArray(value.include)) {
    return `has an "include" that must be a list of field names, but is ` +
      `${typeof value.include}`;
  }
  if (!value.include.every((f) => typeof f === 'string')) {
    return 'has an "include" list holding something that is not a field name';
  }
  return null;
}

// A key under `publish.overrides` that the build never reads changes nothing about the
// published site, and the GM has no way to tell that from "the override didn't match".
// Name it, and say where the real one lives.
function warnUnreadOverrideKeys(overrides, warn = console.warn) {
  if (overrides == null) return;
  // A malformed block — `overrides: fields` (a bare string), or a list — must not be walked
  // as a key/value map: Object.keys('fields') is ['0'..'5'], which would report six invented
  // keys and bury the real problem.
  if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    warn(
      `config: publish.overrides must be a map, but is ${Array.isArray(overrides) ? 'a list' : typeof overrides}. ` +
      'Nothing under it is being read. Expected shape: overrides: { fields: ' +
      '{ "Characters/NPCs/Vex.md": { include: ["secrets"] } } }.'
    );
    return;
  }
  for (const key of Object.keys(overrides)) {
    if (key === 'fields') continue;
    warn(
      `config: publish.overrides.${key} is not read by the build and has no effect. ` +
      'The only supported override is publish.overrides.fields, keyed by vault-relative ' +
      'path: fields: { "Characters/NPCs/Vex.md": { include: ["secrets"] } }.'
    );
  }
}

// Shared vault.config.json loading, so `manifest diff`, `deploy` and `explain` fail
// the same way `doctor --site` already does: a friendly, exit-1 message naming the
// problem, not a raw `require()` stack trace ("Cannot find module '/…/vault.config.json'")
// dumped at whoever ran the command from the wrong directory. Models the try/catch
// site-doctor.js has used from the start. Every caller here already reaches a
// top-level `.catch((err) => { console.error(err.message); process.exit(1); })` in
// bin/gm-publish.js, so throwing with a clean message is enough — nothing here needs
// to print anything itself.
//
// `requireVaultPath` is on for callers that resolve a vault from the config
// (manifest, explain); deploy has no vault of its own to find, so it leaves this off.
function loadVaultConfig(configPath, deps = {}, { requireVaultPath = false } = {}) {
  const readFile = deps.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  let config;
  try {
    config = deps.config || JSON.parse(readFile(configPath));
  } catch (err) {
    const wrapped = new Error(`${configPath} could not be read as JSON: ${err.message}`);
    wrapped.code = 'CONFIG_INVALID';
    throw wrapped;
  }
  if (requireVaultPath && !config.vaultPath) {
    const wrapped = new Error(`${configPath} has no "vaultPath"`);
    wrapped.code = 'CONFIG_INVALID';
    throw wrapped;
  }
  return config;
}

function loadPublishConfig(vaultPath, jsonConfigFallback = {}, warn = console.warn) {
  const configFile = path.join(vaultPath, '_meta', 'vault-config.md');
  let publish = {};
  let settingYear = null;

  if (fs.existsSync(configFile)) {
    const raw = fs.readFileSync(configFile, 'utf-8');
    let data;
    try {
      ({ data } = parseNote(raw));
    } catch (e) {
      // One line, naming the file: js-yaml's message ends in a code excerpt, and a
      // caller that reads the last line of stderr (vault_check) got only its caret.
      throw new Error(`_meta/vault-config.md frontmatter is not valid YAML: ${String(e.message).split('\n')[0].trim().replace(/:$/, '')}`);
    }
    if (data.publish) {
      publish = data.publish;
    }
    if (data.setting_year !== undefined) {
      settingYear = data.setting_year;
    }
  }

  warnUnreadOverrideKeys(publish.overrides, warn);

  // One pass over the moved-key table, in table order, so `legacy` reads the same way
  // every time. The per-key merges below read from `picked`.
  const legacy = [];
  const picked = {};
  const jsonConfig = jsonConfigFallback || {};
  for (const entry of MOVED_KEYS) {
    picked[entry.publish] = pick(
      publish, jsonConfig, entry, legacy,
      entry.publish === 'exclude_dirs'
        ? (v) => (Array.isArray(v) ? normalizeExcludeDirs(v, vaultPath, warn) : v)
        : undefined,
      entry.publish === 'exclude_dirs'
        ? (s) => (normalizeExcludeDir(s, vaultPath, false) ?? String(s)).toLowerCase()
        : undefined,
      warn,
    );
  }
  const list = (v, fallback) => (Array.isArray(v) ? v : [...fallback]);
  const asMap = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

  const merged = {
    mode: publish.mode || PUBLISH_DEFAULTS.mode,
    site_title: picked.site_title ?? null,
    footer: picked.footer ?? null,
    search: picked.search == null ? PUBLISH_DEFAULTS.search : (picked.search !== false && picked.search !== 'false'),
    folder_map: asMap(picked.folder_map),
    attachments_dir: picked.attachments_dir || PUBLISH_DEFAULTS.attachments_dir,
    pc_prose_sections: Array.isArray(publish.pc_prose_sections) ? publish.pc_prose_sections : [],
    system: picked.system || null,
    // CoC sheet masthead crest/seal.
    sheet_crest: picked.sheet_crest || null,
    exclude_drafts: publish.exclude_drafts ?? PUBLISH_DEFAULTS.exclude_drafts,
    // Boolean (strip all callouts) or an array of types to strip.
    exclude_callouts: picked.exclude_callouts ?? PUBLISH_DEFAULTS.exclude_callouts,
    exclude_sections: list(picked.exclude_sections, PUBLISH_DEFAULTS.exclude_sections),
    exclude_fields: list(picked.exclude_fields, PUBLISH_DEFAULTS.exclude_fields),
    exclude_dirs: list(picked.exclude_dirs, PUBLISH_DEFAULTS.exclude_dirs),
    legacy,
    // Per-key merge, not a whole-block replace: setting only max_npcs must not
    // silently drop recency_window back to nothing. The chosen source (vault file, else
    // site file) supplies the keys; the defaults fill the rest.
    landing: {
      ...PUBLISH_DEFAULTS.landing,
      ...asMap(picked.landing),
    },
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
      default_mode: defaultModeFrom(publish.theme && publish.theme.default_mode, warn),
    },
    four_oh_four: {
      ...PUBLISH_DEFAULTS.four_oh_four,
      ...publish.four_oh_four,
    },
    images: {
      ...PUBLISH_DEFAULTS.images,
      ...asMap(picked.images),
    },
    // Per-section index banners, keyed by output dir ("locations", "factions", …). No
    // defaults: absent means "look for the conventional _banner.* in the section folder".
    banners: { ...asMap(picked.banners) },
    // Deliberately not merged with a default: the Locations index needs to tell
    // "group_by never mentioned" (fall back to the genre's pivot) apart from
    // "group_by explicitly falsy" (grouping off), and a default would erase that.
    locations: { ...asMap(picked.locations) },
    // Only `fields` is carried through: nothing downstream reads any other override key, so
    // passing one along would just relocate the silent no-op into publishConfig.
    overrides: {
      fields: canonicalizeOverrideFieldKeys(
        // `??`, not `||`: an explicitly falsy `fields: false` is malformed config the
        // validator must see and report, not something to silently swap for the default.
        (publish.overrides && publish.overrides.fields) ?? PUBLISH_DEFAULTS.overrides.fields,
        warn
      ),
    },
    section_titles: { ...PUBLISH_DEFAULTS.section_titles, ...publish.section_titles },
    switches: resolveSwitches(publish, jsonConfigFallback),
    setting_year: settingYear,
  };

  // A keep-list that is not a list, or holds non-text entries, is dropped (never read
  // as "keep everything"); say so where the build prints the switch notes.
  const proseRaw = publish.pc_prose_sections;
  if (proseRaw !== undefined && !Array.isArray(proseRaw)) {
    merged.switches.notes.push({ key: 'pc_prose_sections', problem: 'is not a list of section titles; ignored' });
  } else if (Array.isArray(proseRaw) && proseRaw.some((s) => typeof s !== 'string')) {
    merged.switches.notes.push({ key: 'pc_prose_sections', problem: 'has entries that are not text; those are ignored' });
  }

  return merged;
}

// A page's key into `publish.overrides.fields`: its vault-relative path, posix
// separators, NFC-normalized (#139). The manifest and the overrides map are both
// authored by hand and canonicalized on load, so a scanned path has to arrive in
// the same normal form or an NFD-typed filename silently matches nothing.
// Shared by build.js and sheet-cli.js so the CLI's player-safe view resolves a
// per-file override to the same entry the site does.
function vaultRelPath(vaultPath, sourcePath) {
  return canonicalPath(path.relative(vaultPath, sourcePath).split(path.sep).join('/'));
}

// The one config object scanVault/scanVaultReport/scanAttachments should ever be handed:
// the raw vault.config.json config, with `excludeDirs` replaced by publishConfig's already
// normalized, already-unioned exclude_dirs. build.js, `explain`, `manifest diff` and
// `doctor --site` all promise the scanner sees the same exclusions the GM configured
// (either vault-config.md's publish.exclude_dirs or the legacy vault.config.json field) —
// before this helper existed, each of the four re-derived that union (or, in three of the
// four, didn't) independently, and drifted (#209 follow-up).
function scanConfigFor(config, publishConfig) {
  return Object.assign({}, config, { excludeDirs: publishConfig.exclude_dirs });
}

// The one resolved config every command reads. `config` is the raw vault.config.json
// object with each moved key overwritten, in its old JSON spelling, by the value
// loadPublishConfig settled on (vault file first, site file only when the vault file is
// silent), so templates and the scanner that read config.siteTitle / folderMap /
// attachmentsDir keep working. `publishConfig` is loadPublishConfig's own output. The raw
// object is not mutated. A key neither file sets stays as the raw object had it.
function resolveConfig(rawConfig, vaultPath, warn = console.warn) {
  const publishConfig = loadPublishConfig(vaultPath, rawConfig, warn);
  const config = Object.assign({}, rawConfig);
  for (const entry of MOVED_KEYS) {
    const value = publishConfig[entry.publish];
    if (value !== undefined && value !== null) config[entry.json] = value;
  }
  return { config, publishConfig };
}

module.exports = { loadPublishConfig, resolveConfig, vaultRelPath, scanConfigFor, PUBLISH_DEFAULTS, loadVaultConfig, normalizeExcludeDir };
