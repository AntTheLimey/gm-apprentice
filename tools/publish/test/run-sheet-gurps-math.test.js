'use strict';
// The shared GURPS maths (step 6b Task 4): UMD, so the page, the reducer and the reader all load the one file.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FILE = path.join(__dirname, '..', 'lib', 'run-sheet', 'web', 'gurps-math.js');
const G = require('../lib/run-sheet/web/gurps-math');

describe('deriveGurps', () => {
  it('works out HP from ST, FP from HT and Basic Speed from DX and HT', () => {
    // step 6b Task 14 changed this on purpose: Dodge is worked out from Basic Speed, marked
    assert.deepEqual(G.deriveGurps({ st: 10, dx: 10, ht: 10 }, {}), { max: 10, fpMax: 10, speed: 5, dodge: 8, from: { hp: 'from ST', fp: 'from HT', speed: 'from DX and HT', dodge: 'from Speed' } });
  });
  it('keeps a speed to two decimals', () => {
    assert.equal(G.deriveGurps({ st: 9, dx: 11, ht: 10 }, {}).speed, 5.25);
    assert.equal(G.deriveGurps({ dx: 12, ht: 11 }, {}).speed, 5.75);
  });
  it('leaves out a figure that was typed, and one whose inputs are missing', () => {
    // step 6b Task 14 changed this on purpose: Dodge is worked out from Basic Speed, marked
    assert.deepEqual(G.deriveGurps({ st: 12, dx: 10, ht: 10 }, { max: true }), { fpMax: 10, speed: 5, dodge: 8, from: { fp: 'from HT', speed: 'from DX and HT', dodge: 'from Speed' } });
    assert.deepEqual(G.deriveGurps({ st: 12, dx: 10, ht: 10 }, ['max', 'fpMax', 'speed', 'dodge']), { from: {} });
    assert.deepEqual(G.deriveGurps({ ht: 10 }, {}), { fpMax: 10, from: { fp: 'from HT' } });
    assert.deepEqual(G.deriveGurps({}, {}), { from: {} });
    assert.deepEqual(G.deriveGurps(null, null), { from: {} });
  });
  it('a zero ST is an input, a non-number is not', () => {
    assert.deepEqual(G.deriveGurps({ st: '10', dx: NaN, ht: null }, {}), { from: {} });
  });
  it('a zero ST gives HP 0', () => {
    assert.equal(G.deriveGurps({ st: 0 }, {}).max, 0);
  });
  it('loads in a page with no module system, as window.RunSheetGurpsMath', () => {
    const win = {};
    vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { self: win });
    assert.equal(typeof win.RunSheetGurpsMath.deriveGurps, 'function');
    assert.equal(win.RunSheetGurpsMath.deriveGurps({ st: 8 }, {}).max, 8);
  });
  it('has no Node-only require', () => {
    assert.doesNotMatch(fs.readFileSync(FILE, 'utf8'), /\brequire\s*\(/);
  });
});

describe('the page serves it', () => {
  it('gm.html loads it before fight.js', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'lib', 'run-sheet', 'web', 'gm.html'), 'utf8');
    const a = html.indexOf('/web/gurps-math.js');
    assert.ok(a > 0);
    assert.ok(a < html.indexOf('/web/fight.js'));
  });
});
