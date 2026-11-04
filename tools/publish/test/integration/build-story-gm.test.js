'use strict';
// The GM site's Story page (#543): the folded wrap-up's marked view in place (its GM-only parts shown, marked), GM
// Notes after the cards, the Source preamble first on the page, a link to the session's Play Notes (always built on
// the GM site), and the wrap-up's own banner and hidden-fields panel. The player page holds none of it.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../helpers/quiet-legacy-warning.js');
const { buildBoth, markedTexts, markedAfterMain } = require('../helpers/gm-build');
const { storyVault, SECRETS, WRAP_1, WRAP_2, SESSION, CHAPTER } = require('../helpers/story-vault');
const { brokenLinks } = require('../helpers/site-links');
const { runLeakGate } = require('../../lib/leak-gate');

const STORY_1 = 'story/chapter-1-docks-session-1.html';
const INTRO = 'story/chapter-1-docks.html';   // the chapter's own Story page
const TOKEN = /[\uE000-\uE002]/;
const rel = (site, f) => path.relative(site.dir, f).split(path.sep).join('/');
const texts = (site) => site.files().filter((f) => /\.(?:html|json|js|xml|txt)$/.test(f)).map((f) => [rel(site, f), fs.readFileSync(f, 'utf8')]);
const read = (site, p) => site.read(...p.split('/'));
const main = (html) => html.slice(html.indexOf('<main'), html.lastIndexOf('</main>'));
// Positions of each string on the page, in the order given; fails on one missing.
const at = (html, strings) => strings.map((s) => { const i = html.indexOf(s); assert.ok(i >= 0, `${s} is on the page`); return i; });
const ascending = (xs) => xs.every((x, i) => i === 0 || xs[i - 1] < x);

// Every element closes in the order it opened (void elements aside): a mark closed outside the element it opened in
// would break this.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'path', 'circle']);
function nestingFault(html) {
  const body = html.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, '');
  const stack = [];
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g)) {
    const name = m[2].toLowerCase();
    if (VOID.has(name) || m[3]) continue;
    if (!m[1]) { stack.push(name); continue; }
    const top = stack.pop();
    if (top !== name) return `</${name}> closes <${top}> at ${m.index}`;
  }
  return stack.length ? `left open: ${stack.join(' ')}` : null;
}

