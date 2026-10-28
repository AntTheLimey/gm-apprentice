'use strict';
// #363: player_site.theme.fonts.label, a third typeface for the menu, labels, table heads, badges and buttons. It is
// written into theme.css as --font-label and loaded the same three ways as the heading and body faces. Unset, theme.css
// is what it was, and every one of those elements keeps the face it had, inherited or its own.
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

test('unset, the label rule changes no face: no fallback, zero specificity, and own faces kept behind the token', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // The shared rule: a fallback here would force one face on elements that inherit another (a CoC sheet's table head,
  // a backstory's, a site whose overrides set a face on body or a container).
  const rule = css.match(/:where\(([^)]*\bth)\)\s*\{\s*font-family:\s*([^;}]+);?\s*\}/);
  assert.ok(rule, 'the label rule is a :where() rule');
  assert.equal(rule[2].trim(), 'var(--font-label)');
  assert.doesNotMatch(css, /(^|[},])\s*\.top-nav, \.breadcrumbs, \.meta/, 'no specific copy of the label rule');
  // Elements with a face of their own keep it, behind the token.
  assert.match(css, /\.coc-sheet-root table\.weap th\{[^}]*font-family:var\(--font-label, var\(--didone\)\)/);
  assert.match(css, /\.coc-sheet-root \.cr-send\{[^}]*font-family:var\(--font-label, var\(--didone\)\)/);
  // .cr-send's font shorthand would reset the face, so the token is read again after it.
  assert.match(css, /\n\.cr-send \{[^}]*font: inherit;[^}]*font-family: var\(--font-label\);/);
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
