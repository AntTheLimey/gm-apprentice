'use strict';
// #543: the one-page Story page, attacked. A folded wrap-up's Memorable Moments holds every kind of hidden text the
// build knows (a gm-only fence, a %%comment%%, a hidden callout, a hide.sections section, a gm-only relationship, a
// gm_aliases name, a withheld note's name), each with its own string. None may reach a player file; the GM Story page
// shows each, marked; the leak gate is clean on the built site and finds a planted sentence on the Story page, so it
// reads Story pages. Then the same for a held-back draft wrap-up, a chapter that is not complete and the moments
// setting off, and no mark token in any file of either site.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../helpers/quiet-legacy-warning.js');
const { build } = require('../../lib/build');
const { buildBoth, markedTexts } = require('../helpers/gm-build');
const { storyVault, SECRETS, WRAP_1, SESSION, CHAPTER } = require('../helpers/story-vault');
const { leakInto } = require('../helpers/leak-site');
const { brokenLinks } = require('../helpers/site-links');
const { runLeakGate } = require('../../lib/leak-gate');

const STORY_1 = 'story/chapter-1-docks-session-1.html';
const INTRO = 'story/chapter-1-docks.html';   // the chapter's own Story page
const TOKEN = /[-]/;
const rel = (site, f) => path.relative(site.dir, f).split(path.sep).join('/');
// Every file a site holds, read as text: a token or a secret in any of them is a leak, whatever the file is.
const texts = (site) => site.files().map((f) => [rel(site, f), fs.readFileSync(f, 'utf8')]);
const read = (site, p) => site.read(...p.split('/'));
const gate = (s) => runLeakGate({ configPath: s.configPath, outputDir: s.player.dir }).findings;

// Each hidden thing in the moments, with the string only it holds, and the kind of mark the GM page puts on it.
const FENCE = 'MMFENCE-1 the cook poisoned the soup at the wake.';
const HIDDEN = {
  'MMFENCE-1': 'gm_only_blocks',
  'MMCOMMENT-1': 'comments',
  'MMCALLOUT-1': 'callouts',
  'MMSTASH-1': 'sections',
  'SECTION-1': 'sections',
  'RELSECRET-1': 'relationships',
  'Elias Crowe': 'fields',
  'Lord Zorn': 'withheld_names',
};
const MOMENTS = `**The cook served the soup with [[Elias Crowe]] at his side, MOMENT-ALIAS-1.**
*They met [[Lord Zorn]] by the stove, MOMENT-ZORN-1. #moment/intriguing*

<!-- gm-only -->
${FENCE}
<!-- /gm-only -->

%% MMCOMMENT-1 the cook keeps a second ledger. %%

> [!secret] Keeper
> MMCALLOUT-1 the ledger is under the floorboards.

### Stash

- MMSTASH-1 a vial of grey powder.

`;
// Session 1's wrap-up with all of it: the moments above ahead of GM Notes, a hide.sections section before Loot, and a
// gm-only relationship in its frontmatter.
const ADVERSARIAL = WRAP_1
  .replace('tags: []', 'tags: []\nrelationships:\n  - target: "[[Mara Quill]]"\n    type: suspects\n    gm_only: true\n    description: RELSECRET-1 she paid the cook.')
  .replace('<!-- gm-only -->\n\n## GM Notes', `${MOMENTS}<!-- gm-only -->\n\n## GM Notes`)
  .replace('## Loot\n', '## Secret Stash\n\n- SECTION-1 the map to the cellar.\n\n## Loot\n');
const NOTES = {
  'NPCs/Lord Zorn.md': '---\ntype: npc\npublish: false\nwithheld: true\n---\n\n# Lord Zorn\n\nZORNBODY-1 the hidden hand.\n',
  'NPCs/Lord Vane.md': '---\ntype: npc\naliases: [Vane]\ngm_aliases: ["Elias Crowe"]\n---\n\n# Lord Vane\n\nA courtly patron.\n',
};
const PLAYER = { hide: { sections: ['GM Notes', 'Secret Stash', 'Stash'], callouts: ['secret'] } };
const GM = { show: { comments: true } };
// What no player file may hold: the strings above, the withheld note's own, the vault's own secrets, and the bare
// halves of the two secret names.
const NEVER = [...Object.keys(HIDDEN), 'ZORNBODY-1', 'Zorn', 'Elias', ...SECRETS];

