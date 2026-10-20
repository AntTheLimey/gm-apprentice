'use strict';
// A tall banner picture on a phone, measured in a real browser (#386): the picture is capped in height and shown
// whole, not stretched to its own height. Skipped without Chrome or Chromium (set GM_TEST_CHROME to point at one).
// Replaces a test of the stylesheet's rule text.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildBoth } = require('./helpers/gm-build');
const { makePng } = require('./helpers/make-png');
const { findChrome, measure } = require('./helpers/browser');

const skip = findChrome() ? false : 'no Chrome or Chromium found';

describe('the landing banner picture on a phone, in a browser', { skip }, () => {
  let site;
  let r;
  before(() => {
    // 300 wide and 1800 tall: on a 390px phone it would be 1800px tall if nothing capped it.
    site = buildBoth({
      'Characters/Mara.md': '---\ntype: npc\n---\nA person.\n',
      'Art/tall.png': makePng(300, 1800),
    }, { sites: ['player'], player: { folder_map: { Characters: 'characters' }, landing: { banner: { image: 'Art/tall.png', title: 'Wanted' } } } });
    r = measure(path.join(site.player.dir, 'index.html'), 390, function (done) {
      var img = document.querySelector('.landing-banner-img');
      var box = img && img.getBoundingClientRect();
      done({ found: !!img, height: box ? Math.round(box.height) : null, rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
        pageScrollWidth: document.documentElement.scrollWidth, pageClientWidth: document.documentElement.clientWidth });
    });
  });
  after(() => site && site.cleanup());

  it('is capped at 18rem tall and the page does not scroll sideways', () => {
    assert.equal(r.found, true, 'the page shows the banner picture');
    assert.ok(r.height <= 18 * r.rem + 1, `the picture is ${r.height}px tall (the cap is ${18 * r.rem}px)`);
    assert.ok(r.pageScrollWidth <= r.pageClientWidth, 'the page does not scroll sideways');
  });
});
