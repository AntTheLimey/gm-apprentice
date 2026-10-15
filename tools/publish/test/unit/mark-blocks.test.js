'use strict';
// tools/publish/test/unit/mark-blocks.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { stripGmOnly, markedBlocksForTest: markedBlocks } = require('../../lib/processor');
const { createMarks, markKinds } = require('../../lib/gm-marks');

const ALL = new Set(markKinds());
const run = (md, name = 'gm-only', show = ALL) => {
  const marks = createMarks();
  const r = markedBlocks(md, name, { marks, show });
  const O = (n) => String.fromCharCode(0xE000) + n.toString(36) + String.fromCharCode(0xE001);
  return { text: r.text, warnings: r.warnings, O, C: String.fromCharCode(0xE002), marks, r };
};

test('rule 1: a marker on its own line is a panel', () => {
  const { text, O, C, marks } = run('Before.\n\n<!-- gm-only -->\nThe traitor is Vex.\n<!-- /gm-only -->\n\nAfter.');
  assert.equal(text, `Before.\n\n\n${O(0)}\n\nThe traitor is Vex.\n\n${C}\n\n\nAfter.`);
  assert.deepEqual(marks.get(0), { kind: 'gm_only_blocks', label: 'gm-only block' });
});

test('rule 2: one line, inline', () => {
  const { text, O, C, marks } = run('a <!-- spoiler -->X<!-- /spoiler --> b', 'spoiler');
  assert.equal(text, `a ${O(0)}X${C} b`);
  assert.deepEqual(marks.get(0), { kind: 'spoilers', label: 'spoiler block' });
});

test('rule 3: opened mid-line, closed later: the block starts on its own line', () => {
  const { text, O, C } = run('Lead in <!-- gm-only -->secret one\nsecret two\n<!-- /gm-only --> tail');
  assert.equal(text, `Lead in\n\n${O(0)}\n\nsecret one\nsecret two\n\n${C}\n\ntail`);
});

test('rule 4: nested blocks each get a mark', () => {
  const { text, O, C } = run('<!-- gm-only -->\nouter\n<!-- gm-only -->\ninner\n<!-- /gm-only -->\nouter again\n<!-- /gm-only -->');
  assert.ok(text.includes(O(0)) && text.includes(O(1)));
  assert.equal(text.split(C).length - 1, 2);
  // the inner mark sits inside the outer one
  assert.ok(text.indexOf(O(0)) < text.indexOf(O(1)) && text.indexOf(O(1)) < text.indexOf(C));
  assert.ok(text.includes('outer again'));
});

test('rule 5: unclosed runs to the end, with today\'s warning', () => {
  const { text, warnings, C } = run('<!-- gm-only -->\nrest of note');
  assert.ok(text.trimEnd().endsWith(C));
  assert.match(warnings[0], /unclosed <!-- gm-only --> marker/);
});

test('rule 6: an orphan closer is dropped and warned', () => {
  const { text, warnings } = run('a\n<!-- /gm-only -->\nb');
  assert.equal(text.includes('/gm-only'), false);
  assert.match(warnings[0], /without a matching/);
});

test('rule 7: inside a fence a marker is text', () => {
  const md = '```\n<!-- gm-only -->\n```';
  assert.equal(run(md).text, md);
});

test('rule 8: a marker split over lines is one marker', () => {
  const { text, O, C, warnings } = run('a\n<!--\ngm-only\n-->\nsecret\n<!-- /gm-only -->\nb');
  assert.deepEqual(warnings, []);
  assert.equal(text.split(O(0)).length - 1, 1);
  assert.equal(text.split(C).length - 1, 1);
  assert.equal(/gm-only|<!--|-->/.test(text), false);
  assert.ok(text.indexOf(O(0)) < text.indexOf('secret') && text.indexOf('secret') < text.indexOf(C));
});

test('every line is kept and the result carries lines and no from', () => {
  const { r } = run('a\n<!-- gm-only -->\nx\n<!-- /gm-only -->\nb');
  assert.equal(r.from, null);
  assert.equal(r.lines.join('\n'), r.text);
});

test('a kind that is off strips as today', () => {
  const md = 'a\n<!-- gm-only -->\nx\n<!-- /gm-only -->\nb';
  const r = run(md, 'gm-only', new Set());
  assert.equal(r.text, stripGmOnly(md));
});

test('without a mark the strip is today\'s', () => {
  const md = 'a\n<!-- gm-only -->\nx\n<!-- /gm-only -->\nb';
  assert.equal(markedBlocks(md, 'gm-only').text, stripGmOnly(md));
  assert.ok(Array.isArray(markedBlocks(md, 'gm-only').from));
});
