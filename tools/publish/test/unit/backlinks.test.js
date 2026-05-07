const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildBacklinks } = require('../../lib/backlinks');

describe('buildBacklinks', () => {
  const pages = [
    {
      title: 'Session_1',
      displayTitle: 'Session 1',
      outputPath: 'sessions/session-1.html',
      frontmatter: { type: 'session' },
      markdown: 'The party met [[Herr_Gruber]] at [[Vienna]].',
    },
    {
      title: 'Session_2',
      displayTitle: 'Session 2',
      outputPath: 'sessions/session-2.html',
      frontmatter: { type: 'session' },
      markdown: 'They returned to [[Vienna]] and fought [[Dark_Entity]].',
    },
    {
      title: 'Herr_Gruber',
      displayTitle: 'Herr Gruber',
      outputPath: 'characters/npcs/herr-gruber.html',
      frontmatter: { type: 'npc' },
      markdown: 'A mysterious figure.',
    },
    {
      title: 'Vienna',
      displayTitle: 'Vienna',
      outputPath: 'locations/vienna.html',
      frontmatter: { type: 'location' },
      markdown: 'The capital of Austria.',
    },
  ];

  it('builds reverse map of wiki-link mentions', () => {
    const backlinks = buildBacklinks(pages);
    assert.ok(backlinks['Herr_Gruber']);
    assert.strictEqual(backlinks['Herr_Gruber'].length, 1);
    assert.strictEqual(backlinks['Herr_Gruber'][0].title, 'Session_1');
  });

  it('collects multiple backlinks for the same target', () => {
    const backlinks = buildBacklinks(pages);
    assert.ok(backlinks['Vienna']);
    assert.strictEqual(backlinks['Vienna'].length, 2);
  });

  it('returns empty object for pages with no wiki-links', () => {
    const backlinks = buildBacklinks([
      { title: 'Alone', displayTitle: 'Alone', outputPath: 'alone.html', frontmatter: { type: 'npc' }, markdown: 'No links here.' },
    ]);
    assert.strictEqual(Object.keys(backlinks).length, 0);
  });

  it('handles aliased wiki-links [[Target|Display]]', () => {
    const pagesWithAlias = [
      {
        title: 'Note',
        displayTitle: 'Note',
        outputPath: 'documents/note.html',
        frontmatter: { type: 'document' },
        markdown: 'Met [[Herr_Gruber|the German]].',
      },
    ];
    const backlinks = buildBacklinks(pagesWithAlias);
    assert.ok(backlinks['Herr_Gruber']);
    assert.strictEqual(backlinks['Herr_Gruber'].length, 1);
  });
});
