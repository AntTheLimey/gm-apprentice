'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../lib/run-sheet/plan-text');

test('sections keeps order, duplicates and the lead', () => {
  const body = 'lead\n\n## B\none\n### sub\nx\n## A\ntwo\n## B\nthree\n';
  assert.deepEqual(t.sections(body, 2), [
    { title: '', text: 'lead' },
    { title: 'B', text: 'one\n### sub\nx' },
    { title: 'A', text: 'two' },
    { title: 'B', text: 'three' },
  ]);
  assert.deepEqual(t.sections('## Only\nx', 2), [{ title: 'Only', text: 'x' }]);
  assert.deepEqual(t.sections('', 2), []);
});

test('a label value runs to the next label or blank line', () => {
  const l = t.labels('**Situation:** a\nb\n**Starts it:** c');
  assert.deepEqual(l, [
    { name: 'Situation', value: 'a b', start: 0, end: 1 },
    { name: 'Starts it', value: 'c', start: 2, end: 2 },
  ]);
  assert.equal(t.labels('**Situation:** a\n\nb')[0].value, 'a');
  assert.equal(t.labels('- **Wants:** x\n- other')[0].value, 'x');
  assert.equal(t.labels('**A:** x\n> q\n| t |')[0].value, 'x');
  assert.equal(t.labels('**Trigger:** x\n**Then**\n- y')[0].value, 'x');
  assert.deepEqual(t.labels(''), []);
});

test('a repeated label keeps both', () => {
  const x = '**Starts it:** x\n\n**Starts it:** y';
  assert.equal(t.labels(x).length, 2);
  assert.equal(t.label(x, 'Starts it'), 'x\n\ny');
  assert.equal(t.label(x, 'Nope'), '');
});

test('block stops at the next label or quote', () => {
  const x = '**Notes**\nline one\n\nline two\n**Then:** z\n';
  assert.deepEqual(t.block(x, 'Notes'), { value: 'line one\n\nline two', start: 0, end: 3 });
  assert.equal(t.block('**Notes:**\nq\n> quote\nafter', 'notes').value, 'q');
  assert.deepEqual(t.block('nothing', 'Notes'), { value: '', start: -1, end: -1 });
});

test('bullets marks checkboxes and folds nested lines', () => {
  const x = '- plain\n  - nested\n- [ ] open\n- [x] done\n\n- last\n  wrapped';
  assert.deepEqual(t.bullets(x), [
    { text: 'plain\n  - nested', box: false, start: 0, end: 1 },
    { text: 'open', box: true, start: 2, end: 2 },
    { text: 'done', box: true, start: 3, end: 3 },
    { text: 'last\n  wrapped', box: false, start: 5, end: 6 },
  ]);
  assert.deepEqual(t.bullets(''), []);
});

test('tableRows drops header and separator, keeps an escaped pipe', () => {
  const x = '| A | B |\n|---|:-:|\n| [[X|y]] | a \\| b |\n| c | d |';
  assert.deepEqual(t.tableRows(x), [['[[X|y]]', 'a \\| b'], ['c', 'd']]);
  assert.deepEqual(t.tableRows('no table'), []);
});

test('links drops labels and headings', () => {
  assert.deepEqual(t.links('[[A#h|label]] and [[B]] and [[A]] ![[pic.png]] [[C\\|x]]'), ['A', 'B', 'A', 'C']);
  assert.deepEqual(t.links(''), []);
});

test('readAloud joins quoted lines', () => {
  assert.equal(t.readAloud('x\n> [!quote] Read\n> one\n>\n> two\ny\n> three'), 'one\n\ntwo\n\nthree');
  assert.equal(t.readAloud('none'), '');
});

test('unclaimed returns the lines no field took', () => {
  const x = '**A:** 1\n\nstray\n**B:** 2\n\nlast';
  assert.equal(t.unclaimed(x, t.labels(x)), 'stray\n\nlast');
  assert.equal(t.unclaimed(x, [{ start: 0, end: 5 }]), '');
  assert.equal(t.unclaimed('', []), '');
  assert.equal(t.unclaimed('a\nb', undefined), 'a\nb');
});

test('crlf reads the same as lf', () => {
  const lf = '## S\n**A:** x\ny\n- [ ] b\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.deepEqual(t.sections(crlf, 2), t.sections(lf, 2));
  assert.deepEqual(t.labels(crlf), t.labels(lf));
  assert.deepEqual(t.bullets(crlf), t.bullets(lf));
});

test('comments are removed without shifting line indexes', () => {
  const x = 'a <!-- gone --> b\n<!-- multi\nline -->\n**A:** v\n\nstray';
  assert.deepEqual(t.labels(x), [{ name: 'A', value: 'v', start: 3, end: 3 }]);
  assert.equal(t.unclaimed(x, t.labels(x)), 'a  b\n\n\n\nstray');
  assert.equal(t.sections('## S\nx <!-- y -->', 2)[0].text, 'x');
  assert.equal(t.label('**A:** v <!-- c', 'A'), 'v');
});

