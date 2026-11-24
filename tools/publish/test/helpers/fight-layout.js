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

// Where focus is: the control's first data-f attribute and its value ("data-fini=<id>"), else '#<id>', its tag, or 'body'.
const where = (page) => page.evaluate(`(() => { const a = document.activeElement; if (!a || a === document.body) return 'body';
  const x = Array.from(a.attributes).find((n) => n.name.startsWith('data-f')); return x ? x.name + '=' + x.value : (a.id ? '#' + a.id : a.tagName); })()`);
// The focused box's words and selection: [value, selectionStart, selectionEnd], or null.
const picked = (page) => page.evaluate('(() => { const a = document.activeElement; return a && typeof a.selectionStart === "number" ? [a.value, a.selectionStart, a.selectionEnd] : null; })()');
// A rail jump's landing (Task 23 fix round 1): the target's top against the sticky bar's bottom, and in a fight the
// pane's top under its own bar.
const landing = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const bar = document.querySelector('.top').getBoundingClientRect().bottom;
  const sheet = document.querySelector('#sheet'); const rbar = sheet && sheet.querySelector('.rbar');
  return { top: e.getBoundingClientRect().top, bar, sheetTop: sheet.getBoundingClientRect().top, rbar: rbar ? rbar.offsetHeight : 0,
    scrollY, sheetScroll: sheet.scrollTop, maxY: document.documentElement.scrollHeight - innerHeight, maxSheet: sheet.scrollHeight - sheet.clientHeight }; })()`);

module.exports = { sane, where, picked, landing };
