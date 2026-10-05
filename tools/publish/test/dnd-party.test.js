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
  // Markup is not a condition at all (fitConditions); what is left is still escaped.
  const status = dndRowCells(pc, { conditions: ['<img src=x>', 'Hexed & "marked"'] }).status;
  assert.doesNotMatch(status, /<img|&lt;img/);
  assert.match(status, /Hexed &amp; &quot;marked&quot;/);
});

test('a rubbish record paints no NaN, keeps hit points inside 0..max, and escapes its text', () => {
  const pc = buildDndPartyManifest('camp', [entry('B', 'b')]).pcs[0];
  const c = dndRowCells(pc, { hp: 'x', temp: -3, exhaustion: 99, conditions: [7, '<b>', 'A & B'], used: { 'ds:s': 'a' } });
  for (const k of ['hp', 'status', 'ac', 'pp', 'dc', 'who']) assert.doesNotMatch(String(c[k]), /NaN/, k);
  const shownHp = Number(c.hp.match(/gl-vnum[^>]*>(\d+)</)[1]);
  assert.ok(shownHp >= 0 && shownHp <= 44, String(shownHp));
  assert.match(c.status, /A &amp; B/);
  assert.doesNotMatch(c.status, /<b>|&lt;b&gt;/);
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

test('an unreadable PC keeps its note facts and dashes whatever the store holds', () => {
  const pc = buildDndPartyManifest('camp', [{ name: 'Bare', outputPath: 'characters/pcs/bare.html', portrait: null,
    data: { pcSlug: 'bare', unreadable: true, board: { who: 'Level 3 Rogue', ac: '15', pp: '', dc: '' } } }]).pcs[0];
  assert.equal(pc.unreadable, true);
  const saved = { hp: 0, temp: 5, conditions: ['Prone'], used: { 'ds:s': 1, 'ds:f': 3 } };
  const c = dndRowCells(pc, saved);
  assert.deepEqual(c, dndRowCells(pc, null));
  assert.match(c.ac, />15</);
  assert.match(c.hp, /—/);
  assert.doesNotMatch(c.status + c.rowClass, /Dying|Fine|hurt|Prone/);
});

// Hit points have no one-third line and are not a wound track: the bar is the sheet's own, green,
// with no tick, and the number is marked only at 0.
test('the hit point bar is the D&D one at full, half and low hit points', () => {
  const pc = buildDndPartyManifest('camp', [entry('B', 'b')]).pcs[0];
  for (const [hp, pct] of [[44, 100], [22, 50], [5, 11], [0, 0]]) {
    const c = dndRowCells(pc, { hp }).hp;
    assert.match(c, new RegExp(`<span class="dnd5e-bar"><span class="dnd5e-bar-fill" style="width:${pct}%"></span></span>`), String(hp));
    assert.doesNotMatch(c, /gl-bar|gl-third/, String(hp));
    assert.equal(/gl-low/.test(c), hp === 0, String(hp));
  }
});

test('the manifest says when temporary hit points or exhaustion are not live, and the row then holds none', () => {
  const pc = buildDndPartyManifest('camp', [entry('B', 'b', { tempLive: false, exhaustionLive: false })]).pcs[0];
  assert.equal(pc.tempLive, false);
  assert.equal(pc.exhaustionLive, false);
  const c = dndRowCells(pc, { hp: 20, temp: 7, exhaustion: 3 });
  assert.doesNotMatch(c.hp, /temp/);
  assert.doesNotMatch(c.status, /Exhaustion/);
  const live = buildDndPartyManifest('camp', [entry('B', 'b', { tempLive: true, exhaustionLive: true })]).pcs[0];
  assert.match(dndRowCells(live, { hp: 20, temp: 7, exhaustion: 3 }).hp, /\+7 temp/);
});
