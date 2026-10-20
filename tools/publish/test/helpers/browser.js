'use strict';
// A real browser for the few checks a vm cannot make (layout: wrapping, stacking, measured lines). It drives an
// installed Chrome or Chromium straight from the command line (no npm package): the page under test is shown in an
// iframe of the width asked for, so its media queries see that width, a probe script written into the page measures it,
// and `--dump-dom` carries the answer out. Without a browser the test is skipped, and says so, except on CI, where
// it fails: CI's runners have one, and a check that skips there is a check that never runs.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CANDIDATES = [
  process.env.GM_TEST_CHROME,
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome',
].filter(Boolean);

function findChrome() {
  for (const c of CANDIDATES) {
    if (/[\\/]/.test(c) ? fs.existsSync(c) : spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0) return c;
  }
  return null;
}

// The `skip` for a browser check: a reason without a browser, but never on CI, where the check runs and fails;
// except on the Windows CI runner, where it is always skipped. The checks test Chrome's layout, which is the same
// engine on every system; the Windows job is there for path and shell problems, and a Chrome start there is slow
// enough to slow every test beside it. `platform`, `env` and `chrome` are given to the helper's own test.
function browserSkip({ platform = process.platform, env = process.env, chrome = findChrome } = {}) {
  if (platform === 'win32' && env.CI) return 'real-browser layout checks run on the Mac and Ubuntu CI jobs: the layout engine is the same on Windows, and a Chrome start on the Windows runner slows every test beside it';
  return chrome() || env.CI ? false : 'no Chrome or Chromium found (set GM_TEST_CHROME to point at one)';
}

// A file URL that also works for a Windows path.
const fileUrl = (p) => `file://${p.replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}`;

// `script` runs in the page once it has loaded, with `done(result)` to call with a JSON-able answer. A page error
// raised at any time is added to the result as `errors`. Returns the result. Given a list of pages (all in one
// folder), one launch of the browser measures each, side by side, and the results come back as a list.
function measure(pagePaths, width, script, { height = 900, wait = 6000 } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error('no browser');
  const pages = [].concat(pagePaths);
  const dir = path.dirname(pages[0]);
  // A phone's scrollbars overlay the page; a desktop Chrome's (Linux, Windows) take 15px of the width.
  const head = '<style>::-webkit-scrollbar{width:0;height:0}</style><script>window.__errors=[];window.addEventListener("error",function(e){window.__errors.push(String(e.message))});</script>';
  const tail = `<script>window.addEventListener('load',function(){var finish=function(r){r=r||{};r.errors=window.__errors;`
    + `var p=document.createElement('pre');p.id='probe';p.textContent=JSON.stringify(r);document.body.appendChild(p);};`
    + `setTimeout(function(){(${script})(finish);},600);});</script>`;
  pages.forEach((page, n) => {
    if (path.dirname(page) !== dir) throw new Error('measure: the pages must share a folder');
    const html = fs.readFileSync(page, 'utf8').replace('<head>', `<head>${head}`).replace('</body>', `${tail}</body>`);
    fs.writeFileSync(path.join(dir, `__probe${n}.html`), html);
  });
  const frames = pages.map((_, n) => `<iframe src="__probe${n}.html" style="display:block;border:0;width:${width}px;height:${height}px"></iframe>`).join('');
  const harness = path.join(dir, '__harness.html');
  fs.writeFileSync(harness, `<!doctype html><body style="margin:0">${frames}`
    + `<pre id="out"></pre><script>var t=setInterval(function(){try{var got=[].map.call(document.querySelectorAll('iframe'),function(f){var p=f.contentDocument.getElementById('probe');return p&&p.textContent;});`
    + `if(got.every(Boolean)){document.getElementById('out').textContent='RESULT['+got.join(',')+']END';clearInterval(t);}}catch(e){document.getElementById('out').textContent='RESULT['+JSON.stringify({harnessError:String(e)})+']END';clearInterval(t);}},100);</script>`);
  const run = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files', '--window-size=1200,1000',
    `--virtual-time-budget=${wait}`, '--dump-dom', fileUrl(harness)], { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'ignore'] });
  const m = /RESULT([\s\S]*?)END/.exec(run.stdout || '');
  if (!m) throw new Error(`the browser gave no answer (status ${run.status})`);
  const text = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const results = JSON.parse(text);
  return Array.isArray(pagePaths) ? results : results[0];
}

module.exports = { findChrome, browserSkip, measure };
