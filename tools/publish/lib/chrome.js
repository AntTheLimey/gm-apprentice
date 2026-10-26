'use strict';
// An installed Chrome or Chromium, found by path or on PATH. The tests' browser helper and `props pages` both ask here.
const fs = require('node:fs');
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

module.exports = { findChrome };