test('ranges: tableRanges and readAloudRanges cover what was read', () => {
  const x = 'a\n| H |\n|---|\n| r |\nb\n> q1\n> q2\nc\n> q3';
  assert.deepEqual(t.tableRanges(x), [{ start: 1, end: 3 }]);
  assert.deepEqual(t.readAloudRanges(x), [{ start: 5, end: 6 }, { start: 8, end: 8 }]);
  assert.equal(t.unclaimed(x, [...t.tableRanges(x), ...t.readAloudRanges(x)]), 'a\n| H |\n|---|\n| r |\nb\n> q1\n> q2\nc\n> q3'.split('\n').filter((l) => ['a', 'b', 'c'].includes(l)).join('\n'));
  assert.deepEqual(t.tableRanges(''), []);
  assert.deepEqual(t.readAloudRanges(''), []);
});

test('blocks finds every match and a link-named label is block content', () => {
  const x = '**NPCs**\n- **[[Ash]]:** wants it\n- **[[Fen]] (2):** waits\n**Then:** z\n**npcs:**\n- c';
  const bs = t.blocks(x, 'NPCs');
  assert.deepEqual(bs.map((b) => [b.start, b.end, b.value]), [
    [0, 2, '- **[[Ash]]:** wants it\n- **[[Fen]] (2):** waits'],
    [4, 5, '- c'],
  ]);
  assert.equal(bs[0].sub, '- **[[Ash]]:** wants it\n- **[[Fen]] (2):** waits');
  assert.deepEqual(t.block(x, 'NPCs'), { value: bs[0].value, start: 0, end: 2 });
  assert.equal(t.endsBlock('- **[[Ash]]:** x'), false);
  assert.equal(t.endsBlock('**Then:** z'), true);
  assert.equal(t.endsBlock('**Then**'), true);
  assert.equal(t.endsBlock('> q'), true);
  assert.equal(t.endsBlock('- plain'), false);
  assert.equal(t.endsBlock('**Open to the party** (any order)'), true);
});

test('a comment opener inside a fenced block stays literal', () => {
  const x = '```\n<!-- not a comment\n```\n**A:** v <!-- c -->\nafter';
  assert.equal(t.cleanText(x), '```\n<!-- not a comment\n```\n**A:** v \nafter');
  assert.equal(t.labels(x)[0].start, 3);
});

test('an empty-valued label is a block head and does not run on', () => {
  const x = '**NPCs:**\n- a\nplain';
  assert.deepEqual(t.labels(x), [{ name: 'NPCs', value: '', start: 0, end: 0 }]);
  const b = t.block(x, 'NPCs');
  assert.equal(b.value, '- a\nplain');
  assert.equal(b.start, 0);
  assert.equal(b.end, 2);
  assert.equal(t.label(x, 'NPCs'), '');
  assert.equal(t.unclaimed(x, [...t.labels(x), b]), '');
});

test('bullets, tables and links skip fenced code', () => {
  const x = '- real\n```\n- fake [[Nope]]\n| a |\n| b |\n```\n[[Yes]]\n| h |\n|---|\n| r |';
  assert.deepEqual(t.bullets(x).map((b) => b.text), ['real']);
  assert.deepEqual(t.links(x), ['Yes']);
  assert.deepEqual(t.tableRows(x), [['r']]);
  assert.deepEqual(t.tableRanges(x), [{ start: 7, end: 9 }]);
});

test('a bulleted bold-label line inside a block is block content; a bare label still ends it', () => {
  const x = '**Then**\n- first\n- **Bold lead:** more of the same block\n- last\n**Trigger:** next field';
  const b = t.block(x, 'Then');
  assert.equal(b.value, '- first\n- **Bold lead:** more of the same block\n- last');
  assert.equal(b.end, 3);
  // after a blank line the same bullet opens the next field, as a scene note's block then a stub's fields do
  const y = '**Treasure**\n- loot\n\n- **Purpose:** the stub field';
  assert.equal(t.block(y, 'Treasure').value, '- loot');
});

test('a separator is the second line of a table only; a dash row is a row', () => {
  assert.deepEqual(t.tableRows('| A | B |\n|---|---|\n| - | - |\n| x | y |'), [['-', '-'], ['x', 'y']]);
  // no separator: every line is a row, the first included
  assert.deepEqual(t.tableRows('| a | b |\n| c | d |'), [['a', 'b'], ['c', 'd']]);
  // a dash row lower down is a row, not a second header
  assert.deepEqual(t.tableRows('| a |\n| b |\n|---|'), [['a'], ['b'], ['---']]);
  // two tables each drop their own header
  assert.deepEqual(t.tableRows('| H |\n|---|\n| 1 |\n\ntext\n\n| G |\n|:-:|\n| 2 |'), [['1'], ['2']]);
  assert.equal(t.isSeparatorRow('| - | - |'), true);
  assert.equal(t.isSeparatorRow('| - | x |'), false);
  assert.equal(t.isSeparatorRow('no table'), false);
});

test('a closing run of # needs a space before it, as notes.js reads note headings', () => {
  assert.deepEqual(t.sections('## C#\nx\n## Done ##\ny', 2), [{ title: 'C#', text: 'x' }, { title: 'Done', text: 'y' }]);
  assert.equal(t.HEADING_LINE.exec('## C#')[2], 'C#');
});
