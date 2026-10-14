const fs = require('fs');
const path = require('path');
const { canonicalPath } = require('./manifest');
const { canonicalNfc } = require('./unicode');
const { readSettings, formatFault, makeFault, stops, entry, movedKeys, layoutOf, nameIn, fileLabelFor, nameInFor } = require('./settings');

// build.js looks up per-page field overrides via `fieldOverrides[vaultRelPathOf(page)]`,
// and vaultRelPathOf() canonicalizes the scanned path to NFC (#139). An overrides.fields
// key typed by the config author in a different normal form (e.g. an NFD-decomposed
// accented filename) would otherwise never match, so it is canonicalized once here, at load.
// An entry that is not a map, or whose `include` is not a list of field names, is dropped
// (the exclusions stay in force, the safe direction) and reported in `problems`.
function canonicalizeOverrideFieldKeys(fields, vaultPath) {
  const out = {};
  const problems = [];
  for (const [key, value] of Object.entries(fields || {})) {
    const problem = overrideEntryProblem(value);
    if (problem) {
      problems.push(`${nameIn(vaultPath, 'player_site.hide.field_exceptions')}["${key}"] ${problem}. That override is ignored. Expected shape: "Characters/NPCs/Vex.md": { include: ["secrets"] }.`);
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
// `siteDir` is the site folder (where vault.config.json is): the output folder is judged against it.
function loadPublishConfig(vaultPath, jsonConfigFallback = {}, warn = console.warn, { quietStops = false, siteDir } = {}) {
  const { values, origins, faults, legacy = [], layout } = readSettings({ vaultPath, siteConfig: jsonConfigFallback, siteDir });
  const v = values.vault;
  const p = values.player_site;
  const named = (n) => origins[n] !== 'default';

  const live = p.features.live_stats && p.sheets.show;
  if (p.features.live_stats && !p.sheets.show) {
    const liveName = nameIn(vaultPath, 'player_site.features.live_stats');
    faults.push(makeFault({ name: liveName, setting: 'player_site.features.live_stats', kind: 'dropped', level: 'warn', message: `${liveName} is on but ${nameIn(vaultPath, 'player_site.sheets.show')} is off; live stats are not published` }));
  }
  const switchNames = { site: 'player_site.publish', character_sheets: 'player_site.sheets.show', live_stats: 'player_site.features.live_stats', inbox: 'player_site.features.inbox' };
  const unset = Object.keys(switchNames).filter((n) => origins[switchNames[n]] === 'default');
  const switches = {
    site: p.publish,
    characterSheets: p.sheets.show,
    liveStats: live,
    inbox: p.features.inbox,
    unset,
    explicitOff: {
      liveStats: !live && (!unset.includes('live_stats') || !p.sheets.show),
      inbox: !p.features.inbox && !unset.includes('inbox'),
      site: !p.publish && !unset.includes('site'),
    },
  };

  const overrides = canonicalizeOverrideFieldKeys(p.hide.field_exceptions, vaultPath);
  for (const message of overrides.problems) {
    faults.push(makeFault({ name: nameIn(vaultPath, 'player_site.hide.field_exceptions'), setting: 'player_site.hide.field_exceptions', kind: 'dropped', level: 'stop', message }));
  }

  // A genre counts as written even when it was refused (an unknown one reads as null): the page
  // then takes the plain fallback palette, as it always has.
  const genreWritten = named('player_site.theme.genre');
  const paletteWritten = Object.keys(origins).some((n) => n.startsWith('player_site.theme.palette.') && named(n));
  const theme = setOnly(p.theme, 'player_site.theme', origins);
  const merged = {
    mode: p.hide.mode,
    link_previews: p.features.link_previews,
    tohit_calculator: p.features.tohit_calculator,
    connections: p.features.connections,
    site_title: p.title,
    footer: p.footer,
    search: p.features.search,
    folder_map: p.folder_map,
    attachments_dir: v.attachments,
    pc_prose_sections: p.sheets.prose_sections,
    system: v.system,
    sheet_crest: p.sheets.crest,
    exclude_drafts: p.hide.drafts,
    exclude_callouts: p.hide.callouts,
    exclude_sections: p.hide.sections,
    exclude_fields: p.hide.fields,
    exclude_dirs: p.hide.folders,
    legacy,
    landing: setOnly(p.landing, 'player_site.landing', origins),
    theme: {
      ...theme,
      genre: p.theme.genre,
      palette: genreWritten && !paletteWritten ? null : p.theme.palette,
      campaign_image: p.theme.campaign_image,
    },
    four_oh_four: { message: p.not_found },
    images: p.images,
    banners: p.lists.banners,
    locations: setOnly(p.lists.locations, 'player_site.lists.locations', origins),
    overrides: { fields: overrides.fields },
    section_titles: p.lists.section_titles,
    switches,
    sheetLook: { skin: p.sheets.skin, frame: p.sheets.frame },
    setting_year: v.setting_year,
    faults,
    origins,
  };

  // Which settings file the vault is on, so a message can name a setting as that file writes it
  // (`nameInFor(publishConfig.layout, name)`). Not listed with the settings: a copy of the
  // object does not carry it, and the message then names the setting by its current name.
  Object.defineProperty(merged, 'layout', { value: layout, enumerable: false });
  // The site folder's own settings, for code that has only the publishConfig. Not listed, like `layout`.
  Object.defineProperty(merged, 'site', {
    value: { url: p.url, host: p.host, output: p.output, cloudflare_project: p.cloudflare_project, keep: p.keep },
    enumerable: false,
  });

  // A blank entry in a steps list is left out, with a warning: it must never reach the shell.
  const stepsOf = (name, list) => {
    const kept = list.filter((c) => String(c).trim() !== '');
    if (kept.length !== list.length) {
      const written = nameIn(vaultPath, name);
      faults.push(makeFault({ name: written, setting: name, kind: 'dropped', level: 'warn', message: `${written} has a blank entry; it was left out` }));
    }
    return kept;
  };
  const steps = { before: stepsOf('player_site.before_build', p.before_build), after: stepsOf('player_site.after_build', p.after_build) };

  // The vault's build steps, for the commands that run them. Not listed, like `site`.
  Object.defineProperty(merged, 'steps', { value: steps, enumerable: false });

  // The GM's extra menu entries. A second entry with the same label under the same group is left out, with a
  // warning. Not listed, like `steps`: a site that sets none builds as it did.
  const menuName = nameIn(vaultPath, 'player_site.menu_extra');
  const menuSeen = new Set();
  const menuExtra = [];
  for (const item of p.menu_extra) {
    const key = `${canonicalNfc(item.label.trim())}\n${(item.group || '').trim().toLowerCase()}`;
    if (menuSeen.has(key)) {
      faults.push(makeFault({ name: menuName, setting: 'player_site.menu_extra', kind: 'dropped', level: 'warn', message: `${menuName} lists "${item.label}" twice${item.group ? ` under ${item.group}` : ''}; the second is left out` }));
      continue;
    }
    menuSeen.add(key);
    menuExtra.push({ label: item.label.trim(), link: item.link.trim(), ...(item.group ? { group: item.group.trim() } : {}) });
  }
  Object.defineProperty(merged, 'menu_extra', { value: menuExtra, enumerable: false });

  // The landing banner's four texts (null when unset). Not listed, like `menu_extra`: a site that sets none
  // builds as it did. The build replaces `image` and `link` with what it resolved.
  const bannerText = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const b = (p.landing && p.landing.banner) || {};
  delete merged.landing.banner;
  Object.defineProperty(merged.landing, 'banner', {
    value: { title: bannerText(b.title), text: bannerText(b.text), link: bannerText(b.link), image: bannerText(b.image) },
    enumerable: false, writable: true, configurable: true,
  });

  // The numbers, the header facts and the withheld words the build used to fix in code. Not listed, like
  // `menu_extra`: a site that sets none builds as it did. Each is passed down to the code that uses it.
  Object.defineProperty(merged, 'limits', { value: { ...p.limits }, enumerable: false });
  Object.defineProperty(merged, 'header_facts', { value: [...p.sheets.header_facts], enumerable: false });
  // A blank word reads as unset. A word that would break the link it is printed in is refused, with a warning.
  const words = {};
  for (const key of ['person', 'place', 'thing']) {
    const setting = `player_site.withheld_words.${key}`;
    const raw = String(p.withheld_words[key]).trim();
    if (/[[\]|]/.test(raw)) {
      const written = nameIn(vaultPath, setting);
      faults.push(makeFault({ name: written, setting, kind: 'dropped', level: 'warn', message: `${written} holds a [, ] or |, which cannot be printed in a link; the built-in word is used` }));
      words[key] = entry(setting).default;
    } else words[key] = raw || entry(setting).default;
  }
  Object.defineProperty(merged, 'withheld_words', { value: words, enumerable: false });

  // The status lists, every word trimmed and lower-cased once. Not listed, like `limits`. A `fallen` word that is
  // not out of play is left out, with a warning.
  const wordsOf = (list) => new Set(list.map((w) => String(w).trim().toLowerCase()).filter(Boolean));
  const statuses = { out_of_play: wordsOf(v.statuses.out_of_play), fallen: new Set(), gone: wordsOf(v.statuses.gone) };
  for (const word of wordsOf(v.statuses.fallen)) {
    if (statuses.out_of_play.has(word)) statuses.fallen.add(word);
    else {
      const written = nameIn(vaultPath, 'vault.statuses.fallen');
      faults.push(makeFault({ name: written, setting: 'vault.statuses.fallen', kind: 'dropped', level: 'warn', message: `${written} holds "${word}", which is not in ${nameIn(vaultPath, 'vault.statuses.out_of_play')}; it does not count as fallen` }));
    }
  }
  Object.defineProperty(merged, 'statuses', { value: statuses, enumerable: false });

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
  let siteDir;
  try {
    const resolved = path.resolve(configPath);
    raw = loadVaultConfig(resolved);
    siteDir = path.dirname(resolved);
    vaultPath = path.resolve(siteDir, raw.vaultPath);
  } catch {
    return;
  }
  assertNoStops(loadPublishConfig(vaultPath, raw, () => {}, { siteDir }), what);
}

// What `build` and `deploy` say instead of running when the GM has turned the site off.
// Only an explicit off stops them: a site folder whose vault never set the switch builds.
// It names the switch as this vault's file writes it, so it takes the vault (or a layout).
const siteOffText = (layout) => `the site is off for this vault (${nameInFor(layout, 'player_site.publish')} in ${fileLabelFor(layout)}); nothing was built. Set ${nameInFor(layout, 'player_site.publish')}: true to publish again.`;
// The text for a vault on the old layout, the one most vaults are on until they are updated.
const SITE_OFF = siteOffText('legacy');
function siteOff(switches, vaultPath) {
  return switches && switches.explicitOff && switches.explicitOff.site ? siteOffText(vaultPath ? layoutOf(vaultPath) : 'legacy') : null;
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

// The site folder's five keys in the spelling the site file used, and the field of publishConfig.site each is.
const SITE_KEYS = [['siteUrl', 'url'], ['host', 'host'], ['outputDir', 'output'], ['cloudflarePagesProject', 'cloudflare_project'], ['preserveDirs', 'keep']];

// The one resolved config every command reads. `config` is the raw vault.config.json
// object with each moved key overwritten, in its old JSON spelling, by the value
// loadPublishConfig settled on (vault file first, site file only when the vault file is
// silent), so templates and the scanner that read config.siteTitle / folderMap /
// attachmentsDir keep working. `publishConfig` is loadPublishConfig's own output. The raw
// object is not mutated. A key neither file sets stays as the raw object had it.
function resolveConfig(rawConfig, vaultPath, warn = console.warn, options = {}) {
  const publishConfig = loadPublishConfig(vaultPath, rawConfig, warn, options);
  const config = Object.assign({}, rawConfig);
  // On the new layout the site file is not merged: a moved key is what the vault's settings resolved, or absent.
  const fromVaultOnly = publishConfig.layout === 'new';
  for (const entry of movedKeys()) {
    const value = publishConfig[entry.publish];
    if (value !== undefined && value !== null) config[entry.json] = value;
    else if (fromVaultOnly) delete config[entry.json];
  }
  // The site folder's own keys are always what the settings resolved (never the raw site file), or absent.
  for (const [key, field] of SITE_KEYS) {
    const value = publishConfig.site[field];
    if (value !== undefined && value !== null) config[key] = value;
    else delete config[key];
  }
  return { config, publishConfig };
}

// The output folder as a plain relative path ("docs"): no leading "./", no trailing slash. A config nothing resolved
// (no vaultPath, a test's stand-in) takes the built-in folder.
function outputFolderOf(config) {
  const folder = config.outputDir === undefined ? entry('player_site.output').default : config.outputDir;
  return String(folder).replace(/^\.\//, '').replace(/\/+$/, '');
}

// The site file's config with its five site keys resolved from the vault's settings, for a command that reads only
// those (deploy, setup-inbox). A config with no vaultPath (a test's stand-in) is returned as it is.
function siteConfigFor(raw, siteRoot, warn = () => {}) {
  if (!raw || !raw.vaultPath) return raw;
  return resolveConfig(raw, path.resolve(siteRoot, raw.vaultPath), warn, { quietStops: true, siteDir: siteRoot }).config;
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
    return siteOff(loadPublishConfig(vaultPath, raw, () => {}).switches, vaultPath);
  } catch (err) {
    // A deploy without a build reads nothing else: a vault file that says `site: false`
    // next to a broken line must not be uploaded for.
    return `cannot tell whether the site is on (${String(err.message).split('\n')[0].trim()}); nothing was built.`;
  }
}

module.exports = { siteOffFor, siteOff, siteOffText, SITE_OFF, siteConfigFor, outputFolderOf, loadPublishConfig, assertNoStops, assertNoStopsFor, resolveConfig, vaultRelPath, scanConfigFor, loadVaultConfig };
