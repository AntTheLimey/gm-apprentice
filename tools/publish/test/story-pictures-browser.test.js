'use strict';
// Story page 9b, Task 4: how the pictures beside a recap look and behave, measured in a real browser (headless
// Chrome). A single picture is 184px and floats right; a pair is 204px with two square crops; on a phone (390px) the
// float is 110px and a pair shows only its first picture. A click opens the full image in the lightbox, once, and
// the page does not navigate; a click with a modifier key or the middle button is left to the browser. The browser helper cannot hold a pointer over an element, so the expand mark's hover
// look is checked by the stylesheet's rules, and its resting look by the computed opacity. Skipped without Chrome or
// Chromium (set GM_TEST_CHROME to point at one), except on CI.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('./helpers/quiet-legacy-warning.js');
const { buildBoth } = require('./helpers/gm-build');
const { storyVault, WRAP_1 } = require('./helpers/story-vault');
const { makePng } = require('./helpers/make-png');
const { browserSkip, measure } = require('./helpers/browser');

const skip = browserSkip();
const note = (type, title, portrait) => `---\ntype: ${type}\ntitle: ${title}\nportrait: ${portrait}\n---\n\n# ${title}\n\nBODY of ${title}.\n`;
// Paragraph one names two pages (a pair, right); paragraph two names one (a single, left).
const RECAP = 'The party reached the docks at dusk, where Mara Quill waited and The Docks lay quiet.\n\n'
  + 'Later Captain Rook bought a round for the whole crew.\n\nNobody slept.';
const VAULT = storyVault({
  '_attachments/mara.png': makePng(30, 40),
  '_attachments/docks.png': makePng(40, 30),
  '_attachments/rook.png': makePng(30, 40),
  'NPCs/Mara Quill.md': note('npc', 'Mara Quill', 'mara.png'),
  'Locations/The Docks.md': note('location', 'The Docks', 'docks.png'),
  'NPCs/Captain Rook.md': note('npc', 'Captain Rook', 'rook.png'),
  'Sessions/Session 1 Wrap-Up.md': WRAP_1.replace(/## Narrative Recap\n\n[^\n]*\n/, `## Narrative Recap\n\n${RECAP}\n`),
});

describe('Story page pictures in a browser', { skip }, () => {
  let s;
  let page;
  let wide;
  let phone;
  let click;
  const probe = function (done) {
    var rect = function (el) { var r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    var pair = document.querySelector('.story-figures--two');
    var single = document.querySelector('.story-figures:not(.story-figures--two)');
    var figs = pair ? pair.querySelectorAll('.story-figure') : [];
    done({
      single: single && { w: rect(single).w, float: getComputedStyle(single).cssFloat, img: rect(single.querySelector('img')), place: !!single.querySelector('.story-figure--place') },
      pair: pair && { w: rect(pair).w, float: getComputedStyle(pair).cssFloat, imgs: [].map.call(figs, function (f) { return rect(f.querySelector('img')); }),
        second: figs[1] ? getComputedStyle(figs[1]).display : null, first: figs[0] ? getComputedStyle(figs[0]).display : null },
      zoomOpacity: getComputedStyle(document.querySelector('.story-figure__zoom')).opacity,
      hasLeft: !!document.querySelector('.story-figures--left'),
    });
  };
  before(() => {
    s = buildBoth(VAULT, { sites: ['player'] });
    page = path.join(s.player.dir, 'story', 'chapter-1-docks-session-1.html');
    wide = measure(page, 1280, probe);
    phone = measure(page, 390, probe);
    click = measure(page, 1280, function (done) {
      var a = document.querySelector('a.story-figure__open');
      var li = document.querySelector('.lightbox-overlay img');
      var sets = 0;
      var d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      Object.defineProperty(li, 'src', { configurable: true, get: function () { return d.get.call(li); }, set: function (v) { sets++; d.set.call(li, v); } });
      var before = location.href;
      var prevented = null;
      // Added after the page's own handlers: it notes whether they cancelled the navigation, then cancels it so a missing handler fails the test instead of leaving the page.
      document.addEventListener('click', function (e) { prevented = e.defaultPrevented; e.preventDefault(); });
      var overlay = document.querySelector('.lightbox-overlay');
      // A modifier or middle-button click is left to the browser (a new tab or window): not cancelled, no lightbox.
      var modified = [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }].map(function (o) {
        prevented = null;
        a.querySelector('img').dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true, cancelable: true }, o)));
        return { prevented: prevented, open: overlay.classList.contains('open') };
      });
      a.querySelector('img').click();
      done({ open: overlay.classList.contains('open'), same: li.src === a.href, sets: sets, href: a.href, unchanged: location.href === before, prevented: prevented, modified: modified });
    });
  });
  after(() => { if (s) s.cleanup(); });

  it('at 1280 wide a single picture is 184px wide and floats right; a pair is 204px with two square crops', () => {
    assert.deepEqual(wide.errors, []);
    assert.equal(wide.pair.float, 'right');
    assert.equal(wide.pair.w, 204);
    assert.equal(wide.pair.imgs.length, 2);
    for (const i of wide.pair.imgs) assert.ok(Math.abs(i.w - i.h) <= 1, `a pair crop is square (${i.w}x${i.h})`);
    assert.equal(wide.single.w, 184);
    assert.equal(wide.single.float, 'left', 'the second paragraph with pictures alternates to the left');
    assert.ok(Math.abs(wide.single.img.h - wide.single.img.w * 4 / 3) <= 1, `a person is cropped 3:4 (${wide.single.img.h})`);
  });

  it('at 390 wide the float is 110px and the second picture of a pair is not shown', () => {
    assert.equal(phone.pair.w, 110);
    assert.equal(phone.single.w, 110);
    assert.equal(phone.pair.second, 'none');
    assert.notEqual(phone.pair.first, 'none');
    assert.ok(Math.abs(phone.pair.imgs[0].w - phone.pair.imgs[0].h) <= 1, 'the first picture keeps its square crop');
  });

  it('clicking a picture opens the lightbox on the full image, once', () => {
    assert.deepEqual(click.errors, []);
    assert.equal(click.open, true, 'the lightbox is open');
    assert.equal(click.same, true, 'it shows the link\'s full image');
    assert.equal(click.sets, 1, 'the lightbox was opened once');
    assert.equal(click.prevented, true, 'the link does not navigate');
    assert.equal(click.unchanged, true);
  });

  it('a click with a modifier key or the middle button is left to the browser', () => {
    assert.deepEqual(click.modified, Array(5).fill({ prevented: false, open: false }));
  });

  it('the expand mark is faint at rest and full on hover', () => {
    assert.equal(wide.zoomOpacity, '0.45');
    const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8').replace(/\s+/g, ' ');
    assert.match(css, /\.story-figure__open:hover \.story-figure__zoom, \.story-figure__open:focus-visible \.story-figure__zoom \{ opacity: 1; background: rgba\(0, 0, 0, \.55\); \}/);
  });
});
