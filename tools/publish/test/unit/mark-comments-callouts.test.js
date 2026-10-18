'use strict';
// tools/publish/test/unit/mark-comments-callouts.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  strippedLines, playerSafeMarkdown, extractSections,
  htmlCommentsForTest: htmlComments, obsidianCommentsForTest: obsidianComments, calloutLinesForTest: calloutLines,
} = require('../../lib/processor');
const { createMarks, markKinds, unmark } = require('../../lib/gm-marks');

const ALL = new Set(markKinds());
const OPEN = (n) => String.fromCharCode(0xE000) + n.toString(36) + String.fromCharCode(0xE001);
const CLOSE = String.fromCharCode(0xE002);
const setup = (show = ALL) => { const marks = createMarks(); return { marks, mark: { marks, show } }; };

test('1: an inline HTML comment is a mark inside the line, its text shown', () => {
  const { marks, mark } = setup();
  const r = htmlComments('a <!-- note --> b', mark);
  assert.equal(r.text, `a ${OPEN(0)}note${CLOSE} b`);
  assert.deepEqual(marks.get(0), { kind: 'comments', label: 'comment' });
  assert.equal(r.from, null);
});

test('2: a line that is only a comment is a block', () => {
  const { mark } = setup();
  const r = htmlComments('before\n<!-- UNVERIFIED -->\nafter', mark);
  assert.equal(r.text, `before\n\n${OPEN(0)}\n\nUNVERIFIED\n\n${CLOSE}\n\nafter`);
});

test('2b: an UNVERIFIED marker tagged with its session is a comment like any other (#434)', () => {
  const md = 'before\n<!-- UNVERIFIED (Ch4 S12): he fled -->\nafter <!-- UNVERIFIED (S3) --> x';
  assert.equal(htmlComments(md).text, 'before\nafter  x');
  const { mark } = setup();
  assert.equal(htmlComments(md, mark).text,
    `before\n\n${OPEN(0)}\n\nUNVERIFIED (Ch4 S12): he fled\n\n${CLOSE}\n\nafter ${OPEN(1)}UNVERIFIED (S3)${CLOSE} x`);
});

test('3: a multi-line HTML comment is a block', () => {
  const { mark } = setup();
  const r = htmlComments('x\n<!--\nline one\nline two\n-->\ny', mark);
  assert.equal(r.text, `x\n\n${OPEN(0)}\n\nline one\nline two\n\n${CLOSE}\n\ny`);
});

test('3c: fences follow the CommonMark rule: a ~~~ fence, and a longer fence holding a ``` line', () => {
  const { mark } = setup();
  const tilde = '~~~\n> [!warning] Example\n> body\n~~~';
  assert.equal(calloutLines(tilde, true, mark).lines.join('\n'), tilde);
  const longer = '````\n```\n<!-- keep -->\n````';
  assert.equal(htmlComments(longer, mark).text, longer);
});

test('3b: a comment in a fence stays literal', () => {
  const { mark } = setup();
  const md = '```\n<!-- keep -->\n```';
  assert.equal(htmlComments(md, mark).text, md);
});

test('4: %% comments, inline and multi-line; %% in inline code stays literal', () => {
  const { mark } = setup();
  assert.equal(obsidianComments('a %% aside %% b', mark).text, `a ${OPEN(0)}aside${CLOSE} b`);
  const m2 = setup().mark;
  assert.equal(obsidianComments('x\n%%\nfirst\nsecond\n%%\ny', m2).text,
    `x\n\n${OPEN(0)}\n\nfirst\nsecond\n\n${CLOSE}\n\ny`);
  const m3 = setup().mark;
  assert.equal(obsidianComments('use `%%` here', m3).text, 'use `%%` here');
  const m4 = setup().mark;
  assert.equal(obsidianComments('plain text', m4).text, 'plain text');
});

test('4b: unclosed comments keep the warning and are closed at the end', () => {
  const { mark } = setup();
  const r = htmlComments('a\n<!-- open\nrest', mark);
  assert.match(r.warnings[0], /unclosed <!-- comment -->/);
  assert.equal(r.text.split(CLOSE).length - 1, 1);
});

