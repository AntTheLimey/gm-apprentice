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
    assert.deepEqual(G.deriveGurps({ st: 10, dx: 10, ht: 10 }, {}), { max: 10, fpMax: 10, speed: 5, from: { hp: 'from ST', fp: 'from HT', speed: 'from DX and HT' } });
  });
  it('keeps a speed to two decimals', () => {
    assert.equal(G.deriveGurps({ st: 9, dx: 11, ht: 10 }, {}).speed, 5.25);
    assert.equal(G.deriveGurps({ dx: 12, ht: 11 }, {}).speed, 5.75);
  });
  it('leaves out a figure that was typed, and one whose inputs are missing', () => {
    assert.deepEqual(G.deriveGurps({ st: 12, dx: 10, ht: 10 }, { max: true }), { fpMax: 10, speed: 5, from: { fp: 'from HT', speed: 'from DX and HT' } });
    assert.deepEqual(G.deriveGurps({ st: 12, dx: 10, ht: 10 }, ['max', 'fpMax', 'speed']), { from: {} });
    assert.deepEqual(G.deriveGurps({ ht: 10 }, {}), { fpMax: 10, from: { fp: 'from HT' } });
    assert.deepEqual(G.deriveGurps({}, {}), { from: {} });
    assert.deepEqual(G.deriveGurps(null, null), { from: {} });
  });
  it('a typed zero or a non-number input is not an input', () => {
    assert.deepEqual(G.deriveGurps({ st: '10', dx: NaN, ht: null }, {}), { from: {} });
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
