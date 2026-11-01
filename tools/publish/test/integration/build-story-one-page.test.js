'use strict';
// #543: one page per session. A wrap-up a Story unit claims folds into that Story page on both sites: no file of its
// own, every link to it (body, frontmatter, Connections, search, previews, landing, session page) goes to the Story
// page, and an unaliased link prints the session's title. A wrap-up no unit claims keeps its own page.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../helpers/quiet-legacy-warning.js');
const { build } = require('../../lib/build');
const { buildBoth } = require('../helpers/gm-build');
const { storyVault, SECRETS, WRAP_1, SESSION } = require('../helpers/story-vault');
const { brokenLinks } = require('../helpers/site-links');
const { HEADINGS_UNSTABLE_WARNING } = require('../../lib/processor');

const STORY_1 = 'story/chapter-1-docks-session-1.html';
const STORY_2 = 'story/chapter-1-docks-session-2.html';
const rel = (site, f) => path.relative(site.dir, f).split(path.sep).join('/');
const texts = (site) => site.files().filter((f) => /\.(?:html|json|js)$/.test(f)).map((f) => [rel(site, f), fs.readFileSync(f, 'utf8')]);
const links = (html) => [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, '') }));
const linkTo = (html, re) => links(html).filter((l) => re.test(decodeURI(l.href)));
const island = (html) => JSON.parse((/<script type="application\/json" class="cx-data">([\s\S]*?)<\/script>/.exec(html) || [])[1] || 'null');

const MARA_LINKS = `---
type: npc
title: Mara Quill
status: alive
---

# Mara Quill

A dockside fixer, NPC-BODY-1. Plain: [[Session 1 Wrap-Up]]. Aliased: [[Session 1 Wrap-Up|the wrap]].
Heading: [[Session 1 Wrap-Up#Loot]]. By path: [[Sessions/Session 1 Wrap-Up]]. By alias: [[Docks Wrap]].
Underscored: [[Session_2_Wrap-Up#Narrative Recap]].
`;
// Session 2's wrap-up under a file name written with underscores, as Dead End's are.
const UNDERSCORED = {
  'Sessions/Session 2 Wrap-Up.md': null,
  'Sessions/Session_2_Wrap-Up.md': require('../helpers/story-vault').WRAP_2,
  'Sessions/Session 2.md': SESSION(2).replace('[[Session 2 Wrap-Up]]', '[[Session_2_Wrap-Up]]'),
};
const ALIASED_WRAP = { 'Sessions/Session 1 Wrap-Up.md': WRAP_1.replace('tags: []', 'tags: []\naliases: [Docks Wrap]') };

