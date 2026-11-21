'use strict';
// The real-input helpers of test/helpers/cdp.js (click held, drag, wheel, type, box) in a real browser,
// against a small data: page. Later layout tests lean on these: a synthetic event has passed a test
// while a real hand failed. Skipped without Chrome, except on CI.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { browserSkip } = require('./helpers/browser');
const { withPage } = require('./helpers/cdp');

const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<button id="b" style="position:absolute;left:40px;top:40px;width:120px;height:40px">go</button>
<div id="pad" style="position:absolute;left:300px;top:40px;width:100px;height:100px;background:#ccc"></div>
<div id="box" style="position:absolute;left:40px;top:200px;width:200px;height:100px;overflow:auto"><div style="height:1000px">tall</div></div>
<div id="rail" style="position:absolute;left:500px;top:20px;width:28px;height:300px;background:#888"></div>
<div id="cover" style="display:none;position:absolute;left:40px;top:40px;width:120px;height:40px;opacity:0"></div>
<button id="far" style="position:absolute;left:40px;top:1500px;width:100px;height:30px">far</button>
<input id="t" style="position:absolute;left:300px;top:200px">
<script>
  window.log = []; window.hits = { rail: [], cover: 0, far: 0 };
  document.getElementById('rail').addEventListener('click', (e) => window.hits.rail.push(e.offsetY));
  document.getElementById('cover').addEventListener('click', () => window.hits.cover++);
  document.getElementById('far').addEventListener('click', () => window.hits.far++);
  const b = document.getElementById('b');
  for (const t of ['mousedown', 'mouseup', 'click']) b.addEventListener(t, (e) => window.log.push({ t, at: performance.now(), buttons: e.buttons }));
  const pad = document.getElementById('pad');
  let from = null;
  pad.addEventListener('mousedown', (e) => { from = { x: e.clientX, y: e.clientY, l: pad.offsetLeft, t: pad.offsetTop }; });
  window.addEventListener('mousemove', (e) => { if (from && e.buttons === 1) { pad.style.left = from.l + e.clientX - from.x + 'px'; pad.style.top = from.t + e.clientY - from.y + 'px'; } });
  window.addEventListener('mouseup', () => { from = null; });
</script>`;
const URL_ = `data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`;

describe('real-input page helpers', { skip: browserSkip() }, () => {
  it('a held click presses, waits, releases and clicks the centre of a button', async () => {
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(URL_);
      await page.waitFor('document.getElementById("b")');
      await page.click('#b');
      const log = await page.evaluate('window.log');
      assert.deepStrictEqual(log.map((e) => e.t), ['mousedown', 'mouseup', 'click']);
      assert.ok(log[1].at - log[0].at >= 85, `press held ${log[1].at - log[0].at} ms`);
      assert.strictEqual(log[0].buttons, 1);
      assert.strictEqual(log[1].buttons, 0);
    });
  });

  it('box says where an element is', async () => {
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(URL_);
      await page.waitFor('document.getElementById("b")');
      const r = await page.box('#b');
      assert.deepStrictEqual([r.x, r.y, r.width, r.height], [40, 40, 120, 40]);
      assert.deepStrictEqual([r.left, r.top, r.right, r.bottom], [40, 40, 160, 80]);
    });
  });

  it('a drag moves a test element by the distance dragged', async () => {
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(URL_);
      await page.waitFor('document.getElementById("pad")');
      await page.drag(350, 90, 450, 140);
      const r = await page.box('#pad');
      assert.deepStrictEqual([r.left, r.top], [400, 90]);
    });
  });

  it('a wheel over a box scrolls it', async () => {
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(URL_);
      await page.waitFor('document.getElementById("box")');
      await page.wheel(100, 250, 120);
      await page.waitFor('document.getElementById("box").scrollTop >= 100');
    });
  });

  it('type puts text into the focused box', async () => {
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(URL_);
      await page.waitFor('document.getElementById("t")');
      await page.click('#t');
      await page.type('Gilt – ünï');
      assert.strictEqual(await page.evaluate('document.getElementById("t").value'), 'Gilt – ünï');
    });
  });

  it('a click lands anywhere along a thin tall element', async () => {
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(URL_);
      await page.waitFor('document.getElementById("rail")');
      const top = await page.click('#rail', { offsetX: 14, offsetY: 4 });
      const bottom = await page.click('#rail', { offsetX: 14, offsetY: 295 });
      assert.ok(top.hit && bottom.hit);
      assert.deepStrictEqual(await page.evaluate('window.hits.rail'), [4, 295]);
    });
  });

  it('a click on an element below the fold scrolls it in and lands', async () => {
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(URL_);
      await page.waitFor('document.getElementById("far")');
      const r = await page.click('#far');
      assert.ok(r.inView && r.hit);
      assert.strictEqual(await page.evaluate('window.hits.far'), 1);
      assert.ok(await page.evaluate('scrollY') > 0);
    });
  });

  it('a click on a covered point reports hit false and the cover gets the click', async () => {
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(URL_);
      await page.waitFor('document.getElementById("b")');
      await page.evaluate('document.getElementById("cover").style.display = "block"');
      const r = await page.click('#b');
      assert.strictEqual(r.hit, false);
      assert.deepStrictEqual(await page.evaluate('window.hits.cover'), 1);
      assert.strictEqual((await page.evaluate('window.log')).length, 0);
    });
  });
});
