'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createRenderer, widenTables } = require('../lib/markdown');
const { processContent, extractSections } = require('../lib/processor');

const md = createRenderer();
const cells = (html, tag) => [...html.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => m[1].trim());

test('an extra body cell widens the table instead of being dropped', () => {
  const html = md.render('| Skill | Attr | Rank | Mod |\n|---|---|---|---|\n| Nature | WIS | E | +10 | skill feat: Natural Medicine |\n');
  assert.ok(html.includes('skill feat: Natural Medicine'));
  assert.deepStrictEqual(cells(html, 'th'), ['Skill', 'Attr', 'Rank', 'Mod', '']);
});

test('the widest row sets the width; short rows stay short', () => {
  const html = md.render('| a | b |\n|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 | 7 |\n| 8 |\n');
  assert.deepStrictEqual(cells(html, 'th'), ['a', 'b', '', '']);
  assert.ok(html.includes('7'));
});

test('a well-formed table is left byte for byte', () => {
  const t = '| a | b |\n|---|:-:|\n| 1 | 2 |\n| 3 |\n';
  assert.strictEqual(widenTables(t).text, t);
  assert.deepStrictEqual(widenTables(t).widened, []);
});

test('alignment colons survive and the new delimiter cells are plain', () => {
  const { text } = widenTables('| a | b |\n|:--|--:|\n| 1 | 2 | 3 |\n');
  assert.strictEqual(text, '| a | b | |\n|:--|--:| --- |\n| 1 | 2 | 3 |\n');
});

test('rows without outer pipes widen too', () => {
  const html = md.render('a | b\n--|--\n1 | 2 | 3\n');
  assert.ok(html.includes('3'));
  assert.strictEqual(cells(html, 'th').length, 3);
});

test('an escaped pipe, a pipe in a link alias and a pipe in a code span are not cell breaks', () => {
  const t = '| a | b |\n|---|---|\n| x \\| y | [[Note|alias]] |\n| `p|q` | z |\n';
  assert.strictEqual(widenTables(t).text, t);
});

test('code fences and indented code are left alone', () => {
  const fenced = '```\n| a | b |\n|---|---|\n| 1 | 2 | 3 |\n```\n';
  assert.strictEqual(widenTables(fenced).text, fenced);
  const tilde = '~~~\n| a | b |\n|---|---|\n| 1 | 2 | 3 |\n~~~\n';
  assert.strictEqual(widenTables(tilde).text, tilde);
  const indented = 'text\n\n    | a | b |\n    |---|---|\n    | 1 | 2 | 3 |\n';
  assert.strictEqual(widenTables(indented).text, indented);
});

test('a table in a callout or blockquote widens', () => {
  const html = md.render('> [!note] Skills\n> | a | b |\n> |---|---|\n> | 1 | 2 | 3 |\n');
  assert.ok(html.includes('callout'));
  assert.ok(html.includes('3'));
  assert.strictEqual(cells(html, 'th').length, 3);
});

test('a table in a list item widens', () => {
  const html = md.render('- item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 | 3 |\n');
  assert.strictEqual(cells(html, 'th').length, 3);
});

test('a table after a fence that closed still widens', () => {
  const { widened } = widenTables('```\ncode\n```\n\n| a |\n|---|\n| 1 | 2 |\n');
  assert.strictEqual(widened.length, 1);
});

test('a delimiter row of the wrong width is not a table: untouched', () => {
  const t = '| a | b |\n|---|\n| 1 | 2 | 3 |\n';
  assert.strictEqual(widenTables(t).text, t);
});

test('the build is told which row was widened', () => {
  const page = { markdown: '| a | b |\n|---|---|\n| Nature | 2 | 3 |\n', outputPath: 'x.html', frontmatter: {} };
  const { html, warnings } = processContent(page, {}, [], {});
  assert.ok(html.includes('>3<'));
  assert.ok(warnings.some(w => /Nature/.test(w) && /3 cells/.test(w) && /2/.test(w)), warnings.join('|'));
});

test('a row inside a gm-only block never comes back', () => {
  const page = { markdown: '| a | b |\n|---|---|\n| 1 | 2 |\n<!-- gm-only -->\n| secret | s | s3 |\n<!-- /gm-only -->\n', outputPath: 'x.html', frontmatter: {} };
  const { html } = processContent(page, {}, [], {});
  assert.ok(!html.includes('secret'));
});

test('extractSections renders widened tables', () => {
  const [s] = extractSections('## Skills\n| a | b |\n|---|---|\n| 1 | 2 | 3 |\n');
  assert.ok(s.html.includes('3'));
});
