'use strict';
// Writes a vault's settings and state files for a test: the one place a test makes them.
// `writeSettings` takes the settings as the new file holds them: nested groups, or flat dotted names
// (`{ 'player_site.title': 'T' }`), or both. `writeState` writes `_meta/vault-state.json`.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const YAML = require('yaml');
const { NEW_FILE, STATE_FILE, at } = require('../../lib/settings/layout');

const FIXTURES = path.join(__dirname, '..', 'fixtures') + path.sep;

function put(vaultDir, rel, text) {
  if ((path.resolve(vaultDir) + path.sep).startsWith(FIXTURES)) throw new Error(`${vaultDir} is a shared fixture: copy it before writing settings into it`);
  const file = at(vaultDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

// { 'a.b': 1, a: { c: 2 } } -> { a: { b: 1, c: 2 } }
function nest(flat) {
  const out = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let at = out;
    for (const p of parts.slice(0, -1)) {
      if (typeof at[p] !== 'object' || at[p] === null || Array.isArray(at[p])) at[p] = {};
      at = at[p];
    }
    const last = parts[parts.length - 1];
    if (value && typeof value === 'object' && !Array.isArray(value) && at[last] && typeof at[last] === 'object') Object.assign(at[last], value);
    else at[last] = value;
  }
  return out;
}

// The settings file's text for `settings` (for a test that hands a vault over as { path: text }).
const settingsText = (settings) => (typeof settings === 'string' ? settings : YAML.stringify(nest(settings)));

// `settings` is an object (written as YAML) or the file's text as it should be written.
function writeSettings(vaultDir, settings = {}) {
  return put(vaultDir, NEW_FILE, settingsText(settings));
}

function writeState(vaultDir, state = {}) {
  return put(vaultDir, STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

// Deep-merges `settings` (nested or dotted) into the settings file the vault already has (or makes one).
function mergeSettings(vaultDir, settings) {
  const file = at(vaultDir, NEW_FILE);
  const had = fs.existsSync(file) ? (YAML.parse(fs.readFileSync(file, 'utf8')) || {}) : {};
  const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const merge = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = isMap(v) && isMap(out[k]) ? merge(out[k], v) : v;
    return out;
  };
  return writeSettings(vaultDir, merge(had, nest(settings)));
}

// The keys a site folder's vault.config.json used to hold campaign settings under, and where each lives now.
const SITE_KEY_HOME = {
  siteTitle: 'player_site.title', folderMap: 'player_site.folder_map', system: 'vault.system', attachmentsDir: 'vault.attachments',
  excludeDirs: 'player_site.hide.folders', excludeSections: 'player_site.hide.sections', excludeFields: 'player_site.hide.fields',
  excludeCallouts: 'player_site.hide.callouts', searchEnabled: 'player_site.features.search', outputDir: 'player_site.output', siteUrl: 'player_site.url', host: 'player_site.host',
  cloudflarePagesProject: 'player_site.cloudflare_project', preserveDirs: 'player_site.keep',
};

// Writes a site folder's vault.config.json holding only `vaultPath`; every other key in `obj` goes to the vault's settings
// under its new name (an `outputDir` inside the site folder becomes a relative path).
function writeSiteConfig(configPath, obj, space) {
  const { vaultPath: given, ...rest } = obj;
  let vaultPath = given;
  // A shared fixture is never written into: the build runs over a copy of it.
  if (Object.keys(rest).length && (path.resolve(given) + path.sep).startsWith(FIXTURES)) {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-copy-'));
    fs.cpSync(given, vaultPath, { recursive: true });
  }
  const settings = {};
  for (const [key, value] of Object.entries(rest)) {
    if (!SITE_KEY_HOME[key]) throw new Error(`writeSiteConfig: no home for ${key}`);
    let v = value;
    if (key === 'outputDir' && typeof v === 'string') v = path.isAbsolute(v) ? path.relative(path.dirname(configPath), v) : v.replace(/^\.\//, '');
    // A hiding list given here adds to the one the vault's settings already hold (the vault's entries first).
    if (['excludeDirs', 'excludeSections', 'excludeFields'].includes(key) && Array.isArray(v) && fs.existsSync(at(vaultPath, NEW_FILE))) {
      const held = SITE_KEY_HOME[key].split('.').reduce((o, k) => (o ? o[k] : undefined), YAML.parse(fs.readFileSync(at(vaultPath, NEW_FILE), 'utf8')) || {});
      if (Array.isArray(held)) v = [...held, ...v.filter((x) => !held.includes(x))];
    }
    settings[SITE_KEY_HOME[key]] = v;
  }
  if (Object.keys(settings).length) mergeSettings(vaultPath, settings);
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath }, null, space));
}

// A test written against the old settings file keeps its fixture text: the old file's front matter (a `publish:` block and
// a few top-level keys) is read as the settings those names stand for, and written as the new file under their current names.
// An old name that stands for nothing is kept under player_site, where it is an unknown name.
function currentNameOf(dotted, top) {
  const { REGISTRY } = require('../../lib/settings/registry');
  const want = top ? dotted : `publish.${dotted}`;
  const e = REGISTRY.find((x) => (x.was || []).some((w) => w.in === 'vault' && w.name === want));
  return e ? e.name : null;
}
function flattenOld(obj, prefix, out, top) {
  for (const [k, v] of Object.entries(obj || {})) {
    const dotted = prefix ? `${prefix}.${k}` : k;
    const name = currentNameOf(dotted, top);
    if (name) out[name] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) flattenOld(v, dotted, out, top);
    else out[top ? `vault.${dotted}` : `player_site.${dotted}`] = v;
  }
  return out;
}
function oldFileSettings(fileText) {
  const m = String(fileText).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const data = (m && YAML.parse(m[1])) || {};
  const { publish, type, ...top } = data;
  const flat = flattenOld(publish, '', {}, false);
  flattenOld(top, '', flat, true);
  return flat;
}
// Writes the settings file a test's old-file text stands for (no file at all when it holds nothing).
function writeFromOldText(dirOrMeta, fileText) {
  const vault = path.basename(dirOrMeta) === '_meta' ? path.dirname(dirOrMeta) : dirOrMeta;
  const flat = oldFileSettings(fileText);
  if (Object.keys(flat).length) writeSettings(vault, flat);
}

module.exports = { oldFileSettings, writeFromOldText, writeSettings, writeState, mergeSettings, writeSiteConfig, settingsText, nest, NEW_FILE };
