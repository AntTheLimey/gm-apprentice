'use strict';
// Maps a campaign's system id to its party-board skin. Single source of truth so
// build.js / wiki.js do not hard-code any one system. Keyed by canonical system id,
// as pc-registry.js and live-mount.js are. clientScripts are ORDERED — party-core.js (the shared spine)
// must load before any system client that reads window.__partyCore.
const { systemId } = require('./shared-lists');
const { buildPartyManifest } = require('./party-manifest');
const { renderPartyBoard } = require('./templates/gurps/party-board');
const { buildCoCPartyManifest, renderCoCBoard } = require('./templates/coc/party-board');
const { buildDndPartyManifest, renderDndBoard } = require('./templates/dnd/party-board');

const GURPS = {
  buildManifest: buildPartyManifest,
  renderBoard: renderPartyBoard,
  scriptId: 'gurps-party-data',
  clientScripts: ['party-core.js', 'gurps-live.js', 'gurps-party.js'],
};
const COC = {
  buildManifest: buildCoCPartyManifest,
  renderBoard: renderCoCBoard,
  scriptId: 'coc-party-data',
  clientScripts: ['party-core.js', 'coc-party.js'],
};
const DND = {
  buildManifest: buildDndPartyManifest,
  renderBoard: renderDndBoard,
  scriptId: 'dnd-party-data',
  clientScripts: ['party-core.js', 'dnd-live.js', 'dnd-party.js'],
};
// By canonical system id; the aliases that name each are the shared list (shared-lists.js).
const REGISTRY = {
  'gurps-4e': GURPS,
  'coc-7e': COC, 'coc-7e-regency': COC,
  'dnd-5e-2024': DND,
};

function boardFor(system) {
  const id = systemId(system);
  return (id && REGISTRY[id]) || null;
}

// The sheet family a system id belongs to (gurps, coc or dnd), or null for a system
// with no sheet. explain reports it so the change-request loop reads one system's file.
function sheetFamilyOf(system) {
  const board = boardFor(system);
  return board === GURPS ? 'gurps' : board === COC ? 'coc' : board === DND ? 'dnd' : null;
}

module.exports = { boardFor, sheetFamilyOf };
