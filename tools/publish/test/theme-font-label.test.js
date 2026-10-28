'use strict';
// #363: player_site.theme.fonts.label, a third typeface for the menu, labels, table heads, badges and buttons. It is
// written into theme.css as --font-label (the token every one of those rules reads, falling back to the body face) and
// loaded the same three ways as the heading and body faces. Unset, theme.css is what it was.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { generateThemeCSS, googleFontNames } = require('../lib/theme');
const { selfHostFamilies } = require('../lib/fonts');
const { buildBoth } = require('./helpers/gm-build');

test('a label face is written as --font-label, with or without a palette or genre', () => {
  const palette = generateThemeCSS({ fonts: { heading: 'Cinzel', body: 'Inter', label: 'Share Tech Mono' } });
  assert.match(palette, /--font-label: 'Share Tech Mono', sans-serif;/);
  const genre = generateThemeCSS({ genre: 'scifi', palette: null, fonts: { label: 'Share Tech Mono' } });
  assert.match(genre, /:root \{\n {2}--font-label: 'Share Tech Mono', sans-serif;\n\}/);
  // A generic family is written as itself, as heading and body are.
  assert.match(generateThemeCSS({ fonts: { label: 'monospace' } }), /--font-label: monospace, sans-serif;/);
});

test('the label face is loaded like the others: from Google, self-hosted or local', () => {
  const css = generateThemeCSS({ fonts: { heading: 'Cinzel', label: 'Share Tech Mono' } });
  assert.match(css, /family=Cinzel&family=Share\+Tech\+Mono&display=swap/);
  assert.deepEqual(googleFontNames({ heading: 'Cinzel', body: 'system-ui', label: 'Share Tech Mono' }), ['Cinzel', 'Share Tech Mono']);
  assert.deepEqual(selfHostFamilies({ heading: 'Cinzel', label: 'Share Tech Mono' }), ['Cinzel', 'Share Tech Mono']);
  assert.doesNotMatch(generateThemeCSS({ fonts: { label: 'Share Tech Mono', source: 'local' } }), /googleapis/);
});

test('unset, theme.css is exactly what it was', () => {
  for (const config of [{ fonts: { heading: 'Cinzel', body: 'Inter' } }, { genre: 'horror', palette: null, fonts: {} }, { fonts: {} }]) {
    const withNull = generateThemeCSS({ ...config, fonts: { ...config.fonts, label: null } });
    assert.equal(withNull, generateThemeCSS(config));
    assert.doesNotMatch(withNull, /--font-label/);
  }
});

const sites = [];
after(() => sites.forEach((s) => s.cleanup()));
test('the setting reaches theme.css on both sites, and unset leaves it out', () => {
  const files = { 'NPCs/Mara.md': '---\ntype: npc\n---\nA person.\n' };
  const set = buildBoth(files, { player: { theme: { fonts: { label: 'Share Tech Mono', source: 'local' } } } });
  const unset = buildBoth(files, {});
  sites.push(set, unset);
  assert.match(set.player.read('css', 'theme.css'), /--font-label: 'Share Tech Mono', sans-serif;/);
  assert.match(set.gm.read('css', 'theme.css'), /--font-label: 'Share Tech Mono', sans-serif;/);
  assert.doesNotMatch(unset.player.read('css', 'theme.css'), /--font-label/);
});