function assertNoTokens(s) {
  for (const side of ['player', 'gm']) for (const [file, text] of texts(s[side])) assert.ok(!TOKEN.test(text), `${side}: a mark token in ${file}`);
}
function assertNoneOn(site, strings) {
  for (const [file, text] of texts(site)) for (const x of strings) assert.ok(!text.includes(x), `${x} in ${file}`);
}

describe('Story page leaks: hidden text in a folded wrap-up\'s Memorable Moments', () => {
  const s = buildBoth(storyVault({ 'Sessions/Session 1 Wrap-Up.md': ADVERSARIAL, ...NOTES }), { player: PLAYER, gm: GM });
  after(() => s.cleanup());

  it('no hidden string reaches any player file', () => {
    assertNoneOn(s.player, NEVER);
  });

  it('the moments players may see still show: the alias prints the public name, the withheld one a neutral word', () => {
    const page = read(s.player, STORY_1);
    assert.ok(page.includes('MOMENT-ALIAS-1') && page.includes('MOMENT-ZORN-1'));
    assert.match(page, /<a href="\.\.\/npcs\/lord-vane\.html">Lord Vane<\/a> at his side/);
    assert.match(page, /met someone by the stove/);
  });

  it('the GM Story page shows each hidden string, marked for what hides it', () => {
    const marks = markedTexts(read(s.gm, STORY_1));
    for (const [x, kind] of Object.entries(HIDDEN)) {
      assert.ok(marks.some((m) => m.kind === kind && m.text.includes(x)), `${x} in a ${kind} mark: ${JSON.stringify(marks.filter((m) => m.text.includes(x)).map((m) => m.kind))}`);
    }
  });

  it('every relative link on either site resolves', () => {
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assert.deepEqual(brokenLinks(s.gm.dir), []);
  });

  it('no mark token in any file on either site', () => assertNoTokens(s));

  it('the leak gate is clean on the built site, and finds exactly the one sentence planted on the Story page', () => {
    assert.deepEqual(gate(s), []);
    leakInto(s.player.dir, STORY_1, FENCE);
    const found = gate(s);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0].page, STORY_1);
    assert.match(found[0].text, /mmfence-1 the cook poisoned the soup at the wake/i);
  });
});

describe('Story page leaks: a withheld name in the address of a link in a moment', () => {
  // The address is printed as written; the note audit names it as the wrap-up's fault, read on its Story page.
  it('is a Site Faults finding on the wrap-up, read on its Story page', () => {
    const wrap = WRAP_1.replace('*Nobody moved to help her for a full minute. #moment/funny*',
      '*Nobody moved; they read [the dossier](https://example.com/wiki/Lord_Zorn) instead. #moment/funny*');
    const s = buildBoth(storyVault({ 'Sessions/Session 1 Wrap-Up.md': wrap, ...NOTES }), { sites: [] });
    let faults = [];
    const saved = { log: console.log, warn: console.warn };
    console.log = () => {}; console.warn = () => {};
    try { build({ configPath: s.configPath, site: 'player', onNoteFaults: (f) => { faults = f; } }); } finally { Object.assign(console, saved); }
    try {
      assert.match(read(s.player, STORY_1), /they read <a href="https:\/\/example\.com\/wiki\/Lord_Zorn">the dossier<\/a> instead/);
      const found = faults.filter((f) => f.code === 'WITHHELD_IN_PROSE' && f.path === 'Sessions/Session 1 Wrap-Up.md');
      assert.equal(found.length, 1, JSON.stringify(faults));
      assert.match(found[0].detail, /Lord Zorn/);
      assert.match(found[0].detail, /in the address of a link on the page/);
    } finally { s.cleanup(); }
  });
});

