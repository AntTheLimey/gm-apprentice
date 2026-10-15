'use strict';
// tools/publish/test/unit/mark-sections.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  filterSections, processContent, playerSafeMarkdown, extractSections, stubMarked,
} = require('../../lib/processor');
const { createMarks, markKinds, renderMarks } = require('../../lib/gm-marks');

const ALL = new Set(markKinds());
const OPEN = (n) => String.fromCharCode(0xE000) + n.toString(36) + String.fromCharCode(0xE001);
const CLOSE = String.fromCharCode(0xE002);
const setup = (show = ALL) => { const marks = createMarks(); return { marks, mark: { marks, show } }; };
const count = (s, re) => (s.match(re) || []).length;
const balanced = (html) => count(html, /<div\b/g) === count(html, /<\/div>/g) && count(html, /<span\b/g) === count(html, /<\/span>/g);

test('1: a withheld section is kept inside one mark; the sections around it are not', () => {
  const { marks, mark } = setup();
  const out = filterSections('Public.\n\n## GM Notes\n\nTraitor.\n\n## Open\n\nShown.', ['GM Notes'], null, { mark });
  assert.equal(out, `Public.\n\n\n${OPEN(0)}\n\n## GM Notes\n\nTraitor.\n\n\n${CLOSE}\n\n## Open\n\nShown.`);
  assert.deepEqual(marks.get(0), { kind: 'sections', label: 'GM Notes section' });
});

