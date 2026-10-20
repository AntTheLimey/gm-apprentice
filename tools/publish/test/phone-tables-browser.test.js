'use strict';
// A table on a character sheet is wider than a phone, and the page must not scroll sideways because of it, measured
// in a real browser (headless Chrome, 390px wide). A CoC accordion holding a very wide table scrolls inside its own
// body; a table written straight into a tab (PF2e) shrinks to its panel. Skipped without Chrome or Chromium (set
// GM_TEST_CHROME to point at one), except on CI. These replace tests of the stylesheet's rule text: the browser says what the rules do.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPc } = require('./helpers/pc-vault');
const { templateBody } = require('./helpers/pc-template');
const { browserSkip, measure } = require('./helpers/browser');

const skip = browserSkip();
const quiet = (fn) => {
  const log = console.log; const warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; }
};

// A table of 14 columns, each header and cell an unbreakable run of letters: wider than any phone.
const COLS = 14;
const wideTable = (title) => `\n## ${title}\n\n| ${Array.from({ length: COLS }, (_, i) => `Column${i}Header`).join(' | ')} |\n|${'---|'.repeat(COLS)}\n| ${Array.from({ length: COLS }, (_, i) => `Value${i}Cell`).join(' | ')} |\n`;

describe('sheet tables on a phone, in a browser', { skip }, () => {
  let coc;
  let pf2e;
  let cocR;
  let pf2eR;
  before(() => {
    coc = quiet(() => buildPc('coc-7e', templateBody('pc-coc-7e.md') + wideTable('House Rules')));
    pf2e = quiet(() => buildPc('pf2e', templateBody('pc-pf2e.md')));
    cocR = measure(path.join(coc.out, 'characters', 'pcs', 'test-hero.html'), 390, function (done) {
      var doc = document.documentElement;
      var cell = Array.prototype.find.call(document.querySelectorAll('td, th'), function (e) { return /Column13Header|Value13Cell/.test(e.textContent); });
      // The sheet shows one tab at a time and keeps its accordions shut: open the ones the table is in.
      var panel = cell && cell.closest('.tab-panel'); if (panel) panel.removeAttribute('hidden');
      var acc = cell && cell.closest('details'); if (acc) acc.open = true;
      var el = cell && cell.parentElement;
      var scroller = null;
      while (el && el !== document.body) {
        var o = getComputedStyle(el).overflowX;
        if ((o === 'auto' || o === 'scroll') && el.scrollWidth > el.clientWidth) { scroller = el; break; }
        el = el.parentElement;
      }
      done({ found: !!cell, pageScrollWidth: doc.scrollWidth, pageClientWidth: doc.clientWidth, scrolls: !!scroller });
    });
    pf2eR = [360, 390].map((width) => ({ width, ...measure(path.join(pf2e.out, 'characters', 'pcs', 'test-hero.html'), width, function (done) {
      var doc = document.documentElement;
      var table = Array.prototype.find.call(document.querySelectorAll('.tab-panel > table'), function (t) { return /Atk Bonus/.test(t.textContent); });
      var panel = table && table.parentElement;
      if (panel) { Array.prototype.forEach.call(document.querySelectorAll('.tab-panel'), function (p) { p.classList.remove('active'); }); panel.classList.add('active'); }
      done({ found: !!table, pageScrollWidth: doc.scrollWidth, pageClientWidth: doc.clientWidth, tableRight: table ? Math.round(table.getBoundingClientRect().right) : null, panelRight: panel ? Math.round(panel.getBoundingClientRect().right) : null });
    }) }));
  });
  after(() => { for (const b of [coc, pf2e]) if (b) fs.rmSync(b.root, { recursive: true, force: true }); });

  it('a very wide table in a CoC accordion scrolls inside its own box, and the page does not scroll sideways', () => {
    assert.equal(cocR.found, true, 'the wide table is on the page');
    assert.ok(cocR.pageScrollWidth <= cocR.pageClientWidth, `the page scrolls sideways (${cocR.pageScrollWidth} > ${cocR.pageClientWidth})`);
    assert.equal(cocR.scrolls, true, 'an ancestor of the table scrolls it sideways inside itself');
  });

  it('the Strikes table written straight into a PF2e tab shrinks to its panel at 360px and 390px, and the page does not scroll sideways', () => {
    for (const r of pf2eR) {
      assert.equal(r.found, true, 'the Strikes table is directly in a tab');
      assert.ok(r.pageScrollWidth <= r.pageClientWidth, `at ${r.width}px the page scrolls sideways (${r.pageScrollWidth} > ${r.pageClientWidth})`);
      assert.ok(r.tableRight <= r.panelRight + 1, `at ${r.width}px the table runs past its panel (${r.tableRight} > ${r.panelRight})`);
    }
  });
});
