const { describe, it } = require('node:test');
const assert = require('node:assert');
const { slugify, mapFolder, buildLinkMap } = require('../../lib/scanner');

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

  it('redirects superseded entities', () => {
    const pages = [
      { title: 'New Name', outputPath: 'new.html', frontmatter: {} },
      { title: 'Old Name', outputPath: 'old.html', frontmatter: { canon_status: 'SUPERSEDED', superseded_by: '[[New Name]]' } },
    ];
    const map = buildLinkMap(pages);
    assert.strictEqual(map['Old Name'], 'new.html');
  });
});
