'use strict';
// `sidebar-badge` styled the removed Connections sidebar (#334); no rule is left for it, so
// no template may print it (#345).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}

test('no template prints a sidebar-badge span and no stylesheet is missing its rule', () => {
  const root = path.join(__dirname, '..', '..');
  const css = walk(path.join(root, 'css')).filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.ok(!css.includes('sidebar-badge'));
  for (const file of walk(path.join(root, 'lib')).filter((f) => f.endsWith('.js'))) {
    assert.ok(!fs.readFileSync(file, 'utf8').includes('sidebar-badge'), `${path.relative(root, file)} still prints sidebar-badge`);
  }
});
