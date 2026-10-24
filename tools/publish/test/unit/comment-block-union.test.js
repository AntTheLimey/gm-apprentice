// tools/publish/test/unit/comment-block-union.test.js
// A %% comment and a hidden block (gm-only, spoiler, HTML comment, dataview) that overlap: the page hides what
// either reading hides. Obsidian reads a %% comment first, so a %% opened inside a block runs past the block's
// closer; the build reads the block first. Text after the closer published while Obsidian hid it.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { playerSafeMarkdown, strippedLines } = require('../../lib/processor');
const { createMarks, withoutMarked } = require('../../lib/gm-marks');

const player = (text) => playerSafeMarkdown(text, { excludeSections: [] }).text;

// A block of each kind as [opener, closer].
const KINDS = {
  'gm-only': ['<!-- gm-only -->', '<!-- /gm-only -->'],
  spoiler: ['<!-- spoiler -->', '<!-- /spoiler -->'],
  'HTML comment': ['<!--', '-->'],
};

// %% opened inside the block, closed after its closer: on the closer's line, then on the line after.
const closerLine = ([open, close]) =>
  `Open text.\n${open}\nGM a.\n%% secret opens here\n${close}still secret %% tail one\nnext line`;
const nextLine = ([open, close]) =>
  `Open text.\n${open}\n%% secret opens here\n${close}\nstill secret\nmore secret %% tail two\nend`;
// %% opened before the block, closed inside it: the block's own text stays hidden.
const reverse = ([open, close]) => `Before.\n%% note\n${open}\n%%\nSecret line.\n${close}\nAfter.`;

const SECRET = /secret|GM a\.|note/;

describe('a %% comment that crosses a hidden block\'s edge', () => {
  for (const [kind, pair] of Object.entries(KINDS)) {
    it(`${kind}: %% closed on the closer's line hides the text before it`, () => {
      const out = player(closerLine(pair));
      assert.doesNotMatch(out, SECRET, out);
      assert.match(out, /Open text\./);
    });
    it(`${kind}: %% closed on a later line hides the lines before it`, () => {
      const out = player(nextLine(pair));
      assert.doesNotMatch(out, SECRET, out);
      assert.match(out, /Open text\./);
    });
    it(`${kind}: %% opened before the block and closed inside it keeps the block's text hidden`, () => {
      const out = player(reverse(pair));
      assert.doesNotMatch(out, /Secret line|note/, out);
      assert.match(out, /Before\./);
    });
  }

  it('a %% that opens just after an inline dataview opener hides what follows the query up to its closer', () => {
    const out = player('Intro ```dataview %% secret\nLIST\n``` still secret %% shown\nlast');
    assert.doesNotMatch(out, /secret/, out);
    assert.match(out, /Intro/);
  });

  it('a %% inside a fenced dataview block is query text, as before', () => {
    const out = player('Intro\n```dataview\nLIST WHERE x = "%%"\n```\nshown');
    assert.match(out, /shown/, out);
  });

  it('a block with an even count of %% inside changes nothing after it', () => {
    assert.strictEqual(player('a\n<!-- gm-only -->\n%%x%%\n<!-- /gm-only -->\nb'), 'a\n\nb');
  });

  it('keeps the line map through a crossing comment, and says why the rest is cut', () => {
    const { lines, from, warnings } = strippedLines('a\n<!-- gm-only -->\n%% x\n<!-- /gm-only -->y\nd', false);
    assert.deepStrictEqual(lines, ['a', '']);
    assert.deepStrictEqual(from, [0, 1]);
    assert.ok(warnings.some((w) => /crosses the edge/.test(w)), warnings.join());
  });

  it('balanced comments and blocks give no crossing warning', () => {
    const { warnings } = strippedLines('a %%x%%\n<!-- gm-only -->\n%%y%%\n<!-- /gm-only -->\nb', false);
    assert.deepStrictEqual(warnings, []);
  });
});

// The GM site keeps hidden text and marks it; what players would see (withoutMarked) must hold none of it, whichever
// kinds the GM site shows.
describe('the GM site marks text a crossing %% comment hides', () => {
  const SHOWS = [
    ['blocks and comments marked', ['gm_only_blocks', 'spoilers', 'comments']],
    ['blocks marked, comments cut', ['gm_only_blocks', 'spoilers']],
    ['blocks cut, comments marked', ['comments']],
    ['both cut', []],
  ];
  for (const [label, kinds] of SHOWS) {
    for (const [kind, pair] of Object.entries(KINDS)) {
      for (const [shape, make] of [['closer line', closerLine], ['next line', nextLine], ['reverse', reverse]]) {
        it(`${label}, ${kind}, ${shape}: players see none of it`, () => {
          const marks = createMarks();
          const { lines } = strippedLines(make(pair), false, { marks, show: new Set(kinds) });
          const seen = withoutMarked(lines.join('\n'), marks);
          assert.doesNotMatch(seen, shape === 'reverse' ? /Secret line|note/ : SECRET, seen);
          assert.doesNotMatch(seen, /﷐/, 'no stand-in marker is left in the text');
        });
      }
    }
  }
});

it('a line with an emoji keeps every character when the note has a %% comment', () => {
  const md = '%%note%%\n😀 hello\nA 🐉 dragon 🐉 sleeps.\n';
  const lines = strippedLines(md, [], null).lines;
  assert.ok(lines.includes('😀 hello'), JSON.stringify(lines));
  assert.ok(lines.includes('A 🐉 dragon 🐉 sleeps.'), JSON.stringify(lines));
});
