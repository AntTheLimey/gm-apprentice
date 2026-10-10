'use strict';

// `vault-setting` command: what the vault file says about a few publish settings, and
// the one place outside `init` and `migrate-config` that writes them. migrate.py asks
// this rather than read the theme or decide which fonts come from Google itself.
//
//   vault-setting --json                      -> { defaultModeSet, fontSource, googleFonts, sheetSkin, sheetFrame, dndbeyondSync, linkPreviews }
//   vault-setting --set <key>=<json> --json   -> { written: [keys] }
const fs = require('fs');
const path = require('path');
const { parseNote } = require('./frontmatter');
const { SKINS, FRAME_IDS } = require('./skins');

// A value is taken only as the exact id, so the line written is always a clean one. (The
// build is more forgiving of a hand-typed value: it trims and lower-cases before matching.)
const SETTABLE = {
  'theme.default_mode': (v) => ['dark', 'light', 'system'].includes(v),
  'theme.fonts.source': (v) => v === 'self-host',
  'sheet_skin': (v) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(SKINS, v),
  'sheet_frame': (v) => v === 'none' || FRAME_IDS.includes(v),
  'dndbeyond_sync': (v) => v === 'build' || v === 'manual',
  'link_previews': (v) => v === 'on' || v === 'desktop' || v === 'off',
};

function siteConfigPath(options) {
  return path.resolve(options.configPath || './vault.config.json');
}

function vaultPathOf(options) {
  if (options.vault) return path.resolve(options.vault);
  const { loadVaultConfig } = require('./config');
  const resolved = siteConfigPath(options);
  return path.resolve(path.dirname(resolved), loadVaultConfig(resolved).vaultPath);
}

function rawPublish(vaultPath) {
  const file = path.join(vaultPath, '_meta', 'vault-config.md');
  if (!fs.existsSync(file)) return {};
  const publish = parseNote(fs.readFileSync(file, 'utf8')).data.publish;
  return publish && typeof publish === 'object' && !Array.isArray(publish) ? publish : {};
}

const asString = (v) => (typeof v === 'string' && v.trim() ? v : null);

function read(options) {
  const { resolveConfig, loadVaultConfig } = require('./config');
  const fontsLib = require('./fonts');
  const { googleFontNames } = require('./theme');
  const vaultPath = vaultPathOf(options);
  const resolved = siteConfigPath(options);
  const siteConfig = fs.existsSync(resolved) ? loadVaultConfig(resolved) : {};
  // Same call as prefetchForConfig; the build reports the warnings, not this.
  const { publishConfig } = resolveConfig(siteConfig, vaultPath, () => {});
  const fonts = publishConfig.theme.fonts || {};
  const hosted = fonts.source === 'local' || fonts.source === 'self-host';
  const names = hosted ? [] : [...googleFontNames(fonts), ...fontsLib.presetFamiliesFor(publishConfig.theme)];
  // What the vault file says, so unset stays null (the resolved source defaults to google).
  const theme = rawPublish(vaultPath).theme;
  const asked = theme && typeof theme === 'object' ? theme : {};
  const askedFonts = asked.fonts && typeof asked.fonts === 'object' ? asked.fonts : {};
  return {
    defaultModeSet: asked.default_mode !== undefined && asked.default_mode !== null,
    fontSource: askedFonts.source || null,
    googleFonts: names.filter((v, i, a) => a.indexOf(v) === i),
    // The two sheet-look lines as written (null when the line is not there).
    sheetSkin: asString(rawPublish(vaultPath).sheet_skin),
    sheetFrame: asString(rawPublish(vaultPath).sheet_frame),
    // When the D&D Beyond sync runs: 'build' or 'manual' (null when the line is not there).
    dndbeyondSync: asString(rawPublish(vaultPath).dndbeyond_sync),
    // Hover preview cards: 'on', 'desktop' or 'off' (null when the line is not there or is a YAML boolean).
    linkPreviews: asString(rawPublish(vaultPath).link_previews),
  };
}

function write(options) {
  const { setPublishLeaves } = require('./vault-config-edit');
  const vaultPath = vaultPathOf(options);
  const leaves = [];
  const written = [];
  for (const pair of options.set) {
    const at = pair.indexOf('=');
    const key = at < 0 ? pair : pair.slice(0, at);
    if (!Object.prototype.hasOwnProperty.call(SETTABLE, key)) throw new Error(`vault-setting cannot set ${key}`);
    let value;
    try { value = JSON.parse(pair.slice(at + 1)); } catch { throw new Error(`the value for ${key} is not JSON`); }
    if (at < 0 || !SETTABLE[key](value)) throw new Error(`${JSON.stringify(value)} is not a value ${key} takes`);
    leaves.push({ path: key.split('.'), value });
    written.push(key);
  }
  // Writes only the entry's own line (and any parent key it has to create); the rest of
  // the publish block, comments included, stays as the GM wrote it. Throws Error(reason) on a
  // refusal, with the file untouched.
  setPublishLeaves(vaultPath, leaves);
  return { written };
}

function runVaultSetting(options, deps) {
  const out = (deps && deps.out) || console.log;
  try {
    const result = options.set && options.set.length ? write(options) : read(options);
    out(options.json ? JSON.stringify(result, null, 2) : Object.entries(result).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n'));
    return 0;
  } catch (err) {
    (deps && deps.err ? deps.err : console.error)(`Error: ${String(err.message).split('\n')[0]}`);
    return 1;
  }
}

module.exports = { runVaultSetting };
