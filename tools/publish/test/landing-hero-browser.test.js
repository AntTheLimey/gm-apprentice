'use strict';
// #530: the full-bleed landing hero, measured in a real browser at a desktop and a phone width. The picture runs edge
// to edge from the top of the page, the menu sits over it, the page never scrolls sideways, and every other section
// keeps the width and place it has with the card hero. Skipped without Chrome or Chromium (set GM_TEST_CHROME), except
// on CI.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildBoth } = require('./helpers/gm-build');
const { makePng } = require('./helpers/make-png');
const { browserSkip, measure } = require('./helpers/browser');

const skip = browserSkip();

const FILES = {
  'Characters/Mara.md': '---\ntype: npc\n---\nA person.\n',
  'Sessions/Session 01.md': '---\ntype: session\nsession_number: 1\nstatus: played\n---\n\nThe party met at the harbour.\n',
  'Art/coast.png': makePng(1600, 600),
};

const probe = function (done) {
  var hero = document.querySelector('.landing-hero');
  var nav = document.querySelector('.top-nav');
  var h1 = hero.querySelector('h1');
  var section = document.querySelector('main.content > .dashboard-section');
  var r = function (el) { var b = el.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height), bottom: Math.round(b.bottom) }; };
  done({
    scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
    hero: r(hero), h1: r(h1), nav: r(nav), navPosition: getComputedStyle(nav).position,
    section: section ? r(section) : null,
    imgFit: getComputedStyle(hero.querySelector('.landing-hero-img')).objectFit,
    imgPosition: getComputedStyle(hero.querySelector('.landing-hero-img')).objectPosition,
  });
};

describe('the full-bleed landing hero, in a browser', { skip }, () => {
  const built = [];
  const res = {};
  before(() => {
    const site = (hero) => {
      const s = buildBoth(FILES, { sites: ['player', 'gm'], player: { title: 'Lantern Coast', theme: { campaign_image: 'Art/coast.png', tagline: 'Salt and smoke.' }, ...(hero ? { landing: { hero } } : {}) } });
      built.push(s);
      return s;
    };
    const card = path.join(site(null).player.dir, 'index.html');
    const both = site({ layout: 'full-bleed', focus: '20% center', focus_narrow: '68% center', align: 'left' });
    const bleed = path.join(both.player.dir, 'index.html');
    for (const w of [1280, 390]) res[w] = { card: measure(card, w, probe), bleed: measure(bleed, w, probe) };
    res.gm = measure(path.join(both.gm.dir, 'index.html'), 1280, function (done) {
      var band = document.querySelector('.gm-band').getBoundingClientRect();
      var nav = document.querySelector('.top-nav');
      done({ bandRight: Math.round(band.right), bandTop: Math.round(band.top), navBottom: Math.round(nav.getBoundingClientRect().bottom),
        navPosition: getComputedStyle(nav).position, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth });
    });
  });
  after(() => built.forEach((s) => s.cleanup()));

  it('on the GM site the menu stays a solid bar and the band sits below it, inside the page', () => {
    const g = res.gm;
    assert.equal(g.navPosition, 'sticky');
    assert.ok(g.bandTop >= g.navBottom, 'the band is not under the menu');
    assert.ok(g.bandRight <= g.clientWidth && g.scrollWidth <= g.clientWidth, 'the band stays inside the page');
  });

  for (const w of [1280, 390]) {
    it(`at ${w} wide: edge to edge from the top, menu over it, no sideways scroll, sections where they were`, () => {
      const { card, bleed } = res[w];
      assert.deepEqual(bleed.errors, []);
      assert.ok(bleed.scrollWidth <= bleed.clientWidth, `the page scrolls sideways (${bleed.scrollWidth} > ${bleed.clientWidth})`);
      assert.equal(bleed.hero.left, 0);
      assert.equal(bleed.hero.width, bleed.clientWidth);
      assert.equal(bleed.hero.top, 0, 'the hero starts at the top, under the menu');
      assert.equal(bleed.navPosition, 'absolute');
      assert.ok(bleed.nav.bottom <= bleed.h1.top, 'the title is below the menu');
      assert.ok(bleed.h1.bottom <= bleed.hero.bottom && bleed.h1.left >= 0 && bleed.h1.left + bleed.h1.width <= bleed.clientWidth, 'the title is inside the hero');
      assert.equal(bleed.imgFit, 'cover');
      assert.equal(bleed.imgPosition, w === 390 ? '68% 50%' : '20% 50%');
      assert.ok(card.section && bleed.section, 'the page has a section after the hero');
      assert.equal(bleed.section.left, card.section.left, 'a section keeps its place');
      assert.equal(bleed.section.width, card.section.width, 'a section keeps its width');
      // The card is today's look: the menu is a sticky bar above it.
      assert.equal(card.navPosition, 'sticky');
      assert.ok(card.scrollWidth <= card.clientWidth);
    });
  }
});
