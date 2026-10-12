'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createRenderer } = require('../lib/markdown');
const { processContent, extractSections } = require('../lib/processor');

const md = createRenderer();
const cells = (html, tag) => [...html.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => m[1].trim());
const render = (src) => { const env = {}; const html = md.render(src, env); return { html, env, widened: env.widenedTables || [] }; };

test('an extra body cell widens the table instead of being dropped', () => {
  const { html } = render('| Skill | Attr | Rank | Mod |\n|---|---|---|---|\n| Nature | WIS | E | +10 | skill feat: Natural Medicine |\n');
  assert.ok(html.includes('skill feat: Natural Medicine'));
  assert.deepStrictEqual(cells(html, 'th'), ['Skill', 'Attr', 'Rank', 'Mod', '']);
});

test('the widest row sets the width; short rows are padded', () => {
  const { html } = render('| a | b |\n|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 | 7 |\n| 8 |\n');
  assert.deepStrictEqual(cells(html, 'th'), ['a', 'b', '', '']);
  assert.ok(html.includes('7'));
  assert.deepStrictEqual(cells(html, 'td').slice(-4), ['8', '', '', '']);
});

test('a well-formed table renders exactly as before and records nothing', () => {
  const src = '| a | b |\n|---|:-:|\n| 1 | 2 |\n| 3 |\n';
  const { html, widened } = render(src);
  assert.deepStrictEqual(cells(html, 'th'), ['a', 'b']);
  assert.deepStrictEqual(widened, []);
  assert.strictEqual(html, new (require('markdown-it'))({ html: false, typographer: true }).render(src));
});

test('alignment colons survive on the existing columns', () => {
  const { html } = render('| a | b |\n|:--|--:|\n| 1 | 2 | 3 |\n');
  assert.ok(html.includes('text-align:left'));
  assert.ok(html.includes('text-align:right'));
});

test('rows without outer pipes widen too', () => {
  const { html } = render('a | b\n--|--\n1 | 2 | 3\n');
  assert.ok(html.includes('3'));
  assert.strictEqual(cells(html, 'th').length, 3);
});

test('only a backslash escapes a pipe: a pipe in a code span is a cell break, as in the renderer', () => {
  const { html } = render('| a | b |\n|---|---|\n| `p|q` | z |\n');
  assert.ok(html.includes('>z<'), html);
  assert.strictEqual(cells(html, 'th').length, 3);
});

test('an escaped pipe is not a cell break', () => {
  const { html, widened } = render('| a | b |\n|---|---|\n| x \\| y | `a\\|b` |\n');
  assert.deepStrictEqual(widened, []);
  assert.strictEqual(cells(html, 'th').length, 2);
});

test('code fences and indented code are left alone', () => {
  for (const src of [
    '```\n| a | b |\n|---|---|\n| 1 | 2 | 3 |\n```\n',
    '~~~\n| a | b |\n|---|---|\n| 1 | 2 | 3 |\n~~~\n',
    'text\n\n    | a | b |\n    |---|---|\n    | 1 | 2 | 3 |\n',
  ]) {
    const { html, widened } = render(src);
    assert.deepStrictEqual(widened, []);
    assert.ok(!html.includes('<table>'));
  }
});

test('a table in a callout or blockquote widens', () => {
  const { html } = render('> [!note] Skills\n> | a | b |\n> |---|---|\n> | 1 | 2 | 3 |\n');
  assert.ok(html.includes('callout'));
  assert.strictEqual(cells(html, 'th').length, 3);
  assert.ok(html.includes('>3<'));
});

test('a table in a list item widens', () => {
  const { html } = render('- item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 | 3 |\n');
  assert.strictEqual(cells(html, 'th').length, 3);
});

test('a heading or list line with pipes straight after a table does not widen it', () => {
  for (const tail of ['# H | x | y', '- item | x | y', '> q | x | y', '---', '```\na | b | c']) {
    const { widened, html } = render(`| a | b |\n|---|---|\n| 1 | 2 |\n${tail}\n`);
    assert.deepStrictEqual(widened, [], tail);
    assert.strictEqual(cells(html, 'th').length, 2, tail);
  }
});

test('fences as the renderer reads them: an unclosed fence in a quote ends with the quote', () => {
  const { widened } = render('> ```\n> code\n\n| a |\n|---|\n| 1 | 2 |\n');
  assert.strictEqual(widened.length, 1);
});

