'use strict';
// tools/publish/test/unit/pc-background.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { playerSafeMarkdown, extractSections } = require('../../lib/processor');
const { backgroundParts, firstSentence } = require('../../lib/pc-background');

// A note's markdown as the build hands it to the page: GM text stripped, then split into sections.
const sectionsOf = (md) => extractSections(playerSafeMarkdown(md).text);

const THREE = [
  '## Background', '**Species:** Elf', '',
  '### Backstory', 'Mira grew up in the salt flats. She left at sixteen.', '',
  '<!-- gm-only -->', 'Her mother is the cult leader.', '<!-- /gm-only -->', '',
  'Second paragraph.', '',
  '### Appearance', 'Tall and weathered.', '',
  '**Age:** 31 · **Height:** — · **Weight:** 150 lb · **Eyes:** grey · **Hair:** — · **Skin:** — · **Faith:** Sune', '',
  '### Personality',
  '- **Traits:** Dry wit',
  '- **Ideals:** —',
  '- **Bonds:** The *Salt Wind* crew',
  '- **Flaws:** {flaws}', '',
  '## Notes', 'x',
].join('\n');

test('reads the three sub-sections', () => {
  const s = backgroundParts(sectionsOf(THREE));
  assert.equal(s.hasSections, true);
  assert.match(s.backstoryHtml, /Mira grew up/);
  assert.match(s.backstoryHtml, /Second paragraph/);
  assert.doesNotMatch(s.backstoryHtml, /cult leader|<h3|Tall and weathered/);
  assert.match(s.appearanceHtml, /Tall and weathered/);
  assert.doesNotMatch(s.appearanceHtml, /Age/);
  assert.deepEqual(s.facts, [
    { label: 'Age', value: '31' }, { label: 'Weight', value: '150 lb' },
    { label: 'Eyes', value: 'grey' }, { label: 'Faith', value: 'Sune' },
  ]);
  assert.deepEqual(s.personality.map(p => p.label), ['Traits', 'Bonds']);
  assert.match(s.personality[1].html, /<em>Salt Wind<\/em> crew/);
  assert.equal(s.firstSentence, 'Mira grew up in the salt flats.');
});

test('reads the old one-line fields', () => {
  const s = backgroundParts(sectionsOf([
    '## Background', '**Species:** Elf', '',
    '**Backstory & Personality:** Raised by *wolves*. Dislikes rain.', '',
    '**Appearance:** Scarred.', '',
  ].join('\n')));
  assert.equal(s.hasSections, false);
  assert.match(s.backstoryHtml, /Raised by <em>wolves<\/em>/);
  assert.doesNotMatch(s.backstoryHtml, /Backstory|Appearance|Scarred/);
  assert.match(s.appearanceHtml, /Scarred\./);
  assert.deepEqual(s.facts, []);
  assert.deepEqual(s.personality, []);
  assert.equal(s.firstSentence, 'Raised by wolves.');
});

test('placeholders and dashes are empty', () => {
  const blank = [
    '## Background', '### Backstory', '{Backstory}', '',
    '### Appearance', '{Appearance and manner}', '',
    '**Age:** — · **Height:** — · **Weight:** — · **Eyes:** — · **Hair:** — · **Skin:** — · **Faith:** —', '',
    '### Personality', '- **Traits:** —', '- **Ideals:** {ideals}', '- **Bonds:** —', '- **Flaws:** —', '',
  ].join('\n');
  const s = backgroundParts(sectionsOf(blank));
  assert.equal(s.hasSections, true);
  assert.equal(s.backstoryHtml, '');
  assert.equal(s.appearanceHtml, '');
  assert.deepEqual(s.facts, []);
  assert.deepEqual(s.personality, []);
  assert.equal(s.firstSentence, '');
  // An old note whose one-line fields are only placeholders has no story at all.
  assert.equal(backgroundParts(sectionsOf('## Background\n**Backstory & Personality:** {text}\n**Appearance:** —\n')), null);
});

test('firstSentence cuts at the sentence and at 200', () => {
  assert.equal(firstSentence('One. Two.'), 'One.');
  assert.equal(firstSentence('Really? Yes!'), 'Really?');
  assert.equal(firstSentence('No full stop here'), 'No full stop here');
  assert.equal(firstSentence('Version 3.5 is out. Next.'), 'Version 3.5 is out.');
  const long = 'word '.repeat(80).trim() + '.';
  const cut = firstSentence(long);
  assert.ok(cut.endsWith('…'));
  assert.ok(cut.length <= 200);
  assert.doesNotMatch(cut, /wor…$/);
  assert.equal(firstSentence('abcdefghij klmnop', 12), 'abcdefghij…');
  assert.equal(firstSentence(''), '');
});

