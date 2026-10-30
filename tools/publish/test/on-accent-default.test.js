'use strict';
// #529: words on an accent-filled button take the page's background colour, as every other accent-filled control's do.
// White on the story page's Begin button and the change-request Send button read at about 2:1 on a light accent.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
const ruleOf = (selector) => {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `${selector} rule`);
  return css.slice(at, css.indexOf('}', at));
};

for (const selector of ['.story-begin', '.cr-send']) {
  test(`${selector} words default to the page background, not white`, () => {
    const color = ruleOf(selector).match(/(?:^|[\s;])color:\s*([^;]+);/);
    assert.ok(color, `${selector} sets a color`);
    assert.match(color[1], /^var\(--on-accent, var\(--bg[,)]/);
  });
}
