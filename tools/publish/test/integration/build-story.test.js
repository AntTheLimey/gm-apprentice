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
    assert.ok(html.includes('The Campaign Saga'), 'landing missing The Campaign Saga branch');
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
