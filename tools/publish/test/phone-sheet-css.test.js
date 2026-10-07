const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8').replace(/\r\n/g, '\n');

test('the CoC sheet\'s phone columns can shrink to the sheet (minmax(0,1fr), not bare 1fr)', () => {
  assert.match(css, /@media \(max-width:720px\)\{\n  \.coc-sheet-root \.grid-main, \.coc-sheet-root \.skills-wrap[^{]*\{ grid-template-columns:minmax\(0,1fr\);\}/);
});

test('the GURPS encumbrance footer is spaced and Reset is styled like the step buttons', () => {
  assert.match(css, /\.gl-readout \{ display: flex; flex-wrap: wrap;[^}]*gap:/);
  assert.match(css, /\.gl-readout\[hidden\] \{ display: none; \}/);
  assert.match(css, /#gl-reset \{[^}]*border: 1px solid var\(--border\)/);
});

test('the PC tab bar shows an edge shadow on a phone where it can scroll', () => {
  const block = css.match(/@media \(max-width: 600px\) \{\n  \.tab-bar \{[\s\S]*?\n  \}\n\}/);
  assert.ok(block, 'phone rule for .tab-bar');
  assert.match(block[0], /no-repeat local/);
  assert.match(block[0], /no-repeat scroll/);
});
