const { describe, it } = require('node:test');
const assert = require('node:assert');
const { generateNavGroups } = require('../../lib/templates/nav');

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
    assert.ok(labels.includes('Chapters'));
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

  it('World group contains Locations, Factions, and Items', () => {
    const groups = generateNavGroups(pages);
    const world = groups.find(g => g.name === 'World');
    const labels = world.links.map(l => l.label);
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
