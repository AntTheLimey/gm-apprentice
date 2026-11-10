'use strict';
// The vault.images settings: the spec defaults, and a fraction where a whole number is wanted.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSettings } = require('../../lib/settings');
const { writeNewConfig } = require('../helpers/settings-files');

const read = (text) => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'images-'));
  writeNewConfig(v, text);
  return readSettings({ vaultPath: v });
};

test('a vault that sets nothing gets the drawing defaults', () => {
  const r = read('');
  const im = r.values.vault.images;
  assert.equal(im.auto, false);
  assert.equal(im.attempt_limit, 5);
  assert.equal(im.redraws, 1);
  assert.equal(im.run_cap, 200);
  assert.equal(im.month_cap, 2000);
  assert.equal(im.unpriced, false);
  assert.equal(im.guidance, '_Campaign/Image_Guidance.md');
  assert.ok(!im.kinds.includes('pc'));
  assert.ok(im.kinds.includes('scene'));
  assert.deepEqual(r.faults, []);
});

test('a fractional redraw count is a fault naming the setting', () => {
  const r = read('vault:\n  images:\n    redraws: 1.5\n');
  assert.ok(r.faults.some((f) => f.name === 'vault.images.redraws'));
});