test('2: a nested heading under a withheld section stays inside its one mark', () => {
  const { marks, mark } = setup();
  const out = filterSections('## GM Notes\n\nx\n\n### Player Notes\n\ny\n\n## Open\n\nz', ['GM Notes'], null, { mark });
  assert.equal(count(out, //g), 1);
  assert.equal(count(out, //g), 1);
  assert.ok(out.indexOf('### Player Notes') > out.indexOf(''));
  assert.ok(out.indexOf('### Player Notes') < out.indexOf(''));
  assert.equal(marks.get(0).label, 'GM Notes section');
});

test('3: a document note\'s Context section is marked', () => {
  const { marks, mark } = setup();
  const out = filterSections('## Context\n\nbackground\n\n## Rules\n\nr', [], { type: 'document' }, { mark });
  assert.equal(marks.get(0).label, 'Context section');
  assert.ok(out.indexOf('background') > out.indexOf(''));
  assert.ok(out.indexOf('background') < out.indexOf(''));
  assert.ok(out.indexOf('## Rules') > out.indexOf(''));
});

test('4: the PC keep list marks the sections it drops and the text before the first section', () => {
  const { marks, mark } = setup();
  const text = 'Preamble words.\n\n## Background\n\nKept.\n\n## Secrets\n\nHidden.';
  const out = filterSections(text, [], { type: 'pc' }, { pcKeepSections: ['Background'], mark });
  assert.deepEqual([0, 1].map((n) => marks.get(n).label), ['text before the first section', 'Secrets section']);
  const between = (needle, a, b) => out.indexOf(needle) > out.indexOf(a) && out.indexOf(needle) < out.indexOf(b);
  assert.ok(between('Preamble words.', OPEN(0), CLOSE));
  assert.ok(out.indexOf('Kept.') > out.indexOf(CLOSE) && out.indexOf('Kept.') < out.indexOf(OPEN(1)));
  assert.ok(out.indexOf('Hidden.') > out.indexOf(OPEN(1)) && out.indexOf('Hidden.') < out.lastIndexOf(CLOSE));
});

test('4b: a note the parser cannot read is one mark over the whole body', () => {
  const { marks, mark } = setup();
  const out = filterSections('a\nb', [], null, { mark, parse: () => { throw new Error('boom'); }, warn: () => {} });
  assert.equal(marks.get(0).label, 'note body (it could not be read)');
  assert.equal(out, `\n${OPEN(0)}\n\na\nb\n\n${CLOSE}\n`);
});

test('5: a PC page whose GM Notes holds a ## heading renders balanced marks, the heading marked inline', () => {
  const { marks, mark } = setup();
  const page = {
    markdown: '# Ada\n\n## Background\n\nKept.\n\n## GM Notes\n\nLine.\n\n## Her secret\n\nWhy.\n\n## Other\n\nMore.',
    frontmatter: { type: 'pc' }, outputPath: 'pcs/ada.html',
  };
  const { html } = processContent(page, {}, ['GM Notes'], {}, { mark, pcKeepSections: ['Background', 'Other'] });
  const rendered = renderMarks(html, marks);
  assert.ok(balanced(rendered), rendered);
  assert.match(rendered, /<h2><span class="gm-mark gm-mark--sections"[^>]*>Her secret<\/span><\/h2>/);
  assert.match(rendered, /<h2><span class="gm-mark gm-mark--sections"[^>]*>GM Notes<\/span><\/h2>/);
});

test('5b: an unsteady PC note is one mark, not empty', () => {
  const { marks, mark } = setup();
  const page = { markdown: '# Ada\n\nSome text.', frontmatter: { type: 'pc' }, outputPath: 'pcs/ada.html', headingsUnstable: true };
  const { html } = processContent(page, {}, [], {}, { mark, pcKeepSections: ['Background'] });
  assert.equal(marks.get(0).label, 'note body (a link label changes its headings)');
  assert.match(renderMarks(html, marks), /Some text\./);
  // the mark's table is the only trace: off, it is empty as on the player site
  const off = processContent(page, {}, [], {}, { mark: { marks: createMarks(), show: new Set() }, pcKeepSections: ['Background'] });
  assert.equal(off.html, '');
});

test('5c: a note titled "# GM Notes" keeps its section, marked once', () => {
  const { marks, mark } = setup();
  const page = { markdown: '# GM Notes\n\nSecret plan.\n\n## Other\n\nOpen.', frontmatter: { type: 'npc' }, outputPath: 'npcs/x.html' };
  const { html } = processContent(page, {}, ['GM Notes'], {}, { mark });
  const rendered = renderMarks(html, marks);
  assert.match(rendered, /Secret plan\./);
  assert.match(rendered, /data-gm-label="GM Notes section"/);
  // one mark was made (the later ## heading inside it only splits it for the templates, which cut a page there)
  assert.equal(marks.get(1), undefined);
  assert.ok(balanced(rendered));
  // the player build still drops the whole section
  assert.doesNotMatch(processContent(page, {}, ['GM Notes'], {}).html, /Secret plan/);
});

test('6: stubMarked marks what the stub cuts; a gm-only block inside a kept section is left for the strips', () => {
  const { marks, mark } = setup();
  const text = '## Overview\n\nOne.\n\n<!-- gm-only -->\ntrap\n<!-- /gm-only -->\n\nTwo.\n\n## Prep\n\nCut me.';
  const out = stubMarked(text, ['Overview'], {}, mark);
  assert.deepEqual(marks.get(0), { kind: 'sections', label: 'publish: stub' });
  assert.equal(marks.get(1), undefined);
  assert.ok(out.startsWith('## Overview\n\nOne.\n\n<!-- gm-only -->\ntrap\n<!-- /gm-only -->\n\nTwo.\n'));
  assert.ok(out.indexOf('Cut me.') > out.indexOf('') && out.indexOf('Cut me.') < out.indexOf(''));
  assert.ok(out.indexOf('## Prep') > out.indexOf(''));
  assert.ok(out.indexOf('trap') < out.indexOf(''));
});

test('6b: stubMarked with the sections kind off returns the note as it is', () => {
  const text = '## Overview\n\nOne.\n\n## Prep\n\nCut me.';
  assert.equal(stubMarked(text, ['Overview'], {}, { marks: createMarks(), show: new Set() }), text);
});

test('7: with the sections kind off, filterSections is today\'s, for every shared vector', () => {
  const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'section-filter-vectors.json'), 'utf8'));
  const { marks } = setup();
  assert.ok(vectors.filter.length > 0);
  for (const v of vectors.filter) {
    assert.equal(filterSections(v.text, v.excludes, null, { mark: { marks, show: new Set() } }), filterSections(v.text, v.excludes), v.name);
  }
  assert.equal(marks.get(0), undefined);
});

test('G11: the PC page path keeps balanced marks in every section it cuts', () => {
  const { mark } = setup();
  const md = '# Ada\n\n## Background\n\nKept.\n\n## GM Notes\n\nLine.\n\n## Her secret\n\nWhy.\n\n### Deeper\n\nMore.\n\n## Other\n\nTail.';
  const { text } = playerSafeMarkdown(md, { excludeSections: ['GM Notes'], frontmatter: { type: 'pc' }, pcKeepSections: ['Background', 'Other'], mark });
  const sections = extractSections(text);
  assert.ok(sections.length >= 3);
  for (const s of sections) {
    assert.equal(count(s.html, //g), count(s.html, //g), `${s.title}: ${s.html}`);
  }
});
