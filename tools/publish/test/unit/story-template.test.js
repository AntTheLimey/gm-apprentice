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
  const spine = [{ outputPath: 'story/chapter-1.html', title: 'Chapter 1', chapterTitle: 'Chapter 1', kind: 'chapter', status: 'complete', sessions: [], recapHtml: '<p>R</p>' }];
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

// Chapter pages (Task 4): the chapter's own Story page, by status.
describe('chapter page', () => {
  const base = {
    kind: 'chapter', outputPath: 'story/the-docks.html', title: 'The Docks', chapterTitle: 'The Docks', label: 'Chapter One',
    dates: 'March 1817', teaserHtml: null, overview: null, recapHtml: null, sections: [], prevHref: 'story/prologue.html', nextHref: 'story/the-docks-s1.html',
    sessions: [{ title: 'Session 1', outputPath: 'story/the-docks-s1.html', inGameDate: '12 March 1817' }, { title: 'Session 2', outputPath: 'story/the-docks-s2.html', inGameDate: null }],
  };
  const page = (u) => storyPage({ ...base, ...u }, cfg, pub, () => '');
  const article = (html) => html.slice(html.indexOf('<article'), html.indexOf('</article>'));

  it('active: label, title, dates, the marker, the Teaser, then Sessions so far; nothing else', () => {
    const html = page({ status: 'active', teaserHtml: '<p>TEASER-TEXT</p>' });
    assert.match(html, /<article class="story-prose story-chapter" data-chapter-status="active">/);
    const at = ['<p class="story-chapter-label">Chapter One</p>', '<h1 class="page-title">The Docks</h1>', '<p class="story-chapter-dates">March 1817</p>',
      '<p class="story-chapter-now">now being played</p>', '<div class="story-chapter-teaser"><p>TEASER-TEXT</p></div>',
      '<h2 class="story-chapter-sessions-title">Sessions so far</h2>', '<ol class="story-chapter-sessions">'].map((s) => html.indexOf(s));
    assert.ok(at.every((i) => i >= 0) && at.every((x, i) => i === 0 || at[i - 1] < x), `in order: ${at}`);
    assert.match(html, /<li value="1"><a href="the-docks-s1\.html">Session 1<\/a> <span class="story-chapter-date">12 March 1817<\/span><\/li>/);
    assert.match(html, /<li value="2"><a href="the-docks-s2\.html">Session 2<\/a><\/li>/);
    assert.doesNotMatch(html, /story-chapter-overview|story-chapter-more|story-eyebrow/);
    assert.equal((html.match(/class="story-nav"/g) || []).length, 2);
  });

  it('complete: overview, the recap\'s opening, the rest in a details, then The sessions; no marker, no Teaser', () => {
    const html = page({ status: 'complete', overview: 'They lost the boat.', recapHtml: '<p>FIRST</p>\n<p>SECOND</p>' });
    assert.match(html, /data-chapter-status="complete"/);
    assert.match(html, /<p class="story-chapter-overview">They lost the boat\.<\/p>/);
    assert.match(html, /<p>FIRST<\/p>\s*<details class="story-chapter-more"><summary>Read the whole chapter recap<\/summary>\s*<p>SECOND<\/p>\s*<\/details>/);
    assert.match(html, /<h2 class="story-chapter-sessions-title">The sessions<\/h2>/);
    assert.doesNotMatch(html, /story-chapter-now|story-chapter-teaser/);
  });

  it('unknown: heading and sessions only', () => {
    const html = page({ status: 'unknown', label: null, dates: null });
    assert.match(html, /data-chapter-status="unknown"/);
    assert.doesNotMatch(article(html), /story-chapter-(label|dates|now|teaser|overview|more)/);
    assert.match(html, /<h2 class="story-chapter-sessions-title">The sessions<\/h2>/);
  });

  it('the contents page and the chapter page number a session the same way', () => {
    const { storyLanding } = require('../../lib/templates/story-landing');
    const sessions = [{ title: 'A', outputPath: 'story/the-docks-a.html', inGameDate: null, number: 6 }, { title: 'B', outputPath: 'story/the-docks-b.html', inGameDate: null, number: 7 }];
    const unit = { ...base, status: 'complete', sessions };
    const chapterHtml = storyPage(unit, cfg, pub, () => '');
    const contents = storyLanding([unit], [], cfg, pub, () => '');
    assert.deepStrictEqual([...chapterHtml.matchAll(/<li value="(\d+)">/g)].map((m) => m[1]), ['6', '7']);
    assert.deepStrictEqual([...contents.matchAll(/<span class="n"[^>]*>(\d+)<\/span>/g)].map((m) => m[1]), ['6', '7']);
  });

  it('a session with a number keeps it in the list', () => {
    const html = page({ status: 'complete', sessions: [{ title: 'Session 6', outputPath: 'story/the-docks-s6.html', inGameDate: null, number: 6 }] });
    assert.match(html, /<li value="6"><a href="the-docks-s6\.html">Session 6<\/a><\/li>/);
  });

  it('no sessions: no sessions heading or list', () => {
    const html = page({ status: 'active', sessions: [] });
    assert.doesNotMatch(html, /story-chapter-sessions/);
  });

  it('a one-paragraph recap has no details', () => {
    const html = page({ status: 'complete', recapHtml: '<p>ONLY</p>' });
    assert.match(html, /<p>ONLY<\/p>/);
    assert.doesNotMatch(html, /<details/);
  });

  it('the wrap-up\'s sections follow the session list, and the moments follow Previous/Next', () => {
    const html = page({ status: 'complete', recapHtml: '<p>R</p>', sections: [{ title: 'Loot', id: 'loot', html: '<p>KEY</p>' }], momentsHtml: '<div class="story-moments">M</div>' });
    const at = ['story-chapter-sessions-title', 'id="loot"', '</article>', 'story-moments'].map((s) => html.lastIndexOf(s));
    assert.ok(at.every((x, i) => x >= 0 && (i === 0 || at[i - 1] < x)), `in order: ${at}`);
  });
});

