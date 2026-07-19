'use strict';
// Maps a campaign's system id to its party-board skin. Single source of truth so
// build.js / wiki.js do not hard-code any one system. Keys mirror pc-registry.js
// and live-mount.js. clientScripts are ORDERED — party-core.js (the shared spine)
// must load before any system client that reads window.__partyCore.
const { buildPartyManifest } = require('./party-manifest');
const { renderPartyBoard } = require('./templates/gurps/party-board');
const { buildCoCPartyManifest, renderCoCBoard } = require('./templates/coc/party-board');

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
const REGISTRY = {
  'gurps': GURPS, 'gurps-4e': GURPS,
  'coc': COC, 'coc-7e': COC, 'regency-cthulhu': COC,
};

function boardFor(system) {
  if (!system) return null;
  return REGISTRY[String(system).toLowerCase()] || null;
}

module.exports = { boardFor };