describe('one page per session (#543)', () => {
  const site = buildBoth(storyVault({ ...UNDERSCORED, ...ALIASED_WRAP, 'NPCs/Mara Quill.md': MARA_LINKS,
    'Items/Brass Key.md': '---\ntype: item\norigin: "[[Session 1 Wrap-Up]]"\n---\n\n# Brass Key\n\nFound on the pier.\n' }));
  after(() => site.cleanup());

  for (const side of ['player', 'gm']) {
    it(`${side}: no wrap-up file is written, and no html/json/js file names its old path`, () => {
      const s = site[side];
      assert.deepEqual(s.files().map((f) => rel(s, f)).filter((f) => /wrap-up\.html$/i.test(f)), []);
      for (const [file, text] of texts(s)) {
        assert.ok(!/session-1-wrap-up\.html|session-2-wrap-up\.html/i.test(text), `${file} names a wrap-up's old address`);
      }
      assert.ok(s.exists(...STORY_1.split('/')) && s.exists(...STORY_2.split('/')));
    });

    it(`${side}: every relative link resolves`, () => {
      assert.deepEqual(brokenLinks(site[side].dir), []);
    });
  }

  it('no gm-only string reaches any player file', () => {
    for (const [file, text] of texts(site.player)) {
      for (const secret of SECRETS) assert.ok(!text.includes(secret), `${secret} in ${file}`);
    }
  });

  it('the Story page carries the recap, then Loot, then the moments; no GM Notes text and no Source callout', { todo: 'Task 3/4: the Story page renders the wrap-up sections and the moments cards' }, () => {
    const html = site.player.read(...STORY_1.split('/'));
    const at = ['The party reached', '<h2 id="loot"', 'class="story-moments"'].map((s) => html.indexOf(s));
    assert.ok(at.every((i) => i >= 0), `all three present: ${at}`);
    assert.ok(at[0] < at[1] && at[1] < at[2], `in order: ${at}`);
    assert.doesNotMatch(html, /GMSECRET-NOTES-1|\[!info\]|GMSECRET-SOURCE-1|Written from the Play Notes/);
  });

  for (const side of ['player', 'gm']) {
    it(`${side}: an entity linked from the wrap-up lists the session title under Mentions, linking the Story page`, () => {
      const model = island(site[side].read('npcs', 'mara-quill.html'));
      const items = (model.m || []).flatMap((group) => group.d);
      const s1 = items.find(([title]) => title === 'Session 1');
      assert.ok(s1, JSON.stringify(model.m));
      assert.equal(s1[1], `../${STORY_1}`);
      assert.ok(!items.some(([title]) => /wrap-up/i.test(title)), JSON.stringify(items));
    });
  }

  it('[[Session 1 Wrap-Up]] prints the session title; an alias is kept; a #heading, a path, an alias and an underscored name all reach the Story page', () => {
    const html = site.player.read('npcs', 'mara-quill.html');
    const to1 = linkTo(html, /story\/chapter-1-docks-session-1\.html$/).map((l) => l.text);
    assert.deepEqual(to1.filter((t) => t !== 'Session 1').sort(), ['the wrap'], to1.join(' | '));
    // Plain, heading, path, alias: four unaliased links to Session 1 in the body (and the page's own Mentions of the
    // wrap-up), each printed with the session's title.
    assert.ok(to1.filter((t) => t === 'Session 1').length >= 4, to1.join(' | '));
    const to2 = linkTo(html, /story\/chapter-1-docks-session-2\.html$/).map((l) => l.text);
    assert.deepEqual(to2, ['Session 2']);
    assert.doesNotMatch(html, /Wrap-Up/);
  });

  it('a frontmatter link to a wrap-up (an item\'s origin) goes to the Story page under the session title', () => {
    const html = site.player.read('items', 'brass-key.html');
    const to1 = linkTo(html, /story\/chapter-1-docks-session-1\.html$/);
    assert.ok(to1.length >= 1, html.match(/origin[\s\S]{0,200}/i));
    assert.ok(to1.every((l) => l.text === 'Session 1'), JSON.stringify(to1));
  });

  it('a link in a field the GM site shows hidden (source_document) goes to the Story page under the session title', () => {
    const s = buildBoth(storyVault({
      'Items/Brass Key.md': '---\ntype: item\nsource_document: "[[Session 1 Wrap-Up]]"\n---\n\n# Brass Key\n\nFound on the pier.\n',
    }), { player: { hide: { fields: ['source_document'] } } });
    try {
      const html = s.gm.read('items', 'brass-key.html');
      const to1 = linkTo(html, /story\/chapter-1-docks-session-1\.html$/);
      assert.ok(to1.length >= 1, (html.match(/source_document[\s\S]{0,300}/) || [''])[0]);
      assert.ok(to1.every((l) => l.text === 'Session 1'), JSON.stringify(to1));
      assert.deepEqual(brokenLinks(s.gm.dir), []);
    } finally { s.cleanup(); }
  });

  for (const side of ['player', 'gm']) {
    it(`${side}: search-index.json has no wrap-up path; the Story path's entry has the session title and subtitle Story`, () => {
      const docs = Object.values(JSON.parse(site[side].read('search-index.json')).documents);
      assert.ok(!docs.some((d) => /wrap-up/i.test(d.href)), JSON.stringify(docs));
      const entry = docs.find((d) => d.href === STORY_1);
      assert.ok(entry, JSON.stringify(docs));
      assert.equal(entry.title, 'Session 1');
      assert.equal(entry.subtitle, 'Story');
    });

    it(`${side}: previews.json holds the card under the Story path`, () => {
      const cards = JSON.parse(site[side].read('previews.json'));
      assert.ok(!Object.keys(cards).some((k) => /wrap-up/i.test(k)), Object.keys(cards).join(', '));
      assert.ok(cards[STORY_1], Object.keys(cards).join(', '));
    });

    it(`${side}: the session page's Read the full session and the landing's Read full session go to story/…`, () => {
      const session = site[side].read('sessions', 'session-1.html');
      const read = links(session).filter((l) => /Read the full session/.test(l.text));
      assert.equal(read.length, 1, session.match(/recap-link[^\n]*/g));
      assert.equal(decodeURI(read[0].href), `../${STORY_1}`);
      const landing = site[side].read('index.html');
      const full = links(landing).filter((l) => /Read full session/.test(l.text));
      assert.ok(full.length >= 1);
      for (const l of full) assert.match(decodeURI(l.href), /^story\/chapter-1-docks-session-\d\.html$/);
    });
  }
});

