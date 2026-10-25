'use strict';

// A prop style is a folder: layout.html and style.css, and optionally sheet.html, style.json,
// script.js and pictures or fonts in assets/. The plugin ships some in prop-styles/; a vault adds
// its own, or replaces one of the plugin's whole, in _meta/prop-styles/. Loading only reads the
// files as text: nothing in a style folder runs at build.
const fs = require('fs');
const path = require('path');
const { PROP_STYLE_RE } = require('./note');
const { checkLayout } = require('./layout');
const { within, realOrNull, findUnder } = require('./paths');
const { isValidFamily } = require('../fonts');

const PLUGIN_STYLES_DIR = path.join(__dirname, '..', '..', 'prop-styles');
const VAULT_STYLES_DIR = '_meta/prop-styles';
const STYLE_ASSET_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.woff2', '.woff', '.ttf', '.otf']);
const DEFAULT_SHEET = '<section class="sheet">{{{text}}}</section>';

// The style names directly under `root`, by exact name. The plugin's are its folders; in a vault
// any entry with a style's name counts (a file or a dangling link too), so an override the GM
// meant but got wrong is reported rather than quietly passed over for the plugin's.
function styleNames(root, { foldersOnly }) {
  let entries;
  try { entries = fs.readdirSync(root); } catch { return []; }
  return entries.filter((n) => {
    if (!PROP_STYLE_RE.test(n)) return false;
    if (!foldersOnly) return true;
    try { return fs.statSync(path.join(root, n)).isDirectory(); } catch { return false; }
  });
}

function listStyles({ vaultPath, pluginDir = PLUGIN_STYLES_DIR }) {
  const vaultNames = styleNames(path.join(vaultPath, VAULT_STYLES_DIR), { foldersOnly: false });
  const pluginNames = styleNames(pluginDir, { foldersOnly: true });
  const all = [...new Set([...vaultNames, ...pluginNames])].sort();
  return all.map((name) => (vaultNames.includes(name)
    ? { name, from: 'vault', replaces: pluginNames.includes(name) }
    : { name, from: 'plugin', replaces: false }));
}

const unusable = (name, why, file) => ({
  problem: { detail: `the style "${name}" cannot be used: ${why}`, fix: `fix the style's ${file}` },
});

function readText(real) {
  return fs.readFileSync(real, 'utf8').replace(/^\ufeff/, '');
}

// style.json's values the tool uses, each of the type it expects; anything else is dropped.
function cleanJson(name, raw) {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : name;
  const about = typeof obj.about === 'string' ? obj.about.trim() : '';
  const fonts = Array.isArray(obj.fonts) ? obj.fonts.filter((f) => isValidFamily(f)) : [];
  const fields = {};
  if (obj.fields && typeof obj.fields === 'object' && !Array.isArray(obj.fields)) {
    for (const [key, value] of Object.entries(obj.fields)) {
      if (/^prop_[a-z0-9_]+$/.test(key) && typeof value === 'string') fields[key] = value;
    }
  }
  return { title, about, fonts, fields };
}

