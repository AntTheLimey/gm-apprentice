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
    // A heading inside a comment starts nothing.
    assert.strictEqual(safe('x\n%%\n## GM Notes\n%%\nvisible').text, 'x\nvisible');
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
  it('the page render is the same strip', () => {
    const { html } = processContent({ markdown: '# T\nLead %%HIDDENWORD%% tail\n\n%%\nHIDDENBLOCK\n%%\n', frontmatter: {}, outputPath: 'a/b.html' }, {}, ['GM Notes']);
    assert.ok(!/HIDDEN/.test(html), html);
    assert.match(html, /Lead\s+tail/);
  });
});
