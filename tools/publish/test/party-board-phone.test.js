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

const boards = () => [
  ['D&D', renderDndBoard(dnd, 'characters/pcs/index.html')],
  ['CoC', renderCoCBoard(coc, 'characters/pcs/index.html')],
  ['GURPS', renderPartyBoard(gurps, 'characters/pcs/index.html')],
];

test('every party board marks its Status cell, which the phone layout moves to its own line', () => {
  for (const [name, html] of boards()) {
    assert.match(html, /<td[^>]*data-gl-party-field="status"/, name);
    assert.match(html, /<th[^>]*>Status<\/th><\/tr><\/thead>/, `${name}: Status is the last header, which the phone rules hide`);
  }
});

test('every party board carries table roles, since the phone layout changes the display type of table parts', () => {
  for (const [name, html] of boards()) {
    assert.match(html, /<table[^>]*role="table"/, name);
    assert.equal((html.match(/role="rowgroup"/g) || []).length, 2, `${name}: thead and tbody`);
    assert.equal((html.match(/<tr(?![^>]*role="row")/g) || []).length, 0, `${name}: every tr has a role`);
    assert.equal((html.match(/<th(?=[\s>])(?![^>]*role="columnheader")/g) || []).length, 0, `${name}: every th has a role`);
    assert.equal((html.match(/<td(?![^>]*role="cell")/g) || []).length, 0, `${name}: every td has a role`);
  }
});

test('the CoC board marks its Rep header so the phone layout can leave it out', () => {
  const withRep = buildCoCPartyManifest('c', [{ name: 'J', outputPath: 'characters/pcs/j.html', portrait: null,
    data: { pcSlug: 'j', dex: 60, player: 'P', hp: { cur: 10, max: 10 }, san: { cur: 50, max: 50 }, mp: { cur: 10, max: 10 }, luck: { cur: 55 }, rep: { cur: 40 }, conditions: {} } }]);
  assert.match(renderCoCBoard(withRep, 'characters/pcs/index.html'), /<th[^>]*class="gl-col-rep"[^>]*>Rep<\/th>/);
});

// The phone rules, found by their media query so a cosmetic reformat does not break the test.
function phoneBlock() {
  const m = css.match(/@media\s*\(\s*max-width:\s*600px\s*\)\s*\{(?:(?!@media)[\s\S])*?\.gl-party-scroll[\s\S]*?\n\}/);
  assert.ok(m, 'a max-width 600px block for the party board');
  return m[0].replace(/\s+/g, ' ');
}

test('style.css takes the Status cell out of the row flow on a phone and keeps headers and cells in step', () => {
  const b = phoneBlock();
  assert.match(b, /\.gl-party-table td\[data-gl-party-field="status"\]\s*\{[^}]*flex:\s*0 0 100%/);
  assert.match(b, /\.gl-party-table th:last-child\s*\{\s*display:\s*none/);
  assert.match(b, /\.gl-party-scroll\s*\{\s*overflow-x:\s*visible/);
  assert.match(b, /\.gl-party-table th,\s*\.gl-party-table td\s*\{[^}]*flex:\s*1 1 0/);
  const size = b.match(/thead th\s*\{[^}]*font-size:\s*([\d.]+)rem/);
  assert.ok(size && Number(size[1]) >= 0.62, 'phone header type is at least 0.62rem');
});
