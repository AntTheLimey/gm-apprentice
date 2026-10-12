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
    const hrefs = Object.values(result.documents).map(d => d.href);
    assert.ok(hrefs.includes('characters/npcs/herr-gruber.html'));
    assert.ok(hrefs.includes('locations/vienna.html'));
  });

  it('document entries include display info', () => {
    const result = buildSearchIndex(pages);
    const doc = Object.values(result.documents).find(d => d.href === 'characters/npcs/herr-gruber.html');
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
    assert.strictEqual(result.documents[results[0].ref].href, 'locations/vienna.html');
  });

  it('search finds results by alias', () => {
    const lunr = require('lunr');
    const result = buildSearchIndex(pages);
    const idx = lunr.Index.load(result.index);
    const results = idx.search('German');
    assert.ok(results.length > 0);
  });
});

describe('a labelled link never reaches the search index with its target', () => {
  const lunr = require('lunr');
  const secret = (fm) => buildSearchIndex([{ title: 'A', displayTitle: 'A', outputPath: 'a.html', frontmatter: { type: 'npc', ...fm }, markdown: 'x' }]);
  it('in aliases, as a word to find or in the stored index', () => {
    const r = secret({ aliases: ['[[Vesper_Hale|the stranger]]'] });
    assert.ok(!JSON.stringify(r).toLowerCase().includes('vesper'));
    assert.ok(!JSON.stringify(r).toLowerCase().includes('hale'));
    assert.ok(lunr.Index.load(r.index).search('stranger').length === 1);
  });
  it('under a sub-key of occupation, faction_type or event_type', () => {
    for (const field of ['occupation', 'faction_type', 'event_type']) {
      const r = secret({ [field]: { main: '[[Vesper_Hale|the stranger]]', other: ['[[Quill_Smith|smith]]'] } });
      assert.ok(!/vesper|quill/i.test(JSON.stringify(r)), field);
    }
  });
});
