// tools/publish/test/integration/build-backstory-showcase.test.js
// #483: the D&D backstory showcase (#492) on GURPS and Call of Cthulhu PC pages: the hook under the
// name, the Story tab opening on the prologue, how they look beside the portrait, the system's
// personality fields as cards, the sheet's teaser in place of a closed Background box, and the hook
// on the party list cards. A PC with no backstory keeps the page it had.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { build } = require('../../lib/build');
const { writeSiteConfig } = require('../helpers/vault-files');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const roots = [];

// Builds `fixture` with each PC note edited by `edits` ({ file: text => text }); -> { page(slug), index }.
function site(fixture, system, edits) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-backstory-'));
  roots.push(root);
  const vault = path.join(root, 'vault');
  fs.cpSync(path.join(FIXTURES, fixture), vault, { recursive: true });
  for (const [file, edit] of Object.entries(edits)) {
    const at = path.join(vault, 'Characters', 'PCs', file);
    fs.writeFileSync(at, edit(fs.existsSync(at) ? fs.readFileSync(at, 'utf8') : ''));
  }
  const configPath = path.join(root, 'config.json');
  writeSiteConfig(configPath, {
    vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments', siteTitle: 'Backstory', system,
    excludeDirs: ['_meta', '_Templates'], excludeSections: ['GM Notes'], folderMap: { 'Characters/PCs': 'characters/pcs' },
  }, 2);
  const real = { log: console.log, warn: console.warn };
  console.log = () => {}; console.warn = () => {};
  try { build({ configPath }); } finally { Object.assign(console, real); }
  const dir = path.join(root, 'docs', 'characters', 'pcs');
  return { page: (slug) => fs.readFileSync(path.join(dir, `${slug}.html`), 'utf8'), index: fs.readFileSync(path.join(dir, 'index.html'), 'utf8') };
}
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

