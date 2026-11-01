'use strict';
// player_site.story.moments: the Memorable Moments section of a wrap-up as cards on its Story page. Off, the section is
// withheld through the same rule hide.sections uses, so no player file holds it (page, search, previews, Connections);
// the GM site still shows the cards, inside one mark that names the setting.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../helpers/quiet-legacy-warning.js');
const { buildBoth, markedTexts } = require('../helpers/gm-build');
const { storyVault, SECRETS } = require('../helpers/story-vault');
const { entry } = require('../../lib/settings/registry');
const { playerSafeMarkdown } = require('../../lib/processor');
const { createMarks, unmark, withoutMarked } = require('../../lib/gm-marks');

const STORY_1 = 'story/chapter-1-docks-session-1.html';
// Session 1's moments, each in a different part of the section.
const MOMENTS = ['MOMENT-FUNNY-1', 'MOMENT-QUOTE-1', 'MOMENT-CONTEXT-1', 'Nobody moved to help her'];
const LABEL = 'player_site.story.moments: off — Story pages show the recap only';
const texts = (site) => site.files().filter((f) => /\.(?:html|json|js)$/.test(f)).map((f) => [path.relative(site.dir, f), fs.readFileSync(f, 'utf8')]);
const html = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

describe('player_site.story.moments', () => {
  const off = buildBoth(storyVault(), { player: { story: { moments: false } } });
  const on = buildBoth(storyVault());
  const both = buildBoth(storyVault(), { player: {
    story: { moments: false },
    hide: { sections: ['GM Notes', 'DM Notes', 'Player Notes', 'Source References', 'Reconciliation Context', 'Handoff to Reconcile', 'Memorable Moments'] } } });
  after(() => { off.cleanup(); on.cleanup(); both.cleanup(); });

  it('off: no moment text on any player file', () => {
    const files = texts(off.player);
    assert.ok(files.some(([f]) => f === 'search-index.json') && files.some(([f]) => f.endsWith('previews.json')), 'the index and previews are built');
    for (const [file, text] of files) {
      for (const m of MOMENTS) assert.ok(!html(text).includes(m), `${m} in ${file}`);
      assert.ok(!/class="story-moments"/.test(text), `a moments block in ${file}`);
    }
    for (const secret of SECRETS) for (const [file, text] of files) assert.ok(!text.includes(secret), `${secret} in ${file}`);
  });

  it('off: the recap and the other sections still publish', () => {
    const page = off.player.read(...STORY_1.split('/'));
    assert.ok(page.includes('The party reached the docks') && page.includes('LOOT-KEY-1'));
  });

  it('off: the GM Story page shows the cards inside one mark labelled for the setting', { todo: 'Task 7' }, () => {
    const page = off.gm.read(...STORY_1.split('/'));
    const marks = markedTexts(page).filter((m) => m.kind === 'sections');
    assert.equal(marks.length, 1, `sections marks: ${JSON.stringify(marks.map((m) => m.label))}`);
    assert.equal(marks[0].label, LABEL);
    for (const m of MOMENTS) assert.ok(html(marks[0].text).includes(m), `${m} in the mark`);
  });

  it('on (default): the cards publish', () => {
    const page = on.player.read(...STORY_1.split('/'));
    assert.ok(page.includes('class="story-moments"'));
    for (const m of MOMENTS) assert.ok(html(page).includes(m), m);
    assert.deepEqual(markedTexts(on.gm.read(...STORY_1.split('/'))).filter((m) => m.label === LABEL), []);
  });

  it('moments off and hide.sections naming Memorable Moments: no moment text on the player site', () => {
    for (const [file, text] of texts(both.player)) for (const m of MOMENTS) assert.ok(!html(text).includes(m), `${m} in ${file}`);
  });

  it('moments off and hide.sections naming Memorable Moments: one mark on the GM page', { todo: 'Task 7' }, () => {
    const marks = markedTexts(both.gm.read(...STORY_1.split('/'))).filter((m) => m.kind === 'sections' && /moments/i.test(m.label + m.text));
    assert.equal(marks.length, 1, JSON.stringify(marks.map((m) => m.label)));
    for (const m of MOMENTS) assert.ok(html(marks[0].text).includes(m), `${m} in the mark`);
  });

  it('the marked view of a wrap-up holds the section in one mark labelled for the setting', () => {
    const marks = createMarks();
    const text = '# T\n\n## Narrative Recap\n\nhi\n\n## Memorable Moments\n\nMOMENT\n\n## Loot\n\nx\n';
    const marked = playerSafeMarkdown(text, { excludeSections: ['GM Notes'], frontmatter: { type: 'session_wrap' },
      storyMoments: false, mark: { marks, show: new Set(['sections']) } }).text;
    assert.deepEqual(marks.get(0), { kind: 'sections', label: LABEL });
    assert.equal(marks.get(1), undefined);
    assert.equal(unmark(marked).includes('MOMENT'), true);
    assert.equal(withoutMarked(marked, marks).includes('MOMENT'), false);
    assert.equal(withoutMarked(marked, marks).includes('Loot'), true);
  });

  it('the setting has no gm_site twin, and defaults on', () => {
    assert.equal(entry('gm_site.story.moments'), undefined);
    assert.equal(entry('player_site.story.moments').default, true);
  });
});