test('returns null with no story', () => {
  assert.equal(backgroundParts(sectionsOf('## Notes\nx\n')), null);
  assert.equal(backgroundParts([]), null);
  assert.equal(backgroundParts(undefined), null);
  assert.equal(backgroundParts(sectionsOf('## Background\n**Species:** Elf\n')), null);
});

test('firstSentence skips abbreviations, initials and ellipses', () => {
  assert.equal(firstSentence('Dr. Smith raised her. Then more.'), 'Dr. Smith raised her.');
  assert.equal(firstSentence('St. Albans is home. Next.'), 'St. Albans is home.');
  assert.equal(firstSentence('J. R. Tolkien wrote. More'), 'J. R. Tolkien wrote.');
  assert.equal(firstSentence('He said... nothing. Then'), 'He said... nothing.');
});

test('a half-migrated note falls back to the old one-line field', () => {
  const s = backgroundParts(sectionsOf([
    '## Background', '**Backstory & Personality:** Old tale\nwrapped here.', '',
    '### Backstory', '{Backstory}', '',
    '### Appearance', 'New look.', '',
  ].join('\n')));
  assert.equal(s.hasSections, true);
  assert.match(s.backstoryHtml, /Old tale[\s\S]*wrapped here\./);
  assert.match(s.appearanceHtml, /New look/);
});

test('an old field keeps its hard-wrapped tail and stops at the next label', () => {
  const s = backgroundParts(sectionsOf('## Background\n**Backstory & Personality:** Line one,\nline two.\n**Appearance:** Tall.\n'));
  assert.match(s.backstoryHtml, /line two\./);
  assert.doesNotMatch(s.backstoryHtml, /Tall/);
  assert.match(s.appearanceHtml, /Tall/);
});

test('facts read a colon outside the bold and drop any lone dash', () => {
  const s = backgroundParts(sectionsOf([
    '## Background', '### Appearance', 'Hmm.', '',
    '**Age**: 40 · **Height:** – · **Weight:** - · **Eyes:** &amp;co', '',
  ].join('\n')));
  assert.deepEqual(s.facts, [{ label: 'Age', value: '40' }, { label: 'Eyes', value: '&co' }]);
});

// #483: the Call of Cthulhu and GURPS shapes.
const COC = [
  '## Background', '',
  '**Personal Description:** Composed and watchful,', 'easy to overlook.', '',
  '**Traits:** Patient.', '',
  '**Ideology & Beliefs:** Reads the arrangement anyway.', '',
  '**Significant People:** Lady Vane.', '',
  '**Meaningful Locations:** {Places of importance}', '',
  '**Treasured Possessions:** Her father\'s prayer book.', '',
  '**Club:** The Athenaeum', '',
  '---', '',
  '## Skills', 'x',
].join('\n');

test('a CoC investigator\'s fields: Personal Description is how they look, the rest are cards in the note\'s order', () => {
  const s = backgroundParts(sectionsOf(COC));
  assert.equal(s.backstoryHtml, '');
  assert.match(s.appearanceHtml, /^Composed and watchful,\s+easy to overlook\.$/);
  assert.deepEqual(s.personality.map(p => p.label), ['Traits', 'Ideology & Beliefs', 'Significant People', 'Treasured Possessions']);
  assert.equal(s.firstSentence, '');
});

test('a CoC Background\'s other lines are left for the page, its story fields and closing rule are not', () => {
  const { backgroundRestHtml } = require('../../lib/pc-background');
  const sections = sectionsOf(COC);
  const bg = sections.find(x => x.id === 'background');
  const rest = backgroundRestHtml(bg, [], backgroundParts(sections));
  assert.match(rest, /Club:<\/strong> The Athenaeum/);
  assert.doesNotMatch(rest, /Personal Description|Traits|Ideology|Significant|Treasured|<hr/);
  const plain = sectionsOf(COC.replace('**Club:** The Athenaeum', ''));
  assert.equal(backgroundRestHtml(plain.find(x => x.id === 'background'), [], backgroundParts(plain)), '');
});

test('a CoC Backstory sub-section under the fields is the prologue', () => {
  const s = backgroundParts(sectionsOf(COC.replace('---', '### Backstory\n\nJane was raised in a vicarage. She reads.\n\n---')));
  assert.equal(s.backstoryHtml, '<p>Jane was raised in a vicarage. She reads.</p>');
  assert.equal(s.firstSentence, 'Jane was raised in a vicarage.');
  assert.equal(s.personality.length, 4);
});

