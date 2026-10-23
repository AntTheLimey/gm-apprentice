'use strict';
// tools/publish/test/unit/pc-story-page.test.js
// The PC page's Story tab opens on the backstory; the sheet tab's teaser; the hook.
const test = require('node:test');
const assert = require('node:assert/strict');
const { playerSafeMarkdown, extractSections } = require('../../lib/processor');
const { pcTemplateWithSettings: pcTemplate } = require('../helpers/settings-files');
const { pcEpithetText } = require('../../lib/pc-header-meta');
const { indexTemplate } = require('../../lib/templates/index-page');

const sectionsOf = (md) => extractSections(playerSafeMarkdown(md).text);
const navFor = () => '';
const config = { siteTitle: 'Test', attachmentsDir: '_attachments' };
const DND = { system: 'dnd-5e-2024' };

const NEW_LAYOUT = [
  '## Background', '',
  '**Species:** Elf', '', '**Class/Subclass:** Wizard 3', '', '**Background:** Sage', '', '**Alignment:** Lawful Neutral', '',
  '### Backstory', '',
  '**The Archivist of Seven Lamps**', '',
  'For a hundred years Ilse kept the index. Nobody asked what she thought.', '',
  'She thought a great deal.', '',
  '### Appearance', '',
  'Tall and narrow, with ink-stained cuffs.', '',
  '**Age:** 112 · **Height:** 5 ft 11 in · **Weight:** — · **Eyes:** grey · **Hair:** — · **Skin:** — · **Faith:** —', '',
  '### Personality', '',
  '- **Traits:** Corrects dates mid-sentence.',
  '- **Ideals:** Knowledge belongs to whoever finds it.',
  '- **Bonds:** —',
  '- **Flaws:** Trusts a record over a witness.', '',
  '## Notes', '', 'Owes the librarian a favour.', '',
].join('\n');

const OLD_LAYOUT = [
  '## Background', '',
  '**Species:** Elf', '', '**Background:** Sage', '',
  '**Backstory & Personality:** Ilse catalogued other people\'s discoveries for a century. Then she left.', '',
  '**Alignment:** Lawful Neutral', '',
  '**Appearance:** Ink-stained cuffs.', '',
].join('\n');

function pcPage(markdown, fm = {}) {
  return {
    title: 'Ilse_Varn', displayTitle: 'Ilse Varn', outputPath: 'characters/pcs/ilse-varn.html',
    markdown, frontmatter: { type: 'pc', player_name: 'Test Player', status: 'alive', ...fm },
  };
}

function render(markdown, context = {}, fm = {}) {
  const page = pcPage(markdown, fm);
  return pcTemplate(page, { html: '' }, sectionsOf(markdown), navFor, config, {}, undefined,
    { ...context, publishConfig: { ...DND, ...(context.publishConfig || {}) } });
}

const panel = (html, id) => {
  const start = html.indexOf(`id="tab-${id}"`);
  assert.ok(start >= 0, `no ${id} panel`);
  const next = html.indexOf('<div class="tab-panel"', start);
  return html.slice(start, next < 0 ? html.indexOf('<script>', start) : next);
};

