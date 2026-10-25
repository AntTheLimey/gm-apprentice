const { test } = require('node:test');
const assert = require('node:assert');
const { cutHtml } = require('../../lib/props/html-cut');

test('cuts a gm-only block and keeps the rest byte for byte', () => {
  const r = cutHtml('<p>A</p>\r\n<!-- gm-only --><p>Keeper only</p><!-- /gm-only -->\r\n<p>B</p>');
  assert.strictEqual(r.text, '<p>A</p>\r\n\r\n<p>B</p>');
  assert.deepStrictEqual(r.cut, ['<p>Keeper only</p>']);
  assert.deepStrictEqual(r.warnings, []);
});

test('a marker split over CRLF lines is a marker', () => {
  assert.strictEqual(cutHtml('<!--\r\nGM-ONLY\r\n-->x<!-- /gm-only -->y').text, 'y');
});

test('nested blocks close only themselves', () => {
  const r = cutHtml('a<!-- gm-only -->b<!-- gm-only -->c<!-- /gm-only -->d<!-- /gm-only -->e');
  assert.strictEqual(r.text, 'ae');
});

test('spoiler blocks are cut too', () => {
  assert.strictEqual(cutHtml('a<!-- spoiler -->b<!-- /spoiler -->c').text, 'ac');
});

test('an unclosed block cuts to the end and warns', () => {
  const r = cutHtml('a<!-- gm-only -->b');
  assert.strictEqual(r.text, 'a');
  assert.deepStrictEqual(r.warnings, ['unclosed <!-- gm-only --> marker in a prop file — the rest of the file is cut']);
  assert.deepStrictEqual(r.cut, ['b']);
});

test('an orphan closer warns and cuts nothing of the page', () => {
  const r = cutHtml('a<!-- /gm-only -->b');
  assert.strictEqual(r.text, 'ab');
  assert.deepStrictEqual(r.warnings, ['a <!-- /gm-only --> marker with nothing open in a prop file']);
});

test('a marker after a code-fence line is still obeyed', () => {
  const r = cutHtml('<pre>\n```\n<!-- gm-only -->secret\n```\n</pre><!-- /gm-only -->t');
  assert.strictEqual(r.text, '<pre>\n```\nt');
});

test('every other comment goes', () => {
  const r = cutHtml('a<!-- Keeper: forged -->b');
  assert.strictEqual(r.text, 'ab');
  assert.ok(r.cut.includes(' Keeper: forged '));
});

test('an unclosed comment cuts to the end and warns', () => {
  const r = cutHtml('a<!-- oops b');
  assert.strictEqual(r.text, 'a');
  assert.deepStrictEqual(r.warnings, ['an HTML comment in a prop file never closes — the rest of the file is cut']);
});

test('%% is text in a hand-made page', () => {
  assert.strictEqual(cutHtml('a %%b%% c').text, 'a %%b%% c');
});