describe('the GM Story page', () => {
  const notesOff = buildBoth(storyVault(), { gm: { show: { notes: false } } });
  const def = buildBoth(storyVault());
  after(() => { notesOff.cleanup(); def.cleanup(); });

  for (const [name, site] of [['show.notes off', notesOff], ['defaults', def]]) {
    it(`${name}: the GM Story page reads the recap, Loot, cards, then GM Notes in a gm_only_blocks mark`, () => {
      const page = read(site.gm, STORY_1);
      assert.ok(ascending(at(page, ['The party reached the docks', 'LOOT-KEY-1', 'class="story-moments"', 'MOMENT-FUNNY-1', 'GMSECRET-NOTES-1', 'Handoff to session-prep'])));
      const marks = markedTexts(page);
      // The heading and its body each sit in the fence's own mark (story-sections.js), so every piece is balanced.
      assert.ok(marks.some((m) => m.kind === 'gm_only_blocks' && m.text.includes('GMSECRET-NOTES-1')),
        JSON.stringify(marks.map((m) => [m.kind, m.text.slice(0, 60)])));
      assert.ok(marks.some((m) => m.kind === 'gm_only_blocks' && m.text.trim() === 'GM Notes'));
      assert.match(page, /<h2 id="gm-notes"><span class="gm-mark gm-mark--gm_only_blocks"/);
      // Nothing but the GM-only parts is marked: the recap, Loot and the cards are player text.
      for (const m of marks) for (const s of ['The party reached the docks', 'LOOT-KEY-1', 'MOMENT-FUNNY-1']) assert.ok(!m.text.includes(s), `${s} is marked`);
    });

    it(`${name}: every mark on the GM Story page is closed inside the element it opened in`, () => {
      for (const p of [STORY_1, 'story/chapter-1-docks-session-2.html', INTRO]) {
        const page = read(site.gm, p);
        assert.equal(nestingFault(page), null, p);
        assert.equal(markedAfterMain(page), '', `${p}: a mark runs past </main>`);
        const opens = (page.match(/<div class="gm-mark/g) || []).length;
        assert.ok(opens > 0 || p === INTRO, `${p} has its panels`);
      }
      for (const [file, text] of texts(site.gm)) assert.ok(!TOKEN.test(text), `a mark token in ${file}`);
    });

    it(`${name}: the player site holds no GM Notes text, no stray token, and its leak gate is clean`, () => {
      const page = read(site.player, STORY_1);
      assert.ok(!page.includes('GM Notes') && !page.includes('Handoff to session-prep') && !page.includes('story-playnotes'));
      for (const [file, text] of texts(site.player)) {
        assert.ok(!TOKEN.test(text), `a mark token in ${file}`);
        for (const s of SECRETS) assert.ok(!text.includes(s), `${s} in ${file}`);
      }
      assert.deepEqual(runLeakGate({ configPath: site.configPath, outputDir: site.player.dir }).findings, []);
      assert.deepEqual(brokenLinks(site.gm.dir), []);
    });

    it(`${name}: the Source preamble shows first, before the recap, marked`, () => {
      const page = read(site.gm, STORY_1);
      assert.ok(ascending(at(page, ['GMSECRET-SOURCE-1', 'The party reached the docks', 'MOMENT-CONTEXT-1', 'GMSECRET-NOTES-1'])));
      assert.ok(markedTexts(page).some((m) => m.kind === 'gm_only_blocks' && m.text.includes('GMSECRET-SOURCE-1')));
    });

    it(`${name}: Play Notes for this session → links the session's Play Notes page, which exists`, () => {
      const page = read(site.gm, STORY_1);
      const link = /<p class="story-playnotes"><a href="([^"]+)">Play Notes for this session →<\/a><\/p>/.exec(page);
      assert.ok(link, 'the Play Notes link');
      const target = path.posix.normalize(path.posix.join('story', decodeURI(link[1])));
      assert.ok(site.gm.exists(...target.split('/')), target);
      const notes = read(site.gm, target);
      assert.ok(notes.includes('Scenes') && notes.includes('PLAYNOTES-1'));
      // After the cards and what goes after them.
      assert.ok(ascending(at(page, ['class="story-moments"', 'GMSECRET-NOTES-1', 'class="story-playnotes"'])));
      assert.ok(!site.player.exists(...target.split('/')));
    });

    it(`${name}: the GM Story page shows the same cards as the player page, plus marks`, () => {
      const cards = (html) => (html.match(/<article class="moment-card"/g) || []).length;
      assert.equal(cards(read(site.gm, STORY_1)), 2);
      assert.equal(cards(read(site.gm, STORY_1)), cards(read(site.player, STORY_1)));
    });
  }

  it('a gm-only line inside the recap shows in place, marked', () => {
    const recap = WRAP_1.replace('waited with a lantern and a ledger.\n',
      'waited with a lantern and a ledger.\n\n<!-- gm-only -->\nGMSECRET-RECAP-1: the lantern was a signal.\n<!-- /gm-only -->\n\nThe tide turned.\n');
    const s = buildBoth(storyVault({ 'Sessions/Session 1 Wrap-Up.md': recap }));
    try {
      const page = read(s.gm, STORY_1);
      assert.ok(ascending(at(page, ['The party reached the docks', 'GMSECRET-RECAP-1', 'The tide turned.', 'LOOT-KEY-1'])));
      assert.ok(markedTexts(page).some((m) => m.kind === 'gm_only_blocks' && m.text.includes('GMSECRET-RECAP-1') && !m.text.includes('The tide turned')));
      assert.equal(nestingFault(page), null);
      const player = read(s.player, STORY_1);
      assert.ok(player.includes('The tide turned.'));
      for (const [file, text] of texts(s.player)) assert.ok(!text.includes('GMSECRET-RECAP-1'), file);
    } finally { s.cleanup(); }
  });

  it('a session\'s own recap (no wrap-up) shows its gm-only line in place, marked', () => {
    const hub = SESSION(2).replace('HUB-BODY-2: what the GM prepped.\n',
      '## Narrative Recap\n\nHUB-RECAP-2 opens.\n\n<!-- gm-only -->\nGMSECRET-HUB-2: the boat leaks.\n<!-- /gm-only -->\n\nHUB-RECAP-2 closes.\n');
    const s = buildBoth(storyVault({ 'Sessions/Session 2 Wrap-Up.md': null, 'Sessions/Session 2.md': hub }));
    try {
      const p = 'story/chapter-1-docks-session-2.html';
      const page = read(s.gm, p);
      assert.ok(ascending(at(page, ['HUB-RECAP-2 opens.', 'GMSECRET-HUB-2', 'HUB-RECAP-2 closes.'])));
      assert.ok(markedTexts(page).some((m) => m.kind === 'gm_only_blocks' && m.text.includes('GMSECRET-HUB-2') && !m.text.includes('closes')));
      assert.equal(nestingFault(page), null);
      assert.ok(read(s.player, p).includes('HUB-RECAP-2 closes.'));
      for (const [file, text] of texts(s.player)) assert.ok(!text.includes('GMSECRET-HUB-2'), file);
    } finally { s.cleanup(); }
  });

  it('with no play_notes in the session, the wrap-up\'s source_document names the Play Notes', () => {
    const s = buildBoth(storyVault({ 'Sessions/Session 1.md': SESSION(1).replace(/\n {2}play_notes:[^\n]*/, '') }), { gm: { show: { notes: false } } });
    try {
      const link = /<p class="story-playnotes"><a href="([^"]+)">/.exec(read(s.gm, STORY_1));
      assert.ok(link);
      assert.equal(path.posix.join('story', decodeURI(link[1])), 'sessions/session-1-play-notes.html');
    } finally { s.cleanup(); }
  });

  it('show.notes off still keeps every other note the player site leaves out off the GM site', () => {
    const s = buildBoth(storyVault({ 'NPCs/Hidden Man.md': '---\ntype: npc\npublish: false\n---\n\n# Hidden Man\n\nHIDDEN-MAN-1.\n' }), { gm: { show: { notes: false } } });
    try {
      assert.ok(!s.gm.exists('npcs', 'hidden-man.html'));
      assert.ok(s.gm.exists('sessions', 'session-1-play-notes.html'));
    } finally { s.cleanup(); }
  });

  it('a draft wrap-up the player site holds back folds into the GM Story page with the hidden-from-players banner', () => {
    const s = buildBoth(storyVault(), { player: { hide: { drafts: true } } });
    try {
      // The hubs have no recap of their own: the player site has no Story page for the session.
      assert.ok(!s.player.exists(...STORY_1.split('/')));
      for (const [file, text] of texts(s.player)) assert.ok(!text.includes('MOMENT-FUNNY-1'), file);
      const page = read(s.gm, STORY_1);
      assert.ok(page.includes('MOMENT-FUNNY-1') && page.includes('class="story-moments"'));
      assert.match(page, /<div class="gm-band gm-band--hidden gm-mark" data-gm-kind="notes" data-gm-label="[^"]*draft[^"]*"/i);
      assert.equal(nestingFault(page), null);
    } finally { s.cleanup(); }
  });

  it('the folded wrap-up\'s hidden fields panel shows on the GM Story page', () => {
    const s = buildBoth(storyVault(), { player: { hide: { fields: ['play_date'] } } });
    try {
      const page = read(s.gm, STORY_1);
      const panel = /<aside class="gm-hidden">([\s\S]*?)<\/aside>/.exec(page);
      assert.ok(panel, 'the hidden-fields panel');
      assert.match(panel[1], /play_date/);
      assert.match(panel[1], /2026-10-01/);
      assert.ok(!/gm-band--hidden/.test(page), 'no hidden-page banner: players see this page');
    } finally { s.cleanup(); }
  });

  it('a missing picture in a folded wrap-up is warned once on the GM build', () => {
    const vault = storyVault({ 'Sessions/Session 1 Wrap-Up.md': WRAP_1
      .replace('a lantern and a ledger.\n', 'a lantern and a ledger.\n\n![[nowhere-recap.png]]\n')
      .replace('LOOT-KEY-1.\n', 'LOOT-KEY-1.\n\n![[nowhere-loot.png]]\n') });
    for (const site of ['player', 'gm']) {
      const s = buildBoth(vault, { sites: site === 'gm' ? ['player', 'gm'] : ['player'] });
      try {
        // The GM build's warnings follow the player build's in the log: the count over both is twice the player's.
        for (const pic of ['nowhere-recap.png', 'nowhere-loot.png']) {
          const n = s.logs.filter((l) => l.includes(pic)).length;
          assert.equal(n, site === 'gm' ? 2 : 1, `${site}: ${pic} warned ${n} times\n${s.logs.join('\n')}`);
        }
      } finally { s.cleanup(); }
    }
  });
});