test('a Background of prose alone (the GURPS free-form template) is the backstory, all of it', () => {
  const s = backgroundParts(sectionsOf('## Background\n\nKarl walked out of the forest. He never went back.\n\n- a list\n\n---\n\n## Skills\n'));
  assert.equal(s.wholeSection, true);
  assert.match(s.backstoryHtml, /^<p>Karl walked[\s\S]*<li>a list<\/li>\s*<\/ul>$/);
  assert.equal(s.firstSentence, 'Karl walked out of the forest.');
  const { backgroundRestHtml } = require('../../lib/pc-background');
  const sections = sectionsOf('## Background\n\nKarl walked.\n');
  assert.equal(backgroundRestHtml(sections[0], [], backgroundParts(sections)), '');
});

test('a Background with a field line, a table or a heading is not read as prose alone', () => {
  assert.equal(backgroundParts(sectionsOf('## Background\n\nKarl walked.\n\n**Rank:** Sergeant\n')), null);
  assert.equal(backgroundParts(sectionsOf('## Background\n\nKarl walked.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')), null);
  // A bold word opening a sentence is no field.
  assert.equal(backgroundParts(sectionsOf('## Background\n\n**Karl** walked. Far.\n')).firstSentence, 'Karl walked.');
});

test('an unfilled GURPS or CoC template has no background parts to show', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', '..', '..', '..', 'skills', 'shared', 'templates');
  for (const t of ['pc-gurps-4e.md', 'pc-coc-7e.md', 'pc-coc-7e-regency.md']) {
    const body = fs.readFileSync(path.join(dir, t), 'utf8').replace(/^---[\s\S]*?\n---\n/, '');
    const s = backgroundParts(sectionsOf(body));
    assert.ok(s, t);
    assert.equal(s.backstoryHtml + s.appearanceHtml + s.firstSentence, '', t);
    assert.deepEqual(s.personality, [], t);
  }
});

// A field written as a list under its label, and the label variants real notes use (#483 proof run).
test('a CoC field\'s list is its value: label-line text, a list alone, text and a list', () => {
  const md = [
    '## Background', '',
    '**Personal Description:** Tall.', '',
    '**Ideology:** Order above all.', '',
    '**Significant People:**', '- [[Jonathan_Pike|Jonathan Pike]] — mentor', '- Ann, her sister', '',
    '**Meaningful Locations:** Bath, and:', '', '- The Pump Room', '- Lansdown', '',
    '**Treasured Possession:** A locket.', '',
    '**Club:** The Athenaeum', '',
    '## Skills', 'x',
  ].join('\n');
  const sections = sectionsOf(md);
  const s = backgroundParts(sections);
  assert.deepEqual(s.personality.map(p => p.label), ['Ideology & Beliefs', 'Significant People', 'Meaningful Locations', 'Treasured Possessions']);
  const card = (l) => s.personality.find(p => p.label === l).html;
  assert.equal(card('Ideology & Beliefs'), 'Order above all.');
  assert.match(card('Significant People'), /^<ul>\s*<li>[\s\S]*Jonathan Pike[\s\S]*<li>Ann, her sister<\/li>\s*<\/ul>$/);
  assert.match(card('Meaningful Locations'), /^<p>Bath, and:<\/p>\s*<ul>[\s\S]*The Pump Room[\s\S]*Lansdown[\s\S]*<\/ul>$/);
  assert.equal(card('Treasured Possessions'), 'A locket.');
  const { backgroundRestHtml } = require('../../lib/pc-background');
  const rest = backgroundRestHtml(sections.find(x => x.id === 'background'), [], s);
  assert.equal(rest, '<p><strong>Club:</strong> The Athenaeum</p>');
});

test('the short Possessions label and the first of two spellings', () => {
  const s = backgroundParts(sectionsOf('## Background\n\n**Possessions:** A cane.\n\n**Treasured Possessions:** A second.\n'));
  assert.deepEqual(s.personality, [{ label: 'Treasured Possessions', html: 'A cane.' }]);
});

test('a gm-only or spoiler fence, or a %% comment, in a field never reaches its card', () => {
  const md = [
    '## Background', '',
    '**Significant People:**', '- Ann', '<!-- gm-only -->', '- GMSECRET the cultist', '<!-- /gm-only -->', '- Tom', '',
    '**Traits:** Calm %%GMCOMMENT%% and kind.', '',
    '**Meaningful Locations:** Bath.', '', '<!-- spoiler -->', 'SPOILERTEXT under the abbey.', '<!-- /spoiler -->', '',
  ].join('\n');
  const s = backgroundParts(sectionsOf(md));
  const all = JSON.stringify(s);
  for (const secret of ['GMSECRET', 'GMCOMMENT', 'SPOILERTEXT']) assert.ok(!all.includes(secret), secret);
  assert.match(s.personality.find(p => p.label === 'Significant People').html, /Ann[\s\S]*Tom/);
});
