'use strict';
// The Connections layout in a real browser (#342): what the CSS tests (rule text) and the vm tests cannot hold.
// Skipped without Chrome or Chromium (set GM_TEST_CHROME to point at one).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildBoth } = require('./helpers/gm-build');
const { findChrome, measure } = require('./helpers/browser');

const LONG = 'Wolfeschlegelsteinhausenbergerdorff'.repeat(2);
const FILES = {
  'Characters/Subject.md': `---\ntype: npc\nrelationships:\n  - target: "[[Other One]]"\n    type: ally\n  - target: "[[${LONG}]]"\n    type: enemy\n  - target: "[[Third]]"\n    type: knows\n  - target: "[[The Quay]]"\n    type: located_at\n---\nHe knows [[Other One]].\n`,
  'Characters/Other One.md': '---\ntype: npc\n---\nOther.\n',
  [`Characters/${LONG}.md`]: '---\ntype: npc\n---\nLong.\n',
  'Characters/Third.md': '---\ntype: npc\n---\nThird.\n',
  'Places/The Quay.md': '---\ntype: location\n---\nA quay.\n',
};
const skip = findChrome() ? false : 'no Chrome or Chromium found';

describe('Connections in a browser at phone width', { skip }, () => {
  let site;
  let page;
  let r;
  before(() => {
    site = buildBoth(FILES, { sites: ['player'], player: { folder_map: { Characters: 'characters', Places: 'places' } } });
    page = path.join(site.player.dir, 'characters', 'subject.html');
    r = measure(page, 390, script);   // one launch of the browser serves the three tests
  });
  after(() => site && site.cleanup());

  const script = function (done) {
    var doc = document.documentElement;
    var tabs = document.querySelectorAll('.cx-tab');
    var names = [].slice.call(document.querySelectorAll('.cx-name'));
    var result = {
      live: !!document.querySelector('.cx-app'), tabs: tabs.length,
      scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth,
      nameOverflow: names.filter(function (n) { return n.getBoundingClientRect().right > doc.clientWidth + 1; }).length,
      firstLines: document.querySelectorAll('.cx-panel:not([hidden]) svg.cx-lines path').length
    };
    if (tabs.length < 2) { done(result); return; }
    tabs[1].click();
    setTimeout(function () {
      result.secondLines = document.querySelectorAll('.cx-panel:not([hidden]) svg.cx-lines path').length;
      done(result);
    }, 600);
  };

  it('a long word wraps inside the page, with no sideways scroll', () => {
    assert.equal(r.live, true, 'the page script drew the section');
    assert.equal(r.nameOverflow, 0);
    assert.ok(r.scrollWidth <= r.clientWidth, `the page scrolls sideways (${r.scrollWidth} > ${r.clientWidth})`);
  });

  it('the tree is measured and its lines drawn, including in a tab that was hidden', () => {
    assert.ok(r.tabs >= 2, `tabs: ${r.tabs}`);
    assert.ok(r.firstLines > 0, 'lines in the first tab');
    assert.ok(r.secondLines > 0, 'lines in the tab opened after load');
  });

  it('opening a hidden tab raises no page error', () => {
    assert.deepEqual(r.errors, []);
  });
});
