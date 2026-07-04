const { describe, it } = require('node:test');
const assert = require('node:assert');
const { escapeHtml, relativePath, relativeHref, parseWikiRef, resolveWikiLinks, filterSections, stripDataview, stripLeadingH1, stripGmOnly, stripSpoiler, filterFields, renderRelationships } = require('../../lib/processor');

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

describe('parseWikiRef', () => {
  it('splits target and alias, keeping the target raw for lookups', () => {
    assert.deepStrictEqual(
      parseWikiRef('[[Lord_Percival_Harcourt|Lord Percival]]'),
      { target: 'Lord_Percival_Harcourt', label: 'Lord Percival' },
    );
  });
  it('humanizes the target as the label when there is no alias', () => {
    assert.deepStrictEqual(
      parseWikiRef('[[Lord_Percival_Harcourt]]'),
      { target: 'Lord_Percival_Harcourt', label: 'Lord Percival Harcourt' },
    );
  });
  it('handles bare (bracketless) refs and empties', () => {
    assert.deepStrictEqual(parseWikiRef('Upper_City'), { target: 'Upper_City', label: 'Upper City' });
    assert.deepStrictEqual(parseWikiRef(''), { target: '', label: '' });
    assert.deepStrictEqual(parseWikiRef(null), { target: '', label: '' });
  });
});

