'use strict';
// The to-hit calculator's colour discipline, read from the stylesheet. Its phone layout is
// measured in a browser: test/tohit-phone-browser.test.js.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'style.css'), 'utf8');
const block = css.slice(css.indexOf('/* === To-hit calculator'), css.indexOf('/* === Combat action chains'));

describe('the to-hit calculator stylesheet', () => {
  it('holds no colour literal and no new font', () => {
    assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|font-family/);
  });
  it('keeps colour off the subtotals and puts the page text on what a player reads', () => {
    assert.doesNotMatch(block, /th-pos|th-neg/);
    assert.match(block, /\.th-gsum { font-weight: 600; color: var\(--text\)/);
    assert.match(block, /\.th-lbl { font-size: 11\.5px; color: var\(--text\)/);
    assert.match(block, /input::placeholder { color: var\(--text-muted\)/);
  });
});
