const { describe, it } = require('node:test');
const assert = require('node:assert');
const { entry } = require('../../lib/settings');
const { findRecap, publishedOf, buildWrapUpIndex, resolveUnitRecap, buildStorySpine: spineWith, characterStoryGroup } = require('../../lib/story-spine');
const { pairHubs } = require('../../lib/session-hub');
const WORDS = require('../helpers/settings-files').defaultWithheldWords();

// The build pairs once (session-hub.js pairHubs) and hands the Saga the map; the Saga never
// pairs on its own.
const buildStorySpine = (pages, linkMap) => spineWith(pages, linkMap, pairHubs(pages, pages, { allNotes: [], withheldWords: WORDS }));

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

// A chapter takes its recap from its wrap-up only once complete; `status` defaults to that.
function ch(title, sort, status = 'complete') { return { title, displayTitle: title.replace(/_/g, ' '), frontmatter: { type: 'chapter', sort_order: sort, status } }; }
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
    const spine = buildStorySpine(pages);
    const paths = spine.map(u => u.outputPath);
    assert.strictEqual(new Set(paths).size, paths.length, `output paths must be unique: ${paths}`);
  });
});

describe('buildStorySpine sourcePage', () => {
  it('uses the unit page (not the wrap-up) as sourcePage', () => {
    const chapter = { title: 'Ch', displayTitle: 'Ch', sourcePath: '/v/Ch/Ch.md', frontmatter: { type: 'chapter', sort_order: 1 }, markdown: '## Overview\nx' };
    const session = { title: 'S1', displayTitle: 'S1', sourcePath: '/v/Ch/S1/S1.md', frontmatter: { type: 'session', session_number: 1, participants: ['[[Alice]]'], location: '[[Vienna]]' }, markdown: '## Overview\nno recap here' };
    const wrap = { title: 'S1 Wrap Up', sourcePath: '/v/Ch/S1/S1_Wrap_Up.md', frontmatter: { type: 'session-wrap-up', session: '[[S1]]' }, markdown: '## Narrative Recap\nRecap prose from the wrap-up.' };
    const spine = buildStorySpine([chapter, session, wrap]);
    const u = spine.find(x => x.kind === 'session');
    assert.ok(u, 'session unit exists');
    assert.match(u.recapHtml, /Recap prose from the wrap-up/); // text still from the wrap-up
    assert.strictEqual(u.sourcePage, session, 'sourcePage is the session page, not the wrap-up');
  });
});

describe('buildStorySpine wrap-up sections', () => {
  const chapter = { title: 'Ch', displayTitle: 'Ch', sourcePath: '/v/Ch/Ch.md', frontmatter: { type: 'chapter', sort_order: 1 }, markdown: '## Overview\nx' };
  const session = (markdown) => ({ title: 'S1', displayTitle: 'S1', sourcePath: '/v/Ch/S1/S1.md', frontmatter: { type: 'session', session_number: 1 }, markdown });
  const wrap = { title: 'S1 Wrap Up', sourcePath: '/v/Ch/S1/S1_Wrap_Up.md', frontmatter: { type: 'session-wrap-up', session: '[[S1]]' },
    markdown: '## Narrative Recap\nThey came.\n\n## Loot\nA key.\n\n## Memorable Moments\n> "Hi."\n\n## GM Notes\nsecret',
    publishedMarkdown: '## Narrative Recap\nThey came.\n\n## Loot\nA key.\n\n## Memorable Moments\n> "Hi."\n' };
  it("a session unit carries its wrap-up's sections (published view), less the recap, and the moments apart", () => {
    const u = buildStorySpine([chapter, session('## Overview\nx'), wrap]).find(x => x.kind === 'session');
    assert.deepStrictEqual(u.sections.map(s => s.title), ['Loot']);
    assert.strictEqual(u.moments.title, 'Memorable Moments');
    assert.match(u.moments.markdown, /"Hi\."/);
    assert.deepStrictEqual(u.after, []);
    assert.ok(!JSON.stringify([u.sections, u.moments, u.after]).includes('secret'), 'the published view only');
  });
  it("a recap from the session's own page leaves the wrap-up's recap section in", () => {
    const pages = [chapter, session('## Narrative Recap\nOwn recap.'), { ...wrap, publishedMarkdown: '## Notes\nA.\n\n## Narrative Recap\n\n' }];
    const u = buildStorySpine(pages).find(x => x.kind === 'session');
    assert.match(u.recapHtml, /Own recap/);
    assert.deepStrictEqual(u.sections.map(s => s.title), ['Notes', 'Narrative Recap']);
  });
});

