'use strict';
// The party page's Party Status board, in a real browser: each PC's portrait fills its circle. The board sits inside
// .content, whose article picture rule gives every img a margin and a corner radius; the avatar's own rule set only
// its size, so the picture slid 12px down its 34px circle and left the top empty (#769, seen on Snowbound). Skipped
// without Chrome or Chromium (set GM_TEST_CHROME), except on CI.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildBoth } = require('./helpers/gm-build');
const { makePng } = require('./helpers/make-png');
const { browserSkip, measure, browserBefore } = require('./helpers/browser');

const FIXTURE = path.join(__dirname, 'fixtures', 'with-dnd-pc', 'Characters', 'PCs');
const withPortrait = (file, portrait) => fs.readFileSync(path.join(FIXTURE, file), 'utf8').replace(/\r\n/g, '\n')
  .replace(/^portrait: .*$/m, `portrait: ${portrait}`);

// Every small picture inside the article text of the page whose computed margin is not zero, by its parent's class.
const smallWithMargin = function (done) {
  done(Array.prototype.filter.call(document.querySelectorAll('.content img'), function (img) {
    var w = img.getBoundingClientRect().width;
    var cs = getComputedStyle(img);
    return w && w < 80 && (parseFloat(cs.marginTop) || parseFloat(cs.marginBottom));
  }).map(function (img) { return img.parentElement.className + ' > img'; }));
};
const LISTS = ['characters/index.html', 'characters/npcs/index.html', 'factions/index.html', 'locations/index.html'];

describe('the party board\'s portraits, in a browser', { skip: browserSkip() }, () => {
  let site;
  let r;
  const lists = {};
  browserBefore(() => {
    site = buildBoth({
      '_attachments/brannoch.png': makePng(40, 60),
      'Characters/PCs/Brannoch_Vale.md': withPortrait('Brannoch_Vale.md', 'brannoch.png'),
      'Characters/PCs/Tamsin_Reed.md': fs.readFileSync(path.join(FIXTURE, 'Tamsin_Reed.md'), 'utf8'),
      'Characters/NPCs/Brother Hollis.md': '---\ntype: npc\nstatus: alive\nportrait: brannoch.png\n---\n\nA monk.\n',
      'Factions/The Order.md': '---\ntype: faction\nportrait: brannoch.png\n---\n\nAn order of monks.\n',
      'Locations/The Pass.md': '---\ntype: location\nportrait: brannoch.png\n---\n\nA high pass.\n',
    }, { vault: { system: 'dnd-5e-2024' }, sites: ['player'], player: { folder_map: {
      'Characters/PCs': 'characters/pcs', 'Characters/NPCs': 'characters/npcs', Factions: 'factions', Locations: 'locations' } } });
    // The other list pages whose small pictures sit inside .content: the same rule reached each of them.
    for (const page of LISTS) lists[page] = measure(path.join(site.player.dir, ...page.split('/')), 1280, smallWithMargin);
    r = measure(path.join(site.player.dir, 'characters', 'pcs', 'index.html'), 1280, function (done) {
      var box = function (el) { var b = el.getBoundingClientRect(); return { top: Math.round(b.top), left: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) }; };
      done({
        avatars: Array.prototype.map.call(document.querySelectorAll('.gl-av-img'), function (span) {
          var img = span.querySelector('img');
          var cs = getComputedStyle(img);
          var sp = getComputedStyle(span);
          return { circle: box(span), img: box(img), border: parseFloat(sp.borderTopWidth), margin: cs.marginTop + ' ' + cs.marginBottom, radius: cs.borderTopLeftRadius, inContent: !!span.closest('.content') };
        }),
        // Every small picture inside the article text on this page: none takes the article picture's margin.
        small: Array.prototype.filter.call(document.querySelectorAll('.content img'), function (img) {
          var w = img.getBoundingClientRect().width;
          var cs = getComputedStyle(img);
          return w && w < 80 && (parseFloat(cs.marginTop) || parseFloat(cs.marginBottom));
        }).map(function (img) { return img.parentElement.className + ' > img'; }),
      });
    });
  });
  after(() => { if (site) site.cleanup(); });

  it('the portrait fills its circle edge to edge', () => {
    assert.equal(r.avatars.length, 1, JSON.stringify(r.avatars));
    const [a] = r.avatars;
    assert.equal(a.inContent, true, 'the board sits inside .content, where the article picture rule applies');
    assert.equal(a.margin, '0px 0px');
    assert.equal(a.radius, '0px');
    // Inside the circle's border, the picture covers the whole circle.
    assert.equal(a.img.top, a.circle.top + a.border);
    assert.equal(a.img.left, a.circle.left + a.border);
    assert.equal(a.img.w, a.circle.w - 2 * a.border);
    assert.equal(a.img.h, a.circle.h - 2 * a.border);
  });

  it('no small picture on the party page takes the article picture\'s margin', () => {
    assert.deepEqual(r.small, []);
  });

  it('nor on the other list pages (the characters index, NPCs, factions, locations)', () => {
    for (const page of LISTS) {
      assert.ok(Array.isArray(lists[page]), `${page} was measured`);
      assert.deepEqual(lists[page], [], page);
    }
  });
});