// The part of a page between one tab panel's id and the next panel's.
const panel = (html, id) => (html.split(`id="${id}"`)[1] || '').replace(/^[^>]*>/, '').split(/<div class="tab-panel"/)[0];
const card = (index, name) => (index.split(`data-entity-name="${name}"`)[1] || '').split('</a>')[0];
// The parts every system's page shares, read the same way.
function assertShowcase(html, { sheetPanel, storyPanel, cards, quote }) {
  const story = panel(html, storyPanel);
  const sheet = panel(html, sheetPanel);
  assert.ok(html.includes(`<div class="pull-quote pull-quote-backstory">${quote}</div>`), 'hook under the name');
  assert.match(story, /^\s*<article class="pc-prologue">/, 'the Story tab opens on the prologue');
  assert.match(story, /<section class="pc-story-box pc-look">[\s\S]*?class="pc-look-portrait[\s\S]*?class="pc-look-text"/, 'how they look beside the portrait');
  assert.deepStrictEqual([...story.matchAll(/<div class="pc-drive"><h4>([^<]*)<\/h4>/g)].map(m => m[1]), cards);
  assert.match(sheet, /^\s*<section class="pc-backstory-teaser">/, 'the sheet opens on the teaser');
  assert.doesNotMatch(html, /<button class="accordion-header"[^>]*>Background<|<summary>Background<\/summary>/, 'no closed Background box');
}

const GURPS_BACKGROUND = `## Background

### Backstory

Karl walked out of the Black Forest at sixteen with a borrowed rifle. He has never gone back, and the letters stay unopened.

### Appearance

Broad and weathered, a scar through one eyebrow.

### Personality

- **Personality:** Dry, patient, slow to anger.
- **Motivations:** Pay off the debt he owes the Hauptmann.

`;
const withBackground = (bg) => (text) => text.replace('## Skills', `${bg}## Skills`);

describe('GURPS PC with a backstory (the template\'s sub-sections)', () => {
  let s;
  before(() => { s = site('with-gurps-pc', 'gurps-4e', { 'Karl Brenner.md': withBackground(GURPS_BACKGROUND) }); });
  it('gets every part of the showcase, with its own two cards', () => {
    assertShowcase(s.page('karl-brenner'), {
      sheetPanel: 'tab-sheet', storyPanel: 'tab-story', cards: ['Personality', 'Motivations'],
      quote: 'Karl walked out of the Black Forest at sixteen with a borrowed rifle.',
    });
  });
  it('the hook is on its party list card', () => {
    assert.match(card(s.index, 'Karl Brenner'), /<p class="card-hook">Karl walked out of the Black Forest/);
  });
});

describe('GURPS PC with a free-form Background (the old template)', () => {
  it('is the prologue, and the Background box is gone', () => {
    const html = site('with-gurps-pc', 'gurps-4e', {
      'Karl Brenner.md': withBackground('## Background\n\nKarl walked out of the forest. He never went back.\n\n'),
    }).page('karl-brenner');
    assert.match(panel(html, 'tab-story'), /^\s*<article class="pc-prologue">[\s\S]*He never went back/);
    assert.match(panel(html, 'tab-sheet'), /^\s*<section class="pc-backstory-teaser">[\s\S]*He never went back\./);
    assert.doesNotMatch(html, /accordion-header[^>]*>Background</);
  });
});

describe('CoC investigator with a backstory (the folio)', () => {
  let s;
  before(() => {
    s = site('with-coc-pc', 'regency-cthulhu', {
      'Jane_Ashford.md': (t) => t.replace('## Injuries', '### Backstory\n\nJane was raised in a vicarage library. She reads what she is not meant to.\n\n---\n\n## Injuries'),
    });
  });
  it('gets every part of the showcase, with the investigator\'s fields as cards', () => {
    const html = s.page('jane-ashford');
    assertShowcase(html, {
      sheetPanel: 'p-sheet', storyPanel: 'p-story',
      cards: ['Traits', 'Ideology &amp; Beliefs', 'Significant People', 'Meaningful Locations', 'Treasured Possessions'],
      quote: 'Jane was raised in a vicarage library.',
    });
    // The hook sits under the masthead; Personal Description is how she looks, beside her portrait.
    assert.ok(html.indexOf('class="pull-quote') > html.indexOf('class="masthead"') && html.indexOf('class="pull-quote') < html.indexOf('class="fleuron"'));
    assert.match(panel(html, 'p-story'), /<img class="pc-look-portrait" src="[^"]*jane-ashford\.svg"[^>]*>\s*<div class="pc-look-text">\s*<p>A composed, watchful young woman/);
    // The folio has no switchTab: its script opens the Story tab from the teaser's link.
    assert.match(panel(html, 'p-sheet'), /<a href="#story">Read on/);
    assert.ok(html.includes('js/coc-sheet.js'));
  });
  it('the hook is on its party list card', () => {
    assert.match(card(s.index, 'Jane Ashford'), /<p class="card-hook">Jane was raised in a vicarage library\.<\/p>/);
  });
});

describe('CoC investigator with only the sheet\'s fields', () => {
  it('shows how they look and the cards, with no prologue, teaser or hook to invent', () => {
    const { page, index } = site('with-coc-pc', 'regency-cthulhu', {});
    const html = page('jane-ashford');
    const story = panel(html, 'p-story');
    assert.match(story, /^\s*<section class="pc-story-box pc-look">/);
    assert.strictEqual((story.match(/class="pc-drive"/g) || []).length, 5);
    assert.ok(!html.includes('pc-prologue') && !html.includes('pc-backstory-teaser') && !html.includes('pull-quote'));
    assert.doesNotMatch(card(index, 'Jane Ashford'), /card-hook/);
  });
  it('a `hook` is shown under the masthead and on the card', () => {
    const { page, index } = site('with-coc-pc', 'regency-cthulhu', { 'Jane_Ashford.md': (t) => t.replace('type: pc', 'type: pc\nhook: She reads what she should not.') });
    assert.ok(page('jane-ashford').includes('<div class="pull-quote">She reads what she should not.</div>'));
    assert.match(card(index, 'Jane Ashford'), /<p class="card-hook">She reads what she should not\.<\/p>/);
  });
});

describe('PCs with no backstory keep their pages', () => {
  it('GURPS: no showcase part, the Story tab as before', () => {
    const { page } = site('with-gurps-pc', 'gurps-4e', {});
    const html = page('karl-brenner');
    for (const cls of ['pc-prologue', 'pc-look', 'pc-drive', 'pc-backstory-teaser', 'pull-quote-backstory']) assert.ok(!html.includes(cls), cls);
    assert.match(panel(html, 'tab-sheet'), /^\s*<div class="gurps-sheet">/);
  });
  it('CoC: no hook under the masthead, no hook on the card, the Story tab and Record as they were', () => {
    const { page, index } = site('with-coc-pc', 'regency-cthulhu', {
      'Jane_Ashford.md': (t) => t.replace(/## Background[\s\S]*?(?=## Injuries)/, ''),
    });
    const html = page('jane-ashford');
    for (const cls of ['pc-prologue', 'pc-look', 'pc-drive', 'pc-backstory-teaser', 'pull-quote']) assert.ok(!html.includes(cls), cls);
    assert.match(panel(html, 'p-story'), /^\s*<div class="story-prose">\s*<p class="text-muted">No story content available\.<\/p>\s*<\/div>\s*<\/div>/);
    assert.match(panel(html, 'p-sheet'), /^\s*<div class="coc-charsheet">/);
    assert.doesNotMatch(card(index, 'Jane Ashford'), /card-hook/);
  });
});
