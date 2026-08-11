const { test } = require('node:test');
const assert = require('node:assert');
// No `document` global in this Node environment, so js/search.js takes its
// early-return branch and exports the pure helpers instead of bootstrapping
// the DOM search overlay.
const search = require('../js/search.js');

test('encodeHref: percent-encodes a space in a path segment', () => {
  assert.strictEqual(search.encodeHref('chronicle/Sessions/Session 02/x.html'), 'chronicle/Sessions/Session%2002/x.html');
});

test('encodeHref: percent-encodes # and ? (URL-active chars a raw space merely looked wrong for)', () => {
  assert.strictEqual(search.encodeHref('notes/Q&A #3.html'), 'notes/Q%26A%20%233.html');
  assert.strictEqual(search.encodeHref('notes/what now?.html'), 'notes/what%20now%3F.html');
});

test('encodeHref: percent-encodes parens', () => {
  assert.strictEqual(search.encodeHref('items/Widget (Mk2).html'), 'items/Widget%20%28Mk2%29.html');
});

test('encodeHref: is a no-op on an already-safe path', () => {
  assert.strictEqual(search.encodeHref('characters/pcs/john-doe.html'), 'characters/pcs/john-doe.html');
});

test('esc: still escapes HTML entities for the attribute (unchanged behavior)', () => {
  assert.strictEqual(search.esc('<a>&"'), '&lt;a&gt;&amp;&quot;');
});
