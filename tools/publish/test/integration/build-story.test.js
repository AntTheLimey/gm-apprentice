const { describe, it, before, after } = require('node:test');
require('../helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');

const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

describe('build story section', () => {
  let out, configPath, docs;
  const fixtures = path.join(__dirname, '..', 'fixtures', 'story');
  const read = rel => fs.readFileSync(path.join(docs, rel), 'utf8');

  before(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'story-build-'));
    configPath = path.join(out, 'config.json');
    docs = path.join(out, 'docs');
    fs.writeFileSync(configPath, JSON.stringify({
      vaultPath: fixtures, outputDir: docs, attachmentsDir: '_attachments',
      siteTitle: 'Story Test', siteUrl: 'https://example.github.io/story',
      excludeDirs: ['_meta', '_Templates'],
      excludeSections: ['GM Notes'],
      folderMap: { Chapters: 'chapters', 'Characters/PCs': 'characters/pcs', Locations: 'locations' },
    }));
    build({ configPath });
  });
  after(() => fs.rmSync(out, { recursive: true, force: true }));

  it('renders a campaign story page for the Chapter 1 chapter-level recap', () => {
    const html = read('story/chapter-1-london.html');
    assert.ok(html.includes('class="story-prose story-chapter"'), 'Ch1 story page missing story-prose');
    assert.ok(html.includes('Lord Harcourt'), 'Ch1 recap content missing');
  });

  it('renders a campaign story page for Chapter 2 Session 1', () => {
    const html = read('story/chapter-2-vienna-session-1.html');
    assert.ok(html.includes('class="story-prose"'), 'Session 1 story page missing story-prose');
    assert.ok(html.includes('Arrival in Vienna'), 'Session 1 recap content missing');
  });

  it('renders a two-branch story landing page', () => {
    const html = read('story.html');
    assert.ok(html.includes('The Story So Far'), 'landing missing The Story So Far branch');
    assert.ok(html.includes('Character Stories'), 'landing missing Character Stories branch');
    assert.ok(html.includes('Adrien'), 'landing missing PC name Adrien');
  });

  it('renders a character story page linked back to the PC sheet', () => {
    const html = read('story/characters/adrien.html');
    // Apostrophe is rendered as a typographic smart quote, so match a quote-free substring.
    assert.ok(html.includes('tale begins in Paris'), 'character story prose missing');
    assert.ok(html.includes('characters/pcs/adrien.html'), 'character story missing link back to PC sheet');
  });

  it('does not leak GM-only content into any story page', () => {
    const storyDir = path.join(docs, 'story');
    const files = walk(storyDir).filter(f => f.endsWith('.html'));
    assert.ok(files.length > 0, 'expected story pages to walk');
    for (const f of files) {
      const html = fs.readFileSync(f, 'utf8');
      assert.ok(!html.includes('locket is cursed'), `GM-only content leaked into ${f}`);
    }
  });
});

// Chapter status (chapter pages, Task 2): what a chapter holds back is said, never silent.
describe('build story: chapters the Story cannot show say so', () => {
  const { buildBoth } = require('../helpers/gm-build');
  const { storyVault, CHAPTER } = require('../helpers/story-vault');

  // A planned note already stays off the player site (AUTO_EXCLUDED_STATUS), so there its sessions name a chapter that
  // does not publish; the GM site has the note, and its Story holds the planned chapter's sessions back.
  it('a planned chapter with played sessions: no Story page for them, and one warning naming them on each site', () => {
    const vault = storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER.replace('sort_order: 1\n', 'sort_order: 1\nstatus: planned\n') });
    for (const site of ['player', 'gm']) {
      const s = buildBoth(vault, { sites: [site] });
      try {
        assert.equal(s[site].exists('story', 'chapter-1-docks-session-1.html'), false, site);
        const hits = s.logs.filter((l) => /WARNING/.test(l) && /Chapter 1 Overview/.test(l));
        assert.equal(hits.length, 1, `${site}:\n${s.logs.join('\n')}`);
        if (site === 'gm') assert.match(hits[0], /Chapters\/Chapter 1\/Chapter 1 Overview\.md: this chapter is planned/);
        assert.match(hits[0], /Sessions\/Session 1\.md/);
        assert.match(hits[0], /Sessions\/Session 2\.md/);
      } finally { s.cleanup(); }
    }
  });

  // Review Focus 1: the chapter note does not publish, so nothing of it shows and its sessions have no chapter.
  it('a chapter note that does not publish: one warning naming it, and nothing of the note shows', () => {
    const s = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER.replace('sort_order: 1\n', 'sort_order: 1\npublish: false\n') }), { sites: ['player'] });
    try {
      const hits = s.logs.filter((l) => /WARNING/.test(l) && /Chapter 1 Overview/.test(l));
      assert.equal(hits.length, 1, s.logs.join('\n'));
      const all = s.player.files().filter((f) => f.endsWith('.html')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
      assert.ok(!all.includes('CHAPTER-BODY-1'), 'the chapter note shows nowhere');
    } finally { s.cleanup(); }
  });
});

