const { describe, it } = require('node:test');
const assert = require('node:assert');
const { resolveWikiLinks, renderRelationships, renderMetaValue, encodeHref, encodeImageUrl } = require('../../lib/processor');
const { createRenderer } = require('../../lib/markdown');

// Mirrors the options createRenderer() actually uses in lib/markdown.js — a mismatch here
// would let this test pass against different (safer) markdown-it behavior than production.
const md = createRenderer();

describe('resolveWikiLinks percent-encodes link destinations (#145)', () => {
  it('encodes a space in the resolved path and renders as a real <a>, not literal text', () => {
    const linkMap = { 'Session 02': 'chronicle/Sessions/Session 02/x.html' };
    // One directory deep so the relative path starts with "../" — the exact shape that
    // markdown-it's typographer mangles into "…/" when the destination is left unescaped.
    const result = resolveWikiLinks('See [[Session 02]]', linkMap, 'chronicle/other/y.html');
    assert.strictEqual(result, 'See [Session 02](../Sessions/Session%2002/x.html)');

    const html = md.render(result);
    assert.match(html, /<a href="\.\.\/Sessions\/Session%2002\/x\.html">Session 02<\/a>/);
    assert.ok(!html.includes('…'), 'typographer must not mangle the encoded destination into an ellipsis');
    assert.ok(!html.includes('[Session 02]'), 'destination must parse as a real link, not literal bracket text');
  });

  it('leaves a no-space target unchanged', () => {
    const linkMap = { 'John Doe': 'characters/pcs/john-doe.html' };
    const result = resolveWikiLinks('See [[John Doe]]', linkMap, 'index.html');
    assert.strictEqual(result, 'See [John Doe](characters/pcs/john-doe.html)');
  });

  it('encodes parens in a path segment', () => {
    const linkMap = { Widget: 'items/Widget (Mk2).html' };
    const result = resolveWikiLinks('See [[Widget]]', linkMap, 'index.html');
    assert.strictEqual(result, 'See [Widget](items/Widget%20%28Mk2%29.html)');
  });
});

describe('renderRelationships percent-encodes the target href (#145)', () => {
  it('encodes a space in the target output path', () => {
    const frontmatter = { relationships: [{ target: 'Session 02', type: 'ally' }] };
    const linkMap = { Session_02: 'chronicle/Sessions/Session 02/x.html' };
    frontmatter.relationships[0].target = 'Session_02';
    const html = renderRelationships(frontmatter, linkMap, 'chronicle/other/y.html');
    assert.match(html, /href="\.\.\/Sessions\/Session%2002\/x\.html"/);
  });
});

describe('renderMetaValue percent-encodes wikilink hrefs (#145)', () => {
  it('encodes a space in the resolved output path', () => {
    const linkMap = { 'Session 02': 'chronicle/Sessions/Session 02/x.html' };
    const html = renderMetaValue('[[Session 02]]', linkMap, 'chronicle/other/y.html');
    assert.match(html, /href="\.\.\/Sessions\/Session%2002\/x\.html"/);
  });
});

describe('encodeHref', () => {
  it('percent-encodes a space in a path segment', () => {
    assert.strictEqual(encodeHref('a b/c.html'), 'a%20b/c.html');
  });

  it('percent-encodes parens', () => {
    assert.strictEqual(encodeHref('a (b).html'), 'a%20%28b%29.html');
  });

  it('is a no-op on an already-safe path', () => {
    assert.strictEqual(encodeHref('characters/pcs/john-doe.html'), 'characters/pcs/john-doe.html');
  });

  it('is the same function as encodeImageUrl (generalized, not duplicated)', () => {
    assert.strictEqual(encodeHref, encodeImageUrl);
  });
});

describe('path-form wikilinks show the note name, not the folder', () => {
  const linkMap = { 'Locations/Drageby': 'locations/drageby.html' };
  it('resolves [[Folder/Name]] in prose and labels it with the basename', () => {
    const out = resolveWikiLinks('From [[Locations/Drageby]].', linkMap, 'characters/x.html');
    assert.strictEqual(out, 'From [Drageby](../locations/drageby.html).');
  });
  it('resolves and labels a path target in a relationship list, alias or not', () => {
    const html = renderRelationships({ relationships: [
      { target: '[[Locations/Drageby]]', type: 'located_at' },
      { target: '[[Locations/Drageby|the town]]', type: 'part_of' },
    ] }, linkMap, 'characters/x.html');
    assert.match(html, /href="\.\.\/locations\/drageby\.html" class="entity-link">Drageby</);
    assert.match(html, /class="entity-link">the town</);
    assert.doesNotMatch(html, /Locations\//);
  });
});