test('5: comments off gives the same lines as the strip', () => {
  const text = 'a <!-- one --> b\n<!-- two -->\n%% three %% c\n\nend';
  const { mark } = setup(new Set(markKinds().filter((k) => k !== 'comments')));
  const off = strippedLines(text, true, mark);
  const strip = strippedLines(text, true);
  assert.deepEqual(off.lines, strip.lines);
});

test('6: a comment inside a gm-only block is marked inside the gm-only mark', () => {
  const { mark } = setup();
  const r = strippedLines('<!-- gm-only -->\nsecret <!-- why -->\n<!-- /gm-only -->', false, mark);
  const text = r.lines.join('\n');
  assert.ok(text.indexOf(OPEN(0)) < text.indexOf(OPEN(1)));
  assert.ok(text.indexOf(OPEN(1)) < text.indexOf(CLOSE));
  assert.equal(text.split(CLOSE).length - 1, 2);
  assert.equal(mark.marks.get(0).kind, 'gm_only_blocks');
  assert.equal(mark.marks.get(1).kind, 'comments');
  assert.equal(r.from, null);
  assert.deepEqual(r.strays, []);
  assert.equal(r.pre, null);
  assert.equal(r.blocks, null);
});

test('7: callouts that would be cut are kept and marked; others are untouched', () => {
  const { marks, mark } = setup();
  const md = 'a\n\n> [!warning] Keeper\n> body\n\nb';
  const r = calloutLines(md, true, mark);
  assert.equal(r.lines.join('\n'), `a\n\n\n${OPEN(0)}\n\n> [!warning] Keeper\n> body\n\n${CLOSE}\n\n\nb`);
  assert.deepEqual(marks.get(0), { kind: 'callouts', label: 'warning callout' });
  const m2 = setup();
  const only = calloutLines(md, ['note'], m2.mark);
  assert.equal(only.lines.join('\n'), md);
  assert.equal(m2.marks.get(0), undefined);
  const m3 = setup();
  assert.equal(calloutLines(md, false, m3.mark).lines.join('\n'), md);
});

test('7b: callouts off in show strips as today', () => {
  const md = 'a\n\n> [!warning] K\n> body\n\nb';
  const { mark } = setup(new Set());
  assert.deepEqual(calloutLines(md, true, mark).lines, calloutLines(md, true).lines);
});

test('8: private-use characters in the note come out as U+FFFD', () => {
  const { mark } = setup();
  const r = strippedLines('x  y <!-- ab -->', true, mark);
  const text = r.lines.join('\n');
  assert.ok(text.includes('x � y'));
  assert.ok(text.includes('a�b'));
  assert.equal(unmark(text).includes(''), false);
});

test('mark mode keeps the dataview strip', () => {
  const { mark } = setup();
  const r = strippedLines('a\n```dataview\nTABLE x\n```\nb', true, mark);
  assert.equal(r.lines.join('\n').includes('TABLE'), false);
});

test('playerSafeMarkdown with a mark returns marked text and no strays', () => {
  const { mark } = setup();
  const r = playerSafeMarkdown('a <!-- c --> b', { mark });
  assert.equal(r.text, `a ${OPEN(0)}c${CLOSE} b`);
  assert.deepEqual(r.strays, []);
  assert.equal(r.openFence, null);
  assert.deepEqual(r.warnings, []);
});

test('G11: a gm-only block spanning a ## heading gives balanced marks in every section', () => {
  const { marks, mark } = setup();
  const md = '## One\nintro\n<!-- gm-only -->\nhidden one\n## Two\nhidden two\n<!-- /gm-only -->\nvisible\n## Three\nend';
  const r = playerSafeMarkdown(md, { mark });
  const sections = extractSections(r.text);
  assert.equal(sections.length, 3);
  for (const s of sections) {
    const html = s.html;
    const opens = (html.match(/[0-9a-z]+/g) || []).length;
    const closes = html.split(CLOSE).length - 1;
    assert.equal(opens, closes, `section ${s.title} balanced`);
  }
  assert.ok(marks.get(0));
});

test('strip mode of playerSafeMarkdown is unchanged', () => {
  const md = 'a <!-- c --> b\n<!-- gm-only -->\nx\n<!-- /gm-only -->\n%% z %%\n> [!note] t\n> u\nend';
  const r = playerSafeMarkdown(md, { excludeCallouts: true });
  assert.equal(r.text, 'a  b\n\nend');
  assert.equal(/[-]/.test(r.text), false);
});
