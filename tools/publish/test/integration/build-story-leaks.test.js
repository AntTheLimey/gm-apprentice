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
const INTRO = 'story/chapter-1-docks-intro.html';
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
    'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER.replace('sort_order: 1', 'sort_order: 1\nstatus: active'),
    'Chapters/Chapter 1/Chapter 1 Wrap-Up.md': CHAPTER_WRAP,
  }), { player: PLAYER, gm: GM });
  after(() => s.cleanup());
  const OWN = 'chapters/chapter 1/chapter-1-wrap-up.html';

  it('the introduction shows on both sites without the wrap-up; the wrap-up keeps its own page', () => {
    for (const side of ['player', 'gm']) {
      const intro = read(s[side], INTRO);
      assert.ok(intro.includes('CHAPTER-BODY-1'), side);
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
