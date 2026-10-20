'use strict';
// The Connections drawings that once looked wrong (#343), in a real browser at a desktop and a phone width: what the
// geometry tests in connections-client cannot see (type as drawn, wrapping, the card against the window).
// Skipped without Chrome or Chromium (set GM_TEST_CHROME to point at one), except on CI, where it fails.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildBoth } = require('./helpers/gm-build');
const { browserSkip, measure } = require('./helpers/browser');
const { connectionsCases, LONG_NAME, SUBJECT_315 } = require('./helpers/connections-cases');

const skip = browserSkip();
const PAGES = ['lone', 'smalls', 'long315', 'crowd', 'tall', 'named', 'wide'];

// Everything the tests ask of one page, measured in it. Run in the browser, so plain ES5.
const script = function (done) {
  var page = JSON.parse(document.querySelector('script.cx-data').textContent).s;   // the subject: the probe's own file name says nothing
  var round = function (v) { return Math.round(v * 10) / 10; };
  var rect = function (e) { var b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
  var lines = function (e) { return Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)); };
  var r = { page: page, how: document.querySelector('svg.cx-web') ? 'web' : document.querySelector('.cx-tree-wrap') ? 'tree' : 'none' };
  var web = document.querySelector('svg.cx-web');
  if (web) {
    var scale = web.getBoundingClientRect().width / web.viewBox.baseVal.width;
    r.namePx = round(13 * scale);
    var disc = document.querySelector('circle.cx-root-dot');
    r.disc = rect(disc);
    r.discTip = (document.querySelector('.cx-disc > title') || {}).textContent || '';
    r.rootText = [].map.call(document.querySelectorAll('text.cx-root'), function (t) { return t.textContent; }).join(' ').replace(/- /g, '-');   // a line may break after a hyphen
    r.bands = [].map.call(document.querySelectorAll('text.cx-band'), rect);
    r.nameTips = [].map.call(document.querySelectorAll('.cx-node > title'), function (t) { return t.textContent; });
    r.hub = !!document.querySelector('circle.cx-hub');
    // the share of the ring each group's names leave empty: the widest gap between neighbouring marks
    var c = disc.getBoundingClientRect();
    var cx = (c.left + c.right) / 2;
    var cy = (c.top + c.bottom) / 2;
    var angles = [].map.call(document.querySelectorAll('.cx-node .cx-mark'), function (m) {
      var b = m.getBoundingClientRect();
      return Math.atan2((b.left + b.right) / 2 - cx, cy - (b.top + b.bottom) / 2);
    }).sort(function (a, b) { return a - b; });
    var gaps = angles.map(function (a, i) { return i + 1 < angles.length ? angles[i + 1] - a : angles[0] + 2 * Math.PI - a; });
    r.gapRatio = angles.length > 2 ? round(Math.max.apply(null, gaps) / Math.min.apply(null, gaps)) : 0;
  }
  var wrap = document.querySelector('.cx-tree-wrap');
  if (wrap) {
    var root = document.querySelector('circle.cx-root-dot');
    var rx = Number(root.getAttribute('cx'));
    var ry = Number(root.getAttribute('cy'));
    r.fromRoot = [].filter.call(document.querySelectorAll('svg.cx-lines path'), function (p) {
      var m = /^M([-\d.]+) ([-\d.]+)/.exec(p.getAttribute('d'));
      return m && Math.abs(Number(m[1]) - rx) < 0.2 && Math.abs(Number(m[2]) - ry) < 0.2;
    }).length;
    r.labelLines = [].map.call(document.querySelectorAll('.cx-group .cx-label'), lines);
    r.nameLines = [].map.call(document.querySelectorAll('.cx-row .cx-name'), function (n) { return [n.textContent, lines(n)]; });
  }
  r.scrollWidth = document.documentElement.scrollWidth;
  r.clientWidth = document.documentElement.clientWidth;
  if (page !== 'Tall' && page !== 'Lone') { done(r); return; }
  var strip = document.querySelector('.cx-panel:not([hidden]) .cx-strip');
  var rows = [].slice.call(document.querySelectorAll('.cx-panel:not([hidden]) [data-cx-i]'));
  if (page === 'Lone') {
    // a tap on a name (a touch's pointerdown, then its click) still opens its card
    rows[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    r.tapped = strip.textContent;
    done(r);
    return;
  }
  // a name near the top of a tall drawing: the card floats, never over the chosen name, and the names it
  // covers can still be reached by the pointer
  rows[0].dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
  setTimeout(function () {
    var s = rect(strip);
    var chosen = rect(rows[0]);
    r.top = { strip: s, chosen: chosen, innerHeight: innerHeight, float: strip.classList.contains('cx-float') };
    var under = rows.filter(function (row) { var b = row.getBoundingClientRect(); var y = (b.top + b.bottom) / 2; return y > s.top + 2 && y < s.bottom - 2; })[0];
    if (under) {
      var b = under.getBoundingClientRect();
      var hit = document.elementFromPoint(b.left + 30, (b.top + b.bottom) / 2);
      r.top.reach = !!(hit && hit.closest && hit.closest('[data-cx-i]') === under);
      // choosing a name the card covers puts the card back under the drawing, off that name
      under.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
      setTimeout(function () {
        var s2 = strip.getBoundingClientRect();
        var u = under.getBoundingClientRect();
        r.covered = { overlap: s2.top < u.bottom && s2.bottom > u.top, float: strip.classList.contains('cx-float') };
        done(r);
      }, 100);
      return;
    }
    done(r);
  }, 100);
};

