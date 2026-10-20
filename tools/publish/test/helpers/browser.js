'use strict';
// A real browser for the few checks a vm cannot make (layout: wrapping, stacking, measured lines). It drives an
// installed Chrome or Chromium straight from the command line (no npm package): the page under test is shown in an
// iframe of the width asked for, so its media queries see that width, a probe script written into the page measures it,
// and `--dump-dom` carries the answer out. Without a browser the test is skipped, and says so; CI's runners have one.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CANDIDATES = [
  process.env.GM_TEST_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome',
].filter(Boolean);

function findChrome() {
  for (const c of CANDIDATES) {
    if (c.includes('/') ? fs.existsSync(c) : spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0) return c;
  }
  return null;
}

// `script` runs in the page once it has loaded, with `done(result)` to call with a JSON-able answer. A page error
// raised at any time is added to the result as `errors`. Returns the result.
function measure(pagePath, width, script, { height = 900, wait = 6000 } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error('no browser');
  const dir = path.dirname(pagePath);
  const probed = path.join(dir, '__probe.html');
  let html = fs.readFileSync(pagePath, 'utf8');
  const head = '<script>window.__errors=[];window.addEventListener("error",function(e){window.__errors.push(String(e.message))});</script>';
  const tail = `<script>window.addEventListener('load',function(){var finish=function(r){r=r||{};r.errors=window.__errors;`
    + `var p=document.createElement('pre');p.id='probe';p.textContent=JSON.stringify(r);document.body.appendChild(p);};`
    + `setTimeout(function(){(${script})(finish);},600);});</script>`;
  html = html.replace('<head>', `<head>${head}`).replace('</body>', `${tail}</body>`);
  fs.writeFileSync(probed, html);
  const harness = path.join(dir, '__harness.html');
  fs.writeFileSync(harness, `<!doctype html><body style="margin:0"><iframe id="f" src="__probe.html" style="border:0;width:${width}px;height:${height}px"></iframe>`
    + `<pre id="out"></pre><script>var t=setInterval(function(){try{var p=document.getElementById('f').contentDocument.getElementById('probe');`
    + `if(p){document.getElementById('out').textContent='RESULT'+p.textContent+'END';clearInterval(t);}}catch(e){document.getElementById('out').textContent='RESULT'+JSON.stringify({harnessError:String(e)})+'END';clearInterval(t);}},100);</script>`);
  const run = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files', '--window-size=1200,1000',
    `--virtual-time-budget=${wait}`, '--dump-dom', `file://${harness}`], { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'ignore'] });
  const m = /RESULT([\s\S]*?)END/.exec(run.stdout || '');
  if (!m) throw new Error(`the browser gave no answer (status ${run.status})`);
  const text = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.parse(text);
}

module.exports = { findChrome, measure };
