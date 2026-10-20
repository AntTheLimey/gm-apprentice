'use strict';
// The to-hit calculator on a phone, measured in a real browser (headless Chrome): the answer
// line sticks and holds all four numbers, the controls are big enough to tap, the strip wraps
// under 360px, and the site's back-to-top button sits in the corner. Headless Chrome will not
// make a window under 500px, so the page is measured inside frames 375px and 340px wide.
// Skipped where no Chrome is found, except on CI, where it fails.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const matter = require('gray-matter');
const { buildPc } = require('./helpers/pc-vault');
const { findChrome } = require('./helpers/browser');

// Runs in the outer page: opens the Combat tab in each frame and measures.
const PROBE = `
function measure(win) {
  var d = win.document;
  var tab = Array.prototype.find.call(d.querySelectorAll('[role=tab],button,a'), function (e) { return /^\\s*Combat\\s*$/.test(e.textContent); });
  if (tab) tab.click();
  var r = function (el) { var b = el.getBoundingClientRect(); return { top: Math.round(b.top), left: Math.round(b.left), right: Math.round(b.right), height: Math.round(b.height) }; };
  var box = d.getElementById('tohit-calc');
  var taps = Array.prototype.map.call(box.querySelectorAll('select, input[type="number"], .th-actions button, .th-chip, .th-c'), function (e) { return { what: e.tagName + '.' + e.className, height: r(e).height }; })
    .filter(function (t) { return t.height > 0; });
  var cells = Array.prototype.map.call(d.querySelectorAll('.th-strip .th-cell'), function (e) { return r(e).top; });
  var btt = d.querySelector('.back-to-top');
  return {
    width: win.innerWidth, scrollWidth: d.documentElement.scrollWidth,
    answer: ['th-roll', 'th-hit', 'th-crit', 'th-fumble'].map(function (id) { return r(d.getElementById(id)).top; }),
    sticky: win.getComputedStyle(box.querySelector('.th-stick')).position,
    taps: taps, firstRow: cells.filter(function (t) { return t === cells[0]; }).length,
    backToTop: btt ? r(btt) : null,
  };
}
var frames = Array.prototype.slice.call(document.querySelectorAll('iframe'));
var left = frames.length; var out = {};
frames.forEach(function (f) {
  f.addEventListener('load', function () {
    setTimeout(function () {
      try { out[f.width] = measure(f.contentWindow); } catch (e) { out[f.width] = { error: String(e) }; }
      if (--left === 0) document.getElementById('out').textContent = JSON.stringify(out);
    }, 300);
  });
});
`;

test('the to-hit calculator on a phone, in a real browser', (t) => {
  const chrome = findChrome();
  if (!chrome) {
    if (process.env.CI) assert.fail('no Chrome found on CI: set CHROME_PATH');
    t.skip('no Chrome found (set CHROME_PATH or GM_TEST_CHROME to run it)');
    return;
  }
  const ronnie = matter(fs.readFileSync(path.join(__dirname, 'fixtures', 'gurps', 'gurps-ronnie.md'), 'utf8')).content;
  const log = console.log; const warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  let out;
  try { ({ out } = buildPc('gurps-4e', ronnie)); } finally { console.log = log; console.warn = warn; }
  const page = 'characters/pcs/test-hero.html';
  fs.writeFileSync(path.join(out, 'probe.html'), `<!doctype html><meta charset="utf-8"><body>
<iframe width="375" height="900" src="${page}"></iframe><iframe width="340" height="900" src="${page}"></iframe>
<pre id="out"></pre><script>${PROBE}</script></body>`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tohit-chrome-'));
  let dom;
  try {
    // Chrome can exit non-zero on its way out under load after it has printed the page: what
    // counts is the measurements in the printed page.
    try {
      dom = execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--allow-file-access-from-files',
        `--user-data-dir=${profile}`, '--window-size=900,1000', '--virtual-time-budget=10000', '--dump-dom',
        'file://' + path.join(out, 'probe.html').replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      if (!e.stdout) throw e;
      dom = String(e.stdout);
    }
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(path.dirname(out), { recursive: true, force: true, maxRetries: 3 });
  }
  const m = /<pre id="out">([^<]*)<\/pre>/.exec(dom);
  assert.ok(m && m[1], 'the probe wrote its measurements');
  const got = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  if (process.env.TOHIT_PROBE_DEBUG) console.log(JSON.stringify(got));

  for (const width of ['375', '340']) {
    const p = got[width];
    assert.ok(!p.error, p.error);
    assert.strictEqual(p.width, Number(width));
    assert.ok(p.scrollWidth <= p.width, `${width}px: nothing wider than the screen (${p.scrollWidth})`);
    // Roll, Hit, Critical and Fumble on one line, and that line sticks.
    assert.strictEqual(new Set(p.answer).size, 1, `${width}px: the answer is one line: ${p.answer}`);
    assert.strictEqual(p.sticky, 'sticky');
    for (const tap of p.taps) assert.ok(tap.height >= 40, `${width}px: ${tap.what} is ${tap.height}px tall`);
    assert.ok(p.backToTop && p.backToTop.left > p.width / 2 && p.backToTop.right <= p.width, `${width}px: back-to-top in the right-hand corner`);
  }
  assert.strictEqual(got['375'].firstRow, 16, 'the strip is one row of 16 at 375px');
  assert.strictEqual(got['340'].firstRow, 8, 'two rows of eight under 360px');
});
