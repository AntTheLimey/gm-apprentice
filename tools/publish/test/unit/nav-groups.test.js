const { describe, it } = require('node:test');
const assert = require('node:assert');
const { generateNavGroups, generateNav } = require('../../lib/templates/nav');

describe('generateNavGroups', () => {
  const pages = [
    { outputDir: 'chapters', outputPath: 'chapters/ch1.html', displayTitle: 'Chapter 1' },
    { outputDir: 'events', outputPath: 'events/battle.html', displayTitle: 'Battle' },
    { outputDir: 'characters/pcs', outputPath: 'characters/pcs/hero.html', displayTitle: 'Hero' },
    { outputDir: 'characters/npcs', outputPath: 'characters/npcs/villain.html', displayTitle: 'Villain' },
    { outputDir: 'locations', outputPath: 'locations/city.html', displayTitle: 'City' },
    { outputDir: 'factions', outputPath: 'factions/guild.html', displayTitle: 'Guild' },
    { outputDir: 'items', outputPath: 'items/sword.html', displayTitle: 'Sword' },
    { outputDir: 'documents', outputPath: 'documents/letter.html', displayTitle: 'Letter' },
    { outputDir: 'creatures', outputPath: 'creatures/dragon.html', displayTitle: 'Dragon' },
  ];

  it('groups pages into 4 semantic categories', () => {
    const groups = generateNavGroups(pages);
    const names = groups.map(g => g.name);
    assert.deepStrictEqual(names, ['Story', 'Characters', 'World', 'Reference']);
  });

  it('Story group contains chapters and events', () => {
    const groups = generateNavGroups(pages);
    const story = groups.find(g => g.name === 'Story');
    const labels = story.links.map(l => l.label);
    assert.ok(labels.includes('Story'));
    assert.ok(labels.includes('Events'));
  });

  it('Characters group contains PCs, NPCs, and Creatures', () => {
    const groups = generateNavGroups(pages);
    const chars = groups.find(g => g.name === 'Characters');
    const labels = chars.links.map(l => l.label);
    assert.ok(labels.includes('Player Characters'));
    assert.ok(labels.includes('NPCs'));
    assert.ok(labels.includes('Creatures'));
  });

  it('World group contains World Overview, Heritages, Locations, Factions, and Items', () => {
    const worldPages = [
      ...pages,
      { outputDir: 'world', outputPath: 'world/geography.html', displayTitle: 'Geography' },
      { outputDir: 'heritages', outputPath: 'heritages/elves.html', displayTitle: 'Elves' },
    ];
    const groups = generateNavGroups(worldPages);
    const world = groups.find(g => g.name === 'World');
    const labels = world.links.map(l => l.label);
    assert.ok(labels.includes('World Overview'));
    assert.ok(labels.includes('Heritages'));
    assert.ok(labels.includes('Locations'));
    assert.ok(labels.includes('Factions & Organizations'));
    assert.ok(labels.includes('Items & Artifacts'));
  });

  it('excludes empty categories from groups', () => {
    const fewPages = [
      { outputDir: 'characters/pcs', outputPath: 'characters/pcs/hero.html', displayTitle: 'Hero' },
    ];
    const groups = generateNavGroups(fewPages);
    const chars = groups.find(g => g.name === 'Characters');
    assert.ok(chars);
    const story = groups.find(g => g.name === 'Story');
    assert.ok(!story);
  });
});

describe('generateNav', () => {
  it('links the Story group at story.html when hasStory is set', () => {
    const pages = [{ outputPath: 'chapters/c1.html', outputDir: 'chapters', frontmatter: { type: 'chapter' } }];
    const navFor = generateNav(pages, { hasStory: true });
    const html = navFor('index.html', { siteTitle: 'T' });
    assert.match(html, /href="story\.html"/);
  });

  it('shows a standalone Story nav link when hasStory but no chapters/sessions/events exist', () => {
    // New campaign: PC backstories published, no sessions played yet.
    const pages = [{ outputPath: 'characters/pcs/hero.html', outputDir: 'characters/pcs', frontmatter: { type: 'pc' } }];
    const navFor = generateNav(pages, { hasStory: true });
    const html = navFor('index.html', { siteTitle: 'T' });
    assert.match(html, /href="story\.html"/);
    assert.match(html, />Story</);
    // mobile entry reuses the shared overlay li>a styling hook (not a bespoke class)
    assert.match(html, /<li><a href="story\.html">Story<\/a><\/li>/);
  });

  it('does not add a duplicate Story entry when a Story group already exists', () => {
    const pages = [{ outputPath: 'chapters/c1.html', outputDir: 'chapters', frontmatter: { type: 'chapter' } }];
    const navFor = generateNav(pages, { hasStory: true });
    const html = navFor('index.html', { siteTitle: 'T' });
    // exactly one desktop story.html link in the top nav-groups (not two)
    const desktopMatches = (html.match(/class="nav-group-toggle"[^>]*href="story\.html"/g) || []).length;
    assert.strictEqual(desktopMatches, 1);
  });
});
