'use strict';
// #498: a line of the old publish list hidden by a `%%` or `<!-- -->` comment is not read, by the page strips' rule.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseManifest, parseAnnotatedManifest } = require('../../lib/manifest-legacy');

const list = (...body) => ['---', 'type: meta', '---', '', ...body, ''].join('\n');
const publishing = (md) => parseManifest(md).publishing;

describe('a commented-out line of the old publish list (#498)', () => {
  it('a %% block around a ticked line does not publish it', () => {
    const md = list('## Publishing', '', '- [x] NPCs/Shown.md', '%% - [x] NPCs/Hidden.md %%');
    assert.deepEqual(publishing(md), ['NPCs/Shown.md']);
  });

  it('a %% block holding the Publishing heading publishes nothing under it', () => {
    const md = list('%% ## Publishing %%', '', '- [x] NPCs/Hidden.md');
    assert.deepEqual(publishing(md), []);
  });

  it("Obsidian's toggle-comment shape over several lines", () => {
    const md = list('## Publishing', '', '- [x] NPCs/Shown.md', '%%', '- [x] NPCs/Hidden.md', '- [x] NPCs/Also.md', '%%');
    assert.deepEqual(publishing(md), ['NPCs/Shown.md']);
  });

  it('the same with <!-- -->, on one line and over several', () => {
    const md = list('## Publishing', '', '<!-- - [x] NPCs/One.md -->', '<!--', '- [x] NPCs/Two.md', '-->', '- [x] NPCs/Shown.md');
    assert.deepEqual(publishing(md), ['NPCs/Shown.md']);
  });

  it('an unclosed %% hides the rest of the file, as Obsidian shows it', () => {
    const md = list('## Publishing', '', '- [x] NPCs/Shown.md', '%%', '- [x] NPCs/Hidden.md');
    assert.deepEqual(publishing(md), ['NPCs/Shown.md']);
  });

  it('a comment after an entry on its line leaves the entry', () => {
    const md = list('## Publishing', '', '- [x] NPCs/Shown.md %% checked with the players %%', '- [x] NPCs/Too.md <!-- ok -->');
    assert.deepEqual(publishing(md), ['NPCs/Shown.md', 'NPCs/Too.md']);
  });

  // The reverse cases: one reading of the comments hides the line and the other does not. Hide what either hides.
  // In both shapes one reading leaves a comment open to the end of the file, so the line after it goes too.
  it('a %% opened inside an HTML comment hides what Obsidian hides', () => {
    const md = list('## Publishing', '', '<!-- note %% -->', '- [x] NPCs/Hidden.md', '%%', '- [x] NPCs/After.md');
    assert.deepEqual(publishing(md), []);
  });

  it('an HTML comment opened inside a %% comment hides what the build hides', () => {
    const md = list('## Publishing', '', '%% <!-- %%', '- [x] NPCs/Hidden.md', '-->', '- [x] NPCs/After.md');
    assert.deepEqual(publishing(md), []);
  });

  it('the annotated reader (the old-file writer reads it) does not see a commented line either', () => {
    const md = list('## Publishing', '', '- [x] NPCs/Shown.md', '%%', '- [x] NPCs/Hidden.md', '%%', '## Excluded', '', '<!-- - [x] NPCs/Gone.md — x -->');
    assert.deepEqual([...parseAnnotatedManifest(md).keys()], ['NPCs/Shown.md']);
  });
});
