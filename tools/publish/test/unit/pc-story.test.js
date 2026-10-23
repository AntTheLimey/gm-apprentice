'use strict';
// tools/publish/test/unit/pc-story.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { playerSafeMarkdown, extractSections } = require('../../lib/processor');
const { storyParts, firstSentence } = require('../../lib/pc-story');

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
  const s = storyParts(sectionsOf(THREE));
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
  const s = storyParts(sectionsOf([
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
  const s = storyParts(sectionsOf(blank));
  assert.equal(s.hasSections, true);
  assert.equal(s.backstoryHtml, '');
  assert.equal(s.appearanceHtml, '');
  assert.deepEqual(s.facts, []);
  assert.deepEqual(s.personality, []);
  assert.equal(s.firstSentence, '');
  // An old note whose one-line fields are only placeholders has no story at all.
  assert.equal(storyParts(sectionsOf('## Background\n**Backstory & Personality:** {text}\n**Appearance:** —\n')), null);
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
  assert.equal(storyParts(sectionsOf('## Notes\nx\n')), null);
  assert.equal(storyParts([]), null);
  assert.equal(storyParts(undefined), null);
  assert.equal(storyParts(sectionsOf('## Background\n**Species:** Elf\n')), null);
});