// The GM Story page shows what players see at its address, plus what they don't, marked.
describe('the GM Story page where players see something else', () => {
  it('a draft wrap-up held back from a Story page players have (the session\'s own recap): their recap unmarked, the wrap-up in one mark, no page banner', () => {
    const hub = SESSION(1).replace('HUB-BODY-1: what the GM prepped.\n', '## Narrative Recap\n\nHUBRECAP-1 the hub.\n');
    const s = buildBoth(storyVault({ 'Sessions/Session 1.md': hub }), { player: { hide: { drafts: true } } });
    try {
      const player = read(s.player, STORY_1);
      assert.ok(player.includes('HUBRECAP-1'));
      for (const [file, text] of texts(s.player)) {
        for (const draft of ['The party reached the docks', 'LOOT-KEY-1', 'MOMENT-FUNNY-1', 'MOMENT-QUOTE-1', ...SECRETS]) assert.ok(!text.includes(draft), `${draft} in ${file}`);
      }
      assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.player.dir }).findings, []);
      const page = read(s.gm, STORY_1);
      assert.ok(!/gm-band--hidden/.test(page), 'players do see this page');
      assert.equal(nestingFault(page), null);
      assert.ok(ascending(at(page, ['HUBRECAP-1', 'The party reached the docks', 'LOOT-KEY-1', 'MOMENT-FUNNY-1', 'GMSECRET-NOTES-1'])));
      const marks = markedTexts(page);
      const held = marks.filter((m) => m.label.startsWith('This wrap-up is held back from players: '));
      assert.equal(held.length, 1, JSON.stringify(marks.map((m) => m.label)));
      assert.equal(held[0].kind, 'notes');
      assert.match(held[0].label, /DRAFT/);
      for (const w of ['The party reached the docks', 'LOOT-KEY-1', 'MOMENT-FUNNY-1', 'MOMENT-QUOTE-1', 'GMSECRET-NOTES-1']) assert.ok(held[0].text.includes(w), `${w} in the mark`);
      for (const m of marks) assert.ok(!m.text.includes('HUBRECAP-1'), 'the players\' recap is marked');
      assert.ok(page.includes('class="story-playnotes"'));
      for (const [file, text] of texts(s.gm)) assert.ok(!TOKEN.test(text), `a mark token in ${file}`);
    } finally { s.cleanup(); }
  });

  it('a session note players do not see, its wrap-up on its own page: the banner says where players read it', () => {
    const hub = SESSION(1).replace('status: played\n', 'status: played\npublish: false\n');
    const s = buildBoth(storyVault({ 'Sessions/Session 1.md': hub }));
    try {
      assert.ok(!s.player.exists(...STORY_1.split('/')));
      assert.ok(read(s.player, 'sessions/session-1-wrap-up.html').includes('The party reached the docks'));
      for (const [file, text] of texts(s.player)) {
        for (const secret of [...SECRETS, 'HUB-BODY-1']) assert.ok(!text.includes(secret), `${secret} in ${file}`);
      }
      const page = read(s.gm, STORY_1);
      const banner = /<div class="gm-band gm-band--hidden gm-mark"[^>]*>([^<]*)<\/div>/.exec(page);
      assert.ok(banner, 'the banner');
      assert.equal(banner[1], "Players don't see this page: players see this wrap-up on its own page (sessions/session-1-wrap-up.html), not here");
      assert.equal(nestingFault(page), null);
    } finally { s.cleanup(); }
  });
});