describe('wrap-ups no Story unit claims, and chapter wrap-ups', () => {
  it('a wrap-up no Story unit claims keeps its page and its links', () => {
    // No chapter: no Story unit at all.
    const site = buildBoth(storyVault({
      'Chapters/Chapter 1/Chapter 1 Overview.md': null,
      'NPCs/Mara Quill.md': MARA_LINKS,
    }));
    try {
      for (const side of ['player', 'gm']) {
        const s = site[side];
        assert.ok(s.exists('sessions', 'session-1-wrap-up.html'), `${side}: the wrap-up keeps its page`);
        assert.equal(s.exists('story', 'chapter-1-docks-session-1.html'), false);
        const html = s.read('npcs', 'mara-quill.html');
        const to = linkTo(html, /sessions\/session-1-wrap-up\.html$/).map((l) => l.text);
        assert.ok(to.includes('Session 1 Wrap-Up'), to.join(' | '));
        assert.ok(to.includes('the wrap'), to.join(' | '));
        assert.deepEqual(brokenLinks(s.dir), [], side);
      }
    } finally { site.cleanup(); }
  });

  it('a chapter wrap-up folds into the chapter Story page; a session\'s claim wins', () => {
    const CHAPTER_WRAP = '---\ntype: session_wrap\nchapter: "[[Chapter 2 Overview]]"\n---\n\n# Chapter 2 Wrap-Up\n\n## Narrative Recap\n\nCHAPTER-TWO-RECAP: the lighthouse.\n';
    const site = buildBoth(storyVault({
      'Chapters/Chapter 2/Chapter 2 Overview.md': '---\ntype: chapter\ntitle: Chapter 2 — Lighthouse\nsort_order: 2\n---\n\n# Chapter 2\n',
      'Chapters/Chapter 2/Chapter 2 Wrap-Up.md': CHAPTER_WRAP,
      'NPCs/Mara Quill.md': `${MARA_LINKS}\nChapter: [[Chapter 2 Wrap-Up]].\n`,
    }));
    try {
      for (const side of ['player', 'gm']) {
        const s = site[side];
        assert.ok(s.exists('story', 'chapter-2-lighthouse.html'), `${side}: the chapter's Story page`);
        assert.match(s.read('story', 'chapter-2-lighthouse.html'), /CHAPTER-TWO-RECAP/);
        assert.deepEqual(s.files().map((f) => rel(s, f)).filter((f) => /wrap-up\.html$/i.test(f)), [], side);
        const html = s.read('npcs', 'mara-quill.html');
        assert.deepEqual(linkTo(html, /story\/chapter-2-lighthouse\.html$/).map((l) => l.text), ['Chapter 2 — Lighthouse']);
        assert.ok(linkTo(html, /story\/chapter-1-docks-session-1\.html$/).length >= 1, 'session 1 keeps its own Story page');
        assert.deepEqual(brokenLinks(s.dir), [], side);
      }
    } finally { site.cleanup(); }
  });

  it('a wrap-up both a session and its chapter claim folds into the session\'s Story page', () => {
    // Session 1's wrap-up sits alone in the chapter's folder, so the chapter takes it as its own (the folder fallback)
    // and gets an intro unit from its recap; Session 1 is paired with it by documents.wrap_up.
    const site = buildBoth(storyVault({
      'Sessions/Session 1 Wrap-Up.md': null,
      'Chapters/Chapter 1/Session 1 Wrap-Up.md': WRAP_1,
      'NPCs/Mara Quill.md': MARA_LINKS,
    }));
    try {
      for (const side of ['player', 'gm']) {
        const s = site[side];
        assert.ok(s.exists('story', 'chapter-1-docks-intro.html'), `${side}: the chapter claims the wrap-up too`);
        const model = island(s.read('npcs', 'mara-quill.html'));
        const items = (model.m || []).flatMap((group) => group.d);
        assert.ok(items.some(([title, href]) => title === 'Session 1' && href === `../${STORY_1}`), JSON.stringify(items));
        const to1 = linkTo(s.read('npcs', 'mara-quill.html'), /story\/chapter-1-docks-session-1\.html$/);
        assert.ok(to1.some((l) => l.text === 'Session 1'), JSON.stringify(to1));
        assert.deepEqual(s.files().map((f) => rel(s, f)).filter((f) => /wrap-up\.html$/i.test(f)), [], side);
        assert.deepEqual(brokenLinks(s.dir), [], side);
      }
    } finally { site.cleanup(); }
  });
});

