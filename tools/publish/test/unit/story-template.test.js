const { describe, it } = require('node:test');
const assert = require('node:assert');
const { storyPage } = require('../../lib/templates/story');

const cfg = { siteTitle: 'Test Campaign' };
const pub = {};

describe('storyPage', () => {
  const unit = {
    kind: 'session', outputPath: 'story/s1.html', title: 'Session 1', chapterTitle: 'Chapter 1',
    recapHtml: '<p>The party arrived.</p>', prevHref: null, nextHref: 'story/s2.html',
    sections: [{ title: 'Loot', id: 'loot', html: '<p>A brass key.</p>' }, { title: 'Notes on [Mara](../npcs/mara.html)', id: 'notes-on-mara', html: '<p>Later.</p>' }],
  };
  it('leads with the recap prose and the unit title', () => {
    const html = storyPage(unit, cfg, pub, () => '');
    assert.match(html, /The party arrived\./);
    assert.match(html, /Session 1/);
  });
  it('renders a next link (relative) and no prev link at the start', () => {
    const html = storyPage(unit, cfg, pub, () => '');
    assert.match(html, /href="s2\.html"/);
    assert.ok(!/&larr;/.test(html), 'no prev arrow at the start');
  });
  it('the recap, then each wrap-up section in order, inside the article and before Previous/Next; no In this session box', () => {
    const html = storyPage({ ...unit, kind: 'session' }, cfg, pub, () => '');
    const at = ['The party arrived.', '<section class="story-section"><h2 id="loot">Loot</h2><p>A brass key.</p></section>',
      '<h2 id="notes-on-mara">Notes on <a href="../npcs/mara.html">Mara</a></h2>', '</article>', 'class="story-nav"'].map((s) => html.lastIndexOf(s));
    assert.ok(at.every((i) => i >= 0), `all present: ${at}`);
    assert.ok(at[0] < at[1] && at[1] < at[2] && at[2] < at[3] && at[3] < at[4], `in order: ${at}`);
    assert.doesNotMatch(html, /story-refs|In this session/);
  });
  it('the moments and what goes after them follow Previous/Next', () => {
    const html = storyPage({ ...unit, momentsHtml: '<div class="story-moments">M</div>', afterHtml: '<section class="story-gm-after">A</section>' }, cfg, pub, () => '');
    const nav = html.lastIndexOf('class="story-nav"');
    assert.ok(nav < html.indexOf('story-moments') && html.indexOf('story-moments') < html.indexOf('story-gm-after'));
  });
});

const { characterStoryPage } = require('../../lib/templates/story');
describe('characterStoryPage', () => {
  it('character story page leads with the prose and links to the stat sheet', () => {
    const pc = { displayTitle: 'Adrien de Montferrand', outputPath: 'characters/pcs/adrien.html' };
    const html = characterStoryPage(
      { title: 'Adrien de Montferrand', outputPath: 'story/characters/adrien.html', html: '<p>His tale.</p>', sheetOutputPath: pc.outputPath },
      cfg, pub, () => '');
    assert.match(html, /His tale\./);
    assert.match(html, /Adrien de Montferrand/);
    assert.match(html, /href="\.\.\/\.\.\/characters\/pcs\/adrien\.html"/);
  });
});

const { storyLanding } = require('../../lib/templates/story-landing');
describe('storyLanding', () => {
  const spine = [{ outputPath: 'story/chapter-1.html', title: 'Chapter 1', chapterTitle: 'Chapter 1', kind: 'chapter' }];
  const chars = [{ outputPath: 'story/characters/adrien.html', title: 'Adrien', group: 'current' },
                 { outputPath: 'story/characters/varrio.html', title: 'Varrio', group: 'fallen' }];
  it('shows a Begin reading link and both branches', () => {
    const html = storyLanding(spine, chars, cfg, pub, () => '');
    assert.match(html, /Begin reading/);
    assert.match(html, /Chapter 1/);
    assert.match(html, /Adrien/);
    assert.match(html, /Varrio/);
    assert.match(html, /Fallen/);
  });
  it('lists story NPCs in an "NPC stories" group, with or without PC stories', () => {
    const npcs = [{ outputPath: 'npcs/marlo.html', title: 'Marlo Petrak' }];
    const html = storyLanding([], chars, cfg, pub, () => '', npcs);
    assert.match(html, /<h3>NPC stories<\/h3><ul><li><a href="npcs\/marlo\.html">Marlo Petrak<\/a><\/li><\/ul>/);
    assert.match(html, /<!-- crew-stories -->/, 'the marker the old add-crew-stories step looks for');
    const alone = storyLanding([], [], cfg, pub, () => '', npcs);
    assert.match(alone, /Character Stories<\/h2>.*NPC stories/);
    assert.ok(!/NPC stories/.test(storyLanding(spine, chars, cfg, pub, () => '')));
  });
  it('omits a branch that is empty', () => {
    const html = storyLanding(spine, [], cfg, pub, () => '');
    assert.ok(!/Character Stories/.test(html));
  });
});

describe('characterStoryPage prologue', () => {
  const base = { title: 'Ilse Varn', outputPath: 'story/characters/ilse.html', html: '<h2>Session 1 — Road</h2><p>Went.</p>', sheetOutputPath: 'characters/pcs/ilse.html' };
  it('story page opens with the prologue', () => {
    const html = characterStoryPage({ ...base, prologueHtml: '<p>For a hundred years she kept the index.</p>' }, cfg, pub, () => '');
    assert.match(html, /class="pc-prologue"/);
    assert.match(html, /Before the campaign/);
    assert.match(html, /as their player wrote it/);
    assert.ok(html.indexOf('pc-prologue') < html.indexOf('Session 1'), 'prologue above the first session');
  });
  it('story page without backstory is unchanged', () => {
    const html = characterStoryPage(base, cfg, pub, () => '');
    assert.doesNotMatch(html, /pc-prologue/);
    assert.doesNotMatch(html, /Before the campaign/);
  });
});
