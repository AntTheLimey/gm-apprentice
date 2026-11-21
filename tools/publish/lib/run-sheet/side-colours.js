'use strict';
// The run sheet's side colours: a vault setting (vault.run_sheet.side_colours and .own_colours.*), read into the
// model and written by the server's settings route.
const { getPath } = require('../settings/types');
const { REGISTRY } = require('../settings/registry');

const SIDES = ['pc', 'ally', 'foe', 'neutral'];
const HEX = /^#[0-9a-f]{6}$/i;
// The first site tool that reads a `vault.run_sheet` key: an older one stops a player build on an unknown key under
// `vault` (settings/layout.js), so the route does not write for a site pinned to one. Named once; it follows the release.
const SITE_TOOL_FROM = '1.70.47';
const PRESETS = REGISTRY.find((e) => e.name === 'vault.run_sheet.side_colours').values;
const DEFAULT_OWN = Object.fromEntries(SIDES.map((k) => [k, REGISTRY.find((e) => e.name === `vault.run_sheet.own_colours.${k}`).default]));

// { preset, own } from the settings' values, and the prep notes for each own colour that is not #rrggbb (it reads as
// its default).
function readSideColours(values) {
  const warnings = [];
  const held = getPath(values, ['vault', 'run_sheet']) || {};
  const preset = PRESETS.includes(held.side_colours) ? held.side_colours : 'pens';
  const own = {};
  for (const k of SIDES) {
    const v = held.own_colours && held.own_colours[k];
    if (typeof v === 'string' && HEX.test(v.trim())) own[k] = v.trim().toLowerCase();
    else {
      own[k] = DEFAULT_OWN[k];
      if (v !== undefined && v !== DEFAULT_OWN[k]) warnings.push({ kind: 'side-colours', note: null, text: `vault.run_sheet.own_colours.${k} is "${v}", not a colour like #2c7739 (#rrggbb): the default ${DEFAULT_OWN[k]} is used` });
    }
  }
  return { sideColours: { preset, own }, warnings };
}

module.exports = { SIDES, HEX, PRESETS, SITE_TOOL_FROM, DEFAULT_OWN, readSideColours };
