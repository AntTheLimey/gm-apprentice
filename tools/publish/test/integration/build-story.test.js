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
    assert.match(c, /<li><span class="n">1<\/span><a href="story\/chapter-1-docks-session-1\.html">Session 1<\/a><span class="d">12 March 1817<\/span><\/li>/);
    assert.match(c, /<li><span class="n">2<\/span><a href="story\/chapter-1-docks-session-2\.html">Session 2<\/a><span class="d"><\/span><\/li>/);
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
