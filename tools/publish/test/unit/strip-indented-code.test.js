const { describe, it } = require('node:test');
const assert = require('node:assert');
const { playerSafeMarkdown } = require('../../lib/processor');

const safe = (text) => playerSafeMarkdown(text, { excludeSections: ['GM Notes'] }).text;

describe('markers in an indented code block are literal, as in a fenced one', () => {
  it('<!-- is kept', () => {
    const got = safe('intro\n\n    <!-- shown -->\n    more\n\nafter <!-- gone -->');
    assert.ok(got.includes('    <!-- shown -->'), got);
    assert.ok(!got.includes('gone'), got);
    assert.ok(got.includes('after'), got);
  });
  it('a comment opened in prose still closes on a line that looks like code', () => {
    assert.strictEqual(safe('a <!--\n\n    x\n-->b'), 'a \n\nb');
  });
  it('an indented line that continues a paragraph is no code: its comment is cut', () => {
    assert.strictEqual(safe('para\n    lazy <!-- gone --> line'), 'para\n    lazy  line');
  });
  it('a gm-only or spoiler marker in indented code is still obeyed: a stray indent must not publish the block', () => {
    for (const name of ['gm-only', 'spoiler']) {
      const got = safe(`intro\n\n    <!-- ${name} -->\n    secret\n    <!-- /${name} -->\n\nafter`);
      assert.ok(!got.includes('secret'), got);
    }
  });
  it('a real block with indented lines inside is still cut', () => {
    const got = safe('a\n\n<!-- gm-only -->\n\n    secret\n\n<!-- /gm-only -->\n\nb');
    assert.ok(!got.includes('secret'), got);
  });
  it('a marker indented under a list item is still obeyed', () => {
    const got = safe('- item\n\n    <!-- gm-only -->\n    secret\n    <!-- /gm-only -->\n\nb');
    assert.ok(!got.includes('secret'), got);
  });
});
