'use strict';
// tools/publish/test/unit/hidden-heading.test.js
// #447: a hidden block (gm-only, spoiler, an HTML or %% comment, a hidden callout) that holds a withheld section's
// heading. The strip takes the heading with the block; the text after it still sits under that heading in Obsidian,
// so it is withheld to the next heading of the same or higher level, on stub and full pages alike.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  playerSafeMarkdown, keepOnlySections, keptSectionFlags, stubMarked, processContent, strippedLines, stubCut,
} = require('../../lib/processor');
const { createMarks, markKinds, withoutMarked } = require('../../lib/gm-marks');

// The exact example from the issue, in the two forms it names.
const PCT = '## Appearance\nTall, grey coat.\n%% working note\n## GM Notes\n%%\nShe is the informant.\n';
const GMO = '## Appearance\nTall, grey coat.\n<!-- gm-only -->\n## GM Notes\n<!-- /gm-only -->\nShe is the informant.\n';
const FORMS = [['%% comment', PCT], ['gm-only block', GMO]];
const EXCLUDE = ['GM Notes'];

for (const [form, note] of FORMS) {
  test(`stub (${form}): the text after a hidden GM Notes heading is withheld`, () => {
    const out = keepOnlySections(note, ['Appearance'], { excludeSections: EXCLUDE });
    assert.match(out, /Tall, grey coat\./);
    assert.doesNotMatch(out, /informant|GM Notes/);
    const flags = keptSectionFlags(note, ['Appearance'], { excludeSections: EXCLUDE });
    assert.equal(flags[5], false, 'the line is not kept');
  });

  test(`full page (${form}): the text after a hidden GM Notes heading is withheld, and the GM hears why`, () => {
    const { text, warnings } = playerSafeMarkdown(note, { excludeSections: EXCLUDE });
    assert.match(text, /Tall, grey coat\./);
    assert.doesNotMatch(text, /informant|GM Notes/);
    assert.ok(warnings.some((w) => /"GM Notes"/.test(w) && /hidden block/.test(w)), JSON.stringify(warnings));
  });

  test(`full page render (${form}): processContent withholds it too`, () => {
    const { html, warnings } = processContent({ markdown: note, frontmatter: { type: 'npc' }, outputPath: 'npcs/x.html' }, {}, EXCLUDE);
    assert.match(html, /Tall, grey coat\./);
    assert.doesNotMatch(html, /informant|GM Notes/);
    assert.ok(warnings.some((w) => /"GM Notes"/.test(w)), JSON.stringify(warnings));
  });

  test(`GM site (${form}): the same text is marked hidden, in a GM Notes section mark`, () => {
    const marks = createMarks();
    const mark = { marks, show: new Set(markKinds()) };
    const out = playerSafeMarkdown(note, { excludeSections: EXCLUDE, mark }).text;
    assert.match(out, /She is the informant\./);
    assert.doesNotMatch(withoutMarked(out, marks), /informant/);
    // The mark that holds the sentence is the section's, opened after the hidden block has closed.
    const at = out.indexOf('She is the informant.');
    const open = out.lastIndexOf('\uE000', at);
    const id = parseInt(out.slice(open + 1, out.indexOf('\uE001', open)), 36);
    assert.deepEqual(marks.get(id), { kind: 'sections', label: 'GM Notes section' });
  });

  test(`GM site stub (${form}): the text is inside the stub's mark`, () => {
    const marks = createMarks();
    const out = stubMarked(note, ['Appearance'], { excludeSections: EXCLUDE }, { marks, show: new Set(markKinds()) });
    assert.match(out, /She is the informant\./);
    assert.doesNotMatch(withoutMarked(out, marks), /informant/);
    assert.match(withoutMarked(out, marks), /Tall, grey coat\./);
  });
}

test('GM site with comments not shown (the default): the cut comment\'s heading still marks the text after it', () => {
  const marks = createMarks();
  const show = new Set(markKinds().filter((k) => k !== 'comments'));
  const { html } = processContent({ markdown: PCT, frontmatter: { type: 'npc' }, outputPath: 'npcs/x.html' }, {}, EXCLUDE, {}, { mark: { marks, show } });
  assert.match(html, /She is the informant\./);
  const at = html.indexOf('She is the informant.');
  const open = html.lastIndexOf('\uE000', at);
  assert.ok(open >= 0 && html.indexOf('\uE002', open) > at, 'inside a mark');
  assert.equal(marks.get(parseInt(html.slice(open + 1, html.indexOf('\uE001', open)), 36)).label, 'GM Notes section');
});

