const { describe, it } = require('node:test');
const assert = require('node:assert');
const { findRecap, publishedOf, buildWrapUpIndex, resolveUnitRecap, buildStorySpine, unitRefs, characterStoryGroup } = require('../../lib/story-spine');

describe('findRecap', () => {
  it('extracts the Narrative Recap H2 section as HTML', () => {
    const page = { markdown: '## Overview\nstuff\n\n## Narrative Recap\nThe party arrived in **London**.\n\n## GM Notes\nsecret' };
    const r = findRecap(page);
    assert.ok(r, 'should find a recap');
    assert.match(r.html, /The party arrived/);
    assert.match(r.html, /<strong>London<\/strong>/);
    assert.ok(!/GM Notes/.test(r.html), 'must not bleed into the next section');
  });

  it('falls back to a plain "Recap" heading', () => {
    const page = { markdown: '## Recap\nShort recap text.' };
    assert.match(findRecap(page).html, /Short recap text/);
  });

  it('matches a decorated recap heading (real vaults: "What Happened — Narrative Recap")', () => {
    const page = { markdown: '## What Happened — Narrative Recap\nThe session unfolded.\n\n## PC Carry-Forward\nstuff' };
    const r = findRecap(page);
    assert.ok(r, 'decorated heading should match');
    assert.match(r.html, /The session unfolded/);
    assert.ok(!/Carry-Forward/.test(r.html), 'must not bleed into the next section');
  });

  it('returns null when there is no recap section', () => {
    assert.strictEqual(findRecap({ markdown: '## Overview\nno recap here' }), null);
  });

  it('prefers publishedMarkdown over raw markdown', () => {
    const page = { markdown: '## Narrative Recap\nRAW', publishedMarkdown: '## Narrative Recap\nPUBLISHED' };
    assert.match(findRecap(page).html, /PUBLISHED/);
    assert.ok(!/RAW/.test(findRecap(page).html));
  });
});

describe('buildWrapUpIndex', () => {
  const pages = [
    { title: 'Session_01', frontmatter: { type: 'session' } },
    { title: 'Session_01_Wrap_Up', frontmatter: { type: 'session-wrap-up', session: '[[Session_01]]' }, markdown: '## Narrative Recap\nS1 recap' },
    { title: 'Chapter_1_Wrap_Up', frontmatter: { type: 'session_wrap', chapter: '[[Chapter_1_Overview]]' }, markdown: '## Narrative Recap\nCh1 recap' },
  ];
  it('keys session wrap-ups by their session ref target', () => {
    const idx = buildWrapUpIndex(pages);
    assert.strictEqual(idx.bySession.get('Session_01').title, 'Session_01_Wrap_Up');
  });
  it('keys chapter wrap-ups (no session ref) by their chapter ref target', () => {
    const idx = buildWrapUpIndex(pages);
    assert.strictEqual(idx.byChapter.get('Chapter_1_Overview').title, 'Chapter_1_Wrap_Up');
  });
});

describe('resolveUnitRecap', () => {
  const session = { title: 'Session_01', frontmatter: { type: 'session' }, markdown: '## Narrative Recap\nIN SESSION FILE' };
  const wrapUp = { title: 'Session_01_Wrap_Up', frontmatter: { type: 'session-wrap-up', session: '[[Session_01]]' }, markdown: '## Narrative Recap\nIN WRAP UP' };

  it('prefers the wrap-up recap over the unit file', () => {
    const idx = buildWrapUpIndex([session, wrapUp]);
    const r = resolveUnitRecap(session, idx.bySession.get('Session_01'));
    assert.match(r.html, /IN WRAP UP/);
  });

  it('falls back to the unit file when there is no wrap-up recap', () => {
    const r = resolveUnitRecap(session, null);
    assert.match(r.html, /IN SESSION FILE/);
  });

  it('returns null when neither has a recap', () => {
    const bare = { title: 'X', frontmatter: {}, markdown: '## Overview\nx' };
    assert.strictEqual(resolveUnitRecap(bare, null), null);
  });
});

function ch(title, sort) { return { title, displayTitle: title.replace(/_/g, ' '), frontmatter: { type: 'chapter', sort_order: sort } }; }
function sess(title, chapterRef, n, recap) {
  return { title, displayTitle: title.replace(/_/g, ' '), frontmatter: { type: 'session', chapter: `[[${chapterRef}]]`, session_number: n }, markdown: recap ? `## Narrative Recap\n${recap}` : '## Overview\nx' };
}