// Chapter pages (Task 5): Story So Far reads like a book's contents.
describe('build story: the Story So Far contents page', () => {
  const { buildBoth } = require('../helpers/gm-build');
  const { storyVault, CHAPTER, SESSION, WRAP_2 } = require('../helpers/story-vault');
  const CH1 = CHAPTER.replace('sort_order: 1\n', 'sort_order: 1\nstatus: complete\noverview: The docks were cleared.\ndate_range: March 1817\n')
    + '\n## Recap\n\nCH1-RECAP the docks.\n';
  const CH2 = '---\ntype: chapter\ntitle: Chapter 2 — Bay\nsort_order: 2\nstatus: active\n---\n\n# Chapter 2\n\nGM-SUMMARY-2 secret.\n\n## Teaser\n\nTEASER-2 you wake on a boat, by [[Mara Quill]].\n';
  const CH0 = '---\ntype: chapter\ntitle: Before the Docks\nsort_order: 0.5\nstatus: complete\n---\n\n# Before\n';
  const CH0_WRAP = '---\ntype: session_wrap\nchapter: "[[Chapter 0 Overview]]"\n---\n\n# Chapter 0 Wrap-Up\n\n## Narrative Recap\n\nCH0-RECAP long ago.\n';
  const S3 = SESSION(3).replace('[[Chapter 1 Overview]]', '[[Chapter 2 Overview]]');
  const W3 = WRAP_2.replace(/Session 2/g, 'Session 3').replace('session_number: 2', 'session_number: 3').replace('[[Chapter 1 Overview]]', '[[Chapter 2 Overview]]');
  const S1 = SESSION(1).replace('status: played\n', 'status: played\nin_game_date: 12 March 1817\n');
  const s = buildBoth(storyVault({
    'Chapters/Chapter 0/Chapter 0 Overview.md': CH0, 'Chapters/Chapter 0/Chapter 0 Wrap-Up.md': CH0_WRAP,
    'Chapters/Chapter 1/Chapter 1 Overview.md': CH1, 'Chapters/Chapter 2/Chapter 2 Overview.md': CH2,
    'Sessions/Session 1.md': S1, 'Sessions/Session 3.md': S3, 'Sessions/Session 3 Wrap-Up.md': W3, 'Sessions/Session 3 Play Notes.md': null,
  }));
  after(() => s.cleanup());
  const contents = (side) => { const h = s[side].read('story.html'); return h.slice(h.indexOf('<section class="story-contents"'), h.indexOf('</section>', h.indexOf('<section class="story-contents"'))); };

  it('chapters in order, each with its parts; the old Campaign Saga is gone', () => {
    for (const side of ['player', 'gm']) {
      const html = s[side].read('story.html');
      assert.doesNotMatch(html, /Campaign Saga/);
      const c = contents(side);
      assert.match(c, /<h2>The Story So Far<\/h2>/);
      assert.match(c, /<a class="story-begin" href="story\/before-the-docks\.html">/);
      const at = ['data-chapter-status="complete"', 'Before the Docks', 'Told as one account', 'Chapter One', 'Chapter 1 — Docks', 'March 1817',
        'The docks were cleared.', 'Session 1', 'Session 2', 'data-chapter-status="active"', 'Chapter Two', 'Chapter 2 — Bay', 'now being played', 'TEASER-2', 'Session 3', 'story-contents-end']
        .map((w) => c.indexOf(w));
      assert.ok(at.every((x, i) => x >= 0 && (i === 0 || at[i - 1] < x)), `${side} in order: ${at}`);
      assert.match(c, /<h3><a href="story\/chapter-1-docks\.html">Chapter 1 — Docks<\/a><\/h3>/);
      assert.match(c, /<p class="story-contents-one">Told as one account · <a href="story\/before-the-docks\.html">read it<\/a><\/p>/);
      assert.match(c, /<p class="story-contents-end" data-ending="continues"><\/p>/);
      // Nothing else of a chapter note: not the GM summary, not the complete chapter's recap, not the active one's body.
      assert.doesNotMatch(c, /GM-SUMMARY-2|CH1-RECAP|CHAPTER-BODY-1|CH0-RECAP/);
      // The Teaser's link is read from story.html.
      assert.match(c, /<a href="npcs\/mara-quill\.html">Mara Quill<\/a>/);
    }
  });

  it('a session row: number, linked title, in-game date in the margin (empty with none)', () => {
    const c = contents('player');
    assert.match(c, /<li><span class="n" data-digits="1">1<\/span><a href="story\/chapter-1-docks-session-1\.html">Session 1<\/a><span class="d">12 March 1817<\/span><\/li>/);
    assert.match(c, /<li><span class="n" data-digits="1">2<\/span><a href="story\/chapter-1-docks-session-2\.html">Session 2<\/a><span class="d"><\/span><\/li>/);
    // The number is the session's own: Chapter 2's first session is 3, not 1.
    assert.match(c, /<li><span class="n" data-digits="1">3<\/span><a href="story\/chapter-2-bay-session-3\.html">Session 3<\/a>/);
  });

  it('every link resolves', () => {
    const { brokenLinks } = require('../helpers/site-links');
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assert.deepEqual(brokenLinks(s.gm.dir), []);
  });

  it('with no active chapter the ending is the completed form', () => {
    const t = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': CH1 }), { sites: ['player'] });
    try {
      assert.match(t.player.read('story.html'), /<p class="story-contents-end" data-ending="ended"><\/p>/);
    } finally { t.cleanup(); }
  });

  // Review Focus 4: a vault with no chapter notes builds as origin/main does.
  it('a vault with no chapter notes: no contents, no chapter pages, no warnings, no redirects', () => {
    // A chapterless vault: no chapter note, and no session or wrap-up names one.
    const files = storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': null });
    for (const k of Object.keys(files)) files[k] = files[k].replace(/^chapter: .*\n/m, '');
    const t = buildBoth(files);
    try {
      for (const side of ['player', 'gm']) {
        assert.equal(t[side].exists('story.html'), false, side);
        assert.deepEqual(t[side].files().filter((f) => /[\\/]story[\\/].*\.html$/.test(f)), [], side);
        assert.ok(t[side].files().some((f) => /session-1-wrap-up\.html$/.test(f)), `${side}: the wrap-up keeps its page`);
      }
      assert.deepEqual(t.logs.filter((l) => /WARNING/.test(l) && /chapter/i.test(l)), []);
    } finally { t.cleanup(); }
  });
});

