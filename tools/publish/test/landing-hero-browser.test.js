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
// The strength of the words' shade, as the stylesheet writes it (color-mix of --bg-hero at this share).
const SHADE = (() => {
  const css = require('node:fs').readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
  const rule = css.slice(css.indexOf('.landing-hero.landing-hero--full-bleed h1::before'));
  return Number(/color-mix\(in srgb, var\(--bg-hero\) (\d+)%, transparent\) 3rem/.exec(rule)[1]) / 100;
})();

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
    bgHero: getComputedStyle(hero).getPropertyValue('--bg-hero').trim(),
    words: [h1, hero.querySelector('.hero-tagline'), hero.querySelector('.hero-dates'), hero.querySelector('.date-label')].map(function (el) {
      var cs = getComputedStyle(el); return { color: cs.color, opacity: cs.opacity, size: parseFloat(cs.fontSize) };
    }),
    shade: (function () { var cs = getComputedStyle(h1, '::before'); return { content: cs.content, position: cs.position, image: cs.backgroundImage }; })(),
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
      // The words read over any picture (review of #530): a light ink on the words' own shade, at least 80% of the hero
      // colour from above the title to the hero's foot. Worst case, the picture behind is white: the title (large) needs
      // 3:1, the tagline and dates 4.5:1. The shade's strength is read from the stylesheet; the inks from the page.
      assert.equal(bleed.shade.content, '""');
      assert.equal(bleed.shade.position, 'absolute');
      assert.match(bleed.shade.image, /gradient/);
      const channels = (c) => (c.startsWith('#') ? (c.length === 4 ? [...c.slice(1)].map((x) => parseInt(x + x, 16)) : [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))) : c.match(/[\d.]+/g).slice(0, 3).map(Number));
      const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; const [r, g, b] = rgb.map(f); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const backdrop = lum(channels(bleed.bgHero).map((h) => SHADE * h + (1 - SHADE) * 255));
      bleed.words.forEach((word, i) => {
        assert.equal(word.opacity, '1');
        const ratio = (lum(channels(word.color)) + 0.05) / (backdrop + 0.05);
        assert.ok(ratio >= (i === 0 ? 3 : 4.5), `${['the title', 'the tagline', 'the dates', 'a date label'][i]} is ${ratio.toFixed(2)}:1 over a white picture`);
      });
      // The card is today's look: the menu is a sticky bar above it.
      assert.equal(card.navPosition, 'sticky');
      assert.ok(card.scrollWidth <= card.clientWidth);
    });
  }
});
