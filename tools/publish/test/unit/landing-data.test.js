const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getLatestSession, extractRecap, getInitials, getPCs, scoreNPCs, inferNPCRole } = require('../../lib/templates/landing-data');

describe('getLatestSession', () => {
  it('returns the most recent played session by session_number', () => {
    const pages = [
      { frontmatter: { type: 'session', status: 'played', session_number: 1, actual_date: '2026-01-01' }, markdown: '# S1' },
      { frontmatter: { type: 'session', status: 'played', session_number: 3, actual_date: '2026-03-01' }, markdown: '# S3' },
      { frontmatter: { type: 'session', status: 'played', session_number: 2, actual_date: '2026-02-01' }, markdown: '# S2' },
      { frontmatter: { type: 'pc', status: 'alive' }, markdown: '# PC' },
    ];
    const result = getLatestSession(pages);
    assert.strictEqual(result.frontmatter.session_number, 3);
  });

  it('ignores sessions that are not played', () => {
    const pages = [
      { frontmatter: { type: 'session', status: 'planned', session_number: 5 }, markdown: '# S5' },
      { frontmatter: { type: 'session', status: 'played', session_number: 2 }, markdown: '# S2' },
    ];
    const result = getLatestSession(pages);
    assert.strictEqual(result.frontmatter.session_number, 2);
  });

  it('returns null when no played sessions exist', () => {
    const pages = [
      { frontmatter: { type: 'pc' }, markdown: '# PC' },
    ];
    assert.strictEqual(getLatestSession(pages), null);
  });
});

describe('extractRecap', () => {
  it('extracts first paragraph from Narrative Recap section', () => {
    const page = {
      markdown: '# Session 1\n\nSome intro.\n\n## Narrative Recap\n\nThe party arrived at the castle. They were weary from travel.\n\nThen they fought a dragon.\n\n## Loot\n\nSword',
    };
    const result = extractRecap(page);
    assert.strictEqual(result, 'The party arrived at the castle. They were weary from travel.');
  });

  it('strips wiki-links to plain text', () => {
    const page = {
      markdown: '# S1\n\n## Narrative Recap\n\n[[John Smith]] met [[Jane|Jane Doe]] at the [[Tavern]].\n\n## Next',
    };
    const result = extractRecap(page);
    assert.strictEqual(result, 'John Smith met Jane Doe at the Tavern.');
  });

  it('falls back to first body paragraph when no Narrative Recap heading', () => {
    const page = {
      markdown: '# Session 1\n\nThe group gathered at dawn.\n\nThey set off.\n',
    };
    const result = extractRecap(page);
    assert.strictEqual(result, 'The group gathered at dawn.');
  });

  it('truncates to ~500 chars at word boundary', () => {
    const longParagraph = 'Word '.repeat(200).trim();
    const page = {
      markdown: '# S1\n\n## Narrative Recap\n\n' + longParagraph + '\n\n## Next',
    };
    const result = extractRecap(page);
    assert.ok(result.length <= 510);
    assert.ok(result.endsWith('…'));
  });

  it('returns null for null page', () => {
    assert.strictEqual(extractRecap(null), null);
  });
});

describe('getInitials', () => {
  it('returns first letter of each word, max 2', () => {
    assert.strictEqual(getInitials('Ronnie Vint'), 'RV');
  });

  it('handles single-word names', () => {
    assert.strictEqual(getInitials('Dragon'), 'D');
  });

  it('caps at 2 characters for long names', () => {
    assert.strictEqual(getInitials('The Exploding Man'), 'TE');
  });

  it('returns empty string for empty input', () => {
    assert.strictEqual(getInitials(''), '');
  });
});

describe('getPCs', () => {
  it('returns PCs sorted alphabetically by title', () => {
    const pages = [
      { title: 'Zara', frontmatter: { type: 'pc', status: 'alive' } },
      { title: 'Abel', frontmatter: { type: 'pc', status: 'alive' } },
      { title: 'Mike', frontmatter: { type: 'npc' } },
    ];
    const result = getPCs(pages);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].title, 'Abel');
    assert.strictEqual(result[1].title, 'Zara');
  });

  it('returns empty array when no PCs exist', () => {
    const pages = [{ title: 'NPC', frontmatter: { type: 'npc' } }];
    assert.deepStrictEqual(getPCs(pages), []);
  });
});