describe('Story page leaks: player_site.story.moments off', () => {
  const s = buildBoth(storyVault({ 'Sessions/Session 1 Wrap-Up.md': ADVERSARIAL, ...NOTES }),
    { player: { ...PLAYER, story: { moments: false } }, gm: GM });
  after(() => s.cleanup());

  it('no hidden string and no moment text reaches any player file', () => {
    assertNoneOn(s.player, [...NEVER, 'MOMENT-ALIAS-1', 'MOMENT-ZORN-1', 'MOMENT-FUNNY-1', 'MOMENT-QUOTE-1']);
    assert.ok(read(s.player, STORY_1).includes('LOOT-KEY-1'));
  });

  it('the GM Story page still shows each hidden string, marked', () => {
    const marks = markedTexts(read(s.gm, STORY_1));
    for (const [x, kind] of Object.entries(HIDDEN)) assert.ok(marks.some((m) => m.kind === kind && m.text.includes(x)), `${x} in a ${kind} mark`);
  });

  it('no broken link, no mark token, and the gate is clean', () => {
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assert.deepEqual(brokenLinks(s.gm.dir), []);
    assertNoTokens(s);
    assert.deepEqual(gate(s), []);
  });
});

describe('Story page leaks: a draft wrap-up the player site holds back', () => {
  // The session note has its own recap, so players have a Story page; the draft wrap-up is held back from it.
  const hub = SESSION(1).replace('HUB-BODY-1: what the GM prepped.\n', '## Narrative Recap\n\nHUBRECAP-1 the hub.\n');
  const s = buildBoth(storyVault({ 'Sessions/Session 1.md': hub, 'Sessions/Session 1 Wrap-Up.md': ADVERSARIAL, ...NOTES }),
    { player: { ...PLAYER, hide: { ...PLAYER.hide, drafts: true } }, gm: GM });
  after(() => s.cleanup());
  const DRAFT = ['The party reached the docks', 'LOOT-KEY-1', 'MOMENT-FUNNY-1', 'MOMENT-QUOTE-1', 'MOMENT-ALIAS-1', 'MOMENT-ZORN-1'];

  it('players see the session\'s own recap and nothing of the draft', () => {
    assert.ok(read(s.player, STORY_1).includes('HUBRECAP-1'));
    assertNoneOn(s.player, [...NEVER, ...DRAFT]);
  });

  it('the GM Story page holds the draft in one held-back mark, each hidden string marked for what hides it too', () => {
    const marks = markedTexts(read(s.gm, STORY_1));
    const held = marks.filter((m) => m.label.startsWith('This wrap-up is held back from players: '));
    assert.equal(held.length, 1, JSON.stringify(marks.map((m) => m.label)));
    // The gm-only relationship is in the wrap-up's hidden-fields panel, marked on its own, not in its body.
    const inBody = Object.keys(HIDDEN).filter((x) => x !== 'RELSECRET-1');
    for (const x of [...DRAFT, ...inBody]) assert.ok(held[0].text.includes(x), `${x} in the held-back mark`);
    for (const [x, kind] of Object.entries(HIDDEN)) assert.ok(marks.some((m) => m.kind === kind && m.text.includes(x)), `${x} in a ${kind} mark`);
  });

  it('no broken link, no mark token, and the gate is clean; a planted draft sentence is the one finding', () => {
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assert.deepEqual(brokenLinks(s.gm.dir), []);
    assertNoTokens(s);
    assert.deepEqual(gate(s), []);
    leakInto(s.player.dir, STORY_1, FENCE);
    const found = gate(s);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0].page, STORY_1);
  });
});

