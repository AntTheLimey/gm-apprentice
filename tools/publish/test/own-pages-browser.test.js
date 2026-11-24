'use strict';
// A page of the GM's own under the site's menu bar (player_site.own_pages, #850), in a real browser over http, with
// real clicks, keys and wheel turns: the page fills the window below the bar and resizes with it; the bar's menus
// open over it, and Esc and the wheel in them never reach it; a link in it that leaves it opens in the whole window;
// a download link in it downloads; the address's ?query and #fragment reach it; and on a phone the bar takes its folded menu. Skipped without Chrome or
// Chromium (set GM_TEST_CHROME to point at one), except on CI.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../lib/build');
const { writeNewConfig } = require('./helpers/settings-files');
const { browserSkip } = require('./helpers/browser');
const { withPage } = require('./helpers/cdp');

const skip = browserSkip();
const OWN = path.join(__dirname, 'fixtures', 'steps', 'own-page.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'with-dnd-pc');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

// Where the bar ends and the frame begins and ends, the frame's own window, and whether the page scrolls.
const LAYOUT = `(() => {
  const bar = document.querySelector('.top-nav').getBoundingClientRect();
  const f = document.querySelector('.own-page-frame'), r = f.getBoundingClientRect(), d = document.documentElement;
  return { barBottom: bar.bottom, top: r.top, bottom: r.bottom, width: r.width, inner: f.contentWindow.size(),
    window: { w: innerWidth, h: innerHeight }, scrolls: d.scrollHeight > d.clientHeight || d.scrollWidth > d.clientWidth };
})()`;
const FRAME = 'document.querySelector(".own-page-frame").contentWindow';

describe('a page of the GM\'s own under the menu bar, in a browser', { skip }, () => {
  let root; let server; let base; let gmDir;
  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'own-pages-browser-'));
    const vault = path.join(root, 'vault'); const site = path.join(root, 'site');
    fs.cpSync(FIXTURE, vault, { recursive: true });
    fs.mkdirSync(site);
    writeNewConfig(vault, { version: 1, vault: { system: 'dnd-5e-2024' }, player_site: { title: 'T', hide: { folders: ['_meta', '_Templates'] },
      folder_map: { 'Characters/PCs': 'characters/pcs', Creatures: 'creatures', Items: 'items' },
      after_build: [`node ${JSON.stringify(OWN)} map/index.html`], own_pages: ['map/index.html'],
      menu_extra: [{ label: 'Star Map', link: 'map/index.html', group: 'World' }] } });
    const configPath = path.join(site, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ vaultPath: '../vault' }));
    const log = console.log; const warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { build({ configPath, runSteps: true, site: 'player' }); } finally { console.log = log; console.warn = warn; }
    const docs = path.join(site, 'docs');
    server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const top = p.startsWith('/gm/') ? gmDir : docs;
      const file = path.join(top, p.startsWith('/gm/') ? p.slice(3) : p);
      if (!file.startsWith(top) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    // The GM site too, in a folder of its own, which the server serves under /gm/.
    gmDir = path.join(root, 'site-gm');
    writeNewConfig(vault, { version: 1, vault: { system: 'dnd-5e-2024' }, player_site: { title: 'T', hide: { folders: ['_meta', '_Templates'] },
      folder_map: { 'Characters/PCs': 'characters/pcs', Creatures: 'creatures', Items: 'items' },
      after_build: [`node ${JSON.stringify(OWN)} map/index.html`], own_pages: ['map/index.html'],
      menu_extra: [{ label: 'Star Map', link: 'map/index.html', group: 'World' }] },
      gm_site: { publish: true, folder: gmDir, after_build: [`node ${JSON.stringify(OWN)} map/index.html ${JSON.stringify(gmDir)}`], own_pages: ['map/index.html'] } });
    console.log = () => {}; console.warn = () => {};
    try { build({ configPath, runSteps: true, site: 'gm' }); } finally { console.log = log; console.warn = warn; }
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  const open = async (page, hash = '') => {
    await page.goto(`${base}/map/index.html${hash}`);
    await page.waitFor(`document.readyState === "complete" && !!(${FRAME}.size)`);
  };

  it('fills the window below the bar, and resizes with it, the page not scrolling', async () => {
    await withPage({ width: 1280, height: 800 }, async (page) => {
      await open(page);
      let r = await page.evaluate(LAYOUT);
      assert.ok(Math.abs(r.top - r.barBottom) < 1, `the frame starts where the bar ends (${r.top} vs ${r.barBottom})`);
      assert.ok(Math.abs(r.bottom - r.window.h) < 1, `the frame reaches the bottom of the window (${r.bottom} vs ${r.window.h})`);
      assert.equal(Math.round(r.width), r.window.w);
      assert.deepEqual(r.inner, { w: Math.round(r.width), h: Math.round(r.bottom - r.top) }, 'the GM\'s page sees the frame as its window');
      assert.equal(r.scrolls, false);
      await page.resize(1000, 650);
      await page.waitFor(`${FRAME}.size().h < 640`);
      r = await page.evaluate(LAYOUT);
      assert.ok(Math.abs(r.bottom - 650) < 1 && r.inner.w === 1000, JSON.stringify(r));
    });
  });

  it('the menus open over the page, and Esc and the wheel in them never reach it', async () => {
    await withPage({ width: 1280, height: 800 }, async (page) => {
      await open(page);
      // Open World with a real click on its button.
      const WORLD = `[...document.querySelectorAll('.nav-group-toggle')].find((b) => b.textContent.trim() === 'World')`;
      const at = await page.evaluate(`(() => { const t = ${WORLD}; if (!t) return null;
        const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      assert.ok(at, 'the menu has a World group');
      await page.clickAt(at.x, at.y);
      assert.equal(await page.evaluate(`${WORLD}.getAttribute('aria-expanded')`), 'true', 'World opened');
      const link = await page.evaluate(`(() => { const a = [...document.querySelectorAll('.nav-dropdown a')].find((x) => x.textContent.trim() === 'Star Map');
        const r = a.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { shown: r.height > 0, onTop: hit === a, x: r.left + r.width / 2, y: r.top + r.height / 2, overFrame: r.bottom > document.querySelector('.own-page-frame').getBoundingClientRect().top }; })()`);
      assert.ok(link.shown && link.onTop, `the Star Map entry shows above the page (${JSON.stringify(link)})`);
      assert.ok(link.overFrame, 'the open menu reaches down over the framed page');
      await page.wheel(link.x, link.y, 120);
      await page.key('Escape');
      await page.sleep(150);
      const heard = await page.evaluate(`${FRAME}.heard`);
      assert.deepEqual(heard, [], 'the framed page heard nothing');
      assert.equal(await page.evaluate('document.querySelectorAll(".nav-group-toggle[aria-expanded=\\"true\\"]").length'), 0, 'Esc closed the menu');
    });
  });

  it('a link in the page that leaves it opens in the whole window; one within it stays in the frame', async () => {
    await withPage({ width: 1280, height: 800 }, async (page) => {
      await open(page);
      const box = await page.evaluate(`(() => { const f = document.querySelector('.own-page-frame').getBoundingClientRect();
        const pick = (id) => { const r = ${FRAME}.document.getElementById(id).getBoundingClientRect(); return { x: f.left + r.left + r.width / 2, y: f.top + r.top + r.height / 2 }; };
        return { here: pick('here'), home: pick('home'), save: pick('save') }; })()`);
      // A download link downloads: the site page stays as it is.
      await page.clickAt(box.save.x, box.save.y);
      await page.sleep(300);
      assert.equal(await page.evaluate('location.pathname'), '/map/index.html', 'a download link leaves the site page where it is');
      assert.equal(await page.evaluate('!!document.querySelector(".own-page-frame")'), true);
      await page.clickAt(box.here.x, box.here.y);
      await page.waitFor(`${FRAME}.system() === "Eris"`);
      assert.equal(await page.evaluate('location.pathname'), '/map/index.html', 'a link within the page keeps the site page');
      await page.clickAt(box.home.x, box.home.y);
      await page.waitFor('location.pathname === "/index.html" && document.readyState === "complete"');
      assert.equal(await page.evaluate('!!document.querySelector(".own-page-frame")'), false, 'the home page fills the window');
    });
  });

  it('the address\'s ?query and #fragment reach the page, and a new fragment follows', async () => {
    await withPage({ width: 1280, height: 800 }, async (page) => {
      await open(page, '?view=table#Eris%20Belt');
      assert.equal(await page.evaluate(`${FRAME}.system()`), 'Eris Belt');
      assert.equal(await page.evaluate(`${FRAME}.query()`), '?view=table');
      await page.evaluate('location.hash = "#Vale"');
      await page.waitFor(`${FRAME}.system() === "Vale"`);
    });
  });

  it('on the GM site the GM band sits above the frame, the frame filling the rest', async () => {
    await withPage({ width: 1280, height: 800 }, async (page) => {
      await page.goto(`${base}/gm/map/index.html`);
      await page.waitFor(`document.readyState === "complete" && !!(${FRAME}.size)`);
      const r = await page.evaluate(`(() => { const band = document.querySelector('.gm-band').getBoundingClientRect(), f = document.querySelector('.own-page-frame').getBoundingClientRect();
        return { bandBottom: band.bottom, bandWidth: band.width, top: f.top, bottom: f.bottom, width: f.width, w: innerWidth, h: innerHeight }; })()`);
      assert.ok(r.top >= r.bandBottom - 1, `the frame is below the band (${JSON.stringify(r)})`);
      assert.ok(Math.round(r.width) === r.w && Math.round(r.bandWidth) === r.w, `both span the window (${JSON.stringify(r)})`);
      assert.ok(Math.abs(r.bottom - r.h) < 1, `the frame reaches the bottom (${JSON.stringify(r)})`);
    });
  });

  it('on a phone the bar takes its folded menu and the page still fills the rest', async () => {
    await withPage({ width: 390, height: 760 }, async (page) => {
      await open(page);
      const r = await page.evaluate(LAYOUT);
      assert.equal(r.scrolls, false, 'the page does not scroll either way');
      assert.ok(Math.abs(r.top - r.barBottom) < 1 && Math.abs(r.bottom - r.window.h) < 1, JSON.stringify(r));
      assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".nav-mobile-toggle")).display !== "none"'), true);
    });
  });
});
