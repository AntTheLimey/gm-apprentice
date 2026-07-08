const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildRelationshipGraph } = require('../../lib/relationship-graph');

describe('buildRelationshipGraph', () => {
  const pages = [
    { title: 'Hero', displayTitle: 'Hero', outputPath: 'pcs/hero.html', frontmatter: { type: 'pc', relationships: [{ target: '[[Villain]]', type: 'nemesis' }] } },
    { title: 'Villain', displayTitle: 'Villain', outputPath: 'npcs/villain.html', frontmatter: { type: 'npc', relationships: [{ target: '[[Hero]]', type: 'nemesis' }, { target: '[[Dark_Tower]]', type: 'resides_at' }] } },
    { title: 'Dark_Tower', displayTitle: 'Dark Tower', outputPath: 'locations/dark-tower.html', frontmatter: { type: 'location' } },
    { title: 'Sidekick', displayTitle: 'Sidekick', outputPath: 'npcs/sidekick.html', frontmatter: { type: 'npc', relationships: [{ target: '[[Villain]]', type: 'enemy' }] } },
  ];

  it('builds 2-hop graph from center entity', () => {
    const graph = buildRelationshipGraph('Hero', pages, {});
    assert.ok(graph.nodes.length > 0);
    assert.ok(graph.edges.length > 0);
  });

  it('center node is included', () => {
    const graph = buildRelationshipGraph('Hero', pages, {});
    const center = graph.nodes.find(n => n.id === 'Hero');
    assert.ok(center);
    assert.strictEqual(center.hop, 0);
  });

  it('hop-1 nodes are directly connected', () => {
    const graph = buildRelationshipGraph('Hero', pages, {});
    const villain = graph.nodes.find(n => n.id === 'Villain');
    assert.ok(villain);
    assert.strictEqual(villain.hop, 1);
  });

  it('hop-2 nodes are 2 hops out', () => {
    const graph = buildRelationshipGraph('Hero', pages, {});
    const tower = graph.nodes.find(n => n.id === 'Dark_Tower');
    assert.ok(tower);
    assert.strictEqual(tower.hop, 2);
  });

  it('node shapes encode entity type', () => {
    const graph = buildRelationshipGraph('Hero', pages, {});
    const hero = graph.nodes.find(n => n.id === 'Hero');
    assert.strictEqual(hero.shape, 'circle');
    const tower = graph.nodes.find(n => n.id === 'Dark_Tower');
    assert.strictEqual(tower.shape, 'rounded-square');
  });
});

describe('index-page exclusion', () => {
  const pages = [
    { title: 'Hero', displayTitle: 'Hero', outputPath: 'pcs/hero.html',
      frontmatter: { type: 'pc', relationships: [{ target: '[[Villain]]', type: 'nemesis' }] } },
    { title: 'Villain', displayTitle: 'Villain', outputPath: 'npcs/villain.html',
      frontmatter: { type: 'npc' } },
    { title: 'index', displayTitle: 'World Index', outputPath: 'world/index.html',
      frontmatter: { type: 'wiki' } },
  ];
  // the index page mentions everyone -> backlink entries from 'index'
  const backlinks = {
    Hero: [{ title: 'index', displayTitle: 'World Index', outputPath: 'world/index.html', type: 'wiki' }],
    Villain: [{ title: 'index', displayTitle: 'World Index', outputPath: 'world/index.html', type: 'wiki' }],
  };

  it('backlinks from an index page create no edges or nodes', () => {
    const graph = buildRelationshipGraph('Hero', pages, backlinks);
    assert.ok(!graph.nodes.some(n => n.id === 'index'));
    assert.ok(!graph.edges.some(e => e.from === 'index' || e.to === 'index'));
  });

  it('frontmatter relationships targeting an index page are dropped', () => {
    const withRel = pages.map(p => p.title === 'Hero'
      ? { ...p, frontmatter: { ...p.frontmatter,
          relationships: [{ target: '[[Villain]]', type: 'nemesis' }, { target: '[[index]]', type: 'listed_in' }] } }
      : p);
    const graph = buildRelationshipGraph('Hero', withRel, {});
    assert.ok(!graph.nodes.some(n => n.id === 'index'));
  });

  it('an index page as center yields an empty graph', () => {
    const graph = buildRelationshipGraph('index', pages, backlinks);
    assert.deepStrictEqual(graph, { nodes: [], edges: [] });
  });

  it('normal entity edges are unaffected', () => {
    const graph = buildRelationshipGraph('Hero', pages, backlinks);
    assert.ok(graph.edges.some(e => e.from === 'Hero' && e.to === 'Villain'));
  });
});
