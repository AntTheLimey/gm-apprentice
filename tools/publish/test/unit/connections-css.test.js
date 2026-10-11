'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'style.css'), 'utf8');
const block = css.slice(css.indexOf('/* Connections */'), css.indexOf('/* end Connections */'));

test('the plain lists are hidden only once the script has drawn', () => {
  assert.match(css, /\.cx\.cx-live \.cx-plain\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(css, /(?<!\.cx-live )\.cx-plain\s*\{[^}]*display:\s*none/);
});

test('printing shows the plain lists and hides everything the script drew', () => {
  const print = css.slice(css.lastIndexOf('@media print'));
  assert.match(print, /\.cx \.cx-app\s*\{[^}]*display:\s*none/);
  assert.match(print, /\.cx\.cx-live \.cx-plain\s*\{[^}]*display:\s*block/);
});

test('the tabs, the strip and the key are all inside what printing hides', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'connections.js'), 'utf8');
  assert.match(script, /app\.appendChild\(tablist\)/);
  assert.match(script, /app\.appendChild\(panel\)/);
  assert.match(script, /app\.appendChild\(key\)/);
  assert.match(script, /entry\.panel\.appendChild\(strip\)/);
});

test('a tone is a shape as well as a colour', () => {
  assert.match(css, /\.cx-mark\.cx-warm\s*\{[^}]*background/);
  // hostile is a diamond, not a ring: told from the other two by its outline alone
  assert.match(css, /span\.cx-mark\.cx-hostile\s*\{[^}]*border-radius:\s*0[^}]*transform:\s*rotate\(45deg\)/);
  assert.match(block, /\.cx-edge\.cx-hostile\s*\{[^}]*stroke-dasharray/);
});

test('without the script every colour of the section is the text colour', () => {
  for (const name of ['muted', 'accent', 'warm-ink', 'hostile-ink', 'warm', 'hostile', 'trunk']) {
    assert.match(block, new RegExp(`--cx-${name}:\\s*var\\(--cxi-${name},\\s*var\\(--text\\)\\)`), name);
  }
  assert.doesNotMatch(block, /color-mix/);
});

test('a focused tab or row draws its ring inside itself, where nothing clips it', () => {
  assert.match(block, /\.cx-tab:focus-visible,\s*\.cx-row:focus-visible\s*\{[^}]*outline-offset:\s*-2px/);
});

test('a circle\u2019s radius is an attribute, never a style', () => {
  assert.doesNotMatch(block, /[{;\s]r:\s*\d/);
});

test('every class the section writes has a rule', () => {
  for (const c of ['cx-kind', 'cx-tone', 'cx-line', 'cx-sess', 'cx-mentions', 'cx-tree', 'cx-row', 'cx-web', 'cx-grid', 'cx-card', 'cx-strip', 'cx-key',
    'cx-tabs', 'cx-tab', 'cx-panel', 'cx-tree-wrap', 'cx-lines', 'cx-subject', 'cx-branch', 'cx-group', 'cx-leaves', 'cx-item', 'cx-name', 'cx-meta', 'cx-edge', 'cx-dot', 'cx-wide', 'cx-narrow', 'cx-avatar', 'cx-open', 'cx-mlist']) {
    assert.ok(block.includes(`.${c}`), c);
  }
});

test('the lines drawing is out of the flow, behind the rows, and takes no pointer', () => {
  assert.match(block, /\.cx-tree-wrap\s*\{[^}]*position:\s*relative/);
  assert.match(block, /svg\.cx-lines\s*\{[^}]*position:\s*absolute/);
  assert.match(block, /svg\.cx-lines\s*\{[^}]*pointer-events:\s*none/);
});

test('a hidden panel stays hidden whatever else sets its display', () => {
  assert.match(block, /\.cx-panel\[hidden\]\s*\{[^}]*display:\s*none/);
});

test('tabs scroll sideways inside their own box', () => {
  assert.match(block, /\.cx-tabs\s*\{[^}]*overflow-x:\s*auto/);
});

test('no colour is written as a literal in the Connections block', () => {
  assert.ok(block.length > 500);
  assert.doesNotMatch(block.replace(/var\([^)]*\)/g, ''), /#[0-9a-fA-F]{3,8}\b|rgb\(/);
});