describe('relativeHref (file → file)', () => {
  it('does not drop intermediate dirs across sibling subtrees (B3)', () => {
    // Regression: passing the page FILE as fromDir added an extra ../, dropping `chapters/`.
    assert.strictEqual(
      relativeHref('chapters/chapter-1-london/chapter-1-overview.html',
        'chapters/chapter-2-vienna/chapter-2-overview.html'),
      '../chapter-2-vienna/chapter-2-overview.html',
    );
  });

  it('links from a root-level file into a subtree', () => {
    assert.strictEqual(relativeHref('index.html', 'chapters/c1/c1.html'), 'chapters/c1/c1.html');
  });

  it('links within the same directory', () => {
    assert.strictEqual(relativeHref('a/b/c.html', 'a/b/d.html'), 'd.html');
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

  it('humanizes underscore slugs in resolved link text (no raw slug)', () => {
    const map = { 'Lord_Percival_Harcourt': 'characters/npcs/lord-percival-harcourt.html' };
    const result = resolveWikiLinks('Meet [[Lord_Percival_Harcourt]]', map, 'index.html');
    assert.strictEqual(result, 'Meet [Lord Percival Harcourt](characters/npcs/lord-percival-harcourt.html)');
  });

  it('humanizes underscore slugs for unresolved links (plain text, not a dead anchor)', () => {
    const result = resolveWikiLinks('Meet [[Yog_Sothoth]]', {}, 'index.html');
    assert.strictEqual(result, 'Meet Yog Sothoth');
  });

  it('still honors an explicit alias verbatim', () => {
    const map = { 'Lord_Percival_Harcourt': 'x.html' };
    const result = resolveWikiLinks('[[Lord_Percival_Harcourt|His Lordship]]', map, 'index.html');
    assert.strictEqual(result, '[His Lordship](x.html)');
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

describe('stripGmOnly', () => {
  it('removes content between gm-only markers', () => {
    const md = 'Public text\n<!-- gm-only -->\nSecret stuff\n<!-- /gm-only -->\nMore public';
    const result = stripGmOnly(md);
    assert.strictEqual(result, 'Public text\n\nMore public');
  });

  it('handles multiple gm-only blocks', () => {
    const md = 'A\n<!-- gm-only -->\nB\n<!-- /gm-only -->\nC\n<!-- gm-only -->\nD\n<!-- /gm-only -->\nE';
    const result = stripGmOnly(md);
    assert.strictEqual(result, 'A\n\nC\n\nE');
  });

  it('strips from unclosed marker to end of file', () => {
    const md = 'Public\n<!-- gm-only -->\nSecret to end';
    const { text, warnings } = stripGmOnly(md);
    assert.strictEqual(text, 'Public\n');
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('unclosed'));
  });

  it('ignores markers inside fenced code blocks', () => {
    const md = 'Text\n```\n<!-- gm-only -->\ncode\n<!-- /gm-only -->\n```\nAfter';
    const result = stripGmOnly(md);
    assert.strictEqual(result, md);
  });

  it('returns input unchanged when no markers present', () => {
    const md = 'Just normal text\nWith multiple lines';
    const result = stripGmOnly(md);
    assert.strictEqual(result, md);
  });

  it('handles markers with extra whitespace', () => {
    const md = 'Public\n<!--  gm-only  -->\nSecret\n<!--  /gm-only  -->\nMore';
    const result = stripGmOnly(md);
    assert.strictEqual(result, 'Public\n\nMore');
  });
});

describe('stripSpoiler', () => {
  it('removes content between spoiler markers', () => {
    const md = 'Public text\n<!-- spoiler -->\nSecret stuff\n<!-- /spoiler -->\nMore public';
    const result = stripSpoiler(md);
    assert.strictEqual(result, 'Public text\n\nMore public');
  });

  it('handles multiple spoiler blocks', () => {
    const md = 'A\n<!-- spoiler -->\nB\n<!-- /spoiler -->\nC\n<!-- spoiler -->\nD\n<!-- /spoiler -->\nE';
    const result = stripSpoiler(md);
    assert.strictEqual(result, 'A\n\nC\n\nE');
  });

  it('warns on an unclosed spoiler marker', () => {
    const md = 'Public\n<!-- spoiler -->\nSecret to end';
    const { text, warnings } = stripSpoiler(md);
    assert.strictEqual(text, 'Public\n');
    assert.ok(warnings[0].includes('spoiler'));
  });

  it('treats a spoiler marker inside a code fence as literal', () => {
    const md = 'Text\n```\n<!-- spoiler -->\ncode\n<!-- /spoiler -->\n```\nAfter';
    const result = stripSpoiler(md);
    assert.strictEqual(result, md);
  });

  it('does not strip gm-only markers, and stripGmOnly does not strip spoiler markers', () => {
    const md = '<!-- gm-only -->\nA\n<!-- /gm-only -->\n<!-- spoiler -->\nB\n<!-- /spoiler -->';
    assert.strictEqual(stripSpoiler(md), '<!-- gm-only -->\nA\n<!-- /gm-only -->\n');
    assert.strictEqual(stripGmOnly(md), '\n<!-- spoiler -->\nB\n<!-- /spoiler -->');
  });
});

describe('filterFields', () => {
  it('removes specified fields from frontmatter', () => {
    const fm = { type: 'npc', occupation: 'Spy', secrets: 'Works for the enemy' };
    const result = filterFields(fm, ['secrets']);
    assert.deepStrictEqual(result, { type: 'npc', occupation: 'Spy' });
  });

  it('does not mutate the original frontmatter', () => {
    const fm = { type: 'npc', secrets: 'Hidden' };
    filterFields(fm, ['secrets']);
    assert.strictEqual(fm.secrets, 'Hidden');
  });

  it('handles missing fields gracefully', () => {
    const fm = { type: 'npc', occupation: 'Guard' };
    const result = filterFields(fm, ['secrets', 'current_plan']);
    assert.deepStrictEqual(result, { type: 'npc', occupation: 'Guard' });
  });

  it('applies per-entity overrides to re-include fields', () => {
    const fm = { type: 'faction', current_plan: 'Take over the docks' };
    const result = filterFields(fm, ['current_plan'], { include: ['current_plan'] });
    assert.deepStrictEqual(result, { type: 'faction', current_plan: 'Take over the docks' });
  });

  it('removes multiple fields at once', () => {
    const fm = { type: 'faction', name: 'Guild', secrets: 'X', current_plan: 'Y', plan_progress: 'Z' };
    const result = filterFields(fm, ['secrets', 'current_plan', 'plan_progress']);
    assert.deepStrictEqual(result, { type: 'faction', name: 'Guild' });
  });

  it('returns copy unchanged when excludeFields is empty', () => {
    const fm = { type: 'npc', secrets: 'Still here' };
    const result = filterFields(fm, []);
    assert.deepStrictEqual(result, { type: 'npc', secrets: 'Still here' });
  });
});

describe('renderRelationships', () => {
  it('replaces underscores with spaces in target display text', () => {
    const frontmatter = {
      relationships: [
        { target: '[[Captain_James_Harker]]', type: 'allied_with' },
      ],
    };
    const linkMap = {};
    const result = renderRelationships(frontmatter, linkMap, 'characters/pcs/test.html');
    assert.ok(result.includes('Captain James Harker'), 'Should display underscores as spaces');
    assert.ok(!result.includes('Captain_James_Harker'), 'Should not contain raw underscored name');
  });
});
