'use strict';

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

module.exports = { SKINS, FRAME_IDS, siteLook, resolveLook, isDressed };
