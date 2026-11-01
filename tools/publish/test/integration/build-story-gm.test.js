'use strict';
// The GM site's Story page (#543): the folded wrap-up's marked view in place (its GM-only parts shown, marked), GM
// Notes after the cards, the Source preamble first after them, a link to the session's Play Notes (always built on
// the GM site), and the wrap-up's own banner and hidden-fields panel. The player page holds none of it.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../helpers/quiet-legacy-warning.js');
const { buildBoth, markedTexts, markedAfterMain } = require('../helpers/gm-build');
const { storyVault, SECRETS, WRAP_1, SESSION, CHAPTER } = require('../helpers/story-vault');
const { brokenLinks } = require('../helpers/site-links');
const { runLeakGate } = require('../../lib/leak-gate');

const STORY_1 = 'story/chapter-1-docks-session-1.html';
const INTRO = 'story/chapter-1-docks-intro.html';
const TOKEN = /[-]/;
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
      assert.ok(marks.some((m) => m.kind === 'gm_only_blocks' && m.text.includes('GMSECRET-NOTES-1') && m.text.includes('GM Notes')),
        JSON.stringify(marks.map((m) => [m.kind, m.text.slice(0, 60)])));
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

    it(`${name}: the Source preamble shows first after the cards, marked`, () => {
      const page = read(site.gm, STORY_1);
      assert.ok(ascending(at(page, ['MOMENT-CONTEXT-1', 'GMSECRET-SOURCE-1', 'GMSECRET-NOTES-1'])));
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

describe('the GM Story page: a chapter\'s introduction', () => {
  const chapter = CHAPTER.replace('The docks, CHAPTER-BODY-1.\n',
    'The docks, CHAPTER-BODY-1.\n\n<!-- gm-only -->\nGMSECRET-CHAPTER-1: the harbourmaster is paid.\n<!-- /gm-only -->\n\nThe fog, CHAPTER-BODY-2.\n');
  const s = buildBoth(storyVault({ 'Chapters/Chapter 1/Chapter 1 Overview.md': chapter }));
  after(() => s.cleanup());

  it('shows the chapter note\'s GM-only parts in place, marked, on the GM site', () => {
    const page = read(s.gm, INTRO);
    assert.ok(ascending(at(page, ['CHAPTER-BODY-1', 'GMSECRET-CHAPTER-1', 'CHAPTER-BODY-2'])));
    assert.ok(markedTexts(page).some((m) => m.kind === 'gm_only_blocks' && m.text.includes('GMSECRET-CHAPTER-1') && !m.text.includes('CHAPTER-BODY-2')));
    assert.equal(nestingFault(page), null);
    assert.ok(!TOKEN.test(page));
  });

  it('the player page keeps the published view', () => {
    const page = read(s.player, INTRO);
    assert.ok(page.includes('CHAPTER-BODY-1') && page.includes('CHAPTER-BODY-2'));
    for (const [file, text] of texts(s.player)) assert.ok(!text.includes('GMSECRET-CHAPTER-1'), file);
    assert.ok(!main(page).includes('gm-mark'));
  });
});
