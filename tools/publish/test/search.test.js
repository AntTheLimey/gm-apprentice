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

// Both halves of the #139 search fix. The index half is exercised by the differential build,
// but the client half ships as a static asset the build never inspects — deleting the
// normalization leaves the whole server-side suite green while accented search silently stops
// working in the browser. These two assertions are the only thing standing under it.
//
// Escapes, not literal accented characters, so no editor can re-normalize this file.
const Q_NFC = 'Gonz\u00e1lez';
const Q_NFD = 'Gonza\u0301lez';

test('normalizeQuery: folds a decomposed query into the index normal form (#139)', () => {
  assert.notStrictEqual(Q_NFC, Q_NFD); // sanity: the two really do differ byte-for-byte
  assert.strictEqual(search.normalizeQuery(Q_NFD), Q_NFC);
  assert.strictEqual(search.normalizeQuery(Q_NFC), Q_NFC);
});

test('normalizeQuery: leaves ASCII and empty input alone', () => {
  assert.strictEqual(search.normalizeQuery('john doe'), 'john doe');
  assert.strictEqual(search.normalizeQuery(''), '');
  assert.strictEqual(search.normalizeQuery(null), '');
  assert.strictEqual(search.normalizeQuery(undefined), '');
});

test('buildSearchIndex: an NFD-authored page is findable by the folded (NFC) query', () => {
  // The other half of the pair: normalizeQuery only helps if the index it queries is in that
  // same form. Asserted through a real lunr search rather than by inspecting the index blob,
  // because matching is the behaviour that matters.
  const lunr = require('lunr');
  const { buildSearchIndex } = require('../lib/search-index');
  const { index } = buildSearchIndex([{
    outputPath: 'characters/npcs/gonzalez.html',
    displayTitle: Q_NFD,
    title: Q_NFD,
    frontmatter: { type: 'npc' },
    markdown: `Notes about ${Q_NFD}.`,
  }]);
  const idx = lunr.Index.load(index);
  const hits = idx.search(search.normalizeQuery(Q_NFD));
  assert.strictEqual(hits.length, 1, 'folded query found nothing in an NFD-authored index');
  assert.strictEqual(hits[0].ref, 'characters/npcs/gonzalez.html');
});
