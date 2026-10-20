'use strict';
// Story pages (#465): an id on each session heading, a "Sessions" row of number chips, a copy-link
// icon, and a scroll offset. The unit tests cover the rule, the build tests the pages, and the
// browser test the layout (jump bar at desktop and 360px, the jump clearing the header).
const { test } = require('node:test');
const assert = require('node:assert');
const { linkSessions } = require('../lib/story-sessions');
const { buildVault } = require('./helpers/build-vault');
const { browserSkip, measure } = require('./helpers/browser');

const STORY = '<p>Before.</p><h2>Session 1 — The Ragged Edge</h2><p>a</p>'
  + '<h2>Session 2 — The "Anomaly" &amp; more</h2><p>b</p><h2>Session 13 — Last</h2><p>c</p>';

test('a story with two or more session headings gets ids, a jump bar and copy-link icons', () => {
  const out = linkSessions(STORY);
  for (const n of [1, 2, 13]) {
    assert.match(out, new RegExp(`<h2 class="story-entry" id="session-${n}">Session ${n} — `));
    assert.match(out, new RegExp(`<a class="story-anchor" href="#session-${n}" aria-label="Copy link to Session ${n}"`));
    assert.match(out, new RegExp(`<li><a href="#session-${n}" title="Session ${n}: [^"]*" aria-label="Session ${n}: [^"]*">${n}</a></li>`));
  }
  assert.strictEqual(out.split('class="story-jump"').length, 2, 'one jump bar');
  assert.ok(out.indexOf('story-jump') < out.indexOf('id="session-1"'), 'the bar is above the first session');
  assert.ok(out.indexOf('story-jump') > out.indexOf('Before.'), 'and below what comes before it');
  assert.match(out, /Sessions<\/span>/);
  // The title is an attribute: its quote and ampersand are escaped, not broken out of it.
  assert.match(out, /title="Session 2: The &quot;Anomaly&quot; &amp; more"/);
});

test('a heading written "Session N: Title" at level three becomes a chapter break', () => {
  const out = linkSessions('<h2>Overview</h2><h3>Session 3: Buckle Up</h3><p>x</p><h3>Session 4: Next</h3>');
  assert.match(out, /<h3 class="story-session" id="session-3"><span class="story-session-n">Session 3<a class="story-anchor"[^>]*>.*<\/a><\/span>Buckle Up<\/h3>/);
  assert.match(out, /<h3 class="story-session" id="session-4">/);
});

test('a page with one session heading, or none, is left as written', () => {
  const one = '<h2>Session 1 — Only</h2><p>x</p>';
  assert.strictEqual(linkSessions(one), one);
  assert.strictEqual(linkSessions('<h2>Overview</h2><p>no sessions</p>'), '<h2>Overview</h2><p>no sessions</p>');
  assert.strictEqual(linkSessions(''), '');
});

test('only headings at the first one\'s level count, and a repeated number gets one id', () => {
  const out = linkSessions('<h2>Session 1 — A</h2><h3>Session 7: deeper</h3><h2>Session 1 — Again</h2><h2>Session 2 — B</h2>');
  assert.strictEqual(out.split('id="session-1"').length, 2, 'the id is unique');
  assert.ok(!out.includes('id="session-7"'), 'a heading at another level is not a session of this story');
  assert.match(out, /<h2>Session 1 — Again<\/h2>/, 'the repeat is left as written');
});

const PC = () => '---\ntype: pc\nplayer_name: P\noccupation: Pilot\nstatus: active\n---\n\n# Ada Moor\n\n## Background\n\nText.\n';
const story = '---\ntype: character-story\n---\n\n## Session 1 — First\n\nOne.\n\n## Session 2 — Second\n\nTwo.\n';
const npc = (body) => `---\ntype: npc\nstatus: alive\n---\n\n# Marlo\n\n## Overview\n\n${body}\n`;