test('a heading inside a hidden block ends no hidden section, on the player site and on the GM site alike', () => {
  const note = 'Intro.\n\n## GM Notes\nsecret\n<!-- gm-only -->\n## Appearance\n<!-- /gm-only -->\nAFTERBLOCK\n\n## Voice\nLow.\n';
  assert.doesNotMatch(playerSafeMarkdown(note, { excludeSections: EXCLUDE }).text, /AFTERBLOCK/);
  const marks = createMarks();
  const out = playerSafeMarkdown(note, { excludeSections: EXCLUDE, mark: { marks, show: new Set(markKinds()) } }).text;
  const seen = withoutMarked(out, marks);
  assert.doesNotMatch(seen, /AFTERBLOCK|secret/);
  assert.match(seen, /Low\./);
});

// The kind and label of the innermost mark around `needle` in a GM site's text, reading the tokens as they nest.
function innermost(text, marks, needle) {
  const at = text.indexOf(needle);
  const stack = [];
  for (const m of text.slice(0, at).matchAll(/\uE000([0-9a-z]+)\uE001|\uE002/g)) {
    if (m[1] !== undefined) stack.push(parseInt(m[1], 36));
    else stack.pop();
  }
  return stack.length ? marks.get(stack[stack.length - 1]) : null;
}

test('GM site: a withheld run that changes section inside a gm-only block does not cut the block\'s mark short', () => {
  const note = '## Background\nKept.\n\n## Secrets\ns1\n<!-- gm-only -->\n## GM Notes\nINNER\n<!-- /gm-only -->\nAFTER\n\n## Background Two\nx\n';
  const marks = createMarks();
  const out = playerSafeMarkdown(note, {
    excludeSections: EXCLUDE, frontmatter: { type: 'pc' }, pcKeepSections: ['Background'], mark: { marks, show: new Set(markKinds()) },
  }).text;
  assert.equal(innermost(out, marks, 'INNER').kind, 'gm_only_blocks');
  assert.equal(innermost(out, marks, 's1').kind, 'sections');
  assert.equal(innermost(out, marks, 'AFTER').kind, 'sections');
  assert.equal(innermost(out, marks, 'Kept.'), null);
  // Every close has an open, and none is left open.
  let depth = 0;
  for (const m of out.matchAll(/\uE000[0-9a-z]+\uE001|\uE002/g)) { depth += m[0] === '\uE002' ? -1 : 1; assert.ok(depth >= 0); }
  assert.equal(depth, 0);
});

test('a stub: a hidden heading the stub does not name ends the kept section; the heading itself never prints', () => {
  const note = '## Appearance\nTall.\n%%\n## Plans\n%%\nPLANTEXT\n\n## Voice\nLow.\n';
  const out = keepOnlySections(note, ['Appearance', 'Voice'], {});
  assert.match(out, /Tall\./);
  assert.match(out, /Low\./);
  assert.doesNotMatch(out, /PLANTEXT|Plans/);
});

