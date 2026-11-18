'use strict';
// #720: the one reading of "an unfilled template placeholder", shared by the excerpts, the sheet readers and the page.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isPlaceholder, isTemplateNote, withoutPlaceholderLines } = require('../../lib/placeholders');
const { excerptFromMarkdown } = require('../../lib/excerpt');

describe('isPlaceholder', () => {
  it('reads a whole braced line as one, and braces inside a sentence as not', () => {
    assert.equal(isPlaceholder(' {To flesh out for colour.} '), true);
    assert.equal(isPlaceholder('She said {sic} twice'), false);
    assert.equal(isPlaceholder('{a} and {b}'), false);
    assert.equal(isPlaceholder(''), false);
  });
});

describe('withoutPlaceholderLines', () => {
  it('drops lone placeholder lines and bullets, keeps the rest', () => {
    assert.equal(withoutPlaceholderLines('{Fill me}\n- {Fill me too}\nKept {as is}.\n'), 'Kept {as is}.\n');
  });
});

describe('excerptFromMarkdown', () => {
  it('skips a placeholder line and keeps braces mid-sentence', () => {
    assert.equal(excerptFromMarkdown('{To flesh out.}\n\nHe wrote {x} on it.\n'), 'He wrote {x} on it.');
  });
});

describe('what counts as a placeholder (#720)', () => {
  it('needs a space and no link: {REDACTED}, {1d6}, {[[Bob]]} are text', () => {
    for (const t of ['{REDACTED}', '{1d6}', '{[[Bob]]}', '{see [[Bob]] now}', '{list}']) assert.equal(isTemplateNote(t), false, t);
    assert.equal(isTemplateNote('{To flesh out for colour.}'), true);
    assert.equal(isTemplateNote('{Backstory}'), true);
    assert.equal(isPlaceholder('{list}'), true);   // a labelled sheet value: any braced text
    assert.equal(withoutPlaceholderLines('{REDACTED}\n{Fill me in}\n'), '{REDACTED}\n');
  });
  it('an escaped brace keeps its text in an excerpt too', () => {
    assert.equal(excerptFromMarkdown('\\{Fill me in\\}\n'), '\\{Fill me in\\}');
  });
});

describe('dropPlaceholders on a page', () => {
  const { createRenderer } = require('../../lib/markdown');
  const { processContent } = require('../../lib/processor');
  const md = createRenderer();
  const run = (markdown, type = 'npc') => processContent({ markdown, frontmatter: { type }, outputPath: 'npcs/x.html' }, {}, [], {}, {});

  it('keeps {REDACTED}, {1d6} and {[[Bob]]} paragraphs and drops the note-like one', () => {
    const { html } = run('## A\n\n{REDACTED}\n\n{1d6}\n\n{Fill this in}\n');
    assert.match(html, /\{REDACTED\}/);
    assert.match(html, /\{1d6\}/);
    assert.doesNotMatch(html, /Fill this in/);
  });
  it('an escaped placeholder stays, braces and all, and is not warned', () => {
    const r = run('## A\n\n\\{Fill this in\\}\n');
    assert.match(r.html, /\{Fill this in\}/);
    assert.deepEqual(r.unfilled, []);
  });
  it('a nested list of the same kind takes the emptied bullet\'s place', () => {
    const { html } = run('- {Fill this in}\n  - child one\n  - child two\n- kept\n');
    assert.doesNotMatch(html, /Fill this in/);
    assert.equal(html.replace(/\s+/g, ''), '<ul><li>childone</li><li>childtwo</li><li>kept</li></ul>');
  });
  it('a nested list of another kind keeps the item', () => {
    const { html } = run('- {Fill this in}\n  1. child\n');
    assert.match(html, /child/);
  });
  it('a heading goes with the emptied one above the next heading, headings that were empty stay', () => {
    const { html } = run('## A\n\n## B\n\n{x y}\n\n## C\n\ntext\n\n## D\n');
    assert.doesNotMatch(html, /<h2>A|<h2>B/);
    assert.match(html, /<h2>C/);
    assert.match(html, /<h2>D/);
  });
  it('braces in code are untouched, and a page with none renders as plain md.render does', () => {
    const src = '## A\n\n```\n{Fill this in}\n```\n\nUse `{Fill this in}` here.\n\n## B\n\n- one\n- two\n\n![pic](pic.png)\n';
    const { html } = run(src);
    assert.match(html, /\{Fill this in\}[\s\S]*\{Fill this in\}/);
    assert.equal(html, md.render(src.replace(/\r/g, ''), {}));
  });
  it('CRLF notes drop the same', () => {
    const { html } = run('## A\r\n\r\n{Fill this in}\r\n\r\n## B\r\n\r\ntext\r\n');
    assert.doesNotMatch(html, /Fill this in|<h2>A/);
    assert.match(html, /<h2>B/);
  });
  it('a heading followed by an image stays', () => {
    const { html } = run('## A\n\n{Fill this in}\n\n![pic](pic.png)\n');
    assert.match(html, /<h2>A/);
    assert.match(html, /<img/);
  });
  it('a PC sheet drops silently, a note with no type warns', () => {
    assert.deepEqual(run('## A\n\n{Fill this in}\n', 'pc').unfilled, []);
    assert.equal(run('## A\n\n{Fill this in}\n', 'npc').unfilled.length, 1);
    assert.match(run('## A\n\n{Fill this in}\n').unfilled[0].fix, /\\\{like this\\\}/);
  });
});
