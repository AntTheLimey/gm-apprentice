'use strict';

const fs = require('fs');
const path = require('path');
const { statements } = require('../color-mode');

// Sheet skins and frames: the one place a PC page's look is decided.
// A skin is CSS settings (css/skins/<id>.css); a frame is an inline SVG (frames.js).
const SKINS = {
  plain:       { ownFrame: 'none',    fonts: [] },
  parchment:   { ownFrame: 'laurel',  fonts: ['IM Fell English SC', 'Alegreya'] },
  'case-file': { ownFrame: 'corners', fonts: ['Special Elite', 'Courier Prime'] },
  console:     { ownFrame: 'hex',     fonts: ['Chakra Petch', 'IBM Plex Mono'] },
  ledger:      { ownFrame: 'gilt',    fonts: ['Spectral', 'Spectral SC'] },
};
const FRAME_IDS = ['ring', 'laurel', 'thorns', 'gilt', 'steel', 'corners', 'hex', 'cracked'];

const unset = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const idOf = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : null);

// One setting: its id, or null when unset or unknown (unknown adds a note).
function pick(raw, key, known, notes) {
  if (unset(raw)) return null;
  const id = idOf(raw);
  if (id && known(id)) return id;
  notes.push({ key, value: raw, problem: 'is not a known ' + (key === 'sheet_skin' ? 'skin' : 'frame') });
  return null;
}
const knownSkin = (id) => Object.prototype.hasOwnProperty.call(SKINS, id);
const knownFrame = (id) => id === 'none' || FRAME_IDS.includes(id);

function siteLook(publish) {
  const p = publish && typeof publish === 'object' ? publish : {};
  const notes = [];
  return { skin: pick(p.sheet_skin, 'sheet_skin', knownSkin, notes), frame: pick(p.sheet_frame, 'sheet_frame', knownFrame, notes), notes };
}

// The PC's value, else the campaign's, else the default. Skin and frame resolve apart.
function resolveLook(fm, site) {
  const f = fm && typeof fm === 'object' ? fm : {};
  const s = site || { skin: null, frame: null };
  const notes = [];
  const skin = pick(f.sheet_skin, 'sheet_skin', knownSkin, notes) || s.skin || 'plain';
  const frame = pick(f.sheet_frame, 'sheet_frame', knownFrame, notes) || s.frame || SKINS[skin].ownFrame;
  return { skin, frame, notes };
}

const isDressed = (look) => look.skin !== 'plain' || look.frame !== 'none';

const CSS_DIR = path.join(__dirname, '../../css/skins');
const LIGHT_BLOCK = /^@media\s*\(\s*prefers-color-scheme\s*:\s*light\s*\)$/i;

// One skin file as { base, light }. A file is written dark-first with at most one trailing
// `@media (prefers-color-scheme: light) { ... }`; both parts are returned as bare rules.
function splitLight(css, name) {
  const sts = statements(css);
  const at = sts.map((st, i) => (st.kind === 'at' && LIGHT_BLOCK.test(st.prelude) ? i : -1)).filter((i) => i >= 0);
  if (!at.length) return { base: css, light: null };
  const i = at[0];
  const after = sts.slice(i + 1).map((st) => st.text).join('').replace(/\/\*[\s\S]*?\*\//g, '');
  if (at.length > 1 || after.trim()) {
    throw new Error(`${name}: a light-mode block must be the last thing in the file, and there may be only one`);
  }
  const offset = sts.slice(0, i).reduce((n, st) => n + st.text.length, 0);
  return { base: css.slice(0, offset), light: sts[i].body };
}

// The layer, then each skin in use, in registry order. Plain has no file. Every file goes
// under `@media screen`, its light block under the screen light query, so the build's
// scopeColorScheme can give the reader's light/dark choice to it and print is left alone.
function skinsCss(ids, dir = CSS_DIR) {
  const used = Object.keys(SKINS).filter((id) => id !== 'plain' && ids.includes(id));
  return ['_layer', ...used].map((id) => {
    const name = id + '.css';
    const { base, light } = splitLight(fs.readFileSync(path.join(dir, name), 'utf8'), name);
    let out = `@media screen {\n${base.trim()}\n}\n`;
    if (light !== null) out += `@media screen and (prefers-color-scheme: light) {\n${light.trim()}\n}\n`;
    return out;
  }).join('\n');
}

// The typefaces the skins in use name, once each, in registry order.
function fontFamiliesFor(ids) {
  const out = [];
  for (const id of Object.keys(SKINS)) {
    if (ids.includes(id)) for (const f of SKINS[id].fonts) if (!out.includes(f)) out.push(f);
  }
  return out;
}

// Which skins a vault uses, found before the build so its typefaces can be fetched: the
// campaign's own and each PC's own. It reads the pages through the same scan the build
// uses (scanAllNotes does not parse frontmatter), so a PC the build never sees is not
// counted. It is a superset of what the build dresses: it ignores the manifest and draft
// filters, because fetching one face too many is harmless and missing one is not.
// `scanConfig` is what scanConfigFor returns; `site` is siteLook's answer (the resolved
// config carries it as publishConfig.sheetLook).
function skinsInVault(scanConfig, site) {
  const { scanVaultReport } = require('../scanner');
  const ids = new Set(site.skin ? [site.skin] : []);
  for (const page of scanVaultReport(scanConfig, { quiet: true }).pages) {
    const fm = page.frontmatter || {};
    if (fm.type === 'pc') ids.add(resolveLook(fm, site).skin);
  }
  ids.delete('plain');
  return [...ids];
}

module.exports = { SKINS, FRAME_IDS, siteLook, resolveLook, isDressed, skinsCss, fontFamiliesFor, skinsInVault };
