'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findChrome } = require('../lib/chrome');
const { pagesFor } = require('../lib/props/pages-cli');

test('a two-sheet page prints as 2 pages', { skip: findChrome() ? false : 'no Chrome or Chromium found' }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'props-pages-browser-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'two.html'),
    '<!doctype html><style>.sheet{break-after:page;height:200px}</style><div class="sheet">one</div><div class="sheet">two</div>');
  const [row] = pagesFor(dir, ['two.html']);
  assert.equal(row.pages, 2);
});
