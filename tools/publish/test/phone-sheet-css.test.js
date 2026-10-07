const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8').replace(/\r\n/g, '\n');

test('the CoC sheet\'s phone columns can shrink to the sheet (minmax(0,1fr), not bare 1fr)', () => {
  const flat = css.replace(/\s+/g, ' ');
  assert.match(flat, /@media\s*\(max-width:\s*720px\)\s*\{\s*\.coc-sheet-root \.grid-main,[^{]*\.coc-sheet-root \.skills-wrap[^{]*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('the GURPS encumbrance footer is spaced and Reset is styled like the step buttons', () => {
  const flat = css.replace(/\s+/g, ' ');
  assert.match(flat, /\.gl-readout\s*\{[^}]*display:\s*flex[^}]*gap:/);
  assert.match(flat, /\.gl-readout\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(flat, /#gl-reset\s*\{[^}]*border:\s*1px solid var\(--border\)/);
});

test('the PC tab bar shows an edge hint on a phone where it can scroll', () => {
  const flat = css.replace(/\s+/g, ' ');
  const block = flat.match(/@media\s*\(max-width:\s*600px\)\s*\{\s*\.tab-bar\s*\{[^}]*\}\s*\}/);
  assert.ok(block, 'phone rule for .tab-bar');
  assert.match(block[0], /no-repeat local/);
  assert.match(block[0], /no-repeat scroll/);
  assert.match(block[0], /var\(--text\)/, 'the hint follows the theme, so it shows on dark palettes too');
});

test('a table written straight into a tab scrolls inside its own box on a phone', () => {
  const flat = css.replace(/\s+/g, ' ');
  assert.match(flat, /@media\s*\(max-width:\s*600px\)\s*\{\s*\.tab-panel > table\s*\{[^}]*overflow-x:\s*auto/);
});