// Chapter pages (Task 6): the old -intro address leads to the chapter page.
describe('build story: the old chapter introduction address', () => {
  const { buildBoth } = require('../helpers/gm-build');
  const { storyVault, CHAPTER } = require('../helpers/story-vault');

  it('story/<chapter>-intro.html is a redirect to story/<chapter>.html, on both sites', () => {
    const s = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER.replace('sort_order: 1\n', 'sort_order: 1\nstatus: active\n') }));
    try {
      for (const side of ['player', 'gm']) {
        const html = s[side].read('story', 'chapter-1-docks-intro.html');
        assert.match(html, /<meta http-equiv="refresh" content="0;url=chapter-1-docks\.html">/, side);
        assert.match(html, /<link rel="canonical" href="chapter-1-docks\.html">/, side);
        assert.match(html, /<a href="chapter-1-docks\.html">Chapter 1 — Docks<\/a>/, side);
      }
    } finally { s.cleanup(); }
  });

  it('no redirect where origin/main wrote no introduction (a chapter with no sessions)', () => {
    const s = buildBoth(storyVault({ 'Sessions/Session 1 Wrap-Up.md': null, 'Sessions/Session 2 Wrap-Up.md': null,
      'Sessions/Session 1.md': null, 'Sessions/Session 2.md': null,
      'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER.replace('sort_order: 1\n', 'sort_order: 1\nstatus: active\n') }), { sites: ['player'] });
    try {
      assert.ok(s.player.exists('story', 'chapter-1-docks.html'));
      assert.equal(s.player.exists('story', 'chapter-1-docks-intro.html'), false);
    } finally { s.cleanup(); }
  });
});

// Chapter pages (Task 6): the new styling reads tokens only, so a campaign's stylesheet reaches every colour and face.
describe('chapter page styling uses theme tokens only', () => {
  const cssDir = path.join(__dirname, '..', '..', 'css');
  const files = ['style.css', ...['horror', 'scifi', 'military', 'fantasy', 'noir'].map((t) => `themes/${t}.css`)];
  // The CSS named colours (CSS Color 4), as words.
  const NAMED = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood '
    + 'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen '
    + 'darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray '
    + 'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia '
    + 'gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender '
    + 'lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink '
    + 'lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon '
    + 'mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise '
    + 'mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid '
    + 'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red '
    + 'rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow '
    + 'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '));
  // Strips every var(...), nested ones included.
  const withoutVars = (v) => { let out = v; let prev; do { prev = out; out = out.replace(/var\([^()]*\)/g, ''); } while (out !== prev); return out; };
  const wholeVar = (v) => /^var\(/.test(v) && withoutVars(v).trim() === '';
  // The fixed colours and faces in a block of CSS: each declaration (split on `;` and `}`), its comments and `content`
  // strings aside. `font` and `font-family` must be wholly var(...); anywhere else, no hex, rgb/hsl or named colour
  // outside var(...).
  function faults(css) {
    const found = [];
    for (const chunk of css.replace(/\/\*[\s\S]*?\*\//g, '').split(/[;}]/)) {
      const decl = chunk.slice(chunk.lastIndexOf('{') + 1).trim();
      const colon = decl.indexOf(':');
      if (colon < 0) continue;
      const prop = decl.slice(0, colon).trim().toLowerCase();
      const value = decl.slice(colon + 1).trim();
      if (prop === 'content') continue;
      if ((prop === 'font' || prop === 'font-family') && !wholeVar(value)) { found.push(decl); continue; }
      const bare = withoutVars(value);
      if (/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(bare)
        || (bare.toLowerCase().match(/[a-z-]+/g) || []).some((w) => NAMED.has(w))) found.push(decl);
    }
    return found;
  }

  it('the check catches what a review planted', () => {
    for (const plant of ['.a { color: #fff }', '.a { margin: 0; color: #abcdef }', '.a { color: crimson; }',
      '.a { font-family: "EB Garamond"; }', '.a { font: italic 1rem "Palatino"; }', '.a { border: 1px solid rgb(0, 0, 0); }',
      '.a { background: hsl(0 0% 0%); }', '.a { font-family: var(--font-body), serif; }']) {
      assert.ok(faults(plant).length > 0, `missed: ${plant}`);
    }
    for (const fine of ['.a { color: var(--accent); }', '.a { font-family: var(--font-label, var(--font-body)); }',
      '.a { border-bottom: 1px dotted var(--border) }', '.a::before { content: "white"; }', '.a { border-top-color: var(--accent); }']) {
      assert.deepEqual(faults(fine), [], fine);
    }
  });

  for (const f of files) {
    it(`${f}: its chapter pages block has no fixed colour or font`, () => {
      const css = fs.readFileSync(path.join(cssDir, f), 'utf8');
      const m = /\/\* chapter pages: start \*\/([\s\S]*?)\/\* chapter pages: end \*\//.exec(css);
      assert.ok(m, `${f} has no chapter pages block`);
      assert.deepEqual(faults(m[1]), [], f);
    });
  }
});

// PR B fix round: what the Story leaves out, and the bookkeeping it says aloud.
describe('build story: fix round', () => {
  const { buildBoth } = require('../helpers/gm-build');
  const { storyVault, CHAPTER, SESSION, WRAP_2 } = require('../helpers/story-vault');
  const fence = (t) => `<!-- gm-only -->\n${t}\n<!-- /gm-only -->`;
  // Every player file: the chapter note has no page, link preview or search entry of its own there (chapter pages).
  const playerText = (site) => site.player.files().map((f) => [path.relative(site.player.dir, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')]);

  it('M1/N1: a GM heading that contains "teaser" or "recap", and text after a later H1, reach no Story page', () => {
    const ch1 = CHAPTER.replace('sort_order: 1\n', 'sort_order: 1\nstatus: complete\n')
      + '\n## Recap ideas (GM)\n\nLEAKX-RECAPIDEAS\n\n## Recap\n\nRECAP-OK.\n\n# Appendix\n\nLEAKX-H1AFTER\n';
    const ch2 = '---\ntype: chapter\ntitle: Chapter Five\nsort_order: 5\nstatus: active\n---\n\n# Chapter Five\n\n'
      + `${fence('## Teaser\n\nLEAKX-CH5-FENCEDTEASER')}\n\n## Teaser ideas for later\n\nLEAKX-CH5-TEASERIDEAS GM brainstorm.\n\n## The teaser of doom (GM only, never show)\n\nLEAKX-DOOMTEASER\n`;
    const s3 = SESSION(3).replace('[[Chapter 1 Overview]]', '[[Chapter 5 Overview]]');
    const w3 = WRAP_2.replace(/Session 2/g, 'Session 3').replace('session_number: 2', 'session_number: 3').replace('[[Chapter 1 Overview]]', '[[Chapter 5 Overview]]');
    const s = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': ch1, 'Chapters/Chapter 5/Chapter 5 Overview.md': ch2,
      'Sessions/Session 3.md': s3, 'Sessions/Session 3 Wrap-Up.md': w3, 'Sessions/Session 3 Play Notes.md': null }));
    try {
      assert.match(s.player.read('story', 'chapter-1-docks.html'), /RECAP-OK/);
      assert.ok(s.player.exists('story', 'chapter-five.html'));
      for (const [file, text] of playerText(s)) {
        for (const secret of ['LEAKX-RECAPIDEAS', 'LEAKX-H1AFTER', 'LEAKX-CH5-FENCEDTEASER', 'LEAKX-CH5-TEASERIDEAS', 'LEAKX-DOOMTEASER']) {
          assert.ok(!text.includes(secret), `${secret} in ${file}`);
        }
      }
    } finally { s.cleanup(); }
  });

  it('S1: two chapter notes with one title get two pages, and one warning names both', () => {
    const arc = (status, word) => `---\ntype: chapter\ntitle: Arc\nsort_order: ${status === 'complete' ? 1 : 2}\nstatus: ${status}\n---\n\n# Arc\n\n## Recap\n\n${word}\n`;
    const s = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': null, 'Chapters/A/Arc.md': arc('complete', 'RECAP-ARC-A-OK'), 'Chapters/B/Arc.md': arc('active', 'B') }), { sites: ['player'] });
    try {
      assert.ok(s.player.exists('story', 'arc.html') && s.player.exists('story', 'arc-2.html'));
      assert.match(s.player.read('story', 'arc.html'), /RECAP-ARC-A-OK/);
      const hits = s.logs.filter((l) => /WARNING/.test(l) && /Chapters\/A\/Arc\.md/.test(l) && /Chapters\/B\/Arc\.md/.test(l));
      assert.equal(hits.length, 1, s.logs.join('\n'));
    } finally { s.cleanup(); }
  });

  it('S2: a played session no chapter heads is named where a chapter shows', () => {
    const s0 = SESSION(0).replace(/chapter: .*\n/, '').replace('session_number: 0', 'session_number: 0');
    const w0 = WRAP_2.replace(/Session 2/g, 'Session 0').replace('session_number: 2', 'session_number: 0').replace(/chapter: .*\n/, '');
    const s = buildBoth(storyVault({ 'Sessions/Session 0.md': s0, 'Sessions/Session 0 Wrap-Up.md': w0 }), { sites: ['player'] });
    try {
      const hits = s.logs.filter((l) => /WARNING/.test(l) && /Sessions\/Session 0\.md/.test(l));
      assert.equal(hits.length, 1, s.logs.join('\n'));
    } finally { s.cleanup(); }
  });

  it('S3: unknown status, an active chapter with no Teaser, and two active chapters each say so on one line', () => {
    const ch = (n, status, extra = '') => `---\ntype: chapter\ntitle: Chapter ${n}\nsort_order: ${n}\n${status ? `status: ${status}\n` : ''}---\n\n# Chapter ${n}\n${extra}`;
    const s = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': ch(1, 'complet'),
      'Chapters/C2/Chapter 2.md': ch(2, 'active'), 'Chapters/C3/Chapter 3.md': ch(3, 'active', '\n## Teaser\n\nT.\n'), 'Chapters/C4/Chapter 4.md': ch(4, null) }), { sites: ['player'] });
    try {
      const warn = s.logs.filter((l) => /WARNING/.test(l));
      assert.equal(warn.filter((l) => /Chapter 1 Overview\.md/.test(l) && /"complet"/.test(l)).length, 1, warn.join('\n'));
      assert.equal(warn.filter((l) => /Chapter 4\.md/.test(l) && /no status/.test(l)).length, 1, warn.join('\n'));
      assert.equal(warn.filter((l) => /Chapter 2\.md/.test(l) && /Teaser/.test(l)).length, 1, warn.join('\n'));
      assert.equal(warn.filter((l) => /Chapter 3\.md/.test(l) && /Teaser/.test(l)).length, 0, warn.join('\n'));
      assert.equal(warn.filter((l) => /more than one/.test(l) && /Chapter 2\.md/.test(l) && /Chapter 3\.md/.test(l)).length, 1, warn.join('\n'));
    } finally { s.cleanup(); }
  });

  it('N3: the player build names a planned chapter as planned', () => {
    const s = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER.replace('sort_order: 1\n', 'sort_order: 1\nstatus: planned\n') }), { sites: ['player'] });
    try {
      const hits = s.logs.filter((l) => /WARNING/.test(l) && /Chapter 1 Overview/.test(l));
      assert.equal(hits.length, 1, s.logs.join('\n'));
      assert.match(hits[0], /Chapters\/Chapter 1\/Chapter 1 Overview\.md: this chapter is planned/);
    } finally { s.cleanup(); }
  });
});