// Review Focus 3: the recap's opening is its first paragraph players see, with any figure placed beside it.
describe('splitOpening', () => {
  const { splitOpening } = require('../../lib/templates/story');
  it('(a) two paragraphs: the first opens, the second is the rest', () => {
    assert.deepStrictEqual(splitOpening('<p>a</p><p>b</p>'), { before: '', opening: '<p>a</p>', rest: '<p>b</p>' });
  });
  it('(b) a figure placed before the first paragraph goes with it; a heading before stays above', () => {
    const fig = '<div class="story-figures"><figure class="story-figure"><img src="x.png" alt="X"></figure></div>';
    const r = splitOpening(`<h3>Part one</h3>${fig}<p>a</p><p>b</p>`);
    assert.deepStrictEqual(r, { before: '<h3>Part one</h3>', opening: `${fig}<p>a</p>`, rest: '<p>b</p>' });
  });
  it('(b2) a picture the GM placed as its own paragraph-less block stays above', () => {
    const r = splitOpening('<figure><img src="x.png"></figure>\n<p>a</p>\n<p>b</p>');
    assert.strictEqual(r.before, '<figure><img src="x.png"></figure>\n');
    assert.strictEqual(r.opening, '<p>a</p>');
    assert.strictEqual(r.rest.trim(), '<p>b</p>');
  });
  it('(c) a single paragraph: no rest', () => {
    assert.deepStrictEqual(splitOpening('<p>only</p>\n'), { before: '', opening: '<p>only</p>', rest: '' });
  });
  it('no paragraph at all: everything is above', () => {
    assert.deepStrictEqual(splitOpening('<ul><li>x</li></ul>'), { before: '<ul><li>x</li></ul>', opening: '', rest: '' });
  });
  it('a paragraph players do not see (inside a GM mark) is not the opening; a mark open across the split is closed and reopened', () => {
    const open = 'abc';
    const close = '';
    const r = splitOpening(`<p>${open}</p><p>HIDDEN</p><p>${close}</p><p>SEEN</p><p>${open}MORE</p><p>STILL${close}</p>`);
    assert.strictEqual(r.opening, '<p>SEEN</p>');
    assert.ok(r.before.includes('HIDDEN'));
    // A mark opening at a paragraph's start hides it: the first words players see open the recap.
    const r2 = splitOpening(`<p>${open}HID</p><p>A</p><p>B${close}</p><p>C</p>`);
    assert.strictEqual(r2.opening, '<p>C</p>');
    // A mark still open where the opening ends is closed there and opened again at the rest's start.
    const r3 = splitOpening(`<p>SEEN ${open}hid</p><p>more${close}</p>`);
    assert.strictEqual(r3.opening, `<p>SEEN ${open}hid</p>${close}`);
    assert.strictEqual(r3.rest, `${open}<p>more${close}</p>`);
    // A rest that holds only mark tokens is no rest: no toggle, the marks still balanced.
    const r4 = splitOpening(`<p>a ${open}x</p>${close}`);
    assert.strictEqual(r4.rest, '');
    assert.strictEqual(r4.opening, `<p>a ${open}x</p>${close}`);
  });
});

describe('splitOpening with a plate', () => {
  const { splitOpening } = require('../../lib/templates/story');
  it('a scene picture set as a plate right after the opening paragraph stays with the opening', () => {
    const plate = '<div class="story-figures story-figures--plate"><figure class="story-figure story-figure--plate"><img src="x.png" alt=""></figure></div>';
    assert.deepStrictEqual(splitOpening(`<p>a</p>${plate}<p>b</p>`), { before: '', opening: `<p>a</p>${plate}`, rest: '<p>b</p>' });
    assert.deepStrictEqual(splitOpening(`<p>a</p>${plate}`), { before: '', opening: `<p>a</p>${plate}`, rest: '' });
  });
  it('a plate the GM embedded after the opening paragraph is the rest\'s, as any picture of theirs is', () => {
    const hand = '<figure class="story-figure story-figure--plate"><img src="x.png" alt=""></figure>';
    assert.deepStrictEqual(splitOpening(`<p>a</p>${hand}<p>b</p>`), { before: '', opening: '<p>a</p>', rest: `${hand}<p>b</p>` });
  });
});
