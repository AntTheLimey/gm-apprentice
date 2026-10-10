const { describe, it } = require('node:test');
const assert = require('node:assert');
const { playerSafeMarkdown, renderMarkdown } = require('../../lib/processor');

const safe = (text) => playerSafeMarkdown(text, { excludeSections: ['GM Notes'] }).text;
const page = (text) => renderMarkdown(safe(text));

// Indenting a line four spaces (or a tab) makes it code to the renderer. It never makes a
// comment literal: hiding too much is the safe side, and a comment that opens on an
// indented line runs on over lines that are not code. Only a fenced block shows a marker.
describe('a comment is cut whether or not it sits in indented code', () => {
  const SHAPES = [
    ['an HTML comment opened on an indented line, text and closer at the margin', 'Para.\n\n    <!--\nSECRET one\n-->\n\nAfter.'],
    ['a %% comment opened on a tab-indented line, text and closer at the margin', 'Para.\n\n\t%% note to self\nSECRET two\n%%\n\nAfter.'],
    ['a whole HTML comment in an indented block', 'Para.\n\n    <!-- SECRET three -->\n\nAfter.'],
    ['a whole %% comment in an indented block', 'Para.\n\n    %% SECRET four %%\n\nAfter.'],
    ['a cut comment that leaves four spaces before a %% comment', 'Para.\n\n   <!-- x --> %%SECRET five%%\n\nAfter.'],
    ['a comment indented under a list item', '- item\n\n    <!-- SECRET six -->\n\nAfter.'],
    ['an indented gm-only block', 'Para.\n\n    <!-- gm-only -->\n    SECRET seven\n    <!-- /gm-only -->\n\nAfter.'],
    ['a tab-indented %% comment straight under a heading', '## Clues\n\t%% SECRET killer is X %%\n\nAfter.'],
    ['a comment eight spaces deep under a list item', '1. item\n\n        %% SECRET deep %%\n\nAfter.'],
    ['an indented opener whose comment runs three lines', 'Para.\n\n    <!-- SECRET start\nSECRET middle\n-->\nAfter.'],
    ['an indented spoiler block', 'Para.\n\n    <!-- spoiler -->\n    SECRET\n    <!-- /spoiler -->\n\nAfter.'],
  ];
  for (const [name, text] of SHAPES) {
    it(name, () => {
      const got = safe(text);
      assert.ok(!/SECRET/.test(got), JSON.stringify(got));
      assert.ok(!/SECRET/.test(page(text)));
      assert.ok(/After\./.test(got), `the text after the comment is kept: ${JSON.stringify(got)}`);
    });
  }

  it('a comment opened in prose closes on a line that looks like code', () => {
    assert.strictEqual(safe('a <!--\n\n    x\n-->b'), 'a \n\nb');
  });
  it('an indented line that continues a paragraph loses its comment too', () => {
    assert.strictEqual(safe('para\n    lazy <!-- gone --> line'), 'para\n    lazy  line');
    assert.strictEqual(safe('para\n    lazy %%gone%% line'), 'para\n    lazy  line');
  });
  it('the code around a cut comment stays', () => {
    const got = safe('intro\n\n    code %%gone%% here\n    more\n\nafter');
    assert.ok(got.includes('    code  here') && got.includes('    more'), JSON.stringify(got));
  });
});

describe('a comment shown in a fenced code block stays', () => {
  for (const [name, text] of [
    ['an HTML comment', 'intro\n\n```\n<!-- shown -->\n```\n\nafter <!-- gone -->'],
    ['a %% comment', 'intro\n\n```\n%% shown %%\n```\n\nafter %%gone%%'],
    ['in a tilde fence', 'intro\n\n~~~\n<!-- shown --> and %% shown %%\n~~~\n\nafter %%gone%%'],
  ]) {
    it(name, () => {
      const got = safe(text);
      assert.ok(/shown/.test(got), JSON.stringify(got));
      assert.ok(/shown/.test(page(text)));
      assert.ok(!/gone/.test(got), JSON.stringify(got));
      assert.ok(/after/.test(got));
    });
  }
});