for (const [mode, widths] of [['web', [1200, 360]], ['tree', [1200, 640, 360]]]) {
  describe(`Connections cases in a browser, ${mode}`, { skip }, () => {
    let site;
    const at = {};
    before(() => {
      site = buildBoth(connectionsCases(), { sites: ['player'], player: { features: { connections: mode } } });
      const pages = PAGES.map((p) => path.join(site.player.dir, 'characters', `${p}.html`));
      for (const w of widths) {
        at[w] = {};
        measure(pages, w, script).forEach((r, n) => { at[w][PAGES[n]] = r; });
      }
    });
    after(() => site && site.cleanup());

    it('raises no page error and never scrolls sideways', () => {
      for (const w of widths) {
        for (const p of PAGES) {
          const r = at[w][p];
          assert.deepEqual(r.errors, [], `${p} at ${w}`);
          assert.ok(r.scrollWidth <= r.clientWidth, `${p} at ${w} scrolls sideways (${r.scrollWidth} > ${r.clientWidth})`);
        }
      }
    });

    if (mode === 'web') {
      it('one name: its group label sits under the name, clear of the disc', () => {
        for (const w of widths) {
          const r = at[w].lone;
          assert.equal(r.how, 'web');
          assert.equal(r.bands.length, 1);
          const [band] = r.bands;
          assert.ok(band.left > r.disc.right + 4, `at ${w} the label starts at ${band.left}, the disc ends at ${r.disc.right}`);
          assert.ok(band.width > band.height, `at ${w} the label reads level (${band.width} by ${band.height})`);
        }
      });

      it('a tap on a name still opens its card', () => {
        for (const w of widths) assert.match(at[w].lone.tapped, /Ann Lowe/, `at ${w}`);
      });

      it('groups of one name leave no wide empty arc: the web of small groups is even', () => {
        for (const w of widths) {
          const r = at[w].smalls;
          if (r.how !== 'web') continue;
          assert.ok(r.gapRatio <= 3.2, `at ${w} the widest gap between names is ${r.gapRatio} times the narrowest`);
        }
      });

      it('a 315-character subject is cut in the disc, whole on hover, and the names stay readable', () => {
        for (const w of widths) {
          const r = at[w].long315;
          assert.equal(r.how, 'web', `at ${w}`);
          assert.equal(r.discTip, SUBJECT_315);
          assert.ok(r.rootText.length <= 40 && r.rootText.endsWith('…'), `at ${w}: "${r.rootText}"`);
          assert.ok(r.namePx >= 9, `at ${w} names are drawn at ${r.namePx}px`);
        }
      });

      it('25 groups: the lines leave from a ring round the disc, names readable', () => {
        const r = at[1200].crowd;
        assert.equal(r.how, 'web');
        assert.equal(r.hub, true);
        assert.ok(r.namePx >= 9, `names at ${r.namePx}px`);
      });
    } else {
      it('25 groups: one line leaves the subject, not 25', () => {
        for (const w of [1200, 640]) assert.equal(at[w].crowd.fromRoot, 1, `at ${w}`);
        assert.equal(at[1200].smalls.fromRoot, 5, 'five groups keep their own curves');
      });

      it('a "(named by)" group label stays on one line', () => {
        for (const w of widths) assert.deepEqual(at[w].named.labelLines, [1], `at ${w}`);
      });

      it('a long name does not wrap where the row has room for it', () => {
        const long = (w) => at[w].wide.nameLines.find(([t]) => t === LONG_NAME)[1];
        assert.equal(long(1200), 1);
      });

      it('in a tall drawing the card never covers the chosen name, and the names it covers can still be chosen', () => {
        for (const w of widths) {
          const { top, covered } = at[w].tall;
          assert.ok(top.strip.height > 0, `at ${w} the card is shown`);
          assert.ok(top.strip.top >= top.chosen.bottom || top.strip.bottom <= top.chosen.top, `at ${w} the card covers the chosen name`);
          assert.equal(top.float, true, `at ${w} the card keeps to the window while the name chosen is near the top`);
          assert.ok(top.strip.bottom <= top.innerHeight + 1, `at ${w} the card is in the window`);
          assert.equal(top.reach, true, `at ${w} a name under the card cannot be reached`);
          assert.deepEqual(covered, { overlap: false, float: false }, `at ${w} choosing a covered name`);
        }
      });
    }
  });
}
