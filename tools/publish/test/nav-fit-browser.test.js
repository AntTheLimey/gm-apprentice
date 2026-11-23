'use strict';
// The site's menu bar at tablet and computer widths (#863): a long title and the GM's extra menu entries must not make
// the page scroll sideways. The title is cut short first; when that leaves it too short, or the bar is still too wide,
// the bar takes the phone menu. A site whose bar fits is left as it was. Measured in a real browser with real clicks
// and window resizes. The checks hold for any font: a wider one only moves where the bar gives way. Skipped without
// Chrome or Chromium (set GM_TEST_CHROME to point at one), except on CI.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { buildVault } = require('./helpers/build-vault');
const { browserSkip } = require('./helpers/browser');
const { withPage } = require('./helpers/cdp');

const skip = browserSkip();
const note = (type) => `---\ntype: ${type}\n---\n\nText.\n`;
// Every group of the menu has a page: Story, Characters, World and Reference.
const FILES = {
  'Sessions/Session_1.md': '---\ntype: session\nsession_number: 1\nstatus: played\n---\n\nPlayed.\n',
  'Characters/NPCs/Mara.md': note('npc'),
  'Locations/Harbour.md': note('location'),
  'Factions/Guild.md': note('faction'),
  'Documents/Letter.md': note('document'),
};
const LONG = 'Horror on the Orient Express';
const entry = (label) => ({ label, link: `https://example.com/${label.toLowerCase()}` });

function site(title, extra) {
  return buildVault(FILES, { settings: { 'player_site.title': title, 'player_site.theme.genre': 'noir', 'player_site.menu_extra': extra } });
}

// What the bar shows: whether the page scrolls sideways, whether the title is cut and how wide it is, whether the bar
// is crowded, and which of the menu's two forms is on screen.
const READ = `(() => {
  const d = document.documentElement, bar = document.querySelector('.top-nav'), brand = bar.querySelector('.nav-brand');
  const shown = (sel) => getComputedStyle(bar.querySelector(sel)).display !== 'none';
  return {
    page: d.scrollWidth, window: d.clientWidth,
    brandCut: brand.scrollWidth > brand.clientWidth, brandWidth: brand.clientWidth,
    floor: 9 * parseFloat(getComputedStyle(d).fontSize),
    crowded: bar.classList.contains('nav-crowded'),
    desktopMenu: shown('.nav-groups'), phoneMenu: shown('.nav-mobile-toggle'),
  };
})()`;

describe('the menu bar fits the window at every width', { skip }, () => {
  const built = {};
  before(() => {
    built.reported = site(LONG, [entry('Elsewhere')]);
    built.many = site(LONG, ['Elsewhere', 'Gazetteer', 'Maps'].map(entry));
    built.longer = site(`${LONG}, Revisited at Great Length`, []);
    built.short = site('Dead End', []);
  });
  after(() => { for (const b of Object.values(built)) b.cleanup(); });

  const open = async (page, which) => {
    await page.goto(pathToFileURL(path.join(built[which].root, 'docs', 'index.html')).href);
    await page.waitFor('document.readyState === "complete" && !!document.querySelector(".top-nav")');
    return page.evaluate(READ);
  };

  it('the reported site (a long title and one extra entry) does not scroll sideways at tablet widths', async () => {
    for (const width of [768, 820]) {
      await withPage({ width, height: 700 }, async (page) => {
        const r = await open(page, 'reported');
        assert.ok(r.page <= r.window, `at ${width}px the page scrolls sideways (${r.page} > ${r.window})`);
        // Either the full menu with the title still at least 9rem, or the phone menu.
        if (r.crowded) assert.ok(r.phoneMenu && !r.desktopMenu, `at ${width}px a crowded bar shows the phone menu`);
        else assert.ok(r.desktopMenu && r.brandWidth >= r.floor - 1, `at ${width}px the title is cut to ${r.brandWidth}px, under 9rem, and the menu stayed`);
      });
    }
  });

  it('a title too long for the bar is cut short, and the menu stays when the cut leaves enough of it', async () => {
    await withPage({ width: 1000, height: 700 }, async (page) => {
      const r = await open(page, 'longer');
      assert.ok(r.page <= r.window, `the page scrolls sideways (${r.page} > ${r.window})`);
      assert.equal(r.brandCut, true, 'the title is cut short');
      assert.equal(r.crowded, false, 'the bar keeps its menu');
      assert.equal(r.desktopMenu, true);
    });
  });

  it('a menu too wide even with the title cut takes the phone menu, which opens to every entry, and gives it back on a wider window', async () => {
    await withPage({ width: 900, height: 700 }, async (page) => {
      let r = await open(page, 'many');
      assert.ok(r.page <= r.window, `the page scrolls sideways (${r.page} > ${r.window})`);
      assert.equal(r.crowded, true, 'the bar is crowded');
      assert.equal(r.desktopMenu, false, 'the desktop menu is hidden');
      assert.equal(r.phoneMenu, true, 'the phone menu button shows');

      const hit = await page.click('.nav-mobile-toggle');
      assert.equal(hit.hit, true, 'nothing covers the phone menu button');
      await page.waitFor('document.getElementById("mobile-nav").classList.contains("open")');
      const labels = await page.evaluate('Array.from(document.querySelectorAll("#mobile-nav a")).map((a) => a.textContent.trim())');
      for (const label of ['Elsewhere', 'Gazetteer', 'Maps']) assert.ok(labels.includes(label), `the phone menu lists ${label}: ${labels.join(', ')}`);
      await page.click('.mobile-nav-close');

      await page.resize(1600, 700);
      await page.waitFor('!document.querySelector(".top-nav").classList.contains("nav-crowded")');
      r = await page.evaluate(READ);
      assert.equal(r.desktopMenu, true, 'at 1600px the desktop menu is back');
      assert.equal(r.phoneMenu, false);

      await page.resize(900, 700);
      await page.waitFor('document.querySelector(".top-nav").classList.contains("nav-crowded")');
      r = await page.evaluate(READ);
      assert.ok(r.page <= r.window, `back at 900px the page scrolls sideways (${r.page} > ${r.window})`);
    });
  });

  it('a site whose bar fits is left as it was: the title whole and the desktop menu shown', async () => {
    for (const width of [768, 1280]) {
      await withPage({ width, height: 700 }, async (page) => {
        const r = await open(page, 'short');
        assert.equal(r.brandCut, false, `at ${width}px the title is whole`);
        assert.equal(r.crowded, false, `at ${width}px the bar is not crowded`);
        assert.equal(r.desktopMenu, true);
        assert.ok(r.page <= r.window);
      });
    }
  });

  it('on a phone a long title is cut short rather than pushing the page wider', async () => {
    await withPage({ width: 360, height: 700 }, async (page) => {
      const r = await open(page, 'reported');
      assert.ok(r.page <= r.window, `the page scrolls sideways (${r.page} > ${r.window})`);
      assert.equal(r.crowded, false, 'a phone-width bar is never marked crowded');
      assert.equal(r.phoneMenu, true);
    });
  });
});
