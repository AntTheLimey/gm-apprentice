const { describe, it } = require('node:test');
const assert = require('node:assert');
const { playerSafeMarkdown, strippedLines, processContent } = require('../../lib/processor');

const safe = (text, opts = {}) => playerSafeMarkdown(text, { excludeSections: ['GM Notes'], ...opts }).text;

describe('cutting a block keeps the meaning of the lines around it', () => {
  const blocks = {
    'gm-only': '<!-- gm-only -->\nx\n<!-- /gm-only -->',
    spoiler: '<!-- spoiler -->\nx\n<!-- /spoiler -->',
    dataview: '```dataview\nLIST\n```',
  };
  for (const [name, block] of Object.entries(blocks)) {
    for (const rule of ['---', '===']) {
      it(`${name} between a paragraph and ${rule} does not make a heading`, () => {
        assert.strictEqual(safe(`text\n${block}\n${rule}`), `text\n\n${rule}`);
        const html = processContent({ markdown: `text\n${block}\n${rule}\nafter`, frontmatter: {}, outputPath: 'a.html' }, {}, []).html;
        assert.ok(!/<h[12]/.test(html), html);
      });
    }
  }
  it('a marker pair opened after text on its line does not make a heading either', () => {
    assert.strictEqual(safe('text <!-- gm-only -->\nx\n<!-- /gm-only -->\n---'), 'text \n\n---');
    assert.strictEqual(safe('text <!-- spoiler -->\nx\n<!-- /spoiler -->\n==='), 'text \n\n===');
  });
  it('a callout between a paragraph and --- does not make a heading', () => {
    assert.strictEqual(safe('text\n> [!note] t\n> body\n---', { excludeCallouts: true }), 'text\n\n---');
    assert.strictEqual(safe('text\n\n> [!note] t\n> body\n---', { excludeCallouts: true }), 'text\n\n---');
  });
  it('the line map points the kept blank at a cut line', () => {
    const { lines, from } = strippedLines('text\n<!-- gm-only -->\nx\n<!-- /gm-only -->\n---', false);
    assert.deepStrictEqual(lines, ['text', '', '---']);
    assert.deepStrictEqual(from, [0, 1, 4]);
  });
});
