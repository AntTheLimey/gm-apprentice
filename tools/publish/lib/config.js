const fs = require('fs');
const path = require('path');
const { canonicalPath } = require('./manifest');
const { readSettings, formatFault, makeFault, stops, entry, movedKeys } = require('./settings');

// build.js looks up per-page field overrides via `fieldOverrides[vaultRelPathOf(page)]`,
// and vaultRelPathOf() canonicalizes the scanned path to NFC (#139). An overrides.fields
// key typed by the config author in a different normal form (e.g. an NFD-decomposed
// accented filename) would otherwise never match, so it is canonicalized once here, at load.
// An entry that is not a map, or whose `include` is not a list of field names, is dropped
// (the exclusions stay in force, the safe direction) and reported in `problems`.
function canonicalizeOverrideFieldKeys(fields) {
  const out = {};
  const problems = [];
  for (const [key, value] of Object.entries(fields || {})) {
    const problem = overrideEntryProblem(value);
    if (problem) {
      problems.push(`publish.overrides.fields["${key}"] ${problem}. That override is ignored. Expected shape: "Characters/NPCs/Vex.md": { include: ["secrets"] }.`);
      continue;
    }
    out[canonicalPath(key)] = value;
  }
  return { fields: out, problems };
}

// build.js hands each per-file entry straight to filterFields, which does
// `overrides.include.includes(field)`. A string there is substring matching
// (`include: sec` would re-admit `secrets`); any other truthy non-array throws.
function overrideEntryProblem(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return `must be a map, but is ${Array.isArray(value) ? 'a list' : typeof value}`;
  }
  if (!('include' in value)) return null;
  if (!Array.isArray(value.include)) {
    return `has an "include" that must be a list of field names, but is ${typeof value.include}`;
  }
  if (!value.include.every((f) => typeof f === 'string')) {
    return 'has an "include" list holding something that is not a field name';
  }
  return null;
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

// A map setting's values without the names the file did not set and the list gives no value.
function setOnly(map, prefix, origins) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) {
    const e = entry(`${prefix}.${k}`);
    if (v === null && origins[`${prefix}.${k}`] === 'default' && e && e.default === undefined) continue;
    out[k] = v;
  }
  return out;
}

// The settings, reshaped into the object every command reads. readSettings decides each
// value; the only rules here join two settings (a genre without a palette, live stats
// without sheets) or check a map's entries (overrides).
// `quietStops` leaves stop-level faults out of the warnings: a command that goes on to
// assertNoStops shows each stop once, in the error it throws. `warn` always gets the text only.
function loadPublishConfig(vaultPath, jsonConfigFallback = {}, warn = console.warn, { quietStops = false } = {}) {
  const { values, origins, faults, legacy } = readSettings({ vaultPath, siteConfig: jsonConfigFallback });
  const p = values.publish;
  const named = (n) => origins[n] !== 'default';

  const live = p.live_stats && p.character_sheets;
  if (p.live_stats && !p.character_sheets) {
    faults.push(makeFault({ name: 'publish.live_stats', kind: 'dropped', level: 'warn', message: 'publish.live_stats is on but character_sheets is off; live stats are not published' }));
  }
  const switchNames = ['site', 'character_sheets', 'live_stats', 'inbox'];
  const unset = switchNames.filter((n) => origins[`publish.${n}`] === 'default');
  const switches = {
    site: p.site,
    characterSheets: p.character_sheets,
    liveStats: live,
    inbox: p.inbox,
    unset,
    explicitOff: {
      liveStats: !live && (!unset.includes('live_stats') || !p.character_sheets),
      inbox: !p.inbox && !unset.includes('inbox'),
      site: !p.site && !unset.includes('site'),
    },
  };

  const overrides = canonicalizeOverrideFieldKeys(p.overrides.fields);
  for (const message of overrides.problems) {
    faults.push(makeFault({ name: 'publish.overrides.fields', kind: 'dropped', level: 'stop', message }));
  }

  // A genre counts as written even when it was refused (an unknown one reads as null): the page
  // then takes the plain fallback palette, as it always has.
  const genreWritten = named('publish.theme.genre');
  const paletteWritten = Object.keys(origins).some((n) => n.startsWith('publish.theme.palette.') && named(n));
  const theme = setOnly(p.theme, 'publish.theme', origins);
  const merged = {
    mode: p.mode,
    link_previews: p.link_previews,
    tohit_calculator: p.tohit_calculator,
    connections: p.connections,
    site_title: p.site_title,
    footer: p.footer,
    search: p.search,
    folder_map: p.folder_map,
    attachments_dir: p.attachments_dir,
    pc_prose_sections: p.pc_prose_sections,
    system: p.system,
    sheet_crest: p.sheet_crest,
    exclude_drafts: p.exclude_drafts,
    exclude_callouts: p.exclude_callouts,
    exclude_sections: p.exclude_sections,
    exclude_fields: p.exclude_fields,
    exclude_dirs: p.exclude_dirs,
    legacy,
    landing: setOnly(p.landing, 'publish.landing', origins),
    theme: {
      ...theme,
      genre: p.theme.genre,
      palette: genreWritten && !paletteWritten ? null : p.theme.palette,
      campaign_image: p.theme.campaign_image,
    },
    four_oh_four: { message: p.four_oh_four.message },
    images: p.images,
    banners: p.banners,
    locations: setOnly(p.locations, 'publish.locations', origins),
    overrides: { fields: overrides.fields },
    section_titles: p.section_titles,
    switches,
    sheetLook: { skin: p.sheet_skin, frame: p.sheet_frame },
    setting_year: values.setting_year,
    faults,
    origins,
  };

  for (const f of faults) if (!(quietStops && f.level === 'stop')) warn(formatFault(f));
  return merged;
}