describe('buildStorySpine', () => {
  it('is adaptive: chapter-only, per-session, and both→intro+sessions; omits no-recap', () => {
    const pages = [
      ch('Chapter_1', 1),
      { title: 'Chapter_1_Wrap_Up', frontmatter: { type: 'session-wrap-up', chapter: '[[Chapter_1]]' }, markdown: '## Narrative Recap\nCh1 whole' },
      ch('Chapter_2', 2),
      { title: 'Chapter_2_Wrap_Up', frontmatter: { type: 'session-wrap-up', chapter: '[[Chapter_2]]' }, markdown: '## Narrative Recap\nCh2 intro' },
      sess('Chapter_2_S1', 'Chapter_2', 1, 'C2S1 recap'),
      sess('Chapter_2_S2', 'Chapter_2', 2, 'C2S2 recap'),
      ch('Chapter_3', 3),
      sess('Chapter_3_S1', 'Chapter_3', 1, null),
    ];
    const spine = buildStorySpine(pages);
    assert.deepStrictEqual(
      spine.map(u => u.kind + ':' + u.title),
      ['chapter:Chapter 1', 'chapter-intro:Chapter 2', 'session:Chapter 2 S1', 'session:Chapter 2 S2'],
    );
  });

  it('chains prev/next across the whole spine', () => {
    const pages = [
      ch('Chapter_1', 1),
      { title: 'C1WU', frontmatter: { type: 'session-wrap-up', chapter: '[[Chapter_1]]' }, markdown: '## Recap\na' },
      ch('Chapter_2', 2),
      { title: 'C2WU', frontmatter: { type: 'session-wrap-up', chapter: '[[Chapter_2]]' }, markdown: '## Recap\nb' },
    ];
    const spine = buildStorySpine(pages);
    assert.strictEqual(spine[0].prevHref, null);
    assert.strictEqual(spine[0].nextHref, spine[1].outputPath);
    assert.strictEqual(spine[1].prevHref, spine[0].outputPath);
    assert.strictEqual(spine[1].nextHref, null);
  });
});

describe('buildStorySpine output-path namespacing', () => {
  it('gives distinct output paths to same-titled sessions in different chapters', () => {
    const mk = (cTitle, sort, cFolder) => ({
      title: `${cTitle} Overview`, displayTitle: cTitle,
      sourcePath: `/v/Chapters/${cFolder}/${cTitle} Overview.md`,
      frontmatter: { type: 'chapter', sort_order: sort }, markdown: '## Overview\nx',
    });
    const se = (cFolder, recap) => ({
      title: 'Session 1', displayTitle: 'Session 1',
      sourcePath: `/v/Chapters/${cFolder}/Session 1/Session 1.md`,
      frontmatter: { type: 'session', session_number: 1 }, markdown: `## Narrative Recap\n${recap}`,
    });
    const pages = [
      mk('Chapter A', 1, 'A'), se('A', 'A one'),
      mk('Chapter B', 2, 'B'), se('B', 'B one'),
    ];
    const spine = require('../../lib/story-spine').buildStorySpine(pages);
    const paths = spine.map(u => u.outputPath);
    assert.strictEqual(new Set(paths).size, paths.length, `output paths must be unique: ${paths}`);
  });
});

describe('buildStorySpine ref-metadata source', () => {
  it('uses the unit page (not the wrap-up) as sourcePage, so refs read the right frontmatter', () => {
    const chapter = { title: 'Ch', displayTitle: 'Ch', sourcePath: '/v/Ch/Ch.md', frontmatter: { type: 'chapter', sort_order: 1 }, markdown: '## Overview\nx' };
    const session = { title: 'S1', displayTitle: 'S1', sourcePath: '/v/Ch/S1/S1.md', frontmatter: { type: 'session', session_number: 1, participants: ['[[Alice]]'], location: '[[Vienna]]' }, markdown: '## Overview\nno recap here' };
    const wrap = { title: 'S1 Wrap Up', sourcePath: '/v/Ch/S1/S1_Wrap_Up.md', frontmatter: { type: 'session-wrap-up', session: '[[S1]]' }, markdown: '## Narrative Recap\nRecap prose from the wrap-up.' };
    const spine = require('../../lib/story-spine').buildStorySpine([chapter, session, wrap]);
    const u = spine.find(x => x.kind === 'session');
    assert.ok(u, 'session unit exists');
    assert.match(u.recapHtml, /Recap prose from the wrap-up/); // text still from the wrap-up
    assert.strictEqual(u.sourcePage, session, 'sourcePage is the session page, not the wrap-up');
    assert.deepStrictEqual(unitRefs(u).participants.map(r => r.label), ['Alice']);
    assert.strictEqual(unitRefs(u).location.target, 'Vienna');
  });
});

