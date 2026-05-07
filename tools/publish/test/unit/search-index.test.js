const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildSearchIndex } = require('../../lib/search-index');

describe('buildSearchIndex', () => {
  const pages = [
    {
      title: 'Herr_Gruber',
      displayTitle: 'Herr Gruber',
      outputPath: 'characters/npcs/herr-gruber.html',
      frontmatter: { type: 'npc', aliases: ['The German'], occupation: 'Spy' },
      markdown: 'A mysterious figure who works in the shadows.',
    },
    {
      title: 'Vienna',
      displayTitle: 'Vienna',
      outputPath: 'locations/vienna.html',
      frontmatter: { type: 'location' },
      markdown: 'The capital of Austria, full of intrigue.',
    },
  ];

  it('returns a serialized lunr index and documents map', () => {
    const result = buildSearchIndex(pages);
    assert.ok(result.index);
    assert.ok(result.documents);
    assert.ok(typeof result.index === 'object');
  });

  it('includes all pages in documents map', () => {
    const result = buildSearchIndex(pages);
    assert.ok(result.documents['characters/npcs/herr-gruber.html']);
    assert.ok(result.documents['locations/vienna.html']);
  });

  it('document entries include display info', () => {
    const result = buildSearchIndex(pages);
    const doc = result.documents['characters/npcs/herr-gruber.html'];
    assert.strictEqual(doc.title, 'Herr Gruber');
    assert.strictEqual(doc.type, 'npc');
    assert.ok(doc.subtitle);
  });

  it('search finds results by title', () => {
    const lunr = require('lunr');
    const result = buildSearchIndex(pages);
    const idx = lunr.Index.load(result.index);
    const results = idx.search('Gruber');
    assert.ok(results.length > 0);
  });

  it('search finds results by body text', () => {
    const lunr = require('lunr');
    const result = buildSearchIndex(pages);
    const idx = lunr.Index.load(result.index);
    const results = idx.search('intrigue');
    assert.ok(results.length > 0);
    assert.strictEqual(results[0].ref, 'locations/vienna.html');
  });

  it('search finds results by alias', () => {
    const lunr = require('lunr');
    const result = buildSearchIndex(pages);
    const idx = lunr.Index.load(result.index);
    const results = idx.search('German');
    assert.ok(results.length > 0);
  });
});