test('story tab opens on the backstory', () => {
  const html = render(NEW_LAYOUT, {
    storyHref: 'story/characters/ilse-varn.html',
    storyLines: [{ n: 1, title: 'The Road to Ashfall', line: 'Ilse finds her own handwriting.', href: 'story/characters/ilse-varn.html#session-1' }],
  });
  const story = panel(html, 'story');
  assert.match(story, /class="pc-prologue"/);
  assert.match(story, /<p class="pc-prologue-eyebrow">Before the campaign<\/p>/);
  assert.match(story, /class="pc-prologue-title">The Archivist of Seven Lamps</);
  assert.match(story, /<p class="pc-prologue-byline">as their player wrote it<\/p>/);
  // The title paragraph is not repeated in the prose.
  const prose = story.split('class="pc-prologue-prose"')[1].split('</article>')[0];
  assert.doesNotMatch(prose, /Archivist of Seven Lamps/);
  assert.match(prose, /<p>For a hundred years Ilse kept the index\./);
  assert.match(prose, /She thought a great deal/);
  // How they look: initials beside the prose, the facts as chips; a dash fact is not content.
  const look = story.split('class="pc-story-box pc-look"')[1].split('</section>')[0];
  assert.match(look, /How they look/);
  assert.match(look, />IV</);
  assert.match(look, /Tall and narrow/);
  assert.match(look, /<ul class="pc-facts">/);
  assert.match(look, /<li><span class="label">Age<\/span> 112<\/li>/);
  assert.match(look, /5 ft 11 in/);
  assert.doesNotMatch(look, /Weight|Hair|Faith|—/);
  // What drives them: the filled items only.
  const drives = story.split('class="pc-story-box pc-drives"')[1].split('</section>')[0];
  assert.match(drives, /What drives them/);
  assert.deepEqual([...drives.matchAll(/<h4>([^<]+)<\/h4>/g)].map(m => m[1]), ['Traits', 'Ideals', 'Flaws']);
  // The story so far, closed by the link to the story page.
  const sofar = story.split('class="pc-story-box pc-sofar"')[1].split('</section>')[0];
  assert.match(sofar, /The story so far/);
  assert.match(sofar, /Session 1/);
  assert.match(sofar, /The Road to Ashfall/);
  assert.match(sofar, /href="\.\.\/\.\.\/story\/characters\/ilse-varn\.html#session-1"/);
  assert.match(sofar, /Read Ilse Varn's full story &rarr;<\/a>\s*<\/p>\s*$/);
  assert.ok(story.indexOf('pc-prologue') < story.indexOf('pc-look'));
  assert.ok(story.indexOf('pc-look') < story.indexOf('pc-drives'));
  assert.ok(story.indexOf('pc-drives') < story.indexOf('pc-sofar'));
  assert.doesNotMatch(html, /No story content available/);
});

test('story tab: no bold title line gives "{Name}\'s story"; no lines but a story page gives the link alone', () => {
  const md = NEW_LAYOUT.replace('**The Archivist of Seven Lamps**\n\n', '');
  const story = panel(render(md, { storyHref: 'story/characters/ilse-varn.html' }), 'story');
  assert.match(story, /class="pc-prologue-title">Ilse Varn's story</);
  const sofar = story.split('class="pc-story-box pc-sofar"')[1].split('</section>')[0];
  assert.doesNotMatch(sofar, /The story so far|<ol/);
  assert.match(sofar, /Read Ilse Varn's full story &rarr;/);
});

test('story tab: no parts and no story is one muted line; a blank template note is not content', () => {
  const blank = [
    '## Background', '', '**Species:** {Species name}', '',
    '### Backstory', '', '{The character\'s story before the campaign, as the player tells it}', '',
    '### Appearance', '', '{How they look}', '',
    '**Age:** — · **Height:** — · **Weight:** — · **Eyes:** — · **Hair:** — · **Skin:** — · **Faith:** —', '',
    '### Personality', '', '- **Traits:** —', '- **Ideals:** —', '- **Bonds:** —', '- **Flaws:** —', '',
  ].join('\n');
  for (const md of [blank, '## Notes\n\nNothing.\n']) {
    const html = render(md);
    const story = panel(html, 'story');
    assert.match(story, /<p class="text-muted pc-story-none">Ilse Varn's story starts at the table\.<\/p>/);
    assert.doesNotMatch(story, /pc-prologue|pc-look|pc-drives|pc-sofar|\{|—/);
    assert.doesNotMatch(html, /No story content available|pc-story-teaser/);
  }
  // A blank note with the sub-sections still never shows Background as an accordion.
  assert.doesNotMatch(render(blank), /id="background"/);
});

test('sheet tab teaser and no Background accordion', () => {
  const html = render(NEW_LAYOUT, { systemSheetHtml: '<div class="dnd5e-sheet">SHEET</div>' });
  const sheet = panel(html, 'sheet');
  const teaser = sheet.split('<section class="pc-story-teaser"')[1].split('</section>')[0];
  assert.ok(sheet.indexOf('pc-story-teaser') < sheet.indexOf('SHEET'), 'the teaser comes first');
  assert.match(teaser, /From the backstory/);
  // No hook: the pull quote is the first sentence, so the teaser goes on from it.
  assert.match(teaser, /<p class="pc-story-teaser-text">Nobody asked what she thought\. She thought a great deal\.<\/p>/);
  assert.doesNotMatch(teaser, /For a hundred years|Archivist/);
  assert.match(teaser, /onclick="switchTab\('story'\);\s*return false;?"[^>]*>Read on &rarr;<\/a>/);
  assert.doesNotMatch(html, /id="background"/);
  assert.doesNotMatch(html, /accordion-header[^>]*>Background</);
  // The header shows species, class and background; the one line it does not show stays on the sheet tab.
  assert.match(sheet, /<strong>Alignment:<\/strong> Lawful Neutral/);
  assert.doesNotMatch(sheet, /<strong>Species:<\/strong>/);
  // Notes is still an accordion.
  assert.match(html, /id="notes"/);
});

test('teaser: with a hook it opens the backstory; a long one is cut near 280 at a word; one sentence has none', () => {
  const teaserOf = (html) => (panel(html, 'sheet').split('pc-story-teaser-text">')[1] || '').split('</p>')[0];
  // A hook: the pull quote says something else, so the teaser is the first sentence.
  assert.equal(teaserOf(render(NEW_LAYOUT, {}, { hook: 'She would like a discovery of her own.' })), 'For a hundred years Ilse kept the index.');
  // No hook, a long backstory: the text after the first sentence, cut at a word with an ellipsis.
  const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
  const long = teaserOf(render(NEW_LAYOUT.replace('Nobody asked what she thought.', `Then ${words}.`)));
  assert.ok(long.startsWith('Then word0 word1'), long);
  assert.ok(long.endsWith('…') && long.length <= 280 && long.length > 250, `${long.length}: ${long}`);
  assert.match(long, / word\d+…$/);
  // No hook, a one-sentence backstory: no teaser.
  const one = NEW_LAYOUT.replace(' Nobody asked what she thought.', '').replace('She thought a great deal.\n\n', '');
  assert.doesNotMatch(render(one), /pc-story-teaser/);
  assert.match(render(one, {}, { hook: 'A hook.' }), /pc-story-teaser-text">For a hundred years Ilse kept the index\.</);
});

test('other Background sub-sections stay on the page', () => {
  const md = NEW_LAYOUT.replace('### Personality', '### Allies\n\nALLIES-UNIQUE the ferryman at Low Crossing.\n\n### Personality');
  const html = render(md, { systemSheetHtml: '<div class="dnd5e-sheet">SHEET</div>' });
  const rest = panel(html, 'sheet').split('<section class="pc-background-rest">')[1].split('</section>')[0];
  assert.match(rest, /<h3[^>]*>Allies<\/h3>\s*<p>ALLIES-UNIQUE the ferryman at Low Crossing\.<\/p>/);
  assert.match(rest, /<strong>Alignment:<\/strong> Lawful Neutral/);
  assert.doesNotMatch(rest, /Backstory|Appearance|Personality|Tall and narrow|Corrects dates/);
  assert.doesNotMatch(panel(html, 'story'), /ALLIES-UNIQUE/);
});

test('old layout note shows its backstory on the Story tab', () => {
  const html = render(OLD_LAYOUT, { systemSheetHtml: '<div class="dnd5e-sheet">SHEET</div>' });
  const story = panel(html, 'story');
  assert.match(story, /pc-prologue-title">Ilse Varn's story</);
  assert.match(story, /Ilse catalogued other people’s discoveries for a century\. Then she left\./);
  assert.match(story, /class="pc-story-box pc-look"[\s\S]*Ink-stained cuffs/);
  assert.doesNotMatch(story, /pc-drives/);
  const sheet = panel(html, 'sheet');
  assert.match(sheet, /pc-story-teaser-text">Then she left\.</);
  assert.doesNotMatch(html, /id="background"/);
  assert.match(sheet, /<strong>Alignment:<\/strong> Lawful Neutral/);
  assert.doesNotMatch(sheet, /Backstory &amp; Personality|<strong>Appearance:/);
});

test('sheets off still shows the story', () => {
  const html = render(NEW_LAYOUT, {
    sheetsOff: true, identity: [['Class', 'Wizard 3'], ['Species', 'Elf'], ['Background', 'Sage']],
  });
  const story = panel(html, 'story');
  assert.match(story, /pc-prologue-title">The Archivist of Seven Lamps</);
  assert.match(story, /For a hundred years Ilse kept the index/);
  assert.match(story, /pc-drives/);
  const sheet = panel(html, 'sheet');
  assert.match(sheet, /pc-story-teaser/);
  assert.match(sheet, /<strong>Alignment:<\/strong> Lawful Neutral/);
  assert.doesNotMatch(sheet, /<strong>Species:<\/strong>/);
  assert.doesNotMatch(html, /id="background"/);
});

test('hook order', () => {
  const traits = { key_traits: ['meticulous', 'impatient'] };
  // 1. hook, as written (a labelled link prints its label).
  assert.equal(pcEpithetText(pcPage(NEW_LAYOUT, { ...traits, hook: 'A century of [[Seven_Lamps|other people\'s]] discoveries.' })),
    'A century of other people\'s discoveries.');
  // 2. the backstory's first sentence (the title line is not a sentence of it).
  assert.equal(pcEpithetText(pcPage(NEW_LAYOUT, { ...traits, hook: '  ' })), 'For a hundred years Ilse kept the index.');
  // ... or the old one-line field's.
  assert.equal(pcEpithetText(pcPage(OLD_LAYOUT, traits)), 'Ilse catalogued other people’s discoveries for a century.');
  // 3. key_traits.
  assert.equal(pcEpithetText(pcPage('## Background\n\n**Species:** Elf\n', traits)), 'meticulous, impatient');
  // 4. the body's first sentence.
  assert.equal(pcEpithetText(pcPage('A quiet man from the coast.\n\n## Notes\n\nx\n')), 'A quiet man from the coast.');
  // A source that still holds a gm-only block (no published text) never gives it up as the hook.
  const raw = '## Background\n\n### Backstory\n\n<!-- gm-only -->\nGM-HOOK-SECRET is the heir.\n<!-- /gm-only -->\n\nBorn at sea.\n';
  assert.equal(pcEpithetText(pcPage(raw)), 'Born at sea.');
  assert.equal(pcEpithetText(pcPage('<!-- gm-only -->\nGM-HOOK-SECRET opens the body.\n<!-- /gm-only -->\n\nA quiet man.\n')), 'A quiet man.');
  // A comment in the backstory is never the hook.
  assert.equal(pcEpithetText(pcPage('## Background\n\n### Backstory\n\n<!-- a note to self -->\n\nBorn at sea.\n')), 'Born at sea.');
});

test('card carries the hook', () => {
  const ilse = { ...pcPage(NEW_LAYOUT, { hook: 'She would like a discovery of her own.' }), outputPath: 'characters/pcs/ilse-varn.html' };
  const quiet = { ...pcPage(''), title: 'Quiet', displayTitle: 'Quiet', outputPath: 'characters/pcs/quiet.html' };
  const html = indexTemplate('characters/pcs', 'PCs', [ilse, quiet], navFor, config, {}, {});
  const card = (name) => html.split(`data-entity-name="${name}"`)[1].split('</a>')[0];
  assert.match(card('Ilse Varn'), /<p class="card-hook">She would like a discovery of her own\.<\/p>/);
  assert.doesNotMatch(card('Quiet'), /card-hook/);
  // The CoC folio shows no hook, so its card carries none.
  assert.doesNotMatch(indexTemplate('characters/pcs', 'PCs', [ilse], navFor, config, {}, {}, { cocFolio: true }), /card-hook/);
});

test('hook prints the backstory as the prologue shows it: a typed [[ ]] stays, a GM link shows its label', () => {
  const md = (line) => `## Background\n\n### Backstory\n\n${line}\n\nMore follows.\n`;
  assert.equal(pcEpithetText(pcPage(md('She fled \\[\\[Waterdeep\\]\\] at dawn.'))), 'She fled [[Waterdeep]] at dawn.');
  assert.equal(pcEpithetText(pcPage(md('She fled [[Waterdeep|the city]] at dawn.'))), 'She fled the city at dawn.');
  assert.equal(pcEpithetText(pcPage(md('She fled \\[\\[Waterdeep|x\\]\\] at dawn.'))), 'She fled [[Waterdeep|x]] at dawn.');
});

test('facts line: a dot inside a value stays in that fact', () => {
  const md = [
    '## Background', '', '### Appearance', '', 'Tall.', '',
    '**Age:** 31 · **Eyes:** grey · green flecks · **Faith:** the Lamp',
  ].join('\n');
  const { storyParts } = require('../../lib/pc-story');
  const parts = storyParts(sectionsOf(md));
  assert.deepEqual(parts.facts, [
    { label: 'Age', value: '31' },
    { label: 'Eyes', value: 'grey · green flecks' },
    { label: 'Faith', value: 'the Lamp' },
  ]);
});
