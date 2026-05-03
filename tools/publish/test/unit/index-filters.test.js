const { describe, it } = require('node:test');
const assert = require('node:assert');
const { indexTemplate, buildPillFilters, buildLocationTree } = require('../../lib/templates/index-page');

describe('buildPillFilters', () => {
  it('returns pills for unique sub-types', () => {
    const pages = [
      { frontmatter: { type: 'pc' } },
      { frontmatter: { type: 'npc' } },
      { frontmatter: { type: 'npc' } },
      { frontmatter: { type: 'creature' } },
    ];
    const pills = buildPillFilters(pages, 'characters');
    assert.ok(pills.includes('All'));
    assert.ok(pills.includes('pc'));
    assert.ok(pills.includes('npc'));
    assert.ok(pills.includes('creature'));
  });

  it('returns location_type pills for locations dir', () => {
    const pages = [
      { frontmatter: { type: 'location', location_type: 'city' } },
      { frontmatter: { type: 'location', location_type: 'building' } },
      { frontmatter: { type: 'location', location_type: 'city' } },
    ];
    const pills = buildPillFilters(pages, 'locations');
    assert.ok(pills.includes('city'));
    assert.ok(pills.includes('building'));
  });
});

describe('buildLocationTree', () => {
  it('nests children under parents', () => {
    const pages = [
      { title: 'Vienna', displayTitle: 'Vienna', outputPath: 'locations/vienna.html', frontmatter: { type: 'location' } },
      { title: 'Hotel_Imperial', displayTitle: 'Hotel Imperial', outputPath: 'locations/hotel-imperial.html', frontmatter: { type: 'location', parent_location: '[[Vienna]]' } },
    ];
    const tree = buildLocationTree(pages);
    assert.strictEqual(tree.length, 1);
    assert.strictEqual(tree[0].page.title, 'Vienna');
    assert.strictEqual(tree[0].children.length, 1);
    assert.strictEqual(tree[0].children[0].page.title, 'Hotel_Imperial');
  });

  it('puts orphans at root level', () => {
    const pages = [
      { title: 'Standalone', displayTitle: 'Standalone', outputPath: 'locations/standalone.html', frontmatter: { type: 'location' } },
    ];
    const tree = buildLocationTree(pages);
    assert.strictEqual(tree.length, 1);
  });
});