describe('Story page leaks: a chapter that is not complete, its wrap-up with a gm-only section', () => {
  const CHAPTER_WRAP = `---
type: session_wrap
chapter: "[[Chapter 1 Overview]]"
canon_status: CANON
---

# Chapter 1 Wrap-Up

## Narrative Recap

CHAPRECAP-1 the docks were cleared.

<!-- gm-only -->

## GM Notes

CHAPGM-1 the harbourmaster was the cook all along.

<!-- /gm-only -->
`;
  const s = buildBoth(storyVault({
    'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER.replace('sort_order: 1', 'sort_order: 1\nstatus: active') + '\n## Teaser\n\nTEASER-1 the docks wait.\n',
    'Chapters/Chapter 1/Chapter 1 Wrap-Up.md': CHAPTER_WRAP,
  }), { player: PLAYER, gm: GM });
  after(() => s.cleanup());
  const OWN = 'chapters/chapter 1/chapter-1-wrap-up.html';

  it('the Teaser shows on both sites without the wrap-up or the note\'s body; the wrap-up keeps its own page', () => {
    for (const side of ['player', 'gm']) {
      const intro = read(s[side], INTRO);
      assert.ok(intro.includes('TEASER-1'), side);
      assert.ok(!intro.includes('CHAPTER-BODY-1'), side);
      assert.ok(!intro.includes('CHAPRECAP-1') && !intro.includes('CHAPGM-1'), `${side}: the intro holds the wrap-up`);
      assert.ok(read(s[side], OWN).includes('CHAPRECAP-1'), `${side}: the wrap-up's own page`);
    }
  });

  it('no player file holds the gm-only section; the GM wrap-up page shows it marked', () => {
    assertNoneOn(s.player, ['CHAPGM-1', 'harbourmaster', ...SECRETS]);
    assert.ok(markedTexts(read(s.gm, OWN)).some((m) => m.kind === 'gm_only_blocks' && m.text.includes('CHAPGM-1')));
  });

  it('no broken link, no mark token, and the gate is clean; a planted sentence on the wrap-up page is the one finding', () => {
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assert.deepEqual(brokenLinks(s.gm.dir), []);
    assertNoTokens(s);
    assert.deepEqual(gate(s), []);
    leakInto(s.player.dir, OWN, 'CHAPGM-1 the harbourmaster was the cook all along.');
    const found = gate(s);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0].page, OWN);
  });
});

// An unaliased link to a folded wrap-up prints the session's title (story-fold.js), so the gate reads such a link both
// ways: by the note it names and by the label the page prints, in hidden text and in what players may already read.
describe('Story page leaks: a link to a folded wrap-up, read as the page prints it', () => {
  const NPC = (body) => `---\ntype: npc\ntitle: Mara Quill\nstatus: alive\n---\n\n# Mara Quill\n\n${body}\n`;
  const MARA_PAGE = 'npcs/mara-quill.html';

  it('a hidden sentence holding the link is found as the page prints it, and as it printed before the fold', () => {
    const files = storyVault({ 'NPCs/Mara Quill.md': NPC('A fixer.\n\n## GM Notes\n\nThe cook in [[Session 1 Wrap-Up]] was the smuggler all along.') });
    for (const label of ['Session 1', 'Session 1 Wrap-Up']) {
      const s = buildBoth(files, { sites: ['player'] });
      try {
        assert.deepEqual(gate(s), []);
        leakInto(s.player.dir, MARA_PAGE, `The cook in <a href="../story/chapter-1-docks-session-1.html">${label}</a> was the smuggler all along.`);
        const found = gate(s);
        assert.equal(found.length, 1, `${label}: ${JSON.stringify(found)}`);
        assert.equal(found[0].page, MARA_PAGE);
      } finally { s.cleanup(); }
    }
  });

  it('a hidden note saying what a page already prints through the link is no finding', () => {
    const s = buildBoth(storyVault({
      'NPCs/Mara Quill.md': NPC('The cook in [[Session 1 Wrap-Up]] waited by the stove all night.'),
      'Prep/Cook Prep.md': '---\ntype: npc\ntitle: Cook Prep\npublish: false\n---\n\n# Cook Prep\n\nThe cook in Session 1 waited by the stove all night.\n',
    }), { sites: ['player'] });
    try {
      assert.ok(read(s.player, MARA_PAGE).includes('Session 1</a> waited by the stove'));
      assert.deepEqual(gate(s), []);
    } finally { s.cleanup(); }
  });
});

