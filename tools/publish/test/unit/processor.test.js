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

describe('stripHtmlComments (issue #85)', () => {
  const { stripHtmlComments } = require('../../lib/processor');

  it('removes a standalone comment without splitting the paragraph', () => {
    assert.strictEqual(
      stripHtmlComments('Line one.\n<!-- private note -->\nLine two.'),
      'Line one.\nLine two.');
  });

  it('removes an inline comment', () => {
    assert.strictEqual(stripHtmlComments('before <!-- x --> after'), 'before  after');
  });

  it('removes a multi-line comment', () => {
    assert.strictEqual(
      stripHtmlComments('a\n<!-- one\ntwo\nthree -->\nb'),
      'a\nb');
  });

  it('leaves comments inside fenced code blocks alone', () => {
    const md = '```html\n<!-- keep me -->\n```';
    assert.strictEqual(stripHtmlComments(md), md);
  });

  it('warns and strips to end of file on an unclosed comment', () => {
    const out = stripHtmlComments('visible\n<!-- oops\nswallowed');
    assert.strictEqual(out.text, 'visible');
    assert.match(out.warnings[0], /unclosed/);
  });

  it('returns a plain string when there is nothing to warn about', () => {
    assert.strictEqual(typeof stripHtmlComments('plain text'), 'string');
  });
});

describe('resolveImageEmbeds (issues #86b, #88)', () => {
  const { resolveImageEmbeds } = require('../../lib/processor');
  const imageMap = {
    'Chrome Jockey.png': { relPath: 'heritages/Chrome Jockey.png' },
    'Kung-Fu (Spacer).png': { relPath: 'docs/Kung-Fu (Spacer).png' },
  };

  it('percent-encodes spaces so the link parses as an image', () => {
    const out = resolveImageEmbeds('![[Chrome Jockey.png]]', imageMap, 'heritages/chrome-jockey.html');
    assert.strictEqual(out, '![Chrome Jockey](../images/heritages/Chrome%20Jockey.png)');
  });

  it('encodes parentheses in the destination', () => {
    const out = resolveImageEmbeds('![[Kung-Fu (Spacer).png]]', imageMap, 'documents/x.html');
    const dest = out.slice(out.lastIndexOf('(') + 1, -1);
    assert.strictEqual(dest, '../images/docs/Kung-Fu%20%28Spacer%29.png');
  });

  it('drops an embed that duplicates the page portrait', () => {
    const out = resolveImageEmbeds('![[Chrome Jockey.png]]', imageMap, 'heritages/chrome-jockey.html',
      null, { portraitBasename: 'Chrome Jockey.png' });
    assert.strictEqual(out, '');
  });

  it('keeps the embed when the portrait names a different file', () => {
    const out = resolveImageEmbeds('![[Chrome Jockey.png]]', imageMap, 'heritages/chrome-jockey.html',
      null, { portraitBasename: 'Other.png' });
    assert.match(out, /<img|!\[Chrome Jockey\]/);
  });

  it('keeps the embed when the portrait is not a scanned image', () => {
    const out = resolveImageEmbeds('![[Chrome Jockey.png]]', imageMap, 'heritages/chrome-jockey.html',
      null, { portraitBasename: 'Missing.png' });
    assert.match(out, /!\[Chrome Jockey\]/);
  });

  it('removes a missing embed rather than leaving a visible comment', () => {
    const out = resolveImageEmbeds('![[Nope.png]]', imageMap, 'x.html');
    assert.strictEqual(out, '');
  });

  it('still records the image as used before deduping', () => {
    const used = new Set();
    resolveImageEmbeds('![[Chrome Jockey.png]]', imageMap, 'heritages/chrome-jockey.html',
      used, { portraitBasename: 'Chrome Jockey.png' });
    assert.ok(used.has('Chrome Jockey.png'));
  });

  it('leaves a non-image embed untouched', () => {
    assert.strictEqual(resolveImageEmbeds('![[Some Note]]', imageMap, 'x.html'), '![[Some Note]]');
  });
});

describe('renderMetaValue / plainMetaValue (issue #86c)', () => {
  const { renderMetaValue, plainMetaValue } = require('../../lib/processor');
  const linkMap = { 'Corvid Financial': 'factions/corvid-financial.html' };

  it('resolves a wikilink in a frontmatter-derived field', () => {
    const out = renderMetaValue('Agent for [[Corvid Financial]]', linkMap, 'characters/npcs/marek.html');
    assert.strictEqual(out,
      'Agent for <a href="../../factions/corvid-financial.html" class="entity-link">Corvid Financial</a>');
  });

  it('honors an explicit alias', () => {
    const out = renderMetaValue('[[Corvid Financial|the bank]]', linkMap, 'x.html');
    assert.match(out, />the bank<\/a>/);
  });

  it('degrades an unresolved link to humanized plain text', () => {
    assert.strictEqual(renderMetaValue('sees [[P.E.T.A.]]', {}, 'x.html'), 'sees P.E.T.A.');
    assert.strictEqual(renderMetaValue('[[Lord_Percival]]', {}, 'x.html'), 'Lord Percival');
  });

  it('escapes surrounding text', () => {
    assert.strictEqual(renderMetaValue('a < b & c', {}, 'x.html'), 'a &lt; b &amp; c');
  });

  it('plainMetaValue never emits an anchor', () => {
    assert.strictEqual(plainMetaValue('Agent for [[Corvid Financial]]'), 'Agent for Corvid Financial');
    assert.doesNotMatch(plainMetaValue('[[Corvid Financial]]'), /</);
  });
});

describe('stripHtmlComments fence markers (review regression)', () => {
  const { stripHtmlComments } = require('../../lib/processor');

  it('does not let a ``` inside a ~~~ block close the fence', () => {
    const md = ['~~~', '```', 'sample <!-- keep --> here', '~~~'].join('\n');
    assert.strictEqual(stripHtmlComments(md), md);
  });

  it('still strips comments after a fence closes', () => {
    const out = stripHtmlComments(['```', 'code', '```', 'after <!-- gone -->'].join('\n'));
    assert.strictEqual(out, ['```', 'code', '```', 'after '].join('\n'));
  });
});

describe('resolveWikiLinks on non-image transclusions (review regression)', () => {
  const { resolveWikiLinks } = require('../../lib/processor');

  it('degrades ![[Note]] to a link, never a broken <img> src', () => {
    const out = resolveWikiLinks('![[Backstory]]', { Backstory: 'docs/backstory.html' }, 'x.html');
    assert.strictEqual(out, '[Backstory](docs/backstory.html)');
  });

  it('degrades an unresolved ![[Note]] to plain text', () => {
    assert.strictEqual(resolveWikiLinks('![[Nope]]', {}, 'x.html'), 'Nope');
  });

  it('still resolves an ordinary wikilink', () => {
    const out = resolveWikiLinks('[[Backstory]]', { Backstory: 'docs/backstory.html' }, 'x.html');
    assert.strictEqual(out, '[Backstory](docs/backstory.html)');
  });
});
