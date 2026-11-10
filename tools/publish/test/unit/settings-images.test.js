'use strict';
// The vault.images settings: the spec defaults, and a fraction where a whole number is wanted.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSettings } = require('../../lib/settings');
const { writeNewConfig } = require('../helpers/settings-files');
const { runSettings } = require('../../lib/settings/cli');

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
  assert.equal(im.thinking, false);
  assert.equal(im.guidance, '_Campaign/Image_Guidance.md');
  assert.ok(!im.kinds.includes('pc'));
  assert.ok(im.kinds.includes('scene'));
  assert.deepEqual(r.faults, []);
});

test('a fractional redraw count is a fault naming the setting', () => {
  const r = read('vault:\n  images:\n    redraws: 1.5\n');
  assert.ok(r.faults.some((f) => f.name === 'vault.images.redraws'));
});

test('an images count in the state file beside its own keys is no fault', () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'images-'));
  writeNewConfig(v, '');
  fs.writeFileSync(path.join(v, '_meta', 'vault-state.json'), JSON.stringify({
    gm_apprentice_version: '1.12.4',
    images: { months: { '2026-11': { cents: 12.4, pictures: 4, unpriced: 0 } } },
  }));
  const err = [];
  const rc = runSettings({ verb: 'get', args: [], vault: v, json: true }, { out: () => {}, err: (l) => err.push(l) });
  assert.equal(rc, 0);
  assert.deepEqual(err, []);
  assert.deepEqual(readSettings({ vaultPath: v }).faults, []);
});