test('a built PC story page and a built story NPC page carry the links; a plain NPC page does not', () => {
  const site = buildVault({
    'PCs/Ada Moor.md': PC(), 'PCs/Ada Moor_Story.md': story,
    'NPCs/Marlo.md': npc('### Session 3: Start\n\nA.\n\n### Session 4: Next\n\nB.\n'),
    'NPCs/Lone.md': npc('### Session 3: Only\n\nA.\n'),
    'NPCs/Plain.md': npc('Just text.'),
  });
  try {
    const pc = site.read('story', 'characters', 'ada-moor.html');
    assert.match(pc, /<h2 class="story-entry" id="session-2">/);
    assert.match(pc, /<nav class="story-jump"/);
    assert.match(pc, /src="\.\.\/\.\.\/js\/story-links\.js"/);
    const marlo = site.read('npcs', 'marlo.html');
    assert.match(marlo, /<h3 class="story-session" id="session-4">/);
    assert.match(marlo, /src="\.\.\/js\/story-links\.js"/);
    for (const name of ['lone', 'plain']) {
      const html = site.read('npcs', `${name}.html`);
      assert.ok(!html.includes('story-anchor') && !html.includes('story-links.js'), `${name}: untouched`);
    }
    assert.ok(site.exists('js', 'story-links.js'));
    assert.ok(!site.read('story', 'characters', 'ada-moor.html').includes('id="session-3"'));
  } finally { site.cleanup(); }
});

test('the jump bar, the anchors and the offset, in a real browser', { skip: browserSkip() }, () => {
  const sessions = Array.from({ length: 24 }, (_, i) => `## Session ${i + 1} — Title ${i + 1}\n\n${'Long enough prose to scroll. '.repeat(60)}\n`).join('\n');
  const site = buildVault({
    'PCs/Ada Moor.md': PC(),
    'PCs/Ada Moor_Story.md': `---\ntype: character-story\n---\n\n${sessions}`,
  });
  try {
    const file = require('node:path').join(site.root, 'docs', 'story', 'characters', 'ada-moor.html');
    const probe = (done) => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width) }; };
      const bar = document.querySelector('.story-jump');
      const chips = [...bar.querySelectorAll('a')];
      const tops = new Set(chips.map((c) => r(c).top));
      const icon = document.querySelector('#session-13 .story-anchor');
      const opacity = getComputedStyle(icon).opacity;
      icon.focus();
      const ring = getComputedStyle(icon).outlineStyle;
      document.documentElement.style.scrollBehavior = 'auto';   // smooth scrolling would not finish in the probe's time
      location.hash = '#session-13';
      setTimeout(() => {
        const nav = document.querySelector('.top-nav');
        done({
          chips: chips.length, rows: tops.size, barRight: r(bar).width, docWidth: document.documentElement.scrollWidth, winWidth: innerWidth,
          chipName: chips[12].getAttribute('aria-label'), opacity, ring,
          headTop: r(document.getElementById('session-13')).top, navBottom: nav ? r(nav).bottom : 0,
          sticky: nav ? getComputedStyle(nav).position : '',
        });
      }, 400);
    };
    for (const width of [1100, 360]) {
      const got = measure(file, width, String(probe));
      assert.strictEqual(got.chips, 24);
      assert.strictEqual(got.chipName, 'Session 13: Title 13');
      assert.ok(got.docWidth <= got.winWidth, `${width}px: no sideways scroll (${got.docWidth})`);
      assert.ok(Number(got.opacity) < 1, `${width}px: the icon is faint until hovered`);
      assert.notStrictEqual(got.ring, 'none', `${width}px: the focus ring shows`);
      assert.ok(got.headTop >= got.navBottom, `${width}px: the heading (${got.headTop}) clears the header (${got.navBottom})`);
      if (width === 360) assert.ok(got.rows > 1, 'the chips wrap on a phone');
    }
  } finally { site.cleanup(); }
});
