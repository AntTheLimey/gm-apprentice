const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { slugify, mapFolder, buildLinkMap, scanVault, pairStoryFiles } = require('../../lib/scanner');
const { getConfidence } = require('../../lib/templates/base');

describe('slugify', () => {
  it('converts to lowercase', () => {
    assert.strictEqual(slugify('Hello World'), 'hello-world');
  });

  it('removes apostrophes', () => {
    assert.strictEqual(slugify("Captain's Log"), 'captains-log');
  });

  it('converts ampersand to "and"', () => {
    assert.strictEqual(slugify('Factions & Organizations'), 'factions-and-organizations');
  });

  it('replaces non-alphanumeric with hyphens', () => {
    assert.strictEqual(slugify('Item (rare)'), 'item-rare');
  });

  it('trims leading/trailing hyphens', () => {
    assert.strictEqual(slugify('--test--'), 'test');
  });

  it('returns "untitled" for empty string', () => {
    assert.strictEqual(slugify(''), 'untitled');
  });
});

describe('mapFolder', () => {
  const folderMap = {
    'Characters/PCs': 'characters/pcs',
    'Characters/NPCs': 'characters/npcs',
    '_Campaign': 'campaign',
  };

  it('maps exact folder match', () => {
    assert.strictEqual(mapFolder('Characters/PCs', folderMap), 'characters/pcs');
  });

  it('maps nested paths within mapped folder', () => {
    assert.strictEqual(mapFolder('Characters/PCs/subfolder', folderMap), 'characters/pcs/subfolder');
  });

  it('returns null for unmapped folders', () => {
    assert.strictEqual(mapFolder('Unknown', folderMap), null);
  });
});

describe('buildLinkMap', () => {
  it('maps titles to output paths', () => {
    const pages = [
      { title: 'John Doe', outputPath: 'characters/pcs/john-doe.html', frontmatter: {} },
    ];
    const map = buildLinkMap(pages);
    assert.strictEqual(map['John Doe'], 'characters/pcs/john-doe.html');
  });

  it('maps aliases', () => {
    const pages = [
      { title: 'John Doe', outputPath: 'characters/pcs/john-doe.html', frontmatter: { aliases: ['Johnny'] } },
    ];
    const map = buildLinkMap(pages);
    assert.strictEqual(map['Johnny'], 'characters/pcs/john-doe.html');
  });

  it('prefers canonical title over alias', () => {
    const pages = [
      { title: 'John', outputPath: 'a.html', frontmatter: {} },
      { title: 'Jane', outputPath: 'b.html', frontmatter: { aliases: ['John'] } },
    ];
    const map = buildLinkMap(pages);
    assert.strictEqual(map['John'], 'a.html');
  });

  it('redirects superseded entities via source_confidence', () => {
    const pages = [
      { title: 'New Name', outputPath: 'new.html', frontmatter: {} },
      { title: 'Old Name', outputPath: 'old.html', frontmatter: { source_confidence: 'SUPERSEDED', superseded_by: '[[New Name]]' } },
    ];
    const map = buildLinkMap(pages);
    assert.strictEqual(map['Old Name'], 'new.html');
  });

  it('redirects superseded entities via canon_status fallback', () => {
    const pages = [
      { title: 'New Name', outputPath: 'new.html', frontmatter: {} },
      { title: 'Old Name', outputPath: 'old.html', frontmatter: { canon_status: 'SUPERSEDED', superseded_by: '[[New Name]]' } },
    ];
    const map = buildLinkMap(pages);
    assert.strictEqual(map['Old Name'], 'new.html');
  });

  it('excludes DRAFT pages using getConfidence filter (same predicate as build.js)', () => {
    const pages = [
      { title: 'Active NPC', outputPath: 'npc.html', frontmatter: { source_confidence: 'AUTHORITATIVE' } },
      { title: 'Draft NPC', outputPath: 'draft.html', frontmatter: { source_confidence: 'DRAFT' } },
      { title: 'Legacy Draft', outputPath: 'legacy.html', frontmatter: { canon_status: 'DRAFT' } },
    ];
    const filtered = pages.filter(p => getConfidence(p.frontmatter) !== 'DRAFT');
    const map = buildLinkMap(filtered);
    assert.ok('Active NPC' in map);
    assert.ok(!('Draft NPC' in map));
    assert.ok(!('Legacy Draft' in map));
  });
});