test('a stub: a hidden deeper heading inside a kept section keeps the text, and the heading does not print', () => {
  const note = '## Appearance\nTall.\n%%\n### Scar\n%%\nA scar.\n\n## Plans\nNo.\n';
  const out = keepOnlySections(note, ['Appearance'], {});
  assert.match(out, /A scar\./);
  assert.doesNotMatch(out, /Scar$|### |Plans|No\./m);
});

test('a hidden heading the page does not withhold changes nothing, and is not printed', () => {
  const note = 'Intro.\n\n%%\n## Appearance\n%%\nTall.\n';
  const { text, warnings } = playerSafeMarkdown(note, { excludeSections: EXCLUDE });
  assert.match(text, /Tall\./);
  assert.doesNotMatch(text, /Appearance/);
  assert.deepEqual(warnings, []);
});

test('a later heading in the same block that the page keeps cancels an earlier withheld one', () => {
  const note = 'Intro.\n\n<!-- gm-only -->\n## GM Notes\nx\n## Appearance\n<!-- /gm-only -->\nTall.\n';
  const { text } = playerSafeMarkdown(note, { excludeSections: EXCLUDE });
  assert.match(text, /Tall\./);
  assert.doesNotMatch(text, /GM Notes|Appearance|^x$/m);
});

test('a hidden callout that holds the heading withholds what follows it', () => {
  const note = '## Appearance\nTall.\n\n> [!note]\n> ## GM Notes\n\nCALLOUTSECRET\n\n## Voice\nLow.\n';
  const { text } = playerSafeMarkdown(note, { excludeSections: EXCLUDE, excludeCallouts: true });
  assert.match(text, /Tall\./);
  assert.match(text, /Low\./);
  assert.doesNotMatch(text, /CALLOUTSECRET/);
});

test('the withholding runs to the next heading of the same or higher level, not further', () => {
  const note = '# Title\n\n## Appearance\nTall.\n%%\n## GM Notes\n%%\nSECRET\n\n### Deeper\nSECRET2\n\n## Voice\nLow.\n';
  const { text } = playerSafeMarkdown(note, { excludeSections: EXCLUDE });
  assert.doesNotMatch(text, /SECRET|Deeper/);
  assert.match(text, /Low\./);
});

test('a spoiler block and an HTML comment holding the heading do the same', () => {
  for (const [open, close] of [['<!-- spoiler -->', '<!-- /spoiler -->'], ['<!--', '-->']]) {
    const note = `## Appearance\nTall.\n${open}\n## GM Notes\n${close}\nHIDDENAFTER\n`;
    assert.doesNotMatch(playerSafeMarkdown(note, { excludeSections: EXCLUDE }).text, /HIDDENAFTER/, open);
    assert.doesNotMatch(keepOnlySections(note, ['Appearance'], { excludeSections: EXCLUDE }), /HIDDENAFTER/, open);
  }
});

test('a closing comment line over a kept === or --- line cancels nothing: the text after the block stays withheld', () => {
  for (const [open, close, rule] of [['%%', '%%', '==='], ['<!--', '-->', '---']]) {
    const note = `Intro.\n\n${open}\n## GM Notes\n${close}\n${rule}\n\nHIDDENAFTER\n`;
    const { text, warnings } = playerSafeMarkdown(note, { excludeSections: EXCLUDE });
    assert.doesNotMatch(text, /HIDDENAFTER/, open);
    assert.ok(warnings.some((w) => /"GM Notes"/.test(w)), JSON.stringify(warnings));
  }
});

test('a stray %% or an open fence in the text a hidden heading withholds is no fault of the page (noteFacts)', () => {
  const head = 'Intro.\n\n<!-- gm-only -->\n## GM Notes\n<!-- /gm-only -->\n';
  const stray = playerSafeMarkdown(`${head}Secret. %% a stray\n`, { excludeSections: EXCLUDE });
  assert.deepEqual(stray.strays, []);
  const fence = playerSafeMarkdown(`${head}Secret.\n\`\`\`\n<!-- gm-only -->\nX\n<!-- /gm-only -->\n`, { excludeSections: EXCLUDE });
  assert.equal(fence.openFence, null);
  // The same faults in text the page prints are still found.
  assert.equal(playerSafeMarkdown('Intro. %% a stray\n', { excludeSections: EXCLUDE }).strays.length, 1);
  assert.notEqual(playerSafeMarkdown('Intro.\n```\n<!-- gm-only -->\nX\n<!-- /gm-only -->\n', { excludeSections: EXCLUDE }).openFence, null);
  // And the stub cut reads them the same way.
  const stub = '## Appearance\nTall.\n<!-- gm-only -->\n## GM Notes\n<!-- /gm-only -->\nSecret. %% a stray\n';
  assert.deepEqual(stubCut(stub, ['Appearance'], { excludeSections: EXCLUDE }).strays, []);
  assert.equal(stubCut('## Appearance\nTall. %% a stray\n', ['Appearance'], { excludeSections: EXCLUDE }).strays.length, 1);
});

test('a heading in a code block inside a hidden block is code: nothing is withheld for it', () => {
  const note = 'Intro.\n\n<!-- gm-only -->\n```\n## GM Notes\n```\n<!-- /gm-only -->\nShown.\n';
  const { text, warnings } = playerSafeMarkdown(note, { excludeSections: EXCLUDE });
  assert.match(text, /Shown\./);
  assert.deepEqual(warnings, []);
});

test('strippedLines with no section rules leaves the lines as they were (the `cut` answer to vault_check)', () => {
  const { lines } = strippedLines(PCT, false);
  assert.deepEqual(lines, ['## Appearance', 'Tall, grey coat.', 'She is the informant.', '']);
});

// #477: a Wrap-Up fences its whole GM Notes section to the end of the file, sub-headings and all. Nothing follows the
// fence, so nothing is withheld and the build stays quiet; real text after the fence still warns.
test('a fenced GM Notes section with only blank lines after the fence draws no warning', () => {
  const ex = ['GM Notes', 'Reconciliation Context'];
  const fenced = '## Recap\nShown.\n<!-- gm-only -->\n## GM Notes\nKeeper text.\n### Reconciliation Context\nMore.\n<!-- /gm-only -->\n';
  for (const tail of ['', '\n', '\n  \n']) {
    const { warnings } = playerSafeMarkdown(fenced + tail, { excludeSections: ex });
    assert.deepEqual(warnings, [], JSON.stringify(tail));
  }
  const after = playerSafeMarkdown(`${fenced}Real text after the fence.\n`, { excludeSections: ex });
  assert.ok(after.warnings.some((w) => /"GM Notes"/.test(w) && /hidden block/.test(w)), JSON.stringify(after.warnings));
  assert.doesNotMatch(after.text, /Real text/);
});