// A wrap-up linked only through a session players do not see (its `documents.wrap_up`) never stands in for another
// session, on the player site or in the GM site's reading of it.
describe('the GM Story page: a wrap-up linked only to a session players do not see', () => {
  it('a session whose own wrap-up is hidden: the banner says players have no page, not another one', () => {
    const hidden = (t) => t.replace('---\n', '---\npublish: false\n');
    const other = '---\ntype: session_wrap\n---\n\n# Other Wrap-Up\n\n## Narrative Recap\n\nOTHER-RECAP-1: another night.\n';
    const s = buildBoth(storyVault({ 'Sessions/Session 1.md': null, 'Sessions/S1/Session 1.md': SESSION(1), 'Sessions/S1/Other Wrap-Up.md': other,
      'Sessions/Session 1 Wrap-Up.md': hidden(WRAP_1), 'Sessions/Session 9.md': hidden(SESSION(9).replace('Session 9 Wrap-Up', 'Other Wrap-Up')) }));
    try {
      assert.ok(!s.player.exists(...STORY_1.split('/')), 'players have no Story page for session 1');
      const banner = /<div class="gm-band gm-band--hidden gm-mark"[^>]*>([^<]*)<\/div>/.exec(read(s.gm, STORY_1));
      assert.ok(banner, 'the banner');
      assert.equal(banner[1], "Players don't see this page: publish: false");
    } finally { s.cleanup(); }
  });
});

