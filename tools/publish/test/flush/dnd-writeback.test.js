const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { applyDnDFlush } = require('../../lib/flush/dnd-writeback');
const { parseDnd } = require('../../lib/templates/dnd/parse');
const { buildDndLiveData } = require('../../lib/templates/dnd/live-data');
const { sectionsFromMarkdown } = require('../helpers/sections');

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
  const md = '## Stat Sheet\n\n### Combat\n\n```\n| HP (Current) | 9 |\n```\n\n| Attribute | Value |\n|---|---|\n| HP (Current) | 9 |\n| HP (Max) | 20 |\n';
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

// A small note of the build's own shape: Combat rows and a features table, each given.
const mini = (combat, features, extra = '') => ['## Stat Sheet', '', '### Combat', '', '| Attribute | Value |', '|---|---|',
  ...combat, '', '## Class Features', '', extra, '| Name | Action | Uses | Used | Recovers | Summary |', '|---|---|---|---|---|---|',
  ...features, ''].join('\n');
const rage = (used, name = 'Rage') => `| ${name} |  | 2 | ${used} | Long Rest | a |`;

test('a cell that is not a plain number is left alone and named', () => {
  const md = mini(['| HP (Current) | 20 / 20 |', '| HP (Max) | 20 |', '| Temp HP | 3d4 |', '| Exhaustion | 2 levels |'], []);
  const r = applyDnDFlush(md, { hp: 5, temp: 2, exhaustion: 0 });
  assert.equal(r.markdown, md);
  assert.deepEqual(r.skipped, ['hp', 'temp', 'exhaustion']);
});

test('hit dice with a suffix, and a Used cell with a reason, are not the build\'s to read', () => {
  const md = mini(['| HP (Max) | 20 |', '| Hit Dice (Spent/Max) | 1/5 left |'], [rage('1 (rested)')]);
  const r = applyDnDFlush(md, { used: { 'hd:hit dice': 3, 'class:rage': 2 } });
  assert.equal(r.markdown, md);
  assert.deepEqual(r.skipped.sort(), ['class:rage', 'hd:hit dice']);
});

test('two rows of one name: only the first is live', () => {
  const md = mini([], [rage(''), rage('')]);
  const r = applyDnDFlush(md, { used: { 'class:rage': 1 } });
  assert.equal(r.changes.length, 1);
  assert.equal(r.markdown.split('\n').filter(l => /^\| Rage .*\| 1 \|/.test(l)).length, 1);
  assert.match(r.markdown, /\| Rage \|  \| 2 \| 1 \|[^\n]*\n\| Rage \|  \| 2 \|  \|/);
});

test('a blank HP cell is full hit points: a live 0 is written', () => {
  const md = mini(['| HP (Current) |  |', '| HP (Max) | 20 |'], []);
  assert.match(applyDnDFlush(md, { hp: 0 }).markdown, /\| HP \(Current\) \| 0 \|/);
  assert.deepEqual(applyDnDFlush(md, { hp: 20 }).changes, []);
});

test('a bold feature name is found by its shown text', () => {
  const r = applyDnDFlush(mini([], [rage('', '**Rage**')]), { used: { 'class:rage': 1 } });
  assert.match(r.markdown, /\| \*\*Rage\*\* \|  \| 2 \| 1 \|/);
});

test('the features table is the first one in the section, even under a subheading', () => {
  const md = '## Class Features\n\n### Barbarian\n\n| Name | Action | Uses | Used | Recovers | Summary |\n|---|---|---|---|---|---|\n' + rage('') + '\n';
  assert.match(applyDnDFlush(md, { used: { 'class:rage': 1 } }).markdown, /\| Rage \|  \| 2 \| 1 \|/);
});

test('an over-spent row is drawn as written, so it is not written', () => {
  const md = mini([], [rage('5')]);
  const r = applyDnDFlush(md, { used: { 'class:rage': 1 } });
  assert.equal(r.markdown, md);
  assert.deepEqual(r.skipped, ['class:rage']);
});

test('a ~~~ fence closed by a ``` line stays open', () => {
  const md = mini(['| HP (Max) | 20 |'], []).replace('### Combat\n', '### Combat\n\n~~~\n```\n| Attribute | Value |\n|---|---|\n| HP (Current) | 9 |\n~~~\n');
  const r = applyDnDFlush(md, { hp: 4 });
  assert.match(r.markdown, /\| HP \(Current\) \| 9 \|/);
  assert.deepEqual(r.skipped, ['hp']);
});