describe('scanVault displayTitle', () => {
  const fixturesDir = path.join(__dirname, '..', 'fixtures', 'minimal');
  const config = {
    vaultPath: fixturesDir,
    excludeDirs: ['_meta', '_Templates'],
    folderMap: {
      '_Campaign': 'campaign',
      'Characters/PCs': 'characters/pcs',
      'Characters/NPCs': 'characters/npcs',
      'Locations': 'locations',
    },
  };

  it('sets displayTitle with underscores replaced by spaces', () => {
    const pages = scanVault(config);
    const pc = pages.find(p => p.title === 'Underscored_Name');
    assert.ok(pc, 'Underscored_Name page should exist');
    assert.strictEqual(pc.displayTitle, 'Underscored Name');
  });

  it('preserves title as raw filename for link resolution', () => {
    const pages = scanVault(config);
    const pc = pages.find(p => p.title === 'Underscored_Name');
    assert.ok(pc, 'Underscored_Name page should exist');
    assert.strictEqual(pc.title, 'Underscored_Name');
  });
});

describe('pairStoryFiles', () => {
  const fixturesDir = path.join(__dirname, '..', 'fixtures', 'with-story');
  const config = {
    vaultPath: fixturesDir,
    excludeDirs: ['_meta', '_Templates'],
    folderMap: {
      'Characters/PCs': 'characters/pcs',
    },
  };

  it('attaches storyMarkdown to PC with matching story file', () => {
    const pages = scanVault(config);
    pairStoryFiles(pages, fixturesDir);
    const pc = pages.find(p => p.title === 'Lord_Blackwood');
    assert.ok(pc, 'Lord_Blackwood page should exist');
    assert.ok(pc.storyMarkdown, 'Should have storyMarkdown attached');
    assert.ok(pc.storyMarkdown.includes('The Whitby Letter'));
    assert.ok(pc.storyMarkdown.includes('The Hastings Séance'));
  });

  it('removes story files from the page list', () => {
    const pages = scanVault(config);
    const beforeCount = pages.length;
    pairStoryFiles(pages, fixturesDir);
    const storyPage = pages.find(p => p.title === 'Lord_Blackwood_Story');
    assert.strictEqual(storyPage, undefined, 'Story file should be removed from pages');
    assert.strictEqual(pages.length, beforeCount - 2, 'Both story files should be removed');
  });

  it('leaves PCs without story files unchanged', () => {
    const pages = scanVault(config);
    pairStoryFiles(pages, fixturesDir);
    const pc = pages.find(p => p.title === 'No_Story_PC');
    assert.ok(pc, 'No_Story_PC should exist');
    assert.strictEqual(pc.storyMarkdown, undefined);
  });

  it('only pairs with type: pc pages', () => {
    const pages = scanVault(config);
    pairStoryFiles(pages, fixturesDir);
    const remaining = pages.filter(p => p.frontmatter.type === 'pc');
    assert.strictEqual(remaining.length, 3, 'Should have 3 PCs remaining');
  });

  it('skips story files without type: character-story frontmatter', () => {
    const pages = scanVault(config);
    pairStoryFiles(pages, fixturesDir);
    const pc = pages.find(p => p.title === 'Wrong_Type_PC');
    assert.ok(pc, 'Wrong_Type_PC should exist');
    assert.strictEqual(pc.storyMarkdown, undefined, 'Should not pair with wrong-type story file');
  });

  it('removes wrong-type story files from pages to prevent standalone publishing', () => {
    const pages = scanVault(config);
    pairStoryFiles(pages, fixturesDir);
    const storyPage = pages.find(p => p.title === 'Wrong_Type_PC_Story');
    assert.strictEqual(storyPage, undefined, 'Wrong-type story file should still be removed from pages');
  });
});