// A recap that players read as the words standing in for a withheld name is the same recap on the GM site.
describe('the GM Story page: a recap that is only a withheld name', () => {
  it('both sites pick the wrap-up\'s recap; the GM page exists where players have one', () => {
    const wrap = WRAP_1.replace('The party reached the docks at dusk, where [[Mara Quill]] waited with a lantern and a ledger.', '[[Lord Zorn]]');
    const s = buildBoth(storyVault({ 'Sessions/Session 1 Wrap-Up.md': wrap,
      '_meta/Lord Zorn.md': '---\ntype: npc\npublish: false\nwithheld: true\n---\n\nThe hidden hand.\n' }));
    try {
      assert.ok(read(s.player, STORY_1).includes('someone'));
      assert.ok(s.gm.exists(...STORY_1.split('/')), 'the GM site has the Story page players have');
      const page = read(s.gm, STORY_1);
      assert.ok(page.includes('Lord Zorn') && page.includes('LOOT-KEY-1'));
      assert.equal(nestingFault(page), null);
    } finally { s.cleanup(); }
  });
});

// A held-back wrap-up with no recap of its own: the unit's recap falls back to the players' own, which shows once,
// unmarked, and the mark holds only the wrap-up's parts.
describe('the GM Story page: a held-back wrap-up with no recap of its own', () => {
  const count = (html, s) => html.split(s).length - 1;
  const heldMarks = (page) => markedTexts(page).filter((m) => m.label.startsWith('This wrap-up is held back from players: '));

  it('a session: the players\' recap once, unmarked; the wrap-up\'s sections in the mark', () => {
    const hub = SESSION(1).replace('HUB-BODY-1: what the GM prepped.\n', '## Narrative Recap\n\nHUBRECAP-1 the hub.\n');
    const wrap = WRAP_1.replace('## Narrative Recap\n\nThe party reached the docks at dusk', '## Other\n\nThe party reached the docks at dusk');
    const s = buildBoth(storyVault({ 'Sessions/Session 1.md': hub, 'Sessions/Session 1 Wrap-Up.md': wrap }), { player: { hide: { drafts: true } } });
    try {
      const page = read(s.gm, STORY_1);
      assert.equal(count(page, 'HUBRECAP-1'), 1);
      for (const m of markedTexts(page)) assert.ok(!m.text.includes('HUBRECAP-1'), `the players' recap in ${m.label}`);
      const held = heldMarks(page);
      assert.equal(held.length, 1);
      for (const w of ['The party reached the docks', 'LOOT-KEY-1', 'MOMENT-FUNNY-1']) assert.ok(held[0].text.includes(w), w);
      assert.ok(!/gm-band--hidden/.test(page));
      assert.equal(nestingFault(page), null);
      for (const [file, text] of texts(s.player)) {
        for (const w of ['The party reached the docks', 'LOOT-KEY-1', 'MOMENT-FUNNY-1']) assert.ok(!text.includes(w), `${w} in ${file}`);
      }
    } finally { s.cleanup(); }
  });

  // Chapter pages: a complete chapter whose wrap-up players do not see leads, on both sites, with the note's own Recap.
  it('a chapter: the note\'s Recap once, unmarked; the chapter wrap-up\'s sections in the mark', () => {
    const chapter = CHAPTER.replace('sort_order: 1', 'sort_order: 1\nstatus: complete') + '\n## Recap\n\nCHAPTER-RECAP-1: the docks fell quiet.\n';
    const chWrap = '---\ntype: session_wrap\nchapter: "[[Chapter 1 Overview]]"\ncanon_status: DRAFT\n---\n\n# Chapter 1 Wrap-Up\n\n## Aftermath\n\nCHWRAP-AFTER-1: the docks burned.\n';
    const canon = (w) => w.replace('canon_status: DRAFT', 'canon_status: CANON');
    const s = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': chapter, 'Chapters/Chapter 1/Chapter 1 Wrap-Up.md': chWrap,
      'Sessions/Session 1 Wrap-Up.md': canon(WRAP_1), 'Sessions/Session 2 Wrap-Up.md': canon(WRAP_2) }),
      { player: { hide: { drafts: true } } });
    try {
      assert.ok(read(s.player, INTRO).includes('CHAPTER-RECAP-1'));
      assert.ok(!read(s.player, INTRO).includes('CHAPTER-BODY-1'), 'the note\'s body is not the chapter page');
      for (const [file, text] of texts(s.player)) assert.ok(!text.includes('CHWRAP-AFTER-1'), file);
      const page = read(s.gm, INTRO);
      assert.equal(count(page, 'CHAPTER-RECAP-1'), 1);
      for (const m of markedTexts(page)) assert.ok(!m.text.includes('CHAPTER-RECAP-1'), `the recap in ${m.label}`);
      const held = heldMarks(page);
      assert.equal(held.length, 1, JSON.stringify(markedTexts(page).map((m) => m.label)));
      assert.ok(held[0].text.includes('CHWRAP-AFTER-1'));
      assert.ok(!/gm-band--hidden/.test(page));
      assert.equal(nestingFault(page), null);
    } finally { s.cleanup(); }
  });
});