test('a line with three backticks inside text is not a fence', () => {
  const { widened } = render('```not a fence``` here\n\n| a |\n|---|\n| 1 | 2 |\n');
  assert.strictEqual(widened.length, 1);
});

test('an indented ``` does not close a fence', () => {
  const { widened } = render('```\nx\n    ```\n| a |\n|---|\n| 1 | 2 |\n```\n');
  assert.deepStrictEqual(widened, []);
});

test('an empty trailing cell is not over-wide', () => {
  const { html, widened } = render('| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 | |\n| 4 | 5 | 6 |  |  |\n');
  assert.deepStrictEqual(widened, []);
  assert.strictEqual(cells(html, 'th').length, 3);
});

test('CRLF source widens too', () => {
  const { html } = render('| a | b |\r\n|---|---|\r\n| 1 | 2 | 3 |\r\n');
  assert.strictEqual(cells(html, 'th').length, 3);
});

test('a row of 50,000 backticks is fast', () => {
  const t = Date.now();
  render('| a | b |\n|---|---|\n| ' + '`'.repeat(50000) + ' | 2 |\n');
  assert.ok(Date.now() - t < 500);
});

const page = (markdown) => ({ markdown, outputPath: 'x.html', frontmatter: {} });

test('the build is told once per table, with the count of rows and the first one named in plain text', () => {
  const rows = Array.from({ length: 50 }, (_, i) => `| [[Lord Edric]] ${i} | 2 | 3 |`).join('\n');
  const { html, warnings } = processContent(page(`| a | b |\n|---|---|\n${rows}\n`), { 'Lord Edric': 'npcs/lord-edric.html' }, [], {});
  assert.ok(html.includes('>3<'));
  const w = warnings.filter(x => /widened/.test(x));
  assert.strictEqual(w.length, 1, w.join('\n'));
  assert.ok(/50 rows/.test(w[0]), w[0]);
  assert.ok(/Lord Edric 0/.test(w[0]) && !/\]\(/.test(w[0]), w[0]);
});

test('one over-wide row is named', () => {
  const { warnings } = processContent(page('| a | b |\n|---|---|\n| Nature | 2 | 3 |\n'), {}, [], {});
  assert.ok(warnings.some(w => /Nature/.test(w) && /1 row\b/.test(w)), warnings.join('|'));
});

test('a table with no over-wide row gives no warning', () => {
  const { warnings } = processContent(page('| a | b |\n|---|---|\n| 1 | 2 |\n# H | x | y\n'), {}, [], {});
  assert.deepStrictEqual(warnings.filter(w => /widened/.test(w)), []);
});

test('a row inside a gm-only block never comes back', () => {
  const { html, warnings } = processContent(page('| a | b |\n|---|---|\n| 1 | 2 |\n<!-- gm-only -->\n| secret | s | s3 |\n<!-- /gm-only -->\n'), {}, [], {});
  assert.ok(!html.includes('secret'));
  assert.ok(!warnings.join('').includes('secret'));
});

test('extractSections renders widened tables', () => {
  const [s] = extractSections('## Skills\n| a | b |\n|---|---|\n| 1 | 2 | 3 |\n');
  assert.ok(s.html.includes('3'));
});

test('the table rule is found and replaced through the public ruler API only', () => {
  // markdown-it offers no public way to read a rule by name, so the plugin finds the `table` function
  // in the public chain `getRules('paragraph')` and replaces it with `ruler.at`. If an upgrade
  // changes that chain, this test and the plugin's own check fail loudly.
  const plain = new (require('markdown-it'))();
  assert.ok(plain.block.ruler.getRules('paragraph').some(f => f.name === 'table'));
  assert.ok(plain.block.ruler.getRules('reference').some(f => f.name === 'table'));
  assert.ok(md.block.ruler.getRules('paragraph').some(f => f.name === 'table'));
  assert.strictEqual(md.block.ruler.getRules('paragraph').filter(f => f.name === 'table').length, 1);
  const src = fs_read('../lib/markdown.js');
  assert.ok(!src.includes('__rules__'));
});
function fs_read(rel) { return require('fs').readFileSync(require('path').join(__dirname, rel), 'utf8'); }