// PR B CodeRabbit round (4465405774): a status hide.fields takes off still reads as no status on the Story (pinned in
// explain-cli (f)); the warning says why, rather than telling the GM the note has none.
describe('build story: a chapter status the player site hides', () => {
  const { buildBoth } = require('../helpers/gm-build');
  const { storyVault, CHAPTER } = require('../helpers/story-vault');
  it('the warning names hide.fields', () => {
    const s = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER.replace('sort_order: 1\n', 'sort_order: 1\nstatus: complete\n') }),
      { player: { hide: { fields: ['status'] } }, sites: ['player'] });
    try {
      const hits = s.logs.filter((l) => /WARNING/.test(l) && /Chapter 1 Overview\.md/.test(l));
      assert.equal(hits.length, 1, s.logs.join('\n'));
      assert.match(hits[0], /hide\.fields/);
      assert.doesNotMatch(hits[0], /no status/);
    } finally { s.cleanup(); }
  });
});

// Chapter pages (Task 8): a session that moves to another chapter keeps its old Story address working, build after
// build; a session the Story stops showing gets no redirect.
describe('build story: a session that moves chapter', () => {
  const { buildBoth } = require('../helpers/gm-build');
  const { build } = require('../../lib/build');
  const { storyVault, CHAPTER, SESSION, WRAP_2 } = require('../helpers/story-vault');
  const OLD = 'chapter-1-docks-session-2.html';
  const NEW = 'chapter-2-boats-session-2.html';
  const CH2 = (status) => `---\ntype: chapter\ntitle: Chapter 2 — Boats\nsort_order: 2\nstatus: ${status}\n---\n\n# Chapter 2 — Boats\n\n## Teaser\n\nThe boats.\n`;
  const quiet = (fn) => { const saved = { log: console.log, warn: console.warn }; console.log = () => {}; console.warn = () => {}; try { fn(); } finally { Object.assign(console, saved); } };
  const vaultFile = (s, rel) => path.join(s.root, 'vault', ...rel.split('/'));
  // Into the new chapter's folder, its `chapter:` too, as a GM moves it in Obsidian.
  const moveSession2 = (s) => {
    for (const name of ['Session 2.md', 'Session 2 Wrap-Up.md']) {
      const from = vaultFile(s, `Sessions/${name}`);
      fs.writeFileSync(vaultFile(s, `Chapters/Chapter 2/${name}`), fs.readFileSync(from, 'utf8').replace('[[Chapter 1 Overview]]', '[[Chapter 2 Overview]]'));
      fs.rmSync(from);
    }
  };
  const rebuild = (s) => quiet(() => build({ configPath: s.configPath, site: 'player' }));
  const isRedirectTo = (html, to) => new RegExp(`<meta http-equiv="refresh" content="0;url=${to.replace(/\./g, '\\.')}">`).test(html);

  it('the old address redirects to the new one, and still does on the next build', () => {
    const s = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER.replace('sort_order: 1\n', 'sort_order: 1\nstatus: complete\n'), 'Chapters/Chapter 2/Chapter 2 Overview.md': CH2('active') }), { sites: ['player'] });
    try {
      assert.ok(s.player.exists('story', OLD));
      moveSession2(s);
      rebuild(s);
      assert.ok(s.player.exists('story', NEW));
      assert.ok(isRedirectTo(s.player.read('story', OLD), NEW), s.player.read('story', OLD));
      rebuild(s);
      assert.ok(isRedirectTo(s.player.read('story', OLD), NEW), 'the redirect is gone on the next build');
      const { brokenLinks } = require('../helpers/site-links');
      assert.deepEqual(brokenLinks(s.player.dir), []);
    } finally { s.cleanup(); }
  });

  it('the record is beside the site, never in its output folder', () => {
    const s = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER.replace('sort_order: 1\n', 'sort_order: 1\nstatus: complete\n') }), { sites: ['player'] });
    try {
      assert.ok(fs.existsSync(path.join(s.root, 'campaign', '.gm-apprentice', 'story-addresses.json')));
      assert.deepEqual(s.player.files().filter((f) => /story-addresses/.test(f)), []);
    } finally { s.cleanup(); }
  });

  it('a GM build, an in-memory build, a sheets-only build and a preview write no record and no moved-session redirect', () => {
    const s = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER.replace('sort_order: 1\n', 'sort_order: 1\nstatus: complete\n'), 'Chapters/Chapter 2/Chapter 2 Overview.md': CH2('active') }), { sites: ['gm'] });
    const anyRecord = () => {
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
      return walk(s.root).filter((f) => /story-addresses/.test(f));
    };
    try {
      assert.deepEqual(anyRecord(), [], 'GM build');
      quiet(() => build({ configPath: s.configPath, inMemory: true }));
      assert.deepEqual(anyRecord(), [], 'in-memory build');
      quiet(() => build({ configPath: s.configPath, outputDirOverride: path.join(s.root, 'preview') }));
      assert.deepEqual(anyRecord(), [], 'preview build');
      // A sheets-only build updates a full one: the full build's record is taken away first.
      quiet(() => build({ configPath: s.configPath }));
      for (const f of anyRecord()) fs.rmSync(f);
      quiet(() => build({ configPath: s.configPath, only: 'sheets' }));
      assert.deepEqual(anyRecord(), [], 'sheets-only build');
      // Seeded by hand, a GM build still writes no redirect from it.
      fs.mkdirSync(path.join(s.root, 'campaign', '.gm-apprentice'), { recursive: true });
      fs.writeFileSync(path.join(s.root, 'campaign', '.gm-apprentice', 'story-addresses.json'), JSON.stringify({ version: 1, sessions: { 'Session 2.md': ['story/old-session-2.html'] } }));
      quiet(() => build({ configPath: s.configPath, site: 'gm' }));
      assert.equal(s.gm.exists('story', 'old-session-2.html'), false);
    } finally { s.cleanup(); }
  });

  it('a record that cannot be read is kept as a dated .bak, the build says so, and a new record starts', () => {
    const s = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER.replace('sort_order: 1\n', 'sort_order: 1\nstatus: complete\n'), 'Chapters/Chapter 2/Chapter 2 Overview.md': CH2('active') }), { sites: ['player'] });
    const dir = path.join(s.root, 'campaign', '.gm-apprentice');
    try {
      fs.writeFileSync(path.join(dir, 'story-addresses.json'), '{"version":1,"sessions":{');
      const logs = [];
      const saved = { log: console.log, warn: console.warn };
      console.log = () => {}; console.warn = (m) => logs.push(String(m));
      try { build({ configPath: s.configPath, site: 'player' }); } finally { Object.assign(console, saved); }
      assert.equal(logs.filter((l) => /WARNING/.test(l) && /story-addresses\.json\.\d{4}-\d\d-\d\d\.bak/.test(l)).length, 1, logs.join('\n'));
      const files = fs.readdirSync(dir);
      assert.ok(files.some((f) => /^story-addresses\.json\.\d{4}-\d\d-\d\d\.bak$/.test(f)), files.join(', '));
      assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'story-addresses.json'), 'utf8')).sessions['Session 2.md']);
    } finally { s.cleanup(); }
  });

  it('two sessions with one file name are said once, and keep no old address', () => {
    const s = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER.replace('sort_order: 1\n', 'sort_order: 1\nstatus: complete\n'),
      'Chapters/Chapter 2/Chapter 2 Overview.md': CH2('active'),
      'Chapters/Chapter 2/Session 2.md': SESSION(2).replace('[[Chapter 1 Overview]]', '[[Chapter 2 Overview]]').replace('title: Session 2', 'title: Session 2b').replace('session_number: 2', 'session_number: 3').replace('[[Session 2 Wrap-Up]]', '[[Session 2b Wrap-Up]]'),
      'Chapters/Chapter 2/Session 2b Wrap-Up.md': WRAP_2.replace('[[Session 2]]', '[[Chapters/Chapter 2/Session 2|Session 2]]').replace('[[Chapter 1 Overview]]', '[[Chapter 2 Overview]]').replace('RECAP-TWO-1', 'RECAP-TWOB-1') }), { sites: ['player'] });
    try {
      const hits = s.logs.filter((l) => /WARNING/.test(l) && /share the file name "Session 2\.md"/.test(l));
      assert.equal(hits.length, 1, s.logs.filter((l) => /WARNING/.test(l)).join('\n'));
      const record = JSON.parse(fs.readFileSync(path.join(s.root, 'campaign', '.gm-apprentice', 'story-addresses.json'), 'utf8'));
      assert.equal(record.sessions['Session 2.md'], undefined);
    } finally { s.cleanup(); }
  });

  it('a session the Story no longer shows (its chapter now planned) gets no redirect', () => {
    const s = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER.replace('sort_order: 1\n', 'sort_order: 1\nstatus: complete\n'), 'Chapters/Chapter 2/Chapter 2 Overview.md': CH2('active') }), { sites: ['player'] });
    try {
      moveSession2(s);
      rebuild(s);
      fs.writeFileSync(vaultFile(s, 'Chapters/Chapter 2/Chapter 2 Overview.md'), CH2('planned'));
      rebuild(s);
      assert.equal(s.player.exists('story', OLD), false);
      assert.equal(s.player.exists('story', NEW), false);
    } finally { s.cleanup(); }
  });
});
