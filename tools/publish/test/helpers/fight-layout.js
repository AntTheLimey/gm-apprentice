'use strict';
// What every fight layout test holds (plan 6a Task 10), shared by the layout and the systems browser tests: no row
// clipped, no sideways scroll, the probe's layout fields there, no script errors. `p` is the page's probe.
const assert = require('node:assert');

function sane(p, where = '') {
  const l = p.layout;
  assert.ok(l, `${where}: a layout in the probe`);
  for (const k of ['railW', 'sheetW', 'paneTop']) assert.strictEqual(typeof l[k], 'number', `${where}: layout.${k}`);
  for (const k of ['folded', 'pvOpen']) assert.strictEqual(typeof l[k], 'boolean', `${where}: layout.${k}`);
  assert.ok(l.grip && typeof l.grip.shown === 'boolean', `${where}: layout.grip`);
  assert.ok('pvTop' in l && 'pvBottom' in l && 'cutTop' in l, `${where}: layout.pvTop, pvBottom, cutTop`);
  const over = (l.rows || []).filter((r) => r.over);
  assert.deepStrictEqual(over.map((r) => r.name), [], `${where}: rows clipped`);
  assert.strictEqual(l.wide, false, `${where}: the page scrolls sideways`);
  assert.deepStrictEqual(p.errors, [], `${where}: script errors`);
}

module.exports = { sane };
