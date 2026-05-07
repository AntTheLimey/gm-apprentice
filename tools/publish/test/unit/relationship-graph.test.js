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
