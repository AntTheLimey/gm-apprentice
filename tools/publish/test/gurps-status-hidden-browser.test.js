'use strict';
// A GURPS sheet's status panel, in a real browser: the REELING and TIRED badges, the effects row and its parts are
// written with the `hidden` attribute and shown by the live client only when they apply. `.gl-badge` sets its own
// display, which outranks the browser's `[hidden] { display: none }`, so without the sheet's override both badges
// showed at full HP and FP (a real bug). Skipped without Chrome or Chromium (set GM_TEST_CHROME), except on CI.
// Replaces a test of the stylesheet's rule text.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const { buildPc } = require('./helpers/pc-vault');
const { browserSkip, measure } = require('./helpers/browser');

describe('a GURPS status panel at full HP and FP, in a browser', { skip: browserSkip() }, () => {
  let pc;
  let r;
  before(() => {
    const body = matter(fs.readFileSync(path.join(__dirname, 'fixtures', 'gurps', 'gurps-ronnie.md'), 'utf8')).content;
    const log = console.log; const warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { pc = buildPc('gurps-4e', body, ['live_stats: true'], { assumeKv: true }); } finally { console.log = log; console.warn = warn; }
    r = measure(path.join(pc.out, 'characters', 'pcs', 'test-hero.html'), 390, function (done) {
      var sel = '.gl-status-panel .gl-badge, .gl-status-panel .gl-status-effects, .gl-status-panel .gl-delta, .gl-status-panel .gl-status-note';
      done({ parts: Array.prototype.map.call(document.querySelectorAll(sel), function (e) {
        return { what: e.className + (e.getAttribute('data-gl-delta') ? ':' + e.getAttribute('data-gl-delta') : ''), hidden: e.hasAttribute('hidden'), display: getComputedStyle(e).display };
      }) });
    });
  });
  after(() => { if (pc) fs.rmSync(pc.root, { recursive: true, force: true }); });

  it('shows no badge, effects row or note that carries the hidden attribute', () => {
    const names = r.parts.map((p) => p.what).join(', ');
    for (const want of ['gl-badge gl-badge-reeling', 'gl-badge gl-badge-tired', 'gl-status-effects']) {
      const part = r.parts.find((p) => p.what === want);
      assert.ok(part, `the panel has ${want} (it has ${names || 'nothing'})`);
      assert.equal(part.hidden, true, `${want} is hidden at full HP and FP`);
    }
    for (const p of r.parts.filter((x) => x.hidden)) assert.equal(p.display, 'none', `${p.what} has the hidden attribute but is displayed (${p.display})`);
  });
});
