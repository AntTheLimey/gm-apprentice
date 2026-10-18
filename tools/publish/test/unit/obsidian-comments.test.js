const { describe, it } = require('node:test');
const assert = require('node:assert');
const { playerSafeMarkdown, strippedLines, keptSectionFlags, keepOnlySections, processContent } = require('../../lib/processor');

const safe = (text, excludes = ['GM Notes']) => playerSafeMarkdown(text, { excludeSections: excludes });

describe('%% comments (Obsidian), #305', () => {
  it('cuts an inline comment and keeps the text around it', () => {
    assert.strictEqual(safe('a %%x%% b').text, 'a  b');
  });
  it('cuts a block comment of several lines', () => {
    assert.strictEqual(safe('before\n%%\nseveral\nlines\n%%\nafter').text, 'before\nafter');
  });
  it('cuts two comments on one line, and text between them stays', () => {
    assert.strictEqual(safe('a %%1%% b %%2%% c').text, 'a  b  c');
  });
  it('cuts a comment that starts and ends on different lines', () => {
    assert.strictEqual(safe('one %% start\nmiddle\nend %% two').text, 'one \n two');
  });
  it('cuts a comment in a table cell, list item, quote and heading', () => {
    assert.strictEqual(safe('| a %%x%% | b |').text, '| a  | b |');
    assert.strictEqual(safe('- item %%x%%').text, '- item ');
    assert.strictEqual(safe('> quote %%x%%').text, '> quote ');
    assert.strictEqual(safe('## Plan %%secret%%').text, '## Plan ');
  });
  it('an opening %% never closed hides the rest of the note, and says so', () => {
    const got = safe('shown\n%% open\nhidden\n## More\nhidden too');
    assert.strictEqual(got.text, 'shown');
    assert.ok(got.warnings.some(w => /unclosed %%/.test(w)), got.warnings.join());
  });
  it('leaves %% in a fenced block and in inline code alone', () => {
    assert.strictEqual(safe('```\n%%x\n```\nafter').text, '```\n%%x\n```\nafter');
    assert.strictEqual(safe('use `%%x%%` here').text, 'use `%%x%%` here');
    assert.strictEqual(safe('use ``a%%b`` and %%gone%%').text, 'use ``a%%b`` and ');
  });
  it('an unclosed backtick is no code span, so a %% after it still counts', () => {
    assert.strictEqual(safe('tick ` then %%gone%% end').text, 'tick ` then  end');
  });
  it('a comment spanning an excluded heading hides the heading, not what follows it as visible', () => {
    // The heading inside the comment is not a heading; the section stays open and hides what follows.
    assert.strictEqual(safe('## GM Notes\nsecret\n%%\n## Next\n%%\nstill secret\n## Real\npub').text, '## Real\npub');
    // A withheld heading inside a comment still withholds what follows the comment: Obsidian shows it under that
    // heading (#447).
    assert.strictEqual(safe('x\n%%\n## GM Notes\n%%\nunder it').text, 'x');
  });
  it('a %% inside an HTML comment is part of that comment', () => {
    assert.strictEqual(safe('a <!-- 50%% off --> b %%gone%% c').text, 'a  b  c');
  });
  it('keeps the line map: each line left names the line it came from', () => {
    const text = 'a\n%%\nx\ny\n%%\nb %%z%% c\n\nend';
    const { lines, from } = strippedLines(text, false);
    assert.deepStrictEqual(lines, ['a', 'b  c', '', 'end']);
    assert.deepStrictEqual(from, [0, 5, 6, 7]);
  });
  it('a stub page flags the lines it keeps by the note\'s own line numbers', () => {
    const note = '## Overview\npublic\n%%\nhidden\n%%\nmore public %%x%%\n## Other\nno';
    assert.deepStrictEqual(keptSectionFlags(note, ['Overview']), [true, true, false, false, false, true, false, false]);
    assert.strictEqual(keepOnlySections(note, ['Overview']), '## Overview\npublic\nmore public ');
  });
  it('leaves %% alone in a fence longer than three backticks, a tilde fence, and a fence in a quote or list item', () => {
    for (const text of [
      '````\n```\n%%x%%\n```\n````\nafter %%gone%%',
      '~~~\n%%x%%\n~~~\nafter %%gone%%',
      '> ```\n> %%x%%\n> ```\n\nafter %%gone%%',
      '- item\n\n  ```\n  %%x%%\n  ```\n\nafter %%gone%%',
    ]) {
      const got = safe(text).text;
      assert.ok(got.includes('%%x%%'), JSON.stringify(text) + ' -> ' + JSON.stringify(got));
      assert.ok(!got.includes('gone'), got);
      assert.ok(got.includes('after'), got);
    }
  });
  it('cuts a %% comment in an indented code block: only a fence shows one', () => {
    const got = safe('intro\n\n    code %%x%% here\n    more\n\nafter %%gone%%').text;
    assert.ok(got.includes('    code  here'), got);
    assert.ok(!got.includes('%%'), got);
    assert.ok(!got.includes('gone'), got);
    assert.strictEqual(safe('para\n    lazy %%gone%% line').text, 'para\n    lazy  line');
  });
  it('a comment-only line between a paragraph and a --- line does not turn the paragraph into a heading', () => {
    assert.strictEqual(safe('text\n%%c%%\n---\nafter').text, 'text\n\n---\nafter');
    assert.strictEqual(safe('text\n<!-- c -->\n---\nafter').text, 'text\n\n---\nafter');
    assert.strictEqual(safe('text\n%%\nc\n%%\n===').text, 'text\n\n===');
    // Nothing to keep apart: no paragraph above, or the underline is not one.
    assert.strictEqual(safe('%%c%%\n---').text, '---');
    assert.strictEqual(safe('text\n\n%%c%%\n---').text, 'text\n\n---');
    assert.strictEqual(safe('text\n%%c%%\nmore').text, 'text\nmore');
  });
  it('a comment still closes on a line the markdown parser would call code', () => {
    assert.strictEqual(safe('a\n%%\n```\n%%\nb').text, 'a\nb');
  });
  it('when every line is stripped no line is left over, and no line map entry is missing', () => {
    for (const text of ['%%\na\n%%', '<!-- a -->', '%% a <!-- %%\nB\n-->']) {
      const { lines, from } = strippedLines(text, false);
      assert.deepStrictEqual(lines, [], text);
      assert.deepStrictEqual(from, [], text);
    }
  });
  it('the page render is the same strip', () => {
    const { html } = processContent({ markdown: '# T\nLead %%HIDDENWORD%% tail\n\n%%\nHIDDENBLOCK\n%%\n', frontmatter: {}, outputPath: 'a/b.html' }, {}, ['GM Notes']);
    assert.ok(!/HIDDEN/.test(html), html);
    assert.match(html, /Lead\s+tail/);
  });
});