test('a second row of a name whose first row is not live is not written either', () => {
  // The build gives the key to the first Rage row; it is over-spent, so the page draws both rows as written.
  const md = mini(['| HP (Max) | 20 |'], ['| Rage |  | 2 | 3 | Long Rest | a |', rage(1)]);
  const r = applyDnDFlush(md, { used: { 'class:rage': 0 } });
  assert.equal(r.markdown, md);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.skipped, ['class:rage']);
});

test('when the first row of a name is live, it alone is written', () => {
  const md = mini(['| HP (Max) | 20 |'], [rage(1), rage(2)]);
  const r = applyDnDFlush(md, { used: { 'class:rage': 0 } });
  assert.equal(r.markdown.split('\n').filter(l => /^\| Rage \|/.test(l)).map(l => l.split('|')[4].trim()).join(','), '0,2');
});

test('the row live on the page is the row flush writes, with a duplicate name', () => {
  const live = md => buildDndLiveData(parseDnd({ type: 'pc' }, sectionsFromMarkdown(md)), { campaignId: 'c', pcSlug: 'p', buildVersion: 'v' });
  const over = mini(['| HP (Max) | 20 |'], ['| Rage |  | 2 | 3 | Long Rest | a |', rage(1)]);
  assert.equal(live(over).tracks.some(t => t.key === 'class:rage'), false);
  assert.deepEqual(applyDnDFlush(over, { used: { 'class:rage': 0 } }).changes, []);
  const fine = mini(['| HP (Max) | 20 |'], [rage(1), rage(2)]);
  assert.equal(live(fine).defaults.used['class:rage'], 1);
  assert.equal(applyDnDFlush(fine, { used: { 'class:rage': 0 } }).changes.length, 1);
});

// What the page reads through the renderer, flush writes: emphasis round a number is kept.
for (const [name, open, close] of [['bold', '**', '**'], ['italic', '*', '*']]) {
  test(`${name} numbers are written, the emphasis and a reason kept`, () => {
    const md = mini([`| HP (Current) | ${open}38${close} (after the fall) |`, '| HP (Max) | 44 |', `| Temp HP | ${open}0${close} |`,
      `| Exhaustion | ${open}1${close} |`, `| Hit Dice (Spent/Max) | ${open}1/5${close} |`, `| Death Saves (S/F) | ${open}0${close}/${open}1${close} |`],
    [rage(`${open}1${close}`)]);
    const r = applyDnDFlush(md, { hp: 31, temp: 4, exhaustion: 2, used: { 'hd:hit dice': 3, 'ds:s': 2, 'ds:f': 1, 'class:rage': 2 } });
    assert.deepEqual(r.skipped, []);
    const row = re => r.markdown.split('\n').find(l => re.test(l));
    assert.match(row(/^\| HP \(Current\)/), new RegExp(`\\| \\${open}31\\${close.split('').join('\\')} \\(after the fall\\) \\|`));
    assert.equal(row(/^\| Temp HP/), `| Temp HP | ${open}4${close} |`);
    assert.equal(row(/^\| Exhaustion/), `| Exhaustion | ${open}2${close} |`);
    assert.equal(row(/^\| Hit Dice/), `| Hit Dice (Spent/Max) | ${open}3/5${close} |`);
    assert.equal(row(/^\| Death Saves/), `| Death Saves (S/F) | ${open}2${close}/${open}1${close} |`);
    assert.equal(row(/^\| Rage/), `| Rage |  | 2 | ${open}2${close} | Long Rest | a |`);
  });
}

test('a bold number with a reason keeps both', () => {
  const md = mini(['| HP (Current) | **38** (after the fall) |', '| HP (Max) | 44 |'], []);
  assert.equal(applyDnDFlush(md, { hp: 31 }).markdown.split('\n').find(l => /^\| HP \(C/.test(l)), '| HP (Current) | **31** (after the fall) |');
});

test('markup that only renders as a number is skipped and named', () => {
  const md = mini(['| HP (Current) | <span>38</span> |', '| HP (Max) | 44 |'], [rage('[[Two|2]]')]);
  const r = applyDnDFlush(md, { hp: 31, used: { 'class:rage': 1 } });
  assert.equal(r.markdown, md);
  assert.deepEqual(r.skipped.sort(), ['class:rage', 'hp']);
});