describe('sheets-only builds and PC headings', () => {
  const PC = '---\ntype: pc\noccupation: Clerk\n---\n# Ann\n\n## Background\n\nAnn sailed with [[Session 1 Wrap-Up]].\n\n## Seen in [[Session 1 Wrap-Up]]\n\nSEEN-SECTION-1.\n';

  it('a sheets-only build points a PC page\'s link to the wrap-up at the Story page', () => {
    const site = buildBoth(storyVault({ 'PCs/Ann.md': PC }), { sites: ['player'] });
    try {
      const quiet = (fn) => { const l = console.log; const w = console.warn; console.log = () => {}; console.warn = () => {}; try { return fn(); } finally { console.log = l; console.warn = w; } };
      quiet(() => build({ configPath: site.configPath, site: 'player', only: 'sheets' }));
      const html = site.player.read('pcs', 'ann.html');
      const to = linkTo(html, /story\/chapter-1-docks-session-1\.html$/);
      assert.ok(to.length >= 1, 'the PC page links the Story page');
      assert.ok(to.every((l) => l.text === 'Session 1'), JSON.stringify(to));
      assert.doesNotMatch(html, /wrap-up\.html/);
      assert.deepEqual(brokenLinks(site.player.dir), []);
    } finally { site.cleanup(); }
  });

  it('a PC with sheets off keeps a section whose heading links a folded wrap-up, named as it prints', () => {
    const site = buildBoth(storyVault({ 'PCs/Ann.md': PC }), {
      player: { sheets: { show: false, prose_sections: ['Seen in Session 1'] } },
      sites: ['player'],
    });
    try {
      const html = site.player.read('pcs', 'ann.html');
      assert.match(html, /SEEN-SECTION-1/, 'the kept section shows');
      assert.ok(!site.logs.some((l) => l.includes(HEADINGS_UNSTABLE_WARNING)), site.logs.filter((l) => /pcs\//.test(l)).join('\n'));
    } finally { site.cleanup(); }
  });
});

describe('the note audit reads a folded wrap-up on its Story page', () => {
  // A withheld note's name in a folded wrap-up is the wrap-up's fault, found on the page that prints it, as it was
  // when the wrap-up had a page of its own.
  const ZORN = { 'NPCs/Lord Zorn.md': '---\ntype: npc\npublish: false\nwithheld: true\n---\n\nThe hidden hand.\n' };
  const faultsFor = (recap) => {
    const files = storyVault({ ...ZORN,
      'Sessions/Session 1 Wrap-Up.md': WRAP_1.replace(/## Narrative Recap\n\n[^\n]*\n/, `## Narrative Recap\n\n${recap}\n`) });
    const s = buildBoth(files, { sites: [] });
    let faults = [];
    const saved = { log: console.log, warn: console.warn };
    console.log = () => {}; console.warn = () => {};
    try { build({ configPath: s.configPath, site: 'player', onNoteFaults: (f) => { faults = f; } }); } finally { Object.assign(console, saved); s.cleanup(); }
    // The session page quotes the recap's opening too: that finding is the session note's own.
    return faults.filter((f) => f.code === 'WITHHELD_IN_PROSE' && /Lord Zorn/.test(f.detail) && f.path === 'Sessions/Session 1 Wrap-Up.md');
  };

  it('a withheld name in the address of a link in the recap', () => {
    const found = faultsFor('The party read [the dossier](https://example.com/wiki/Lord_Zorn) at the docks.');
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.match(found[0].detail, /in the address of a link on the page/);
  });

  it('a withheld name in a chapter wrap-up folded into the chapter\'s Story page', () => {
    const files = storyVault({ ...ZORN,
      'Chapters/Chapter 2/Chapter 2 Overview.md': '---\ntype: chapter\ntitle: Chapter 2 — Lighthouse\nsort_order: 2\n---\n\n# Chapter 2\n',
      'Chapters/Chapter 2/Chapter 2 Wrap-Up.md': '---\ntype: session_wrap\nchapter: "[[Chapter 2 Overview]]"\n---\n\n## Narrative Recap\n\nLord Zorn kept the light.\n' });
    const s = buildBoth(files, { sites: [] });
    let faults = [];
    const saved = { log: console.log, warn: console.warn };
    console.log = () => {}; console.warn = () => {};
    try { build({ configPath: s.configPath, site: 'player', onNoteFaults: (f) => { faults = f; } }); } finally { Object.assign(console, saved); s.cleanup(); }
    const found = faults.filter((f) => f.code === 'WITHHELD_IN_PROSE' && f.path === 'Chapters/Chapter 2/Chapter 2 Wrap-Up.md');
    assert.equal(found.length, 1, JSON.stringify(faults));
    assert.match(found[0].detail, /printed on the page/);
  });

  it('a withheld name in the recap prose', () => {
    const found = faultsFor('They met Lord Zorn by the crane.');
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.match(found[0].detail, /printed on the page/);
  });
});