describe('buildStorySpine folder-proximity pairing', () => {
  it('pairs a chapter wrap-up by folder even when its chapter ref is a free-form display title', () => {
    const pages = [
      { title: 'Chapter 1 Overview', displayTitle: 'Chapter 1 — London', sourcePath: '/v/Chapters/Chapter 1 - London/Chapter 1 Overview.md', frontmatter: { type: 'chapter', sort_order: 1, status: 'complete' }, markdown: '## Overview\nx' },
      { title: 'Chapter_1_Wrap_Up', sourcePath: '/v/Chapters/Chapter 1 - London/Chapter_1_Wrap_Up.md', frontmatter: { type: 'session_wrap', chapter: 'Chapter 1 — London: The Orphean Society' }, markdown: '## Narrative Recap\nLondon happened.' },
    ];
    const spine = buildStorySpine(pages);
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
    // The chapter (not complete) opens with its introduction; the session takes its wrap-up's recap.
    const spine = buildStorySpine(pages);
    assert.deepStrictEqual(spine.map(u => u.kind), ['chapter-intro', 'session']);
    assert.match(spine[1].recapHtml, /Calcutta session one/);
  });
});

describe('characterStoryGroup', () => {
  const FALLEN = new Set(entry('vault.statuses.fallen').default);
  it('groups a PC by status, using the fallen list it is given', () => {
    assert.strictEqual(characterStoryGroup({ status: 'active' }, FALLEN), 'current');
    assert.strictEqual(characterStoryGroup({}, FALLEN), 'current');
    assert.strictEqual(characterStoryGroup({ status: 'Retired' }, FALLEN), 'retired');
    assert.strictEqual(characterStoryGroup({ status: 'dead' }, FALLEN), 'fallen');
    assert.strictEqual(characterStoryGroup({ status: ' KIA ' }, FALLEN), 'fallen');
    assert.strictEqual(characterStoryGroup({ status: 'MIA' }, FALLEN), 'current'); // not in fallen set
    assert.strictEqual(characterStoryGroup({ status: 'missing' }, FALLEN), 'fallen');
    assert.strictEqual(characterStoryGroup({ status: 'dead' }, new Set()), 'current');
    assert.strictEqual(characterStoryGroup({ status: 'retired' }, new Set(['retired'])), 'retired', 'retired keeps its own group');
  });
  it('a missing list fails loudly', () => {
    assert.throws(() => characterStoryGroup({ status: 'dead' }), TypeError);
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

describe('wrap-up matching in a flat Sessions/ folder', () => {
  // Real vaults often keep every session AND every wrap-up in one shared Sessions/
  // folder. The same-folder heuristic must not shotgun the first wrap-up onto every
  // session — the explicit session: ref has to win.
  const pages = [
    { title: 'Chapter 1 Overview', displayTitle: 'Chapter 1', sourcePath: '/v/Chapters/Ch1/Chapter 1 Overview.md', frontmatter: { type: 'chapter', sort_order: 1 }, markdown: '## Overview\nx' },
    { title: 'Session 01 - Alpha', sourcePath: '/v/Chapters/Ch1/Sessions/Session 01 - Alpha.md', frontmatter: { type: 'session', session_number: 1 }, markdown: '## Overview\nx' },
    { title: 'Session 02 - Bravo', sourcePath: '/v/Chapters/Ch1/Sessions/Session 02 - Bravo.md', frontmatter: { type: 'session', session_number: 2 }, markdown: '## Overview\nx' },
    { title: 'Session 01 - Alpha - Wrap-Up', sourcePath: '/v/Chapters/Ch1/Sessions/Session 01 - Alpha - Wrap-Up.md', frontmatter: { type: 'session_wrap', session: '[[Session 01 - Alpha]]' }, markdown: '## Narrative Recap\nALPHA RECAP' },
    { title: 'Session 02 - Bravo - Wrap-Up', sourcePath: '/v/Chapters/Ch1/Sessions/Session 02 - Bravo - Wrap-Up.md', frontmatter: { type: 'session_wrap', session: '[[Session 02 - Bravo]]' }, markdown: '## Narrative Recap\nBRAVO RECAP' },
  ];

  it('gives each session its OWN wrap-up recap, not the first wrap-up in the folder', () => {
    const spine = buildStorySpine(pages);
    const s1 = spine.find(u => u.title.includes('Alpha'));
    const s2 = spine.find(u => u.title.includes('Bravo'));
    assert.match(s1.recapHtml, /ALPHA RECAP/);
    assert.ok(!/BRAVO/.test(s1.recapHtml), 'session 1 must not get session 2 content');
    assert.match(s2.recapHtml, /BRAVO RECAP/);
    assert.ok(!/ALPHA/.test(s2.recapHtml), 'session 2 must not get session 1 content');
  });

  it('still uses the same-folder heuristic when it is unambiguous (per-session subfolders)', () => {
    const nested = [
      { title: 'Chapter 4 Overview', displayTitle: 'Chapter 4', sourcePath: '/v/Chapters/Ch4/Chapter 4 Overview.md', frontmatter: { type: 'chapter', sort_order: 4 }, markdown: '## Overview\nx' },
      { title: 'Session 01', sourcePath: '/v/Chapters/Ch4/Sessions/Session 01/Session 01.md', frontmatter: { type: 'session', session_number: 1 }, markdown: '## Overview\nx' },
      { title: 'Session 01 Wrap Up', sourcePath: '/v/Chapters/Ch4/Sessions/Session 01/Session_01_Wrap_Up.md', frontmatter: { type: 'session_wrap', session: 'Session 01 - The Morning After' }, markdown: '## Narrative Recap\nSubfolder recap.' },
    ];
    const spine = buildStorySpine(nested);
    const sessions = spine.filter(u => u.kind === 'session');
    assert.strictEqual(sessions.length, 1);
    assert.match(sessions[0].recapHtml, /Subfolder recap/);
  });
});

// Review of #276: the Saga takes a session's recap from the Wrap-Up session-hub.js pairs
// with it — the same rule that withholds the hub body — so a hub linked only through
// documents.wrap_up, in a flat folder with two Wrap-Ups, keeps its recap.
describe('buildStorySpine pairs a session with its Wrap-Up through session-hub (#276 review)', () => {
  it('keeps the recap of a hub paired only by documents.wrap_up beside a second Wrap-Up', () => {
    const at = (page, dir) => Object.assign(page, { sourcePath: `/v/${dir}/${page.title}.md`, vaultPath: `${dir}/${page.title}` });
    const pages = [
      at({ title: 'Chapter_1', frontmatter: { type: 'chapter', sort_order: 1 }, markdown: '' }, 'Chapters'),
      at({ title: 'Session 01', frontmatter: { type: 'session', session_number: 1, chapter: '[[Chapter_1]]',
        documents: { wrap_up: '[[S1 Wrap]]' } }, markdown: '' }, 'Sessions'),
      at({ title: 'Session 02', frontmatter: { type: 'session', session_number: 2, chapter: '[[Chapter_1]]',
        documents: { wrap_up: '[[S2 Wrap]]' } }, markdown: '' }, 'Sessions'),
      at({ title: 'S1 Wrap', frontmatter: { type: 'session_wrap' }, markdown: '## Narrative Recap\n\nFIRST\n' }, 'Sessions'),
      at({ title: 'S2 Wrap', frontmatter: { type: 'session_wrap' }, markdown: '## Narrative Recap\n\nSECOND\n' }, 'Sessions'),
    ];
    const spine = buildStorySpine(pages);
    assert.deepStrictEqual(spine.map(u => u.title), ['Session 01', 'Session 02']);
    assert.match(spine[0].recapHtml, /FIRST/);
    assert.match(spine[1].recapHtml, /SECOND/);
  });
});

describe('buildStorySpine: a wrap-up claimed by one unit', () => {
  const { foldPlan, applyFold } = require('../../lib/story-fold');
  // Ch1/Ch1.md, Ch1/S1.md, Ch1/S1_Wrap_Up.md: the chapter's same-folder fallback finds the session's wrap-up.
  const vault = (chapterMarkdown, status) => [
    { title: 'Ch1', displayTitle: 'Ch1', sourcePath: '/v/Ch1/Ch1.md', outputPath: 'chapters/ch1.html', frontmatter: { type: 'chapter', sort_order: 1, ...(status ? { status } : {}) }, markdown: chapterMarkdown },
    { title: 'S1', displayTitle: 'S1', sourcePath: '/v/Ch1/S1.md', outputPath: 'sessions/s1.html', frontmatter: { type: 'session', session_number: 1 }, markdown: '## Overview\nx' },
    { title: 'S1_Wrap_Up', sourcePath: '/v/Ch1/S1_Wrap_Up.md', outputPath: 'sessions/s1-wrap-up.html', frontmatter: { type: 'session-wrap-up', session: '[[S1]]' },
      markdown: '## Narrative Recap\nThey came.\n\n## Loot\nA key.\n\n## Memorable Moments\n- one\n\n## Notes\nLater.' },
  ];
  const folded = (pages) => {
    applyFold(foldPlan(buildStorySpine(pages, null)), {});
    return buildStorySpine(pages, {});
  };
  for (const status of [undefined, 'active', 'Complete']) {
    it(`(c) a chapter (status ${status}) takes nothing from a wrap-up its session claims: its introduction only`, () => {
      const spine = folded(vault('# Ch1\n\n## Overview\nThe chapter opens.', status));
      const session = spine.find(u => u.kind === 'session');
      const intro = spine.find(u => u.kind === 'chapter-intro');
      assert.ok(session && intro, `units: ${spine.map(u => u.kind)}`);
      assert.match(session.recapHtml, /They came/);
      assert.deepStrictEqual(session.sections.map(s => s.title), ['Loot', 'Notes']);
      assert.match(intro.recapHtml, /The chapter opens/);
      assert.doesNotMatch(intro.recapHtml, /They came|<h1/);
      assert.strictEqual(intro.wrapUpPage, null);
      assert.deepStrictEqual([intro.sections, intro.moments, intro.after], [[], null, []]);
    });
  }
});

describe('buildStorySpine: a chapter has a recap only once complete', () => {
  const { foldPlan } = require('../../lib/story-fold');
  const vault = (status) => [
    { title: 'Ch1', displayTitle: 'Ch1', sourcePath: '/v/Ch1/Ch1.md', frontmatter: { type: 'chapter', sort_order: 1, status }, markdown: '# Ch1\n\n## Overview\nThe chapter opens.' },
    { title: 'S1', displayTitle: 'S1', sourcePath: '/v/Ch1/S1/S1.md', frontmatter: { type: 'session', session_number: 1, chapter: '[[Ch1]]' }, markdown: '## Overview\nx' },
    { title: 'S1 Wrap Up', sourcePath: '/v/Ch1/S1/S1_Wrap_Up.md', frontmatter: { type: 'session-wrap-up', session: '[[S1]]' }, markdown: '## Narrative Recap\nThey came.' },
    { title: 'Ch1 Wrap Up', sourcePath: '/v/Ch1/Ch1_Wrap_Up.md', frontmatter: { type: 'session-wrap-up', chapter: '[[Ch1]]' },
      markdown: '## Narrative Recap\nCHAPTER-RECAP.\n\n## Loot\nThe lighthouse key.' },
  ];
  it('(a) an active chapter shows its introduction only and claims no wrap-up', () => {
    const pages = vault('active');
    const spine = buildStorySpine(pages);
    const intro = spine.find(u => u.kind === 'chapter-intro');
    assert.ok(intro, `units: ${spine.map(u => u.kind)}`);
    assert.match(intro.recapHtml, /The chapter opens/);
    assert.doesNotMatch(intro.recapHtml, /CHAPTER-RECAP/);
    assert.strictEqual(intro.wrapUpPage, null);
    assert.deepStrictEqual(intro.sections, []);
    assert.ok(![...foldPlan(spine).keys()].includes(pages[3]), 'the chapter wrap-up keeps its own page');
  });
  it('(b) a complete chapter takes its recap and sections from its own wrap-up, which folds in', () => {
    const pages = vault('complete');
    const spine = buildStorySpine(pages);
    const intro = spine.find(u => u.kind === 'chapter-intro');
    assert.match(intro.recapHtml, /CHAPTER-RECAP/);
    assert.doesNotMatch(intro.recapHtml, /The chapter opens/);
    assert.deepStrictEqual(intro.sections.map(s => s.title), ['Loot']);
    assert.strictEqual(foldPlan(spine).get(pages[3]), intro);
  });
});

// The GM Story page's notes from the player site's side (#543): never held-back text unmarked with no banner.
describe('gmStoryNotes', () => {
  const { gmStoryNotes } = require('../../lib/story-spine');
  const wrap = { gmHiddenBecause: 'canon_status: DRAFT and exclude_drafts is on', foldedFrom: 'sessions/w.html' };
  const hub = { gmHiddenBecause: 'publish: false' };
  const hiddenFrom = (...ps) => (p) => !ps.includes(p);

  it('players have the page and see the wrap-up: no banner, nothing held', () => {
    assert.deepStrictEqual(gmStoryNotes({ sourcePage: hub, wrapUpPage: wrap }, { playerHas: true, shows: () => true, folded: wrap }), { banner: null, held: null });
  });

  it('players have the page, the wrap-up is held back and their recap leads it: held in one mark, no banner', () => {
    const heldBack = { recapHtml: '<p>theirs</p>', wrapHasRecap: true, wrapRecapTitle: 'Narrative Recap' };
    const out = gmStoryNotes({ sourcePage: hub, wrapUpPage: wrap, heldBack }, { playerHas: true, shows: hiddenFrom(wrap), folded: wrap });
    assert.deepStrictEqual(out, { banner: null, held: heldBack });
  });

  it('players have the page, the wrap-up is held back, and there is no recap of theirs: the banner gives the reason', () => {
    for (const heldBack of [undefined, { recapHtml: null }, { recapHtml: '' }]) {
      const out = gmStoryNotes({ sourcePage: hub, wrapUpPage: wrap, heldBack }, { playerHas: true, shows: hiddenFrom(wrap), folded: wrap });
      assert.strictEqual(out.held, null);
      assert.strictEqual(out.banner, 'players see another Story page here; this wrap-up is held back: canon_status: DRAFT and exclude_drafts is on');
    }
  });

  it('players have no page: the banner says where they read the wrap-up, or why it is held back', () => {
    assert.strictEqual(gmStoryNotes({ sourcePage: hub, wrapUpPage: wrap }, { playerHas: false, shows: () => true, folded: wrap }).banner,
      'players see this wrap-up on its own page (sessions/w.html), not here');
    assert.strictEqual(gmStoryNotes({ sourcePage: hub, wrapUpPage: wrap }, { playerHas: false, shows: hiddenFrom(wrap), folded: wrap }).banner, wrap.gmHiddenBecause);
    assert.strictEqual(gmStoryNotes({ sourcePage: hub, wrapUpPage: null }, { playerHas: false, shows: () => false }).banner, 'publish: false');
    assert.strictEqual(gmStoryNotes({ sourcePage: {}, wrapUpPage: null }, { playerHas: false, shows: () => false }).banner, 'the player site has no Story page here');
  });
});

// Chapter status (chapter pages, Task 2): planned / active / complete, anything else unknown.
describe('chapterStatus', () => {
  const { chapterStatus } = require('../../lib/story-spine');
  const of = (status) => chapterStatus({ frontmatter: status === undefined ? {} : { status } });
  it('reads planned, active and complete in any case, trimmed', () => {
    assert.strictEqual(of('Active'), 'active');
    assert.strictEqual(of(' complete '), 'complete');
    assert.strictEqual(of('PLANNED'), 'planned');
  });
  it('a missing or other value is unknown', () => {
    assert.strictEqual(of('in_progress'), 'unknown');
    assert.strictEqual(of(undefined), 'unknown');
    assert.strictEqual(of(''), 'unknown');
    assert.strictEqual(chapterStatus(null), 'unknown');
  });
});

describe('buildStorySpine: chapter status', () => {
  it('a planned chapter gives no unit for itself or its sessions, and records the sessions it held back', () => {
    const chapter = ch('Chapter_1', 1, 'planned');
    const s1 = sess('Chapter_1_S1', 'Chapter_1', 1, 'C1S1 recap');
    const spine = buildStorySpine([chapter, s1]);
    assert.deepStrictEqual(spine.map(u => u.id), []);
    assert.deepStrictEqual(spine.heldBackSessions, [{ chapter, sessions: [s1] }]);
    assert.deepStrictEqual(spine.unpublishedChapters, []);
  });
  it('a planned chapter whose sessions have no recap holds nothing back', () => {
    const spine = buildStorySpine([ch('Chapter_1', 1, 'planned'), sess('Chapter_1_S1', 'Chapter_1', 1, null)]);
    assert.deepStrictEqual(spine.heldBackSessions, []);
  });
  for (const status of ['active', 'complete', 'in_progress', undefined]) {
    it(`a ${status} chapter is shown`, () => {
      const spine = buildStorySpine([ch('Chapter_1', 1, status), sess('Chapter_1_S1', 'Chapter_1', 1, 'C1S1 recap')]);
      assert.ok(spine.some(u => u.kind === 'session'), `units: ${spine.map(u => u.kind)}`);
      assert.deepStrictEqual(spine.heldBackSessions, []);
    });
  }
  // Review Focus 1: the chapter note does not publish, so it is not in `pages`.
  it('a session naming a chapter that is not in pages records the ref, once', () => {
    const spine = buildStorySpine([
      sess('Chapter_9_S1', 'Chapter_9', 1, 'C9S1 recap'),
      sess('Chapter_9_S2', 'Chapter_9', 2, 'C9S2 recap'),
      sess('Loose', '', 3, 'no ref at all'),
    ]);
    assert.deepStrictEqual(spine.unpublishedChapters.map(e => [e.ref, e.sessions.map(x => x.title)]), [['Chapter_9', ['Chapter_9_S1', 'Chapter_9_S2']]]);
    assert.deepStrictEqual(spine.heldBackSessions, []);
  });
});
