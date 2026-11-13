'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'style.css'), 'utf8');

test('the CoC weapon-table header sits on the parchment, not on the global th fill (#606)', () => {
  const m = css.match(/\.coc-sheet-root table\.weap th\s*\{([^}]*)\}/);
  assert.ok(m, 'rule exists');
  assert.match(m[1], /background:\s*transparent/);
});

test('a long unbroken code line wraps instead of widening the page (#607)', () => {
  const m = css.match(/(?:^|\n)pre\s*\{([^}]*)\}/);
  assert.ok(m, 'base stylesheet has a pre rule');
  assert.match(m[1], /white-space:\s*pre-wrap/);
  assert.match(m[1], /overflow-wrap:\s*anywhere/);
});