function loadStyle(name, { vaultPath, pluginDir = PLUGIN_STYLES_DIR }) {
  if (typeof name !== 'string' || !PROP_STYLE_RE.test(name)) {
    return {
      problem: {
        detail: `prop_style "${name}" is not a style name (lower-case letters, digits and hyphens)`,
        fix: 'write a style name such as terminal',
      },
    };
  }
  const styles = listStyles({ vaultPath, pluginDir });
  const entry = styles.find((s) => s.name === name);
  if (!entry) {
    const names = styles.map((s) => s.name);
    return {
      problem: {
        detail: `the style "${name}" is not one the plugin has or the vault adds in _meta/prop-styles/`,
        fix: names.length ? `use one of: ${names.join(', ')}, or add the style` : `add the style in _meta/prop-styles/${name}/`,
      },
    };
  }
  const root = entry.from === 'vault' ? path.join(vaultPath, VAULT_STYLES_DIR) : pluginDir;
  const rootReal = realOrNull(root);
  if (entry.from === 'vault') {
    // A vault's styles are vault files: like a prop's files, they resolve inside the vault.
    const vaultReal = realOrNull(path.resolve(vaultPath));
    if (!vaultReal || !rootReal || !within(rootReal, vaultReal)) {
      return { problem: { detail: `the style "${name}" cannot be used: ${VAULT_STYLES_DIR}/ is outside the vault`, fix: `make ${VAULT_STYLES_DIR}/ a folder inside the vault, not a link out of it` } };
    }
    let isFolder = false;
    try { isFolder = fs.statSync(path.join(root, name)).isDirectory(); } catch { isFolder = false; }
    if (!isFolder) {
      return {
        problem: {
          detail: `the style "${name}" cannot be used: ${VAULT_STYLES_DIR}/${name} is not a folder`,
          fix: `make ${VAULT_STYLES_DIR}/${name}/ a folder holding layout.html and style.css, or remove it to use the plugin's`,
        },
      };
    }
  }
  const dir = realOrNull(path.join(root, name));
  if (!rootReal || !dir || dir === rootReal || !within(dir, rootReal)) return unusable(name, `${name}/ is outside the style's folder`, `${name}/`);

  // Each file is looked up by its exact name and must real-path inside the style's folder.
  const find = (segments) => findUnder(dir, segments, [dir]);
  const files = {};
  for (const file of ['layout.html', 'style.css', 'sheet.html', 'style.json', 'script.js']) {
    const hit = find([file]);
    if (hit.why === 'outside') return unusable(name, `${file} is outside the style's folder`, file);
    if (hit.why === 'case') return unusable(name, `${hit.name} should be named ${file}`, hit.name);
    files[file] = hit.real || null;
  }
  for (const file of ['layout.html', 'style.css']) {
    if (!files[file]) return unusable(name, `${file} is missing`, file);
  }

  const layout = readText(files['layout.html']);
  const sheet = files['sheet.html'] ? readText(files['sheet.html']) : DEFAULT_SHEET;
  for (const [file, text] of [['layout.html', layout], ['sheet.html', sheet]]) {
    const problems = checkLayout(text, { file });
    if (problems.length) return unusable(name, problems[0], file);
  }

  let raw = {};
  if (files['style.json']) {
    try { raw = JSON.parse(readText(files['style.json'])); } catch (e) {
      return unusable(name, `style.json is not JSON (${e.message})`, 'style.json');
    }
  }

  // assets/: one level, the listed kinds only. Matched by its exact name, as the files are.
  const assets = [];
  let top = [];
  try { top = fs.readdirSync(dir); } catch { top = []; }
  const misspelled = top.find((n) => n !== 'assets' && n.toLowerCase() === 'assets');
  if (misspelled && !top.includes('assets')) return unusable(name, `${misspelled}/ should be named assets/`, `${misspelled}/`);
  const assetsHit = top.includes('assets') ? realOrNull(path.join(dir, 'assets')) : null;
  if (assetsHit) {
    if (!within(assetsHit, dir)) return unusable(name, "assets/ is outside the style's folder", 'assets/');
    let entries = [];
    try { entries = fs.readdirSync(path.join(dir, 'assets')).sort(); } catch { entries = []; }
    for (const n of entries) {
      if (!STYLE_ASSET_EXTS.has(path.extname(n).toLowerCase())) continue;
      const hit = find(['assets', n]);
      if (hit.why === 'outside') return unusable(name, `assets/${n} is outside the style's folder`, `assets/${n}`);
      if (hit.real) assets.push({ source: hit.real, rel: `assets/${n}` });
    }
  }

  return {
    style: {
      name,
      from: entry.from,
      replaces: entry.replaces,
      dir,
      layout,
      sheet,
      json: cleanJson(name, raw),
      css: files['style.css'],
      script: files['script.js'],
      assets,
    },
  };
}

// One load per style name for a build.
function styleLoader({ vaultPath, pluginDir = PLUGIN_STYLES_DIR }) {
  const cache = new Map();
  return (name) => {
    if (!cache.has(name)) cache.set(name, loadStyle(name, { vaultPath, pluginDir }));
    return cache.get(name);
  };
}

module.exports = { PLUGIN_STYLES_DIR, VAULT_STYLES_DIR, STYLE_ASSET_EXTS, listStyles, loadStyle, styleLoader };