describe('%% comments in a frontmatter value', () => {
  const { cutValueComments } = require('../../lib/frontmatter');
  it('cuts a span, an unclosed one to the end, and a value that was only comment', () => {
    assert.deepStrictEqual(
      cutValueComments({ a: 'x %%y%% z', b: 'keep %%open', c: '%%all%%', d: ['p %%q%%', '%%r%%', 'ok'], n: 3, e: { f: 'g %%h%%' } }),
      { a: 'x z', b: 'keep', d: ['p', 'ok'], n: 3, e: { f: 'g' } });
  });
});

describe('HTML comments and hidden blocks in a frontmatter value', () => {
  const { cutValueComments } = require('../../lib/frontmatter');
  const cut = (text) => cutValueComments(text);
  it('cuts an HTML comment, and an unclosed one to the end', () => {
    assert.strictEqual(cut('Clerk <!-- a spy --> of works'), 'Clerk of works');
    assert.strictEqual(cut('Clerk <!-- a spy'), 'Clerk');
    assert.strictEqual(cut('<!---->Clerk<!-- x -->'), 'Clerk');
    assert.strictEqual(cut('line one <!-- a\nspy --> line two'), 'line one line two');
  });
  it('cuts a gm-only or spoiler block with what it holds, in any capitals', () => {
    assert.strictEqual(cut('Clerk <!-- gm-only -->a spy<!-- /gm-only --> of works'), 'Clerk of works');
    assert.strictEqual(cut('Clerk <!-- SPOILER -->a spy<!-- / Spoiler --> of works'), 'Clerk of works');
    assert.strictEqual(cut('Clerk <!--GM-ONLY-->a spy<!--/gm-only-->'), 'Clerk');
  });
  it('a block never closed hides the rest of the value', () => {
    assert.strictEqual(cut('Clerk <!-- gm-only --> a spy'), 'Clerk');
    // A closer of the other name does not close it.
    assert.strictEqual(cut('Clerk <!-- gm-only --> a spy <!-- /spoiler --> of works'), 'Clerk');
  });
  it('a block inside a block of the same name closes only itself', () => {
    assert.strictEqual(cut('A <!-- gm-only -->b <!-- gm-only -->c<!-- /gm-only --> d<!-- /gm-only --> E'), 'A E');
  });
  it('a closer with nothing open is a comment like any other', () => {
    assert.strictEqual(cut('Clerk <!-- /gm-only --> of works'), 'Clerk of works');
  });
  it('leaves one in backticks alone, as it does a %%', () => {
    assert.strictEqual(cut('type `<!-- x -->` to hide'), 'type `<!-- x -->` to hide');
    assert.strictEqual(cut('type `<!-- gm-only -->` then <!-- real --> text'), 'type `<!-- gm-only -->` then text');
  });
  it('reads the three kinds in one pass, left to right', () => {
    assert.strictEqual(cut('a %% x <!-- y %% b <!-- z --> c'), 'a b c');
    assert.strictEqual(cut('a <!-- x %% y --> b %% z %% c'), 'a b c');
  });
  it('reads every string at any depth, and drops a value that was only hidden text', () => {
    assert.deepStrictEqual(
      cutValueComments({ a: 'x <!-- y --> z', c: '<!-- all -->', d: ['p <!-- q -->', '<!-- gm-only -->r<!-- /gm-only -->', 'ok'], n: 3, e: { f: 'g <!-- h' } }),
      { a: 'x z', d: ['p', 'ok'], n: 3, e: { f: 'g' } });
  });
  it('a value with none of them is returned as it was', () => {
    assert.strictEqual(cut('a  < b   and  -> c'), 'a  < b   and  -> c');
  });
});
