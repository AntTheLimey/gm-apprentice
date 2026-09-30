const { describe, it } = require('node:test');
const assert = require('node:assert');
const { stripTags } = require('../../lib/strip-tags');
const { buildSearchIndex } = require('../../lib/search-index');
const { excerptFromMarkdown } = require('../../lib/excerpt');
const { extractRecap } = require('../../lib/templates/landing-data');

describe('plain-text consumers never carry raw tags', () => {
  const markdown = 'The <b>Magellan</b>\'s log.\n\n<div class="handout" style="color:red">Handout text</div>\n\n<svg viewBox="0 0 1 1"><text>Label</text></svg>\n\n<script>var leak = 1;</script>';

  it('search index terms contain no tag or attribute names', () => {
    const { index } = buildSearchIndex([{ displayTitle: 'Log', outputPath: 'log.html', frontmatter: { type: 'document' }, markdown }]);
    const terms = Object.keys(index.invertedIndex || {}).concat((index.invertedIndex || []).map(e => e[0]));
    for (const bad of ['div', 'class', 'handout"', 'style', 'svg', 'viewbox', 'script', 'var', 'leak']) {
      assert.ok(!terms.includes(bad), `search index contains "${bad}": ${terms.join(' ')}`);
    }
    for (const good of ['log', 'handout', 'label']) {
      assert.ok(terms.includes(good), `search index is missing "${good}": ${terms.join(' ')}`);
    }
  });

  it('excerpts contain no tags', () => {
    const excerpt = excerptFromMarkdown(markdown);
    assert.doesNotMatch(excerpt, /[<>]/);
    assert.match(excerpt, /Magellan's log/);
  });

  it('landing recap contains no tags', () => {
    const recap = extractRecap({ frontmatter: {}, publishedMarkdown: '## Narrative Recap\n\n<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>\n\n<div class="handout">The <b>party</b> fled.</div>\n' });
    assert.doesNotMatch(recap, /[<>]/);
    assert.match(recap, /The party fled\./);
  });

  it('stripTags keeps a bare < in prose', () => {
    assert.strictEqual(stripTags('a < b and c > d').trim(), 'a < b and c > d');
  });

  it('stripTags keeps angle-bracket prose and autolinks that are not element names', () => {
    assert.strictEqual(stripTags('Met <Grim> at <https://x.com>, <b>bold</b>.'), 'Met <Grim> at <https://x.com>, bold.');
  });
});
