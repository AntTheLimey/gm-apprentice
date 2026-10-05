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
  const r = applyDnDFlush(old, blob({ hp: 9, used: { 'class:no such feature': 1, 'slot:pact (3rd)': 2 } }));
  assert.equal(r.markdown.split('\n').length, old.split('\n').length);
  assert.match(row(r.markdown, /^\| HP \(Current\)/), /\| 9 \|/);
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
  const r = applyDnDFlush(md, { hp: 5, temp: 2, exhaustion: 1 });
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
  const r = applyDnDFlush(md, { used: { 'class:rage': 2 } });
  assert.equal(r.markdown, md);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.skipped, ['class:rage']);
  // A saved 0 for a row the page does not track has lost nothing, so it is not named.
  assert.deepEqual(applyDnDFlush(md, { used: { 'class:rage': 0 } }), { markdown: md, changes: [], skipped: [] });
});

test('when the first row of a name is live, it alone is written', () => {
  const md = mini(['| HP (Max) | 20 |'], [rage(1), rage(2)]);
  const r = applyDnDFlush(md, { used: { 'class:rage': 0 } });
  assert.equal(r.markdown.split('\n').filter(l => /^\| Rage \|/.test(l)).map(l => l.split('|')[4].trim()).join(','), '0,2');
});

