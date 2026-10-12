'use strict';
// The to-hit calculator's phone rules and colour discipline, read from the stylesheet.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'style.css'), 'utf8');
const block = css.slice(css.indexOf('/* === To-hit calculator'), css.indexOf('/* === Combat action chains'));
const media = (q) => { const at = block.indexOf(`@media (${q})`); return at < 0 ? '' : block.slice(at, block.indexOf('\n}\n', at)); };

describe('the to-hit calculator stylesheet', () => {
  it('holds no colour literal and no new font', () => {
    assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|font-family/);
  });
  it('lets the answer line stick under the site header on a phone, and lets the card show it', () => {
    const phone = media('max-width: 780px');
    assert.match(phone, /\.tohit \.th-stick\s*{[^}]*position: sticky;[^}]*top: 3\.5rem/);
    assert.match(block, /\.tohit { overflow: visible; }/);
  });
  it('makes the controls at least 40px tall on a phone', () => {
    const phone = media('max-width: 780px');
    for (const sel of ['select', 'input[type="number"]', '.th-actions button', '.th-chip']) assert.ok(phone.includes(sel), sel);
    assert.match(phone, /min-height: 40px/);
    assert.match(phone, /\.tohit \.th-c { min-height: 40px; }/);
  });
  it('wraps the strip to two rows of eight under 360px', () => {
    assert.match(media('max-width: 360px'), /\.th-strip { grid-template-columns: repeat\(8,/);
  });
  it('keeps colour off the subtotals and puts the page text on what a player reads', () => {
    assert.doesNotMatch(block, /th-pos|th-neg/);
    assert.match(block, /\.th-gsum { font-weight: 600; color: var\(--text\)/);
    assert.match(block, /\.th-lbl { font-size: 11\.5px; color: var\(--text\)/);
    assert.match(block, /input::placeholder { color: var\(--text-muted\)/);
  });
});