describe('inferNPCRole', () => {
  it('returns Patron for employer tag', () => {
    const npc = { frontmatter: { tags: ['employer'], relationships: [] } };
    assert.strictEqual(inferNPCRole(npc), 'Patron');
  });

  it('returns Patron for patron tag', () => {
    const npc = { frontmatter: { tags: ['patron'], relationships: [] } };
    assert.strictEqual(inferNPCRole(npc), 'Patron');
  });

  it('returns Patron for employs relationship', () => {
    const npc = { frontmatter: { tags: [], relationships: [{ type: 'employs', target: '[[PCs]]' }] } };
    assert.strictEqual(inferNPCRole(npc), 'Patron');
  });

  it('returns Antagonist for villain tag', () => {
    const npc = { frontmatter: { tags: ['villain'], relationships: [] } };
    assert.strictEqual(inferNPCRole(npc), 'Antagonist');
  });

  it('returns Companion for ally tag', () => {
    const npc = { frontmatter: { tags: ['ally'], relationships: [] } };
    assert.strictEqual(inferNPCRole(npc), 'Companion');
  });

  it('returns Threat for super tag', () => {
    const npc = { frontmatter: { tags: ['super'], relationships: [] } };
    assert.strictEqual(inferNPCRole(npc), 'Threat');
  });

  it('returns Leader for leads relationship', () => {
    const npc = { frontmatter: { tags: [], relationships: [{ type: 'leads', target: '[[Squad]]' }] } };
    assert.strictEqual(inferNPCRole(npc), 'Leader');
  });

  it('returns NPC as default', () => {
    const npc = { frontmatter: { tags: [], relationships: [] } };
    assert.strictEqual(inferNPCRole(npc), 'NPC');
  });

  it('handles missing tags and relationships', () => {
    const npc = { frontmatter: {} };
    assert.strictEqual(inferNPCRole(npc), 'NPC');
  });

  it('returns Recurring when sessionCount >= 2 and no tag matches', () => {
    const npc = { frontmatter: { tags: [], relationships: [] } };
    assert.strictEqual(inferNPCRole(npc, 2), 'Recurring');
  });

  it('returns NPC when sessionCount < 2 and no tag matches', () => {
    const npc = { frontmatter: { tags: [], relationships: [] } };
    assert.strictEqual(inferNPCRole(npc, 1), 'NPC');
  });
});

describe('scoreNPCs', () => {
  it('scores NPCs by session mentions, relationships, and tags', () => {
    const npcPage = {
      title: 'Adrian Voss',
      frontmatter: {
        type: 'npc',
        tags: ['employer'],
        relationships: [
          { type: 'employs', target: '[[PCs]]' },
          { type: 'owns', target: '[[Voss Dynamics]]' },
        ],
        occupation: 'CEO',
      },
      outputPath: 'characters/npcs/adrian-voss.html',
    };
    const session1 = {
      frontmatter: { type: 'session', status: 'played', session_number: 1 },
      markdown: '# S1\n\nThe team met [[Adrian Voss]] at HQ.\n',
    };
    const session2 = {
      frontmatter: { type: 'session', status: 'played', session_number: 2 },
      markdown: '# S2\n\n[[Adrian Voss]] gave orders.\n',
    };
    const allPages = [npcPage, session1, session2];
    const result = scoreNPCs(allPages);
    assert.ok(result.length > 0);
    assert.strictEqual(result[0].page.title, 'Adrian Voss');
    assert.ok(result[0].score >= 3);
    assert.strictEqual(result[0].role, 'Patron');
  });

  it('excludes NPCs scoring below 3', () => {
    const npcPage = {
      title: 'Random NPC',
      frontmatter: { type: 'npc', tags: [], relationships: [] },
      outputPath: 'characters/npcs/random.html',
    };
    const allPages = [npcPage];
    const result = scoreNPCs(allPages);
    assert.strictEqual(result.length, 0);
  });

  it('caps results at 8', () => {
    const pages = [];
    for (let i = 0; i < 12; i++) {
      pages.push({
        title: `NPC ${i}`,
        frontmatter: {
          type: 'npc',
          tags: ['employer', 'recurring'],
          relationships: [{ type: 'employs', target: '[[X]]' }],
        },
        outputPath: `characters/npcs/npc-${i}.html`,
      });
    }
    const result = scoreNPCs(pages);
    assert.ok(result.length <= 8);
  });

  it('checks NPC aliases for session mentions', () => {
    const npcPage = {
      title: 'The Dragon',
      frontmatter: {
        type: 'npc',
        aliases: ['Dragon', 'Dragonman'],
        tags: ['super'],
        relationships: [],
      },
      outputPath: 'characters/npcs/the-dragon.html',
    };
    const session1 = {
      frontmatter: { type: 'session', status: 'played', session_number: 1 },
      markdown: '# S1\n\nThey encountered [[Dragon]] in the sky.\n',
    };
    const result = scoreNPCs([npcPage, session1]);
    const dragon = result.find(r => r.page.title === 'The Dragon');
    assert.ok(dragon, 'Dragon should appear in scored NPCs');
    assert.ok(dragon.score >= 3);
  });
});
