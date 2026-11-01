'use strict';
// #543: the Story page's body, cut from the wrap-up's published view (player) or marked view (GM).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { storySections } = require('../../lib/story-sections');
const { createMarks, blockLines, unmark } = require('../../lib/gm-marks');

const OPEN = '\uE000';
const CLOSE = '\uE002';
const count = (s, c) => s.split(c).length - 1;
const balanced = (html) => count(html, OPEN) === count(html, CLOSE);

const PLAYER = [
  '## Narrative Recap', 'The party reached the docks.', '',
  '## Loot', '- a brass key', '',
  '## Memorable Moments', '> "Not today." — [[Mara Quill]]', '',
  '## Notes', 'Written later.', '',
].join('\n');

describe('storySections', () => {
  it('player text: recap, then Loot, then Notes in written order; moments separate; nothing after', () => {
    const resolve = (md) => md.replace('[[Mara Quill]]', '[Mara Quill](../npcs/mara-quill.html)');
    const out = storySections(PLAYER, { resolve, recapTitle: 'Narrative Recap' });
    assert.deepEqual(out.sections.map((s) => s.title), ['Loot', 'Notes']);
    assert.equal(out.sections[0].id, 'loot');
    assert.match(out.sections[0].html, /a brass key/);
    assert.equal(out.moments.title, 'Memorable Moments');
    assert.equal(out.moments.hidden, null);
    assert.match(out.moments.markdown, /\[Mara Quill\]\(\.\.\/npcs\/mara-quill\.html\)/, 'the moments markdown is resolved');
    assert.doesNotMatch(out.moments.markdown, /Memorable Moments|Written later/, 'only the section body');
    assert.deepEqual(out.after, []);
  });

  it('the recap section is not repeated', () => {
    const out = storySections(PLAYER, { recapTitle: 'Narrative Recap' });
    assert.ok(out.sections.every((s) => !/reached the docks/.test(s.html)));
    assert.equal(out.recap.title, 'Narrative Recap');
    assert.match(out.recap.html, /reached the docks/);
  });

  it("a recap from the unit's own page leaves every wrap-up section in", () => {
    const out = storySections(PLAYER, { recapTitle: null });
    assert.deepEqual(out.sections.map((s) => s.title), ['Narrative Recap', 'Loot', 'Notes']);
    assert.equal(out.recap, null);
  });

  it('text above the first heading comes back as the preamble, without the note\'s own title; none when there is none', () => {
    const out = storySections('# Session 1 Wrap-Up\n\nA plain lead line.\n\n## Narrative Recap\nx\n', { recapTitle: 'Narrative Recap' });
    assert.match(out.preamble.html, /<p>A plain lead line\.<\/p>/);
    assert.doesNotMatch(out.preamble.html, /Session 1 Wrap-Up/);
    assert.equal(storySections('# Session 1 Wrap-Up\n\n## Narrative Recap\nx\n', { recapTitle: 'Narrative Recap' }).preamble, null);
  });

  it('no moments section: moments is null', () => {
    const out = storySections('## Narrative Recap\nx\n\n## Loot\ny\n', { recapTitle: 'Narrative Recap' });
    assert.equal(out.moments, null);
    assert.deepEqual(out.sections.map((s) => s.title), ['Loot']);
  });

  it('marked text: a fenced GM Notes after the moments goes after; a hidden Loot before them stays in place; the Source preamble comes back apart, marked', () => {
    const m = createMarks();
    const source = m.open('callouts', 'source');
    const gmOnly = m.open('gm_only', 'gm-only');
    const loot = m.open('sections', 'Loot');
    const notes = m.open('sections', 'GM Notes');
    // The shape the build's marked view has: each token on a line of its own between blank lines.
    const text = [
      ...blockLines(source), '> [!info] Source', '> Written from the Play Notes', ...blockLines(CLOSE), '',
      '## Narrative Recap', 'The party reached the docks.', '',
      ...blockLines(loot), '## Loot', 'secret loot', ...blockLines(CLOSE), '',
      '## Visible', 'Seen by all.', '',
      '## Memorable Moments', '- one', '',
      ...blockLines(notes), '## GM Notes', 'the twist', ...blockLines(gmOnly), 'deeper', ...blockLines(CLOSE), ...blockLines(CLOSE), '',
      '## Epilogue', 'After all.', '',
    ].join('\n');
    const out = storySections(text, { marks: m, recapTitle: 'Narrative Recap' });
    assert.deepEqual(out.sections.map((s) => unmark(s.title)),
      ['Loot', 'Visible', 'Epilogue'], 'player sections and the hidden Loot in written order');
    const hiddenLoot = out.sections[0];
    assert.equal(hiddenLoot.id, 'loot');
    assert.ok(hiddenLoot.html.includes(loot) && hiddenLoot.html.includes('secret loot') && balanced(hiddenLoot.html));
    assert.ok(hiddenLoot.title.startsWith(loot) && hiddenLoot.title.endsWith(CLOSE), 'the hidden heading is marked');
    assert.equal(out.moments.title, 'Memorable Moments');
    assert.equal(out.moments.hidden, null);
    assert.doesNotMatch(out.moments.markdown, /the twist|After all/);
    assert.match(out.preamble.html, /Written from the Play Notes/, 'the Source preamble, for the page to print first');
    assert.ok(out.preamble.html.includes(source) && balanced(out.preamble.html), 'the preamble keeps its mark');
    assert.equal(out.after.length, 1);
    assert.match(out.after[0].html, /<h2 id="gm-notes">/);
    assert.match(out.after[0].html, /the twist[\s\S]*deeper/);
    for (const a of out.after) assert.ok(balanced(a.html), `balanced: ${JSON.stringify(a.html)}`);
    assert.ok(out.sections.every((s) => !/the twist|Written from the Play Notes/.test(s.html)));
  });

  it('a hidden run holding the moments heading: moments.hidden carries its tokens; its other sections go after', () => {
    const m = createMarks();
    const run = m.open('gm_only', 'gm-only');
    const text = [
      '## Narrative Recap', 'They came.', '',
      ...blockLines(run), '## Memorable Moments', '- one', '', '## Aftermath', 'the cost', ...blockLines(CLOSE), '',
    ].join('\n');
    const out = storySections(text, { marks: m, recapTitle: 'Narrative Recap' });
    assert.equal(out.moments.title, 'Memorable Moments');
    assert.deepEqual(out.moments.hidden, { open: run, close: CLOSE });
    assert.match(out.moments.markdown, /- one/);
    assert.doesNotMatch(out.moments.markdown, /the cost|[\uE000-\uE002]/);
    assert.deepEqual(out.sections, []);
    assert.equal(out.after.length, 1);
    assert.match(out.after[0].html, /Aftermath[\s\S]*the cost/);
    assert.ok(balanced(out.after[0].html));
  });

  it('ids are unique on the page: a hidden Loot beside a visible Loot gets its own anchor', () => {
    const m = createMarks();
    const run = m.open('sections', 'Loot');
    const after = m.open('sections', 'Loot');
    const text = [
      '## Loot', 'A key.', '',
      ...blockLines(run), '## Loot', 'secret loot', ...blockLines(CLOSE), '',
      '## Memorable Moments', '- one', '',
      ...blockLines(after), '## Loot', 'more', ...blockLines(CLOSE), '',
    ].join('\n');
    const out = storySections(text, { marks: m });
    assert.deepEqual(out.sections.map((s) => s.id), ['loot', 'loot-2']);
    assert.match(out.after[0].html, /<h2 id="loot-3">/);
  });

  it('a mark opened inside a hidden moments run and closed after the next heading: each piece balanced, GM Notes under its own mark', () => {
    // The build's marked view with player_site.story.moments off: the moments section's mark opens before its heading,
    // the template's gm-only fence opens inside it (before GM Notes) and both close at the end.
    const m = createMarks();
    const run = m.open('sections', 'player_site.story.moments: off');
    const fence = m.open('gm_only_blocks', 'gm-only block');
    const text = [
      '## Narrative Recap', 'They came.', '',
      ...blockLines(run), '## Memorable Moments', '**One.**', '', ...blockLines(fence), '',
      '## GM Notes', '- the secret', '', ...blockLines(CLOSE), '', ...blockLines(CLOSE), '',
    ].join('\n');
    const out = storySections(text, { marks: m, recapTitle: 'Narrative Recap' });
    assert.deepEqual(out.moments.hidden, { open: run, close: CLOSE });
    assert.equal(out.moments.markdown, '**One.**');
    assert.equal(out.after.length, 1);
    const gmNotes = out.after[0].html;
    assert.ok(balanced(gmNotes), gmNotes);
    assert.ok(gmNotes.includes(fence) && !gmNotes.includes(run), 'GM Notes stand in the fence\'s mark, not the moments\'');
    assert.match(gmNotes, /the secret/);
  });

  it('a mark that closes inside a piece leaves the run\'s own mark round it, and the piece balanced', () => {
    const m = createMarks();
    const run = m.open('sections', 'Aftermath');
    const inner = m.open('gm_only_blocks', 'gm-only block');
    const text = [
      ...blockLines(run), '## Aftermath', ...blockLines(inner), 'inner words', ...blockLines(CLOSE), 'outer words', '',
      '## Debts', 'owed', ...blockLines(CLOSE), '',
    ].join('\n');
    const out = storySections(text, { marks: m });
    assert.equal(out.after.length, 2);
    for (const a of out.after) assert.ok(balanced(a.html), a.html);
    assert.ok(out.after[0].html.startsWith(`<h2 id="aftermath">${run}`) || out.after[0].html.includes(`<p>${run}</p>`));
    assert.ok(out.after[0].html.includes(inner) && out.after[0].html.includes('outer words'));
    assert.ok(out.after[1].html.includes(`<p>${run}</p>`) && !out.after[1].html.includes(inner));
  });

  it('a recap heading holding a marked name is found by its title as players see it', () => {
    const m = createMarks();
    const name = m.open('withheld_names', 'withheld');
    const text = [`## Recap: ${name}Vex${CLOSE}`, 'They came.', '', '## Loot', 'a key', ''].join('\n');
    const out = storySections(text, { marks: m, recapTitle: 'Recap:' });
    assert.match(out.recap.html, /They came/);
    assert.deepEqual(out.sections.map((x) => unmark(x.title)), ['Loot']);
  });

  it('a wrap-up whose headings cannot be read warns, naming the note, and the page keeps no body from it', () => {
    const processor = require('../../lib/processor');
    const real = processor.findHeadings;
    const key = require.resolve('../../lib/story-sections');
    delete require.cache[key];
    processor.findHeadings = () => { throw new Error('parser broke'); };
    const warned = [];
    try {
      const fresh = require('../../lib/story-sections');
      const out = fresh.storySections(PLAYER, { recapTitle: 'Narrative Recap', warn: (msg) => warned.push(msg), name: 'Sessions/Session 1 Wrap-Up.md' });
      assert.deepEqual(out, { preamble: null, recap: null, sections: [], moments: null, after: [] });
    } finally {
      processor.findHeadings = real;
      delete require.cache[key];
    }
    assert.equal(warned.length, 1);
    assert.match(warned[0], /Sessions\/Session 1 Wrap-Up\.md/);
    assert.match(warned[0], /parser broke/);
  });
});
