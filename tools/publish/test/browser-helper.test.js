'use strict';
// When the real-browser checks run (test/helpers/browser.js browserSkip): skipped on the Windows CI runner, failing
// rather than skipping on any other CI without a browser, skipped with a reason off CI without one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserSkip } = require('./helpers/browser');

const found = () => '/usr/bin/chromium';
const none = () => null;

test('the Windows CI runner skips the browser checks, with the reason, browser or no browser', () => {
  for (const chrome of [found, none]) {
    const why = browserSkip({ platform: 'win32', env: { CI: 'true' }, chrome });
    assert.match(why, /same on Windows/);
    assert.match(why, /slows every test/);
  }
});

test('CI on Mac and Ubuntu runs the checks, and so fails when no browser is there', () => {
  for (const platform of ['darwin', 'linux']) {
    assert.equal(browserSkip({ platform, env: { CI: 'true' }, chrome: none }), false, platform);
    assert.equal(browserSkip({ platform, env: { CI: 'true' }, chrome: found }), false, platform);
  }
});

test('off CI the checks run where a browser is found and are skipped, with a reason, where none is', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.equal(browserSkip({ platform, env: {}, chrome: found }), false, platform);
    assert.match(browserSkip({ platform, env: {}, chrome: none }), /no Chrome or Chromium found/, platform);
  }
});
