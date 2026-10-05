const { test } = require('node:test');
const assert = require('node:assert');
const { dndRowCells } = require('../js/dnd-party.js');
const { buildDndPartyManifest, renderDndBoard } = require('../lib/templates/dnd/party-board');
const { boardFor } = require('../lib/party-board-registry');

const DS = [
  { key: 'ds:s', label: 'Death saves made', max: 3, used: 0, rest: 'reset', fill: 'made' },
  { key: 'ds:f', label: 'Death saves failed', max: 3, used: 0, rest: 'reset', fill: 'made' },
];
const data = (slug, over) => Object.assign({
  system: 'dnd', pcSlug: slug, hpMax: 44,
  defaults: { hp: 38, temp: 0, exhaustion: 0, inspiration: false, concentrating: false, conditions: [], used: { 'ds:s': 0, 'ds:f': 0, 'slot:1st': 1 } },
  tracks: [{ key: 'slot:1st', label: '1st', max: 4, used: 1, rest: 'long' }, ...DS],
  board: { who: 'Level 5 Paladin', ac: '19', pp: '14', dc: '14' },
}, over);
const entry = (name, slug, over) => ({ name, outputPath: `characters/pcs/${slug}.html`, portrait: null, data: data(slug, over) });

test('the manifest is sorted by name and carries only what the board needs', () => {
  const m = buildDndPartyManifest('camp', [entry('Tamsin', 'tamsin'), entry('Brannoch', 'brannoch')]);
  assert.deepEqual(m.pcs.map(p => p.name), ['Brannoch', 'Tamsin']);
  assert.deepEqual(m.pcs[0].tracks.map(t => t.key), ['ds:s', 'ds:f']);
  assert.equal(m.campaignId, 'camp');
  assert.equal(buildDndPartyManifest('camp', []), null);
});

test('a row from the note alone', () => {
  const pc = buildDndPartyManifest('camp', [entry('Brannoch', 'brannoch')]).pcs[0];
  const c = dndRowCells(pc, null);
  assert.match(c.hp, />38<span class="gl-max">\/44</);
  assert.match(c.ac, />19</);
  assert.match(c.pp, />14</);
  assert.match(c.status, /Fine/);
});

test('a row follows the saved state: temporary hit points, dying, conditions', () => {
  const pc = buildDndPartyManifest('camp', [entry('Brannoch', 'brannoch')]).pcs[0];
  const c = dndRowCells(pc, { hp: 0, temp: 5, exhaustion: 2, concentrating: true, inspiration: true, conditions: ['Prone'], used: { 'ds:s': 1, 'ds:f': 2 } });
  assert.match(c.hp, />0<span class="gl-max">\/44/);
  assert.match(c.hp, /\+5 temp/);
  assert.match(c.status, /Dying: 1 saved, 2 failed/);
  assert.match(c.status, /Prone/);
  assert.match(c.status, /Exhaustion 2/);
  assert.match(c.status, /Concentrating/);
  assert.match(c.status, /Inspired/);
  assert.equal(c.rowClass, 'hurt');
});

test('a condition typed in the note cannot inject markup', () => {
  const pc = buildDndPartyManifest('camp', [entry('B', 'b')]).pcs[0];
  assert.doesNotMatch(dndRowCells(pc, { conditions: ['<img src=x>'] }).status, /<img/);
});

test('no hit point maximum, no spell DC: dashes', () => {
  const pc = buildDndPartyManifest('camp', [entry('B', 'b', { hpMax: null, board: { who: '', ac: '', pp: '', dc: '' } })]).pcs[0];
  const c = dndRowCells(pc, null);
  for (const k of ['hp', 'ac', 'pp', 'dc']) assert.match(c[k], /—/, k);
});

test('the board: one row per PC, hooked for the live paint, live mark only when live', () => {
  const m = buildDndPartyManifest('camp', [entry('Brannoch', 'brannoch'), entry('Tamsin', 'tamsin')]);
  const on = renderDndBoard(m, 'characters/pcs/index.html', { live: true });
  assert.equal([...on.matchAll(/data-gl-party="/g)].length, 2);
  assert.match(on, /data-gl-party="brannoch"/);
  for (const f of ['ac', 'hp', 'pp', 'dc', 'status']) assert.match(on, new RegExp(`data-gl-party-field="${f}"`));
  assert.match(on, /gl-party-live/);
  assert.match(on, /<th>Spell DC<\/th>/);
  assert.doesNotMatch(renderDndBoard(m, 'characters/pcs/index.html', { live: false }), /gl-party-live/);
  assert.equal(renderDndBoard(null, 'x.html', {}), null);
});

test('the registry knows D&D, and still not Pathfinder', () => {
  const b = boardFor('dnd-5e-2024');
  assert.equal(b.scriptId, 'dnd-party-data');
  assert.deepEqual(b.clientScripts, ['party-core.js', 'dnd-live.js', 'dnd-party.js']);
  assert.equal(boardFor('dnd'), b);
  assert.equal(boardFor('pf2e'), null);
});