test('the row the island counts is the row flush writes, with a duplicate name', () => {
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

// A level-up between sessions: the record was saved against the old sheet. The page cuts a
// saved count to the note's maximum when it reads it; flush does the same, or it would leave
// the row over-spent, which the next build draws as written and no longer tracks.
test('a saved count above the note\'s maximum is cut to it, as the page does', () => {
  const md = note('Brannoch_Vale.md');
  const r = applyDnDFlush(md, blob({ hp: 99, exhaustion: 9, used: { 'slot:1st': 9, 'hd:hit dice': 8, 'class:lay on hands': 40,
    'item:wand of magic missiles': 12, 'ds:s': 5, 'ds:f': 4 } }));
  assert.match(row(r.markdown, /^\| HP \(Current\)/), /\| 44 \|/);
  assert.match(row(r.markdown, /^\| Exhaustion/), /\| 6 \|/);
  assert.match(row(r.markdown, /^\| 1st/), /^\| 1st \| 4 \| 4 \|/);
  assert.match(row(r.markdown, /^\| Hit Dice/), /\| 5\/5 \|/);
  assert.match(row(r.markdown, /^\| Death Saves/), /\| 3\/3 \|/);
  assert.match(row(r.markdown, /^\| Lay on Hands/), /\| 25 \| 25 \|/);
  assert.match(row(r.markdown, /^\| \[\[Wand_of_Magic_Missiles/), /\| 7 \| 7 \|/);
  assert.deepEqual(r.skipped, []);
  // What it wrote, the build still reads as live: every key keeps its track.
  const live = text => buildDndLiveData(parseDnd({ type: 'pc' }, sectionsFromMarkdown(text)), { campaignId: 'c', pcSlug: 'p', buildVersion: 'v' }).tracks.map(t => t.key).sort();
  assert.deepEqual(live(r.markdown), live(md));
});

test('a saved number that is not whole, or below nothing, is fitted as the page fits it', () => {
  const r = applyDnDFlush(note('Brannoch_Vale.md'), blob({ hp: -3, temp: 2.6, exhaustion: -1, used: { 'slot:1st': -2, 'hd:hit dice': 1.4 } }));
  assert.match(row(r.markdown, /^\| HP \(Current\)/), /\| 0 \|/);
  assert.match(row(r.markdown, /^\| Temp HP/), /\| 3 \|/);
  assert.match(row(r.markdown, /^\| Exhaustion/), /\| 0 \|/);
  assert.match(row(r.markdown, /^\| 1st/), /^\| 1st \| 4 \| 0 \|/);
  assert.match(row(r.markdown, /^\| Hit Dice/), /\| 1\/5 \|/);
});

// ---- the fix wave after the two whole-branch reviews ----

// A saved record can be sent by anyone (the endpoint is public), and conditions are the one
// place its text reaches the note. They pass the page's own rule (fitConditions in js/dnd-live.js).
test('condition text from the store cannot leave its cell', () => {
  const md = note('Brannoch_Vale.md');
  const r = applyDnDFlush(md, blob({ conditions: ['Prone |', 'x\n\n## Injected heading\n\n[click](http://evil.example)', '<script>alert(1)</script>', 'Stunned', '[[Secret]]', 'a, b'] }));
  assert.equal(r.markdown.split('\n').length, md.split('\n').length);
  assert.equal(row(r.markdown, /^\| Conditions/), '| Conditions | Stunned |');
  assert.doesNotMatch(r.markdown, /Injected|evil\.example|<script>|Secret/);
});

test('conditions that are not text, or are said twice, are not written', () => {
  const r = applyDnDFlush(note('Brannoch_Vale.md'), blob({ conditions: [1, null, {}, ' Prone ', 'prone', 'x'.repeat(61)] }));
  assert.equal(row(r.markdown, /^\| Conditions/), '| Conditions | Prone |');
});

test('a Conditions cell that says None, or holds a hyphen, is no conditions: nothing to write', () => {
  for (const cell of ['None', 'none', 'N/A', '-', '–', '—', '']) {
    const md = mini([`| Conditions | ${cell} |`, '| HP (Max) | 20 |'], []);
    const r = applyDnDFlush(md, { conditions: [] });
    assert.equal(r.markdown, md, cell);
    assert.deepEqual(r.skipped, [], cell);
    assert.equal(row(applyDnDFlush(md, { conditions: ['Prone'] }).markdown, /^\| Conditions/), '| Conditions | Prone |', cell);
  }
});

// Conditions follow the rule of everything else here: a cell the page shows as written is not live
// and is never rewritten. Flush writes names that pass the rule, and never rendered text.
const condNote = cell => mini([`| Conditions | ${cell} |`, '| HP (Max) | 20 |'], []);
const flushes = (md, record, times) => { const out = []; let text = md; for (let i = 0; i < times; i++) { const r = applyDnDFlush(text, record); out.push(r); text = r.markdown; } return out; };

for (const hostile of ['x&#10;&#10;## Injected&#10;&#10;y', 'a &#124; b', 'a &vert; b', '&lt;script&gt;alert(1)&lt;/script&gt;', '&#91;x&#93;(y)',
  '&#91;&#91;Secret_Note&#93;&#93;', 'A &amp; B', 'A & B']) {
  test(`a character reference in a saved condition never reaches the note, however often flush runs: ${hostile}`, () => {
    const md = condNote('—');
    const [one, two, three] = flushes(md, { conditions: [hostile, 'Stunned'] }, 3);
    assert.equal(one.markdown, md.replace('| Conditions | — |', '| Conditions | Stunned |'));
    assert.deepEqual(two.changes, []);
    assert.equal(three.markdown, one.markdown);
    assert.equal(three.markdown.split('\n').length, md.split('\n').length);
    // And with nothing else in the record the cell is not touched at all.
    for (const r of flushes(md, { conditions: [hostile] }, 3)) { assert.equal(r.markdown, md); assert.deepEqual(r.skipped, []); }
  });
}

for (const cell of ['[[Poisoned]]', 'Hexed [Bob]', 'A\\|B', '**Hexed**', 'Hexed, [see notes](http://example.test)', 'x&#10;y', 'Prone, prone',
  'Cursed by the drowned bell until the tide turns three times over the bar']) {
  test(`a Conditions cell the page shows as written is never rewritten: ${cell}`, () => {
    const md = condNote(cell);
    // The page holds such conditions to the note's own, so that is what it saves: nothing to name.
    const d = buildDndLiveData(parseDnd({ type: 'pc' }, sectionsFromMarkdown(md)), { campaignId: 'c', pcSlug: 'p', buildVersion: 'v' });
    assert.equal(d.conditionsLive, false);
    // (A real build resolves a wikilink first: one to a missing note reaches the page as its plain text.)
    const held = cell === '[[Poisoned]]' ? ['Poisoned'] : d.defaults.conditions;
    for (const record of [{ conditions: held }, { conditions: [] }]) {
      for (const r of flushes(md, record, 3)) { assert.equal(r.markdown, md); assert.deepEqual(r.skipped, []); }
    }
    // A record that says otherwise is named, and still nothing is written.
    for (const r of flushes(md, { conditions: ['Stunned'] }, 3)) { assert.equal(r.markdown, md); assert.deepEqual(r.skipped, ['conditions']); }
  });
}

test('plain names with an apostrophe, a hyphen and round brackets are live, kept, and written back the same', () => {
  const md = condNote('Hexed (Bob\'s curse), Half-blind');
  const d = buildDndLiveData(parseDnd({ type: 'pc' }, sectionsFromMarkdown(md)), { campaignId: 'c', pcSlug: 'p', buildVersion: 'v' });
  assert.equal(d.conditionsLive, true);
  assert.deepEqual(d.defaults.conditions, ['Hexed (Bob\u2019s curse)', 'Half-blind']);
  // What the page saves for an untouched sheet changes nothing, though the page shows a curly apostrophe.
  for (const r of flushes(md, { conditions: d.defaults.conditions }, 2)) { assert.equal(r.markdown, md); assert.deepEqual(r.skipped, []); }
  // A tap adds a name; the others are written as the page holds them, and it is stable.
  const [one, two] = flushes(md, { conditions: d.defaults.conditions.concat('Prone') }, 2);
  assert.equal(row(one.markdown, /^\| Conditions/), '| Conditions | Hexed (Bob\u2019s curse), Half-blind, Prone |');
  assert.deepEqual(two.changes, []);
  const again = buildDndLiveData(parseDnd({ type: 'pc' }, sectionsFromMarkdown(one.markdown)), { campaignId: 'c', pcSlug: 'p', buildVersion: 'v' });
  assert.deepEqual(again.defaults.conditions, ['Hexed (Bob\u2019s curse)', 'Half-blind', 'Prone']);
});

test('the word None in Temp HP or Exhaustion is a blank: it is written over', () => {
  const md = mini(['| HP (Current) | 9 |', '| HP (Max) | 20 |', '| Temp HP | None |', '| Exhaustion | n/a |'], []);
  assert.deepEqual(applyDnDFlush(md, { hp: 9, temp: 0, exhaustion: 0 }).changes, []);
  const r = applyDnDFlush(md, { hp: 9, temp: 5, exhaustion: 2 });
  assert.equal(row(r.markdown, /^\| Temp HP/), '| Temp HP | 5 |');
  assert.equal(row(r.markdown, /^\| Exhaustion/), '| Exhaustion | 2 |');
  assert.deepEqual(r.skipped, []);
});

// A row short of its last cell is live on the page (the renderer pads it). Flush adds no cell,
// so the value has nowhere to go: it is named, never silently dropped.
test('a row short of its last cell is named, not silently skipped', () => {
  const short = ['## Stat Sheet', '', '### Combat', '', '| Attribute | Value |', '|---|---|', '| HP (Current) |', '| HP (Max) | 44 |', '| Temp HP |',
    '| Exhaustion |', '| Conditions |', '', '## Class Features', '', '| Name | Action | Uses | Used | Recovers | Summary |', '|---|---|---|---|---|---|',
    '| Second Wind | Bonus Action | 3 |', '', '## Spellcasting', '', '### Spell Slots', '', '| Level | Total | Expended |', '|---|---|---|', '| 1st | 4 |', '',
    '## Equipment', '', '### Magic Items', '', '| Item | Attuned | Charges | Used | Recovers | Notes |', '|---|---|---|---|---|---|', '| Wand | No | 7 |', ''].join('\n');
  // The page does make every one of these live.
  const d = buildDndLiveData(parseDnd({ type: 'pc' }, sectionsFromMarkdown(short)), { campaignId: 'c', pcSlug: 'p', buildVersion: 'v' });
  assert.deepEqual(d.tracks.map(t => t.key).sort(), ['class:second wind', 'item:wand', 'slot:1st']);
  assert.equal(d.hpMax, 44);
  const r = applyDnDFlush(short, { hp: 30, temp: 5, exhaustion: 2, conditions: ['Prone'], used: { 'class:second wind': 2, 'slot:1st': 1, 'item:wand': 3 } });
  assert.equal(r.markdown, short);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.skipped.slice().sort(), ['class:second wind', 'conditions', 'exhaustion', 'hp', 'item:wand', 'slot:1st', 'temp']);
  // With nothing to save (every value is what a blank cell means) there is nothing to name.
  assert.deepEqual(applyDnDFlush(short, { hp: 44, temp: 0, exhaustion: 0, conditions: [], used: { 'class:second wind': 0, 'slot:1st': 0, 'item:wand': 0 } }).skipped, []);
});

test('a table whose separator has fewer cells than its header is not a table, as the renderer has it', () => {
  const broken = ['## Class Features', '', '| Name | Action | Uses | Used | Recovers | Summary |', '|---|---|---|', rage(1), '',
    '| Name | Action | Uses | Used | Recovers | Summary |', '|---|---|---|---|---|---|', rage(0), ''].join('\n');
  const d = buildDndLiveData(parseDnd({ type: 'pc' }, sectionsFromMarkdown(broken)), { campaignId: 'c', pcSlug: 'p', buildVersion: 'v' });
  assert.equal(d.defaults.used['class:rage'], 0);    // the build reads the real table
  const r = applyDnDFlush(broken, { used: { 'class:rage': 2 } });
  assert.deepEqual(r.skipped, []);
  const lines = r.markdown.split('\n');
  assert.equal(lines[4], rage(1));                   // the broken copy is left alone
  assert.equal(lines[8], rage(2));
});

test('a dash in a number cell is a blank: it is written over', () => {
  for (const dash of ['—', '–', '-']) {
    const md = mini([`| HP (Current) | ${dash} |`, '| HP (Max) | 44 |', `| Temp HP | ${dash} |`, `| Exhaustion | ${dash} |`], []);
    assert.deepEqual(applyDnDFlush(md, { hp: 44, temp: 0, exhaustion: 0 }).changes, [], dash);
    const r = applyDnDFlush(md, { hp: 30, temp: 5, exhaustion: 2 });
    assert.deepEqual(r.skipped, [], dash);
    assert.equal(row(r.markdown, /^\| HP \(C/), '| HP (Current) | 30 |');
    assert.equal(row(r.markdown, /^\| Temp HP/), '| Temp HP | 5 |');
    assert.equal(row(r.markdown, /^\| Exhaustion/), '| Exhaustion | 2 |');
  }
});

// The line under a PC's name is for a value that was lost. A note with no cell, and a saved
// value that is what no cell means, has lost nothing.
test('a value that is nothing is not named when its cell is missing or in words', () => {
  const old = note('Ilse_Varn_Old_Layout.md');
  assert.deepEqual(applyDnDFlush(old, { hp: 9, temp: 0, exhaustion: 0, conditions: [], inspiration: false, used: { 'class:gone': 0 } }).skipped, []);
  assert.deepEqual(applyDnDFlush(old, { hp: 9, temp: 0, exhaustion: 0, conditions: ['Prone'], inspiration: false, used: { 'class:gone': 2 } }).skipped.sort(), ['class:gone', 'conditions']);
  const words = mini(['| HP (Current) | 9 |', '| HP (Max) | 20 |', '| Temp HP | 2d4 |', '| Exhaustion | two levels |'], []);
  assert.deepEqual(applyDnDFlush(words, { hp: 9, temp: 0, exhaustion: 0 }).skipped, []);
  assert.deepEqual(applyDnDFlush(words, { hp: 9, temp: 3, exhaustion: 1 }).skipped, ['temp', 'exhaustion']);
});

test('hit points the page does not track are not written, and temporary hit points go with them', () => {
  // Words in HP (Current), or no readable maximum: no hit point tile, so no temporary hit points either.
  for (const combat of [['| HP (Current) | about half |', '| HP (Max) | 44 |', '| Temp HP | 5 |'], ['| HP (Current) | 12 |', '| HP (Max) | see GM |', '| Temp HP | 5 |']]) {
    const md = mini(combat, [rage(0)]);
    const d = buildDndLiveData(parseDnd({ type: 'pc' }, sectionsFromMarkdown(md)), { campaignId: 'c', pcSlug: 'p', buildVersion: 'v' });
    assert.equal(d.hpMax, null);
    assert.equal(d.tempLive, false);
    // What that page saves: no hit points, and 0 for the temporary hit points it does not hold.
    const r = applyDnDFlush(md, { hp: null, temp: 0, used: { 'class:rage': 1 } });
    assert.equal(row(r.markdown, /^\| Temp HP/), '| Temp HP | 5 |');
    assert.deepEqual(r.changes.map(c => c.field), ['Rage']);
    assert.deepEqual(r.skipped, []);
    // A record made by hand is still named, never written.
    const forced = applyDnDFlush(md, { hp: 3, temp: 9 });
    assert.equal(forced.markdown, md);
    assert.deepEqual(forced.skipped, ['hp', 'temp']);
  }
});