describe('the GM Story page with player_site.story.moments off', () => {
  const s = buildBoth(storyVault(), { player: { story: { moments: false } } });
  after(() => s.cleanup());

  it('the cards sit in the setting\'s mark, GM Notes in the fence\'s alone, every mark balanced', () => {
    const page = read(s.gm, STORY_1);
    assert.equal(nestingFault(page), null);
    assert.equal((page.match(/<article class="moment-card"/g) || []).length, 2);
    const marks = markedTexts(page);
    const notes = marks.filter((m) => m.text.includes('GMSECRET-NOTES-1'));
    assert.deepEqual(notes.map((m) => m.kind), ['gm_only_blocks'], JSON.stringify(marks.map((m) => [m.kind, m.label])));
    assert.ok(ascending(at(page, ['GMSECRET-SOURCE-1', 'MOMENT-CONTEXT-1', 'GMSECRET-NOTES-1', 'class="story-playnotes"'])));
    for (const [file, text] of texts(s.gm)) assert.ok(!TOKEN.test(text), `a mark token in ${file}`);
    assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.player.dir }).findings, []);
  });
});

// Chapter pages: an active chapter's page shows its Teaser; a GM-only part inside it is marked in place on the GM site.
describe('the GM Story page: a chapter\'s Teaser', () => {
  const chapter = CHAPTER.replace('sort_order: 1', 'sort_order: 1\nstatus: active') + '\n## Teaser\n\nTEASER-1, the pier.\n\n<!-- gm-only -->\nGMSECRET-CHAPTER-1: the harbourmaster is paid.\n<!-- /gm-only -->\n\nTEASER-2, the fog.\n';
  const s = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': chapter }));
  after(() => s.cleanup());

  it('shows the Teaser\'s GM-only parts in place, marked, on the GM site', () => {
    const page = read(s.gm, INTRO);
    assert.ok(ascending(at(page, ['TEASER-1', 'GMSECRET-CHAPTER-1', 'TEASER-2'])));
    assert.ok(markedTexts(page).some((m) => m.kind === 'gm_only_blocks' && m.text.includes('GMSECRET-CHAPTER-1') && !m.text.includes('TEASER-2')));
    assert.ok(!page.includes('CHAPTER-BODY-1'), 'nothing but the Teaser');
    assert.equal(nestingFault(page), null);
    assert.ok(!TOKEN.test(page));
  });

  it('the player page keeps the published view', () => {
    const page = read(s.player, INTRO);
    assert.ok(page.includes('TEASER-1') && page.includes('TEASER-2'));
    assert.ok(!page.includes('CHAPTER-BODY-1'));
    for (const [file, text] of texts(s.player)) assert.ok(!text.includes('GMSECRET-CHAPTER-1'), file);
    assert.ok(!main(page).includes('gm-mark'));
  });
});

