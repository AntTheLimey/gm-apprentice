const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildDndPartyManifest, renderDndBoard } = require('../lib/templates/dnd/party-board');
const { buildCoCPartyManifest, renderCoCBoard } = require('../lib/templates/coc/party-board');
const { renderPartyBoard } = require('../lib/templates/gurps/party-board');
const { buildPartyManifest } = require('../lib/party-manifest');

const dnd = buildDndPartyManifest('c', [{ name: 'B', outputPath: 'characters/pcs/b.html', portrait: null,
  data: { system: 'dnd', pcSlug: 'b', hpMax: 44, defaults: { hp: 38, temp: 0, exhaustion: 0, inspiration: false, concentrating: false, conditions: [], used: {} }, tracks: [], board: { who: 'Paladin', ac: '19', pp: '14', dc: '14' } } }]);
const coc = buildCoCPartyManifest('c', [{ name: 'J', outputPath: 'characters/pcs/j.html', portrait: null,
  data: { pcSlug: 'j', dex: 60, player: 'P', hp: { cur: 10, max: 10 }, san: { cur: 50, max: 50 }, mp: { cur: 10, max: 10 }, luck: { cur: 55 }, rep: null, conditions: {} } }]);
const gurps = buildPartyManifest('c', [{ name: 'K', outputPath: 'characters/pcs/k.html', data: {
  pcSlug: 'k', buildVersion: 'v1', basicSpeed: 6, dx: 12, authoredLevel: 0,
  levels: [{ name: 'None', num: 0, maxWeight: 26, move: 6, dodge: 10 }], items: [],
  vitals: { hp: { cur: 11, max: 11 }, fp: { cur: 11, max: 11 }, st: 11 } } }]);

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8').replace(/\r\n/g, '\n');

test('every party board marks its Status cell, which the phone layout moves to its own line', () => {
  for (const html of [renderDndBoard(dnd, 'characters/pcs/index.html'), renderCoCBoard(coc, 'characters/pcs/index.html'), renderPartyBoard(gurps, 'characters/pcs/index.html')]) {
    assert.match(html, /<td[^>]*data-gl-party-field="status"/);
    assert.match(html, /<th>Status<\/th><\/tr><\/thead>/, 'Status is the last header, which the phone rules hide');
  }
});

test('style.css takes the Status cell out of the row flow on a phone', () => {
  const block = css.match(/@media \(max-width: 600px\) \{\n  \.gl-party-scroll \{ overflow-x: visible; \}[\s\S]*?\n\}/);
  assert.ok(block, 'phone block for the party board');
  assert.match(block[0], /\.gl-party-table td\[data-gl-party-field="status"\] \{[^}]*flex: 0 0 100%/);
  assert.match(block[0], /\.gl-party-table th:last-child \{ display: none; \}/);
});
