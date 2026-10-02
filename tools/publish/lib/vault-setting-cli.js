'use strict';

// `vault-setting` command: what the vault file says about a few publish settings, and
// the one place outside `init` and `migrate-config` that writes them. migrate.py asks
// this rather than read the theme or decide which fonts come from Google itself.
//
//   vault-setting --json                      -> { defaultModeSet, fontSource, googleFonts }
//   vault-setting --set <key>=<json> --json   -> { written: [keys] }
const fs = require('fs');
const path = require('path');
const { parseNote } = require('./frontmatter');

const SETTABLE = {
  'theme.default_mode': (v) => ['dark', 'light', 'system'].includes(v),
  'theme.fonts.source': (v) => v === 'self-host',
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
  };
}

function write(options) {
  const { setPublishKeys } = require('./vault-config-edit');
  const vaultPath = vaultPathOf(options);
  const publish = rawPublish(vaultPath);
  const set = {};
  const written = [];
  for (const pair of options.set) {
    const at = pair.indexOf('=');
    const key = at < 0 ? pair : pair.slice(0, at);
    if (!Object.prototype.hasOwnProperty.call(SETTABLE, key)) throw new Error(`vault-setting cannot set ${key}`);
    let value;
    try { value = JSON.parse(pair.slice(at + 1)); } catch { throw new Error(`the value for ${key} is not JSON`); }
    if (at < 0 || !SETTABLE[key](value)) throw new Error(`${JSON.stringify(value)} is not a value ${key} takes`);
    const parts = key.split('.');
    // The whole top-level key is rewritten with the one leaf changed.
    const top = parts[0];
    const base = set[top] !== undefined ? set[top] : publish[top];
    const root = base && typeof base === 'object' && !Array.isArray(base) ? JSON.parse(JSON.stringify(base)) : {};
    let node = root;
    for (const part of parts.slice(1, -1)) {
      if (!node[part] || typeof node[part] !== 'object' || Array.isArray(node[part])) node[part] = {};
      node = node[part];
    }
    node[parts[parts.length - 1]] = value;
    set[top] = root;
    written.push(key);
  }
  // Throws Error(reason) on a refusal, with the file untouched.
  setPublishKeys(vaultPath, set);
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
