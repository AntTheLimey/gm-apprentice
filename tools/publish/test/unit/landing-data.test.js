const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getLatestSession, getLatestWrapUp, extractRecap, getInitials, getPCs, scoreNPCs, inferNPCRole, getRecentEvents, getExploreDescriptions } = require('../../lib/templates/landing-data');

describe('getLatestSession', () => {
  it('returns the most recent played session by session_number', () => {
    const pages = [
      { frontmatter: { type: 'session', status: 'played', session_number: 1, play_date: '2026-01-01' }, markdown: '# S1' },
      { frontmatter: { type: 'session', status: 'played', session_number: 3, play_date: '2026-03-01' }, markdown: '# S3' },
      { frontmatter: { type: 'session', status: 'played', session_number: 2, play_date: '2026-02-01' }, markdown: '# S2' },
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

  it('returns a session with status reviewed', () => {
    const pages = [
      { frontmatter: { type: 'session', status: 'reviewed', session_number: 5, play_date: '2026-04-26' }, title: 'Session 5' },
      { frontmatter: { type: 'session', status: 'played', session_number: 4, play_date: '2026-04-19' }, title: 'Session 4' },
    ];
    const result = getLatestSession(pages);
    assert.strictEqual(result.title, 'Session 5');
  });

  it('picks the most recently played session even when a later chapter restarts numbering', () => {
    // Regression: "latest" must mean most recently played (play_date), not highest session_number.
    // Vienna ran 1-14; Calcutta restarted at 1-3 — the June session (number 3) is the real latest.
    const pages = [
      { frontmatter: { type: 'session', status: 'reviewed', session_number: 14, play_date: '2026-05-21' }, title: 'Session 14' },
      { frontmatter: { type: 'session', status: 'reviewed', session_number: 3, play_date: '2026-06-25' }, title: 'Session 03 - Give Rest' },
    ];
    const result = getLatestSession(pages);
    assert.strictEqual(result.title, 'Session 03 - Give Rest');
  });

  it('falls back to session_number when play dates are equal or absent', () => {
    const pages = [
      { frontmatter: { type: 'session', status: 'played', session_number: 2 }, title: 'Session 2' },
      { frontmatter: { type: 'session', status: 'played', session_number: 5 }, title: 'Session 5' },
    ];
    const result = getLatestSession(pages);
    assert.strictEqual(result.title, 'Session 5');
  });
});

describe('getLatestWrapUp', () => {
  const session = { title: 'Session 05', frontmatter: { type: 'session', session_number: 5 } };

  it('matches wrap-up by session_number', () => {
    const pages = [
      { frontmatter: { type: 'session_wrap', session_number: 5 }, title: 'Session_05_Wrap_Up' },
      { frontmatter: { type: 'session_wrap', session_number: 4 }, title: 'Session_04_Wrap_Up' },
    ];
    const result = getLatestWrapUp(pages, session);
    assert.strictEqual(result.title, 'Session_05_Wrap_Up');
  });

  it('falls back to title match when session_number is absent on wrap-up', () => {
    const pages = [
      { frontmatter: { type: 'session-wrapup', session: 'Session 05' }, title: 'Session_05_Wrap_Up' },
    ];
    const noNumSession = { title: 'Session 05', frontmatter: { type: 'session' } };
    const result = getLatestWrapUp(pages, noNumSession);
    assert.strictEqual(result.title, 'Session_05_Wrap_Up');
  });

  it('returns null when no wrap-up matches', () => {
    const pages = [
      { frontmatter: { type: 'session_wrap', session_number: 3 }, title: 'Session_03_Wrap_Up' },
    ];
    const result = getLatestWrapUp(pages, session);
    assert.strictEqual(result, null);
  });

  it('returns null for null session', () => {
    const pages = [
      { frontmatter: { type: 'session_wrap', session_number: 5 }, title: 'Session_05_Wrap_Up' },
    ];
    assert.strictEqual(getLatestWrapUp(pages, null), null);
  });

  it('matches wrap-up by title containment', () => {
    const pages = [
      { frontmatter: { type: 'session_wrap', session: 'Recap for Session 05 extras' }, title: 'Session_05_Wrap_Up' },
    ];
    const noNumSession = { title: 'Session 05', frontmatter: { type: 'session' } };
    const result = getLatestWrapUp(pages, noNumSession);
    assert.strictEqual(result.title, 'Session_05_Wrap_Up');
  });

  it('recognizes all wrap-up type variants', () => {
    const variants = ['session-wrap-up', 'session_wrap', 'session-wrapup'];
    for (const type of variants) {
      const pages = [{ frontmatter: { type, session_number: 5 }, title: `WU-${type}` }];
      const result = getLatestWrapUp(pages, session);
      assert.ok(result, `should match type "${type}"`);
    }
  });

  it('prefers the wrap-up in the same session folder when chapters restart numbering', () => {
    // Regression: Vienna S4 and Calcutta S4 both have session_number 4 — a bare
    // number match returned Vienna's wrap-up for Calcutta's session.
    const pages = [
      {
        frontmatter: { type: 'session_wrap', session_number: 4 },
        title: 'Chapter_03_Session_04_Wrap_Up',
        sourcePath: '/vault/Chapters/Chapter 3 - Vienna/Session 4/Chapter_03_Session_04_Wrap_Up.md',
      },
      {
        frontmatter: { type: 'session_wrap', session_number: 4 },
        title: 'Chapter_04_Session_04_Wrap_Up',
        sourcePath: '/vault/Chapters/Chapter 4 - Calcutta/Sessions/Session 04/Chapter_04_Session_04_Wrap_Up.md',
      },
    ];
    const calcuttaSession = {
      title: 'Session 04 - The Road to Cairo',
      frontmatter: { type: 'session', session_number: 4 },
      sourcePath: '/vault/Chapters/Chapter 4 - Calcutta/Sessions/Session 04/Session 04 - The Road to Cairo.md',
    };
    const result = getLatestWrapUp(pages, calcuttaSession);
    assert.strictEqual(result.title, 'Chapter_04_Session_04_Wrap_Up');
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

  it('humanizes underscored wiki-link targets in recap text', () => {
    const page = {
      markdown: '# S1\n\n## Narrative Recap\n\nBreakfast at the [[Locanda_del_Leone]].\n\n## Next',
    };
    const result = extractRecap(page);
    assert.strictEqual(result, 'Breakfast at the Locanda del Leone.');
  });

  it('falls back to first body paragraph when no Narrative Recap heading', () => {
    const page = {
      markdown: '# Session 1\n\nThe group gathered at dawn.\n\nThey set off.\n',
    };
    const result = extractRecap(page);
    assert.strictEqual(result, 'The group gathered at dawn.');
  });

  it('matches heading variants like "What Happened — Narrative Recap"', () => {
    const page = {
      markdown: '# S4\n\n## Session Metadata\n\nStuff.\n\n## What Happened — Narrative Recap\n\nThe party rode for Cairo at dawn.\n\n## World State\n\nSecret.',
    };
    const result = extractRecap(page);
    assert.strictEqual(result, 'The party rode for Cairo at dawn.');
  });

  it('never returns a bare heading as the recap', () => {
    // Regression: a body whose H1 sits after a blank line, followed by more headings,
    // rendered a raw "# Session 4 — ..." line on the landing page.
    const page = {
      markdown: '\n# Session 4 — The Hofburg Reception\n\n## Session Metadata\n\n- **Date:** August 5\n',
    };
    const result = extractRecap(page);
    assert.ok(result === null || !result.startsWith('#'), `got: ${result}`);
  });

  it('prefers publishedMarkdown over raw markdown when present', () => {
    const page = {
      markdown: '# S1\n\n## Narrative Recap\n\nKeeper secret draft.\n',
      publishedMarkdown: '# S1\n\n## Narrative Recap\n\nThe players saw this.\n',
    };
    const result = extractRecap(page);
    assert.strictEqual(result, 'The players saw this.');
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

describe('getRecentEvents', () => {
  it('returns events sorted by in_game_date, most recent first', () => {
    const pages = [
      { frontmatter: { type: 'event', in_game_date: '1936-01-01' }, displayTitle: 'Old' },
      { frontmatter: { type: 'event', in_game_date: '1936-12-01' }, displayTitle: 'New' },
      { frontmatter: { type: 'npc' }, displayTitle: 'Not event' },
    ];
    const result = getRecentEvents(pages, 10);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].displayTitle, 'New');
  });

  it('falls back to date field for backward compat', () => {
    const pages = [
      { frontmatter: { type: 'event', date: '1936-01-01' }, displayTitle: 'Old (legacy)' },
      { frontmatter: { type: 'event', date: '1936-12-01' }, displayTitle: 'New (legacy)' },
    ];
    const result = getRecentEvents(pages, 10);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].displayTitle, 'New (legacy)');
  });

  it('respects max limit', () => {
    const pages = [
      { frontmatter: { type: 'event', in_game_date: '1936-01-01' } },
      { frontmatter: { type: 'event', in_game_date: '1936-02-01' } },
      { frontmatter: { type: 'event', in_game_date: '1936-03-01' } },
    ];
    const result = getRecentEvents(pages, 2);
    assert.strictEqual(result.length, 2);
  });

  it('skips events without in_game_date or date', () => {
    const pages = [
      { frontmatter: { type: 'event' }, displayTitle: 'No date' },
      { frontmatter: { type: 'event', in_game_date: '1936-01-01' }, displayTitle: 'Has date' },
    ];
    const result = getRecentEvents(pages, 10);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].displayTitle, 'Has date');
  });
});

describe('getExploreDescriptions', () => {
  it('returns genre-specific descriptions', () => {
    const result = getExploreDescriptions('horror', {});
    assert.ok(result.characters.includes('investigators'));
  });

  it('returns defaults for unknown genre', () => {
    const result = getExploreDescriptions('steampunk', {});
    assert.ok(result.characters.includes('people'));
  });

  it('allows overrides', () => {
    const result = getExploreDescriptions('horror', { characters: 'Custom text' });
    assert.strictEqual(result.characters, 'Custom text');
    assert.ok(result.locations.includes('candlelit'));
  });

  it('returns defaults for null genre', () => {
    const result = getExploreDescriptions(null, {});
    assert.ok(result.characters);
  });

  it('scifi genre supplies explore descriptions', () => {
    const d = getExploreDescriptions('scifi', {});
    assert.ok(d.locations.includes('Stations'));
    assert.ok(d.factions.includes('Corporations'));
  });
});
