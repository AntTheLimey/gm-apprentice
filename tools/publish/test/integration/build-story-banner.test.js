'use strict';
// Issue 837: a Story page shows its session's `banner:`, or its Wrap-Up's when the session sets none, on both sites.
// Readers reach a session through its Story page, so a banner only on the session's own page was never seen.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildBoth } = require('../helpers/gm-build');
const { storyVault, WRAP_1, WRAP_2, SESSION } = require('../helpers/story-vault');
const { brokenLinks } = require('../helpers/site-links');
const { makePng } = require('../helpers/make-png');

const STORY_1 = 'story/chapter-1-docks-session-1.html';
const STORY_2 = 'story/chapter-1-docks-session-2.html';
const read = (site, p) => site.read(...p.split('/'));
const withBanner = (text, name) => text.replace(/\n---\n/, `\nbanner: "[[${name}]]"\n---\n`);
const bannerSrcs = (html) => [...html.matchAll(/<figure class="section-banner page-banner"><img src="([^"]+)"/g)].map((m) => m[1]);

describe('Story pages show the session banner', () => {
  const s = buildBoth(storyVault({
    '_attachments/harbour.png': makePng(60, 20),
    '_attachments/wreck.png': makePng(60, 20),
    '_attachments/storm.png': makePng(60, 20),
    // Session 1 sets its own banner and so does its Wrap-Up: the session's wins.
    'Sessions/Session 1.md': withBanner(SESSION(1), 'harbour.png'),
    'Sessions/Session 1 Wrap-Up.md': withBanner(WRAP_1, 'storm.png'),
    // Session 2 sets none; its Wrap-Up does.
    'Sessions/Session 2 Wrap-Up.md': withBanner(WRAP_2, 'wreck.png'),
  }));
  after(() => s.cleanup());

  it('the session banner leads its Story page, before the title, on both sites', () => {
    for (const site of [s.player, s.gm]) {
      const page = read(site, STORY_1);
      const srcs = bannerSrcs(page);
      assert.equal(srcs.length, 1, site.dir);
      assert.match(srcs[0], /^\.\.\/images\/harbour\.(png|webp)$/);
      assert.ok(page.indexOf('page-banner') < page.indexOf('page-title'));
      assert.ok(!page.includes('storm.'), 'the Wrap-Up banner gives way to the session one');
    }
  });

  it('a session with no banner shows its Wrap-Up banner', () => {
    for (const site of [s.player, s.gm]) {
      const srcs = bannerSrcs(read(site, STORY_2));
      assert.equal(srcs.length, 1);
      assert.match(srcs[0], /^\.\.\/images\/wreck\.(png|webp)$/);
    }
  });

  it('the pictures are copied and every link resolves', () => {
    for (const site of [s.player, s.gm]) {
      assert.deepEqual(brokenLinks(site.dir), []);
      for (const p of [STORY_1, STORY_2]) {
        for (const src of bannerSrcs(read(site, p))) assert.ok(fs.existsSync(path.join(site.dir, 'story', decodeURI(src))), src);
      }
    }
  });
});

describe('Story pages with no banner', () => {
  const s = buildBoth(storyVault({}));
  after(() => s.cleanup());

  it('show none', () => {
    for (const site of [s.player, s.gm]) {
      assert.deepEqual(bannerSrcs(read(site, STORY_1)), []);
      assert.ok(!read(site, STORY_1).includes('page-banner'));
    }
  });
});

describe('A folded Wrap-Up\'s banner that names no picture', () => {
  const s = buildBoth(storyVault({ 'Sessions/Session 2 Wrap-Up.md': withBanner(WRAP_2, 'nowhere.png') }));
  after(() => s.cleanup());

  it('is said once per site from its Story page, which shows no banner', () => {
    const said = s.logs.filter((m) => m.includes('nowhere.png'));
    assert.ok(said.length >= 1 && said.length <= 2, said.join('\n'));
    assert.deepEqual(bannerSrcs(read(s.player, STORY_2)), []);
  });
});
