const { describe, it } = require('node:test');
const assert = require('node:assert');
const { escapeHtml, relativePath, resolveWikiLinks, filterSections, stripDataview, stripLeadingH1 } = require('../../lib/processor');

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    assert.strictEqual(escapeHtml('<script>'), '&lt;script&gt;');
  });

  it('escapes ampersand', () => {
    assert.strictEqual(escapeHtml('A & B'), 'A &amp; B');
  });

  it('escapes quotes', () => {
    assert.strictEqual(escapeHtml('"test"'), '&quot;test&quot;');
  });

  it('handles null/undefined', () => {
    assert.strictEqual(escapeHtml(null), '');
    assert.strictEqual(escapeHtml(undefined), '');
  });
});

describe('relativePath', () => {
  it('returns path unchanged when fromDir is empty', () => {
    assert.strictEqual(relativePath('', 'foo/bar.html'), 'foo/bar.html');
  });

  it('computes relative path with parent traversal', () => {
    assert.strictEqual(relativePath('characters/pcs', 'factions/guild.html'), '../../factions/guild.html');
  });

  it('handles same directory', () => {
    assert.strictEqual(relativePath('characters/pcs', 'characters/pcs/jane.html'), 'jane.html');
  });
});

describe('resolveWikiLinks', () => {
  const linkMap = { 'John Doe': 'characters/pcs/john-doe.html' };

  it('resolves wiki links', () => {
    const result = resolveWikiLinks('See [[John Doe]]', linkMap, 'index.html');
    assert.strictEqual(result, 'See [John Doe](characters/pcs/john-doe.html)');
  });

  it('uses display text when provided', () => {
    const result = resolveWikiLinks('See [[John Doe|the hero]]', linkMap, 'index.html');
    assert.strictEqual(result, 'See [the hero](characters/pcs/john-doe.html)');
  });

  it('returns display text only for unknown links', () => {
    const result = resolveWikiLinks('See [[Unknown]]', linkMap, 'index.html');
    assert.strictEqual(result, 'See Unknown');
  });
});

describe('filterSections', () => {
  it('removes excluded sections', () => {
    const md = '# Title\n\n## Keep\nContent\n\n## Remove\nSecret';
    const result = filterSections(md, ['Remove']);
    assert.ok(result.includes('## Keep'));
    assert.ok(!result.includes('## Remove'));
    assert.ok(!result.includes('Secret'));
  });

  it('is case-insensitive', () => {
    const md = '## PLAYER NOTES\nSecret';
    const result = filterSections(md, ['Player Notes']);
    assert.ok(!result.includes('Secret'));
  });
});

describe('stripDataview', () => {
  it('removes dataview blocks', () => {
    const md = 'Before\n```dataview\nLIST\n```\nAfter';
    const result = stripDataview(md);
    assert.strictEqual(result, 'Before\n\nAfter');
  });
});

describe('stripLeadingH1', () => {
  it('removes leading H1', () => {
    const md = '# Title\n\nContent';
    const result = stripLeadingH1(md);
    assert.ok(!result.includes('# Title'));
    assert.ok(result.includes('Content'));
  });

  it('preserves non-leading H1', () => {
    const md = 'Intro\n\n# Title\n\nContent';
    const result = stripLeadingH1(md);
    assert.ok(result.includes('# Title'));
  });
});
