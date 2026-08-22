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

  it('ignores mentions stripped from the published view (B6 spoiler leak)', () => {
    // NPC_A is only mentioned in the raw markdown; the published view (gm-only/excluded
    // sections removed) does not mention it, so it must not surface as "in play".
    const gmOnlySessions = [
      { title: 'S3', frontmatter: { type: 'session', status: 'played', session_number: 3 },
        markdown: 'Met [[NPC_A]] in secret.', publishedMarkdown: 'Nothing public here.' },
    ];
    const scored = scoreByRecency(entities, gmOnlySessions, [], { window: 3, max: 10, type: 'npc' });
    assert.ok(!scored.map(s => s.page.title).includes('NPC_A'),
      'an NPC mentioned only in stripped content must not be scored as recent');
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

describe('scoreByRecency — play_date recency, wrap-ups, terminal status', () => {
  it('uses play_date (not session_number) to find recent sessions across a chapter restart, and counts freshly wrapped sessions', () => {
    // Vienna S14 (number 14) was played before Calcutta S3 (number 3). With window 1, only the
    // most-recently-played session (Calcutta S3) is in scope — even though it's still `wrap-up`.
    const sessions = [
      { title: 'S14', frontmatter: { type: 'session', status: 'reviewed', session_number: 14, play_date: '2026-05-21' }, markdown: 'Vienna with [[Old_NPC]].' },
      { title: 'S3', frontmatter: { type: 'session', status: 'wrap-up', session_number: 3, play_date: '2026-06-25' }, markdown: 'Alexandria with [[New_NPC]].' },
    ];
    const entities = [
      { title: 'Old_NPC', frontmatter: { type: 'npc', status: 'alive' } },
      { title: 'New_NPC', frontmatter: { type: 'npc', status: 'alive' } },
    ];
    const titles = scoreByRecency(entities, sessions, [], { window: 1, max: 10, type: 'npc' }).map(s => s.page.title);
    assert.ok(titles.includes('New_NPC'), 'the play_date-latest session is scored');
    assert.ok(!titles.includes('Old_NPC'), 'the higher-numbered but older session is outside the recent window');
  });

  it('counts mentions from the paired wrap-up (recaps live there, not in the index stub)', () => {
    const sessions = [
      { title: 'S1', frontmatter: { type: 'session', status: 'reviewed', session_number: 1, play_date: '2026-06-25' }, markdown: 'See the wrap-up.' },
    ];
    const wrapUps = [
      { title: 'Wrap', frontmatter: { type: 'session_wrap', session: '[[S1]]' }, markdown: 'The party met [[Dragoman|Yusuf]] and [[Thibault]].' },
    ];
    const entities = [
      { title: 'Dragoman', frontmatter: { type: 'npc', status: 'alive' } },
      { title: 'Thibault', frontmatter: { type: 'npc', status: 'alive' } },
    ];
    const titles = scoreByRecency(entities, sessions, [], { window: 3, max: 10, type: 'npc', wrapUps }).map(s => s.page.title);
    assert.ok(titles.includes('Dragoman'), 'aliased mention in the wrap-up is counted');
    assert.ok(titles.includes('Thibault'), 'bare mention in the wrap-up is counted');
  });

  it('includes a dead NPC only when they appear in the latest session', () => {
    const sessions = [
      { title: 'S2', frontmatter: { type: 'session', status: 'reviewed', session_number: 2, play_date: '2026-06-25' }, markdown: 'They lost [[Endicott]] to the sea.' },
      { title: 'S1', frontmatter: { type: 'session', status: 'reviewed', session_number: 1, play_date: '2026-06-04' }, markdown: 'Long ago, [[Old_Casualty]] fell.' },
    ];
    const entities = [
      { title: 'Endicott', frontmatter: { type: 'npc', status: 'dead' } },
      { title: 'Old_Casualty', frontmatter: { type: 'npc', status: 'dead' } },
    ];
    const titles = scoreByRecency(entities, sessions, [], { window: 3, max: 10, type: 'npc' }).map(s => s.page.title);
    assert.ok(titles.includes('Endicott'), 'died in the latest session → still in play');
    assert.ok(!titles.includes('Old_Casualty'), 'died earlier → retired from in play');
  });

  it('weights the most recent session highest', () => {
    const sessions = [
      { title: 'S3', frontmatter: { type: 'session', status: 'reviewed', session_number: 3, play_date: '2026-06-25' }, markdown: 'Now: [[Fresh_NPC]].' },
      { title: 'S1', frontmatter: { type: 'session', status: 'reviewed', session_number: 1, play_date: '2026-06-04' }, markdown: 'Earlier: [[Older_NPC]].' },
    ];
    const entities = [
      { title: 'Fresh_NPC', frontmatter: { type: 'npc', status: 'alive' } },
      { title: 'Older_NPC', frontmatter: { type: 'npc', status: 'alive' } },
    ];
    const scored = scoreByRecency(entities, sessions, [], { window: 3, max: 10, type: 'npc' });
    assert.strictEqual(scored[0].page.title, 'Fresh_NPC', 'latest-session NPC outranks an older-session NPC');
  });

  it('pairs a session with its own wrap-up by wiki-link, not a same-numbered wrap-up from another chapter', () => {
    const sessions = [
      { title: 'Session 03 - Give Rest', frontmatter: { type: 'session', status: 'wrap-up', session_number: 3, play_date: '2026-06-25' }, markdown: '' },
    ];
    const wrapUps = [
      // Same session_number (3) but belongs to an earlier chapter — must NOT be used.
      { title: 'Vienna_S3_Wrap', frontmatter: { type: 'session_wrap', session_number: 3, session: '[[Session_03]]' }, markdown: 'Vienna with [[Wrong_NPC]].' },
      { title: 'Calcutta_S3_Wrap', frontmatter: { type: 'session_wrap', session_number: 3, session: '[[Session 03 - Give Rest]]' }, markdown: 'Alexandria with [[Right_NPC]].' },
    ];
    const entities = [
      { title: 'Wrong_NPC', frontmatter: { type: 'npc', status: 'alive' } },
      { title: 'Right_NPC', frontmatter: { type: 'npc', status: 'alive' } },
    ];
    const titles = scoreByRecency(entities, sessions, [], { window: 3, max: 10, type: 'npc', wrapUps }).map(s => s.page.title);
    assert.ok(titles.includes('Right_NPC'), 'pairs by the session wiki-link');
    assert.ok(!titles.includes('Wrong_NPC'), 'ignores the same-numbered wrap-up from another chapter');
  });
});

describe('scoreByRecency tie-break (#169)', () => {
  // Equal scores used to fall back to vault scan order, because the sort had no
  // secondary key and Array.prototype.sort is stable. Which entities survived
  // `.slice(0, max)` was therefore decided by where the files sat on disk —
  // invisible to the GM and unchangeable by anything they could author.
  const mkSession = (md) => ({
    title: 'Session_01', displayTitle: 'Session 01',
    frontmatter: { type: 'session', status: 'played', play_date: '2026-08-01' },
    markdown: md,
  });
  const mkNpc = (title) => ({
    title, displayTitle: title, frontmatter: { type: 'npc', status: 'alive' }, markdown: '',
  });

  it('breaks ties by title so the selection is deterministic and explainable', () => {
    const session = mkSession('Met [[Zed_Npc]], [[Adam_Npc]] and [[Mabel_Npc]].');
    // deliberately reversed relative to the wanted output
    const entities = [mkNpc('Zed_Npc'), mkNpc('Mabel_Npc'), mkNpc('Adam_Npc')];
    const scored = scoreByRecency(entities, [session], [], { window: 3, max: 10, type: 'npc' });
    assert.deepStrictEqual(scored.map(s => s.page.title), ['Adam_Npc', 'Mabel_Npc', 'Zed_Npc']);
  });

  it('keeps score as the primary key', () => {
    const session = mkSession('Met [[Zed_Npc]] twice: [[Zed_Npc]]. Also [[Adam_Npc]].');
    const chapter = { title: 'Ch', displayTitle: 'Ch', frontmatter: { type: 'chapter' },
      markdown: 'Featuring [[Zed_Npc]].' };
    const entities = [mkNpc('Adam_Npc'), mkNpc('Zed_Npc')];
    const scored = scoreByRecency(entities, [session], [chapter], { window: 3, max: 10, type: 'npc' });
    assert.strictEqual(scored[0].page.title, 'Zed_Npc');   // higher score wins over alphabetical
  });

  it('cuts at max by the same deterministic order', () => {
    const session = mkSession('Met [[Zed_Npc]], [[Adam_Npc]] and [[Mabel_Npc]].');
    const entities = [mkNpc('Zed_Npc'), mkNpc('Mabel_Npc'), mkNpc('Adam_Npc')];
    const scored = scoreByRecency(entities, [session], [], { window: 3, max: 2, type: 'npc' });
    assert.deepStrictEqual(scored.map(s => s.page.title), ['Adam_Npc', 'Mabel_Npc']);
  });
});
