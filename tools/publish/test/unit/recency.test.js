const { describe, it } = require('node:test');
const assert = require('node:assert');
const { scoreByRecency } = require('../../lib/recency');

describe('scoreByRecency', () => {
  const sessions = [
    { title: 'S3', frontmatter: { type: 'session', status: 'played', session_number: 3 }, markdown: 'Met [[NPC_A]] at [[Location_A]].' },
    { title: 'S2', frontmatter: { type: 'session', status: 'played', session_number: 2 }, markdown: 'Visited [[Location_A]] and [[Location_B]].' },
    { title: 'S1', frontmatter: { type: 'session', status: 'played', session_number: 1 }, markdown: 'Started at [[Location_A]].' },
  ];

  const chapter = {
    title: 'Ch1',
    frontmatter: { type: 'chapter' },
    markdown: 'This chapter features [[NPC_A]] and [[NPC_B]].',
  };

  const entities = [
    { title: 'NPC_A', displayTitle: 'NPC A', outputPath: 'npcs/npc-a.html', frontmatter: { type: 'npc', status: 'alive' } },
    { title: 'NPC_B', displayTitle: 'NPC B', outputPath: 'npcs/npc-b.html', frontmatter: { type: 'npc', status: 'alive' } },
    { title: 'NPC_Dead', displayTitle: 'Dead NPC', outputPath: 'npcs/dead.html', frontmatter: { type: 'npc', status: 'dead' } },
    { title: 'Location_A', displayTitle: 'Location A', outputPath: 'locs/loc-a.html', frontmatter: { type: 'location' } },
    { title: 'Location_B', displayTitle: 'Location B', outputPath: 'locs/loc-b.html', frontmatter: { type: 'location' } },
  ];

  it('scores entities by recent session mentions', () => {
    const scored = scoreByRecency(entities, sessions, [chapter], { window: 3, max: 10, type: 'npc' });
    assert.ok(scored.length > 0);
    assert.strictEqual(scored[0].page.title, 'NPC_A');
  });

  it('excludes dead/destroyed entities', () => {
    const scored = scoreByRecency(entities, sessions, [chapter], { window: 3, max: 10, type: 'npc' });
    const titles = scored.map(s => s.page.title);
    assert.ok(!titles.includes('NPC_Dead'));
  });

  it('respects max limit', () => {
    const scored = scoreByRecency(entities, sessions, [chapter], { window: 3, max: 1, type: 'npc' });
    assert.strictEqual(scored.length, 1);
  });

  it('scores locations', () => {
    const scored = scoreByRecency(entities, sessions, [chapter], { window: 3, max: 10, type: 'location' });
    assert.ok(scored.length > 0);
    assert.strictEqual(scored[0].page.title, 'Location_A');
  });

  it('returns empty array when no sessions', () => {
    const scored = scoreByRecency(entities, [], [], { window: 3, max: 10, type: 'npc' });
    assert.deepStrictEqual(scored, []);
  });
});