describe('buildStorySpine folder-proximity pairing', () => {
  it('pairs a chapter wrap-up by folder even when its chapter ref is a free-form display title', () => {
    const pages = [
      { title: 'Chapter 1 Overview', displayTitle: 'Chapter 1 — London', sourcePath: '/v/Chapters/Chapter 1 - London/Chapter 1 Overview.md', frontmatter: { type: 'chapter', sort_order: 1 }, markdown: '## Overview\nx' },
      { title: 'Chapter_1_Wrap_Up', sourcePath: '/v/Chapters/Chapter 1 - London/Chapter_1_Wrap_Up.md', frontmatter: { type: 'session_wrap', chapter: 'Chapter 1 — London: The Orphean Society' }, markdown: '## Narrative Recap\nLondon happened.' },
    ];
    const spine = require('../../lib/story-spine').buildStorySpine(pages);
    assert.strictEqual(spine.length, 1);
    assert.strictEqual(spine[0].kind, 'chapter');
    assert.match(spine[0].recapHtml, /London happened/);
  });

  it('owns a session by folder containment and pairs its wrap-up by subfolder, even with display-title refs', () => {
    const pages = [
      { title: 'Chapter 4 Overview', displayTitle: 'Chapter 4 — Calcutta', sourcePath: '/v/Chapters/Chapter 4 - Calcutta/Chapter 4 Overview.md', frontmatter: { type: 'chapter', sort_order: 4 }, markdown: '## Overview\nx' },
      { title: 'Session 01', displayTitle: 'Session 01', sourcePath: '/v/Chapters/Chapter 4 - Calcutta/Sessions/Session 01/Session 01.md', frontmatter: { type: 'session', session_number: 1, chapter: 'Chapter 4 — Calcutta' }, markdown: '## Overview\nx' },
      { title: 'Session 01 Wrap Up', sourcePath: '/v/Chapters/Chapter 4 - Calcutta/Sessions/Session 01/Session_01_Wrap_Up.md', frontmatter: { type: 'session_wrap', session: 'Session 01 - The Morning After', chapter: 'Chapter 4 — Calcutta' }, markdown: '## Narrative Recap\nCalcutta session one.' },
    ];
    const spine = require('../../lib/story-spine').buildStorySpine(pages);
    assert.strictEqual(spine.length, 1);
    assert.strictEqual(spine[0].kind, 'session');
    assert.match(spine[0].recapHtml, /Calcutta session one/);
  });
});

describe('unitRefs', () => {
  it('collects participants and location from the source page frontmatter', () => {
    const unit = { sourcePage: { frontmatter: { participants: ['[[Adrien_de_Montferrand]]'], location: '[[Vienna]]' } } };
    const refs = unitRefs(unit);
    assert.deepStrictEqual(refs.participants.map(r => r.label), ['Adrien de Montferrand']);
    assert.strictEqual(refs.location.target, 'Vienna');
  });
});

describe('characterStoryGroup', () => {
  it('maps status to current/retired/fallen', () => {
    assert.strictEqual(characterStoryGroup({ status: 'active' }), 'current');
    assert.strictEqual(characterStoryGroup({}), 'current');
    assert.strictEqual(characterStoryGroup({ status: 'Retired' }), 'retired');
    assert.strictEqual(characterStoryGroup({ status: 'dead' }), 'fallen');
    assert.strictEqual(characterStoryGroup({ status: 'MIA' }), 'current'); // not in fallen set
    assert.strictEqual(characterStoryGroup({ status: 'missing' }), 'fallen');
  });
});

describe('wiki-link resolution in story recaps', () => {
  const pages = [
    { title: 'Chapter 1 Overview', displayTitle: 'Chapter 1 — The Hungry God', sourcePath: '/v/Chapters/Chapter 1/Chapter 1 Overview.md', frontmatter: { type: 'chapter', sort_order: 1 }, markdown: '## Narrative Recap\nIt began at [[Voss_Campus]].' },
    { title: 'Session 04 - Fallen Stars', displayTitle: 'Session 04 - Fallen Stars', sourcePath: '/v/Chapters/Chapter 1/Sessions/Session 04 - Fallen Stars.md', frontmatter: { type: 'session', session_number: 4 }, markdown: '## Narrative Recap\nThe team hit [[Voss_Campus]] with [[Ronnie_Vint|Ronnie]] and met [[Nobody_Known]].' },
  ];
  const linkMap = {
    Voss_Campus: 'locations/voss-campus.html',
    Ronnie_Vint: 'characters/pcs/ronnie-vint.html',
  };

  it('resolves [[wiki-links]] in session recap HTML against the link map', () => {
    const spine = buildStorySpine(pages, linkMap);
    const u = spine.find(x => x.kind === 'session');
    assert.match(u.recapHtml, /<a href="\.\.\/locations\/voss-campus\.html">Voss Campus<\/a>/);
    assert.match(u.recapHtml, /<a href="\.\.\/characters\/pcs\/ronnie-vint\.html">Ronnie<\/a>/);
    assert.ok(!u.recapHtml.includes('[['), 'no raw wiki-link syntax may remain');
  });

  it('renders unresolvable links as humanized plain text', () => {
    const spine = buildStorySpine(pages, linkMap);
    const u = spine.find(x => x.kind === 'session');
    assert.match(u.recapHtml, /Nobody Known/);
    assert.ok(!/Nobody_Known/.test(u.recapHtml));
  });

  it('resolves links in chapter-intro recaps too', () => {
    const spine = buildStorySpine(pages, linkMap);
    const intro = spine.find(x => x.kind === 'chapter-intro');
    assert.match(intro.recapHtml, /<a href="\.\.\/locations\/voss-campus\.html">Voss Campus<\/a>/);
  });

  it('leaves recaps unresolved-but-intact when no link map is given (hasStory probe)', () => {
    const spine = buildStorySpine(pages);
    assert.ok(spine.length > 0);
  });
});
