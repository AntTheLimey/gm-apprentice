const { test } = require('node:test');
const assert = require('node:assert');
const { propTextOf, splitSheets, lineClasses, propSheets, linesOfPropHtml } = require('../../lib/props/text');

test('the text is the section under ## The Text', () => {
  const note = ['## Description', 'x', '## the text', '```', 'one', '## The Text', 'two', '```', '### Note', '## Related', 'y'].join('\n');
  const text = propTextOf(note);
  assert.strictEqual(text.mode, 'prose');
  assert.ok(text.markdown.includes('### Note') && !text.markdown.includes('Related'), text.markdown);
  const bare = note.replace('### Note\n', '');
  assert.deepStrictEqual(propTextOf(bare), { mode: 'lines', lines: ['one', '## The Text', 'two'] });
  const hidden = ['```', '## The Text', 'x', '```', '## Related'].join('\n');
  assert.strictEqual(propTextOf(hidden), null);
  const ended = ['## The Text', 'a', '# Next', 'b'].join('\n');
  assert.deepStrictEqual(propTextOf(ended), { mode: 'prose', markdown: 'a' });
});

test('a fence keeps its lines exactly', () => {
  const lines = ['  lead', '\ttab', '<b> & [[x|y]]', 'plain', ''];
  const note = '## The Text\n~~~~text\n' + lines.join('\n') + '\n~~~~\n';
  const text = propTextOf(note);
  assert.deepStrictEqual(text.lines, lines.slice(0, -1));
  const html = propSheets(text, {}).join('');
  assert.deepStrictEqual(linesOfPropHtml(html), lines.slice(0, -1));
  assert.ok(html.includes('[[x|y]]'), html);
  assert.ok(html.includes('&lt;b&gt; &amp;'), html);
});

test('CRLF reads as LF', () => {
  assert.deepStrictEqual(propTextOf('## The Text\r\n```\r\na\r\nb\r\n```\r\n'), { mode: 'lines', lines: ['a', 'b'] });
});

test('prose renders as a page does', () => {
  const text = propTextOf('## The Text\n> **bold** to [[Ada]]\n>\n> more');
  assert.strictEqual(text.mode, 'prose');
  const [html] = propSheets(text, { linkMap: { Ada: 'npcs/ada.html' }, outputPath: 'props/letter.html' });
  assert.ok(html.includes('<strong>bold</strong>'), html);
  assert.ok(html.includes('href="../npcs/ada.html"'), html);
  assert.ok(!html.includes('<blockquote'), html);
  assert.ok(html.startsWith('<div class="prop-text">'), html);
});

test('breaks start sheets', () => {
  assert.deepStrictEqual(splitSheets(['A', '', 'D+12 x', 'B'], ['D+12']), [['A'], ['D+12 x', 'B']]);
  assert.deepStrictEqual(splitSheets(['A', 'B'], [5, null]), [['A', 'B']]);
  const text = { mode: 'prose', markdown: 'one D+12 mid\n\nD+12 two\n```\n\nD+12 in fence\n```' };
  const sheets = propSheets(text, { breaks: ['D+12'], outputPath: 'p/x.html' });
  assert.strictEqual(sheets.length, 2);
  assert.ok(sheets[0].includes('one D+12 mid'), sheets[0]);
  assert.ok(sheets[1].includes('D+12 in fence'), sheets[1]);
});

test('line classes', () => {
  const lines = ['CORVID FINANCIAL', 'Dear sir', '────────', 'AMOUNT ..... 40 CR', '  indented', '────────', 'fine print'];
  const c = lineClasses(lines, {});
  assert.deepStrictEqual(c[0], ['l', 'l-caps', 'l-head', 'l-head1']);
  assert.ok(c[2].includes('l-rule'));
  assert.ok(c[3].includes('l-leader') && c[3].includes('l-caps'));
  assert.ok(c[4].includes('l-indent'));
  assert.ok(c[6].includes('l-fine') && c[6].includes('l-last'));
  assert.ok(!c[1].includes('l-shift'));
  const s = lineClasses(lines, { shift: 'Dear' });
  for (let i = 1; i <= 6; i++) assert.ok(s[i].includes('l-shift'), String(i));
  assert.ok(!s[0].includes('l-shift'));
  const html = propSheets({ mode: 'lines', lines }, {})[0];
  assert.ok(html.includes('<span class="l-key">AMOUNT .....</span> 40 CR'), html);
});

test('no The Text, no text', () => {
  assert.strictEqual(propTextOf('## Description\nx'), null);
  assert.strictEqual(propTextOf('## The Text\n\n  \n## Related\nx'), null);
});