// Text above a wrap-up's first `##` heading shows on its Story page on both sites, as written, before the recap (the
// note's own order). The usual hiding rules decide what players see of it; the GM site prints it in the same place,
// with only its hidden parts marked. Its link preview reads what the page shows.
describe('a wrap-up\'s text above its first heading', () => {
  const PRE = [
    'PREAMBLE-VISIBLE the night the docks burned, told plainly.',
    '',
    '%% PREAMBLE-COMMENT the GM keeps an aside here. %%',
    '',
    '> [!secret] Keeper',
    '> PREAMBLE-CALLOUT the fire was set on purpose.',
    '',
  ].join('\n');
  const wrap = WRAP_1.replace('## Narrative Recap\n', `${PRE}\n## Narrative Recap\n`);
  const s = buildBoth(storyVault({ 'Sessions/Session 1 Wrap-Up.md': wrap }), { player: { hide: { callouts: ['secret'] } }, gm: { show: { comments: true } } });
  after(() => s.cleanup());

  it('the player Story page shows the visible text before the recap, and none of the hidden parts', () => {
    assert.notStrictEqual(wrap, WRAP_1);
    const page = read(s.player, STORY_1);
    assert.ok(ascending(at(page, ['PREAMBLE-VISIBLE', 'The party reached the docks', 'LOOT-KEY-1'])));
    for (const [file, text] of texts(s.player)) {
      for (const x of ['PREAMBLE-COMMENT', 'PREAMBLE-CALLOUT', ...SECRETS]) assert.ok(!text.includes(x), `${x} in ${file}`);
    }
    assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.player.dir }).findings, []);
  });

  it('the GM Story page prints it in the same place: the visible text unmarked, each hidden part marked', () => {
    const page = read(s.gm, STORY_1);
    assert.ok(ascending(at(page, ['GMSECRET-SOURCE-1', 'PREAMBLE-VISIBLE', 'PREAMBLE-COMMENT', 'PREAMBLE-CALLOUT', 'The party reached the docks'])));
    const marks = markedTexts(page);
    assert.ok(!marks.some((m) => m.text.includes('PREAMBLE-VISIBLE')), 'the visible text is marked');
    for (const x of ['GMSECRET-SOURCE-1', 'PREAMBLE-COMMENT', 'PREAMBLE-CALLOUT']) assert.ok(marks.some((m) => m.text.includes(x)), `${x} is not marked`);
    assert.equal(nestingFault(page), null);
    assert.equal(markedAfterMain(page), '');
  });

  it('the link preview of the Story page shows only words the page shows', () => {
    for (const side of ['player', 'gm']) {
      const card = JSON.parse(s[side].read('previews.json'))[STORY_1];
      assert.ok(card, side);
      const words = JSON.stringify(card).match(/PREAMBLE-[A-Z]+/g) || [];
      const page = read(s[side], STORY_1);
      for (const w of words) assert.ok(page.includes(w), `${side}: the preview shows ${w}, the page does not`);
      assert.ok(!words.includes('PREAMBLE-COMMENT') && !words.includes('PREAMBLE-CALLOUT'), `${side}: ${words}`);
    }
  });
});
