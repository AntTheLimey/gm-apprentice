const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { applyDnDFlush } = require('../../lib/flush/dnd-writeback');

const PCS = path.join(__dirname, '../fixtures/with-dnd-pc/Characters/PCs');
const note = file => fs.readFileSync(path.join(PCS, file), 'utf8').replace(/\r\n/g, '\n');
const row = (md, re) => md.split('\n').find(l => re.test(l));
const blob = over => Object.assign({ v: 1, hp: 31, temp: 4, exhaustion: 1, inspiration: false, concentrating: true,
  conditions: ['Poisoned', 'Prone'], used: {} }, over);

test('scalars land in their own cells, and only there', () => {
  const before = note('Brannoch_Vale.md');
  const r = applyDnDFlush(before, blob());
  assert.match(row(r.markdown, /^\| HP \(Current\)/), /\| 31 \|/);
  assert.match(row(r.markdown, /^\| Temp HP/), /\| 4 \|/);
  assert.match(row(r.markdown, /^\| Exhaustion/), /\| 1 \|/);
  assert.match(row(r.markdown, /^\| Conditions/), /\| Poisoned, Prone \|/);
  assert.match(row(r.markdown, /^\| Heroic Inspiration/), /\| No \|/);
  assert.doesNotMatch(r.markdown, /Concentrating/i);
  // Every other line is untouched.
  const a = before.split('\n'), b = r.markdown.split('\n');
  assert.equal(a.length, b.length);
  assert.equal(a.filter((l, i) => l !== b[i]).length, r.changes.length);
  assert.deepEqual(r.skipped, []);
});

test('a cell with a reason keeps it', () => {
  const md = note('Brannoch_Vale.md').replace(/^\| HP \(Current\) \|[^|]*\|/m, '| HP (Current) | 38 (after the fall) |');
  const r = applyDnDFlush(md, blob());
  assert.match(row(r.markdown, /^\| HP \(Current\)/), /\| 31 \(after the fall\) \|/);
});

test('hit dice: the spent half only', () => {
  const r = applyDnDFlush(note('Brannoch_Vale.md'), blob({ used: { 'hd:hit dice': 3 } }));
  assert.match(row(r.markdown, /^\| Hit Dice/), /\| 3\/5 \|/);
});

test('two kinds of hit dice are told apart by their row', () => {
  const r = applyDnDFlush(note('Tamsin_Reed.md'), blob({ used: { 'hd:hit dice d6': 2 } }));
  assert.match(row(r.markdown, /^\| Hit Dice d6/), /\| 2\/2 \|/);
  assert.match(row(r.markdown, /^\| Hit Dice d10/), /\| 1\/3 \|/);
});

test('death saves need both halves', () => {
  const r = applyDnDFlush(note('Brannoch_Vale.md'), blob({ used: { 'ds:s': 1, 'ds:f': 2 } }));
  assert.match(row(r.markdown, /^\| Death Saves/), /\| 1\/2 \|/);
});

test('slots, feature uses and a linked magic item', () => {
  const r = applyDnDFlush(note('Brannoch_Vale.md'), blob({ used: { 'slot:1st': 3, 'class:channel divinity': 2, 'item:wand of magic missiles': 5 } }));
  assert.match(row(r.markdown, /^\| 1st \|/), /^\| 1st \| \d+ \| 3 \|/);
  assert.match(row(r.markdown, /^\| Channel Divinity/), /\| 2 \| 2 \| 1 Short Rest, all Long Rest \|/);
  assert.match(row(r.markdown, /Wand_of_Magic_Missiles/), /\| No \| 7 \| 5 \| 1d6\+1 at dawn \|/);
  assert.deepEqual(r.skipped, []);
});

test('a Pact row', () => {
  const r = applyDnDFlush(note('Oriel_Thackeray.md'), blob({ used: { 'slot:pact (3rd)': 2 } }));
  assert.match(row(r.markdown, /^\| Pact \(3rd\)/), /\| 2 \| 2 \|/);
});

test('no conditions is a dash', () => {
  const md = applyDnDFlush(note('Brannoch_Vale.md'), blob()).markdown;
  const r = applyDnDFlush(md, blob({ conditions: [] }));
  assert.match(row(r.markdown, /^\| Conditions/), /\| — \|/);
});

test('twice is the same as once, and an unchanged note is returned as it came', () => {
  const b = blob({ used: { 'hd:hit dice': 3, 'slot:1st': 2 } });
  const once = applyDnDFlush(note('Brannoch_Vale.md'), b);
  const twice = applyDnDFlush(once.markdown, b);
  assert.equal(twice.markdown, once.markdown);
  assert.deepEqual(twice.changes, []);
});

test('a blank Used cell and a count of 0 is no change', () => {
  const md = '## Class Features\n\n| Name | Action | Uses | Used | Recovers | Summary |\n|---|---|---|---|---|---|\n| Rage |  | 2 |  | Long Rest | a |\n';
  assert.deepEqual(applyDnDFlush(md, { used: { 'class:rage': 0 } }).changes, []);
  assert.match(applyDnDFlush(md, { used: { 'class:rage': 1 } }).markdown, /\| Rage \|  \| 2 \| 1 \| Long Rest \|/);
});

test('a sparse old-layout note changes only where cells exist; every missing cell is named', () => {
  const old = note('Ilse_Varn_Old_Layout.md');
  const r = applyDnDFlush(old, blob({ used: { 'class:no such feature': 1, 'slot:pact (3rd)': 2 } }));
  assert.equal(r.markdown.split('\n').length, old.split('\n').length);
  assert.match(row(r.markdown, /^\| HP \(Current\)/), /\| 31 \|/);
  assert.doesNotMatch(r.markdown, /Temp HP|Exhaustion|Conditions/);
  assert.deepEqual(r.skipped.slice().sort(), ['class:no such feature', 'conditions', 'exhaustion', 'slot:pact (3rd)', 'temp']);
  assert.deepEqual(r.changes.map(c => c.field).sort(), ['HP (Current)', 'Heroic Inspiration']);
});

test('a table inside a code fence is not a sheet', () => {
  const md = '## Stat Sheet\n\n### Combat\n\n```\n| HP (Current) | 9 |\n```\n\n| Attribute | Value |\n|---|---|\n| HP (Current) | 9 |\n';
  const r = applyDnDFlush(md, { hp: 4 });
  assert.equal(r.markdown.split('\n')[5], '| HP (Current) | 9 |');
  assert.equal(r.markdown.split('\n')[10], '| HP (Current) | 4 |');
});

test('Windows line ends survive', () => {
  const md = note('Brannoch_Vale.md').replace(/\n/g, '\r\n');
  const r = applyDnDFlush(md, blob());
  assert.ok(r.changes.length > 0);
  assert.equal(r.markdown.split('\r\n').length, md.split('\r\n').length);
  assert.doesNotMatch(r.markdown.replace(/\r\n/g, ''), /[\r\n]/);
});

test('nothing to write: no blob, an empty blob', () => {
  const md = note('Brannoch_Vale.md');
  assert.equal(applyDnDFlush(md, null).markdown, md);
  assert.deepEqual(applyDnDFlush(md, {}).changes, []);
  assert.deepEqual(applyDnDFlush(md, {}).skipped, []);
});

test('an inspiration cell typed as words is left alone', () => {
  const md = note('Brannoch_Vale.md').replace(/^\| Heroic Inspiration \|[^|]*\|/m, '| Heroic Inspiration | from Odo |');
  assert.match(row(applyDnDFlush(md, blob()).markdown, /^\| Heroic Inspiration/), /from Odo/);
});