// Chapter pages (PR C, Task 7): the chapter note is no player page. Players read only its Teaser (active), its
// overview and its Recap (complete), on its chapter page; links to it lead there and its old address redirects there.
// A planned chapter is nowhere: no page, no redirect, no link, no title.
describe('Story page leaks: the chapter note leaves the player site', () => {
  const NOTE_OUT = 'chapters/chapter 1/chapter-1-overview.html';
  const CH = '---\ntype: chapter\ntitle: Chapter 1 — Docks\nsort_order: 1\nstatus: active\ndate_range: "Spring 1923"\n'
    + 'overview: "OVERVIEW-ACTIVE-1 the whole plot."\nlocation: "[[Mara Quill]]"\ngm_aliases: ["Secretalias Harbourmaster"]\n---\n\n'
    + 'GMSUMMARY-1 the smugglers own the harbour master and the party will learn it in session four.\n\n'
    + '## Teaser\n\nTEASER-OK-1 the docks are quiet, and [[Mara Quill]] has a lantern lit.\n\n'
    + '## Premise\n\nPREMISE-1 the harbour master is the smuggler they hunt.\n\n'
    + '<!-- gm-only -->\n\n## GM Notes\n\nGMFENCED-1 the ledger is a forgery.\n\n<!-- /gm-only -->\n';
  const planned = (status) => `---\ntype: chapter\ntitle: Chapter 2 — Deeps\nsort_order: 2\nstatus: ${status}\n---\n\n`
    + '## Teaser\n\nPLANNEDTEASER-1 the deeps.\n\nPLANNEDBODY-1 the sunken temple.\n';
  const MARA_LINKS = '---\ntype: npc\ntitle: Mara Quill\nstatus: alive\n---\n\n# Mara Quill\n\n'
    + 'A dockside fixer, NPC-BODY-1. See [[Chapter 1 Overview]] and [[Chapter 2 Overview]].\n';
  const NEVER_CH = ['GMSUMMARY-1', 'PREMISE-1', 'GMFENCED-1', 'OVERVIEW-ACTIVE-1', 'PLANNEDTEASER-1', 'PLANNEDBODY-1', 'Deeps', 'Secretalias', 'secretalias'];
  const files = (status) => storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': CH,
    'Chapters/Chapter 2/Chapter 2 Overview.md': planned(status), 'NPCs/Mara Quill.md': MARA_LINKS });
  let s;
  after(() => s && s.cleanup());

  it('builds', () => { s = buildBoth(files('"planned "')); });

  it('players see the Teaser on the chapter page, and nothing else of either chapter note anywhere', () => {
    assert.match(read(s.player, INTRO), /TEASER-OK-1/);
    assertNoneOn(s.player, NEVER_CH);
  });

  it('no chapter note page, no Chapters index or menu entry; the old addresses redirect', () => {
    const left = texts(s.player).map(([f]) => f).filter((f) => f.startsWith('chapters/'));
    assert.deepEqual(left.sort(), ['chapters/index.html', NOTE_OUT].sort());
    // The Chapters index, though nothing else is left in the folder: a bookmark of it still leads somewhere.
    assert.match(read(s.player, 'chapters/index.html'), /<meta http-equiv="refresh" content="0;url=\.\.\/story\.html">/);
    const html = read(s.player, NOTE_OUT);
    assert.match(html, /<meta http-equiv="refresh" content="0;url=\.\.\/\.\.\/story\/chapter-1-docks\.html">/);
    for (const [file, text] of texts(s.player).filter(([f]) => f.endsWith('.html'))) {
      assert.ok(!/href="[^"]*chapters\/index\.html"/.test(text), `a Chapters menu entry in ${file}`);
    }
  });

  it('no search entry or link preview at the note\'s old address', () => {
    const { documents } = JSON.parse(read(s.player, 'search-index.json'));
    assert.deepEqual(Object.values(documents).filter((d) => d.href.startsWith('chapters/')), []);
    const cards = JSON.parse(read(s.player, 'previews.json'));
    assert.deepEqual(Object.keys(cards).filter((k) => k.startsWith('chapters/') || k === INTRO), []);
  });

  it('a link to the chapter note leads to its chapter page; a link to the planned one is plain text', () => {
    const mara = read(s.player, 'npcs/mara-quill.html');
    assert.match(mara, /<a href="\.\.\/story\/chapter-1-docks\.html"[^>]*>Chapter 1 — Docks<\/a>/);
    assert.ok(!/chapter-2/.test(mara), 'a link to the planned chapter');
  });

  it('the landing page\'s Story card leads to the Story So Far and counts the chapters shown', () => {
    const html = read(s.player, 'index.html');
    assert.match(html, /<a class="explore-card" href="story\.html">\n  <h4>The Story<\/h4>\n  <div class="card-flavour">[^<]*<\/div>\n  <div class="count">1 entry<\/div>/);
    assert.match(read(s.gm, 'index.html'), /<a class="explore-card" href="chapters\/index\.html">\n  <h4>The Story<\/h4>/);
  });

  it('the planned chapter has no page and no redirect', () => {
    assert.deepEqual(texts(s.player).map(([f]) => f).filter((f) => /chapter-2/.test(f)), []);
  });

  it('the GM site keeps the note\'s own page, linked from the chapter page', () => {
    assert.match(read(s.gm, NOTE_OUT), /GMSUMMARY-1/);
    assert.match(read(s.gm, INTRO), /<p class="story-chapter-gm-note"><a href="\.\.\/chapters\/chapter%201\/chapter-1-overview\.html">Chapter note \(GM\)<\/a><\/p>/);
    assert.ok(!/story-chapter-gm-note/.test(read(s.player, INTRO)));
  });

  it('no broken link, no mark token, and the leak gate is clean', () => {
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assertNoTokens(s);
    assert.deepEqual(gate(s), []);
  });

  it('a complete chapter shows its overview and Recap, and nothing else of the note', () => {
    const done = CH.replace('status: active', 'status: complete').replace('OVERVIEW-ACTIVE-1', 'OVERVIEW-OK-1')
      + '\n## Recap\n\nRECAP-OK-1 the docks burned.\n';
    const t = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': done, 'NPCs/Mara Quill.md': MARA_LINKS }), { sites: ['player'] });
    try {
      const page = read(t.player, INTRO);
      assert.match(page, /OVERVIEW-OK-1/);
      assert.match(page, /RECAP-OK-1/);
      assertNoneOn(t.player, ['GMSUMMARY-1', 'PREMISE-1', 'GMFENCED-1', 'TEASER-OK-1']);
      assert.deepEqual(gate(t), []);
    } finally { t.cleanup(); }
  });

  it('other notes in the chapters folder keep their pages; the Chapters index leads to the Story So Far, off the menu', () => {
    const t = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': CH, 'Chapters/Chapter 1/Harbour Map.md': '---\ntype: document\n---\n\n# Harbour Map\n\nA map of the harbour, HANDOUT-1.\n' }));
    try {
      assert.match(read(t.player, 'chapters/chapter 1/harbour-map.html'), /HANDOUT-1/);
      // Its breadcrumb names the section it now belongs to, and leads straight there.
      assert.match(read(t.player, 'chapters/chapter 1/harbour-map.html'), /<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="\.\.\/\.\.\/index\.html">Home<\/a><span class="sep">&rsaquo;<\/span><a href="\.\.\/\.\.\/story\.html">Story<\/a>/);
      assert.match(read(t.gm, 'chapters/chapter 1/harbour-map.html'), /<span class="sep">&rsaquo;<\/span>Chapters<span/);
      assert.match(read(t.player, 'chapters/index.html'), /<meta http-equiv="refresh" content="0;url=\.\.\/story\.html">/);
      for (const [file, text] of texts(t.player).filter(([f]) => f.endsWith('.html'))) {
        assert.ok(!/>Chapters<\/a>/.test(text), `a Chapters menu entry in ${file}`);
      }
      assert.deepEqual(brokenLinks(t.player.dir), []);
      // The GM site keeps its Chapters index and menu entry.
      assert.match(read(t.gm, 'chapters/index.html'), /class="chapter-card"/);
      assert.match(read(t.gm, 'story.html'), />Chapters<\/a>/);
    } finally { t.cleanup(); }
  });

  // A planned chapter's title is its likeliest spoiler, and too short to be a hidden sentence (PR C review S2).
  it('a complete chapter\'s link-preview card says Chapter', () => {
    const done = CH.replace('status: active', 'status: complete');
    const wrap = '---\ntype: session_wrap\nchapter: "[[Chapter 1 Overview]]"\n---\n\n# Chapter 1 Wrap-Up\n\n## Narrative Recap\n\nThe docks burned, CHWRAP-1.\n';
    const t = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': done, 'Chapters/Chapter 1/Chapter 1 Wrap-Up.md': wrap }), { sites: ['player'] });
    try {
      const cards = JSON.parse(read(t.player, 'previews.json'));
      assert.ok(cards[INTRO], Object.keys(cards).join(', '));
      assert.equal(cards[INTRO].k, 'Chapter');
    } finally { t.cleanup(); }
  });

  it('the gate finds a planned chapter\'s title planted on a page', () => {
    const t = buildBoth(files('planned'), { sites: ['player'] });
    try {
      assert.deepEqual(gate(t), []);
      leakInto(t.player.dir, 'story.html', 'Coming soon: Chapter 2 — Deeps.');
      const found = gate(t);
      assert.equal(found.length, 1, JSON.stringify(found));
      assert.equal(found[0].note, 'Chapters/Chapter 2/Chapter 2 Overview.md');
    } finally { t.cleanup(); }
  });

  // CodeRabbit 4469622157: a list-valued status reads as the Story and the publish decision read it.
  it('the gate finds the title of a chapter planned by a list-valued status', () => {
    const t = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': CH,
      'Chapters/Chapter 2/Chapter 2 Overview.md': planned('[active, planned]') }), { sites: ['player'] });
    try {
      assert.equal(t.player.exists('story', 'chapter-2-deeps.html'), false);
      leakInto(t.player.dir, 'story.html', 'Coming soon: Chapter 2 — Deeps.');
      assert.equal(gate(t).length, 1, JSON.stringify(gate(t)));
    } finally { t.cleanup(); }
  });

  // CodeRabbit 4469622129: a chapter wrap-up with no recap of its own folded with the note, the page shows the note's
  // Recap; the search index finds it on that page, once.
  it('a complete chapter\'s note Recap shown beside a wrap-up with no recap is searchable, in one entry', () => {
    const done = CH.replace('status: active', 'status: complete') + '\n## Recap\n\nThe Zanzibarine fleet burned the docks.\n';
    const wrap = '---\ntype: session_wrap\nchapter: "[[Chapter 1 Overview]]"\n---\n\n# Chapter 1 Wrap-Up\n\n## Loot\n\n- A brass Quintessacle.\n';
    const t = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': done, 'Chapters/Chapter 1/Chapter 1 Wrap-Up.md': wrap }), { sites: ['player'] });
    try {
      assert.match(read(t.player, INTRO), /Zanzibarine/);
      const idx = JSON.parse(read(t.player, 'search-index.json'));
      assert.deepEqual(Object.values(idx.documents).filter((d) => d.href === INTRO).length, 1);
      const terms = new Set(idx.index.invertedIndex.map(([term]) => term));
      assert.ok(terms.has('zanzibarine'), 'the note Recap is searchable');
      assert.ok(terms.has('quintessacle'), 'the wrap-up is searchable');
      assert.deepEqual(gate(t), []);
    } finally { t.cleanup(); }
  });

  it('the gate finds a planted sentence from the note\'s GM summary', () => {
    const t = buildBoth(files('planned'), { sites: ['player'] });
    try {
      leakInto(t.player.dir, INTRO, 'GMSUMMARY-1 the smugglers own the harbour master and the party will learn it in session four.');
      assert.equal(gate(t).length, 1, JSON.stringify(gate(t)));
    } finally { t.cleanup(); }
  });
});