// Throws when a setting that hides something could not be read: a build must not go on
// to publish with the safe fallback in place of what the GM meant.
function assertNoStops(publishConfig, what) {
  const found = stops(publishConfig.faults || []);
  if (!found.length) return;
  throw new Error(`${what} stopped: the settings have a fault that could show players more than you meant.\n${found.map((f) => `  ${formatFault(f)}`).join('\n')}\nFix it, or ask the apprentice to run the Settings check.`);
}

// assertNoStops for a command that has only the site's vault.config.json path (deploy).
// A config that cannot be read is left for the command to report in its own words.
function assertNoStopsFor(configPath, what) {
  let raw;
  let vaultPath;
  try {
    const resolved = path.resolve(configPath);
    raw = loadVaultConfig(resolved);
    vaultPath = path.resolve(path.dirname(resolved), raw.vaultPath);
  } catch {
    return;
  }
  assertNoStops(loadPublishConfig(vaultPath, raw, () => {}), what);
}

// What `build` and `deploy` say instead of running when the GM has turned the site off.
// Only an explicit off stops them: a site folder whose vault never set the switch builds.
const SITE_OFF = 'the site is off for this vault (publish.site in _meta/vault-config.md); nothing was built. Set publish.site: true to publish again.';
function siteOff(switches) {
  return switches && switches.explicitOff && switches.explicitOff.site ? SITE_OFF : null;
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
function resolveConfig(rawConfig, vaultPath, warn = console.warn, options = {}) {
  const publishConfig = loadPublishConfig(vaultPath, rawConfig, warn, options);
  const config = Object.assign({}, rawConfig);
  for (const entry of movedKeys()) {
    const value = publishConfig[entry.publish];
    if (value !== undefined && value !== null) config[entry.json] = value;
  }
  return { config, publishConfig };
}

// Why `build` and `deploy` must not run for the site at `configPath`: the GM turned the
// site off (`publish.site`), or the vault file cannot be read to tell. null when it is on
// or unset, and when the site's own vault.config.json cannot be read (the command then
// reports that in its own words).
function siteOffFor(configPath) {
  let raw;
  let vaultPath;
  try {
    const resolved = path.resolve(configPath);
    raw = loadVaultConfig(resolved);
    vaultPath = path.resolve(path.dirname(resolved), raw.vaultPath);
  } catch {
    return null;
  }
  try {
    return siteOff(loadPublishConfig(vaultPath, raw, () => {}).switches);
  } catch (err) {
    // A deploy without a build reads nothing else: a vault file that says `site: false`
    // next to a broken line must not be uploaded for.
    return `cannot tell whether the site is on (${String(err.message).split('\n')[0].trim()}); nothing was built.`;
  }
}

module.exports = { siteOffFor, siteOff, SITE_OFF, loadPublishConfig, assertNoStops, assertNoStopsFor, resolveConfig, vaultRelPath, scanConfigFor, loadVaultConfig };