// Dead End's chapter note lists its sessions ("14 — [[Session 14 - Iced Tea]]"), and Session 14's breadcrumb prints
// "Session 14 › Session 14 - Iced Tea": the same words as that row. The chapter page prints the row too (its session
// list: the number, the title), so it is no hidden text (PR C review M1).
describe('Story page leaks: a chapter note\'s session list, as its chapter page prints it', () => {
  it('is no finding', () => {
    const sess = (n, title) => `---\ntype: session\ntitle: ${title}\nsession_number: ${n}\nchapter: "[[Chapter 2]]"\nstatus: played\nplay_date: "2026-10-${n}"\n---\n\n# ${title}\n\n## Narrative Recap\n\nThey drank tea, recap ${n}.\n`;
    const s = buildBoth({
      'Chapters/Chapter 2/Chapter 2.md': '---\ntype: chapter\ntitle: Chapter 2 — Running Dark\nsort_order: 2\nstatus: active\n---\n\n# Chapter 2\n\n## Sessions\n\n'
        + '| Session | Notes |\n|---|---|\n| 14 — [[Session 14 - Iced Tea]] | x |\n| 15 — [[Session 15 - Hot Coffee]] | y |\n\n## Teaser\n\nThe dark runs.\n',
      'Sessions/Session 14/Session 14 - Iced Tea.md': sess(14, 'Session 14 - Iced Tea'),
      'Sessions/Session 15/Session 15 - Hot Coffee.md': sess(15, 'Session 15 - Hot Coffee'),
    }, { sites: ['player'] });
    try {
      assert.deepEqual(gate(s), []);
    } finally { s.cleanup(); }
  });
});
