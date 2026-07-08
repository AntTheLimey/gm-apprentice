const { describe, it } = require('node:test');
const assert = require('node:assert');
const { excerptFromMarkdown } = require('../../lib/excerpt');

describe('excerptFromMarkdown', () => {
  it('returns the first prose sentence, skipping heading lines', () => {
    const md = '## Overview\n\nA rusted mining station orbits the dim star. It hums.\n';
    assert.strictEqual(
      excerptFromMarkdown(md),
      'A rusted mining station orbits the dim star.');
  });

  it('never reads past an excluded section heading', () => {
    const md = '## GM Notes\n\nThe director is secretly a construct built by the syndicate to watch the gate.\n';
    assert.strictEqual(
      excerptFromMarkdown(md, { excludeSections: ['GM Notes'] }), '');
  });

  it('excluded-section match is case-insensitive and mid-document', () => {
    const md = 'Intro line without punctuation\n\n## gm notes\n\nSecret secret secret.\n';
    const out = excerptFromMarkdown(md, { excludeSections: ['GM Notes'] });
    assert.ok(!out.includes('Secret'), 'must not leak excluded content');
    assert.ok(out.startsWith('Intro line'), 'keeps pre-exclusion prose');
  });

  it('drops callout markers but keeps quoted prose', () => {
    const md = '> [!info]\n> The docks never sleep. Cargo moves at all hours.\n';
    assert.strictEqual(
      excerptFromMarkdown(md), 'The docks never sleep.');
  });

  it('resolves wiki-links to their labels', () => {
    const md = 'The crew reports to [[MacMillian_Corp|the Company]] every cycle without fail always.\n';
    const out = excerptFromMarkdown(md);
    assert.ok(out.includes('the Company'));
    assert.ok(!out.includes('[['));
  });

  it('fallback truncates at a word boundary with an ellipsis', () => {
    const words = 'word '.repeat(60).trim();           // 299 chars, no sentence end
    const out = excerptFromMarkdown(words, { limit: 50 });
    assert.ok(out.length <= 51, `got length ${out.length}`);
    assert.ok(out.endsWith('…'));
    assert.ok(!out.endsWith(' …'), 'no dangling space before ellipsis');
  });

  it('short text without sentence end returns as-is, no ellipsis', () => {
    assert.strictEqual(excerptFromMarkdown('Just a fragment'), 'Just a fragment');
  });

  it('accepts rendered HTML input (tags stripped, sentence found)', () => {
    const html = '<p>The station <strong>groans</strong> under load. More text.</p>';
    assert.strictEqual(excerptFromMarkdown(html), 'The station groans under load.');
  });

  it('skips table rows and horizontal rules', () => {
    const md = '| a | b |\n|---|---|\n\n---\n\nReal prose starts here. And continues.\n';
    assert.strictEqual(excerptFromMarkdown(md), 'Real prose starts here.');
  });

  it('matches an excluded heading with closing-hash decoration', () => {
    const md = '## GM Notes ##\n\nThe director is secretly a construct built by the syndicate.\n';
    const out = excerptFromMarkdown(md, { excludeSections: ['GM Notes'] });
    assert.ok(!out.includes('construct'), 'must not leak excluded content');
    assert.ok(!out.includes('##'), 'must not leak the literal heading markup');
  });

  it('matches an excluded heading with a heading-id anchor', () => {
    const md = '## GM Notes {#gm-notes}\n\nThe director is secretly a construct built by the syndicate.\n';
    const out = excerptFromMarkdown(md, { excludeSections: ['GM Notes'] });
    assert.ok(!out.includes('construct'), 'must not leak excluded content');
  });

  it('matches an excluded heading with a trailing colon', () => {
    const md = '## GM Notes:\n\nThe director is secretly a construct built by the syndicate.\n';
    const out = excerptFromMarkdown(md, { excludeSections: ['GM Notes'] });
    assert.ok(!out.includes('construct'), 'must not leak excluded content');
  });

  it('matches an excluded heading with emphasized heading text', () => {
    const md = '## **GM Notes**\n\nThe director is secretly a construct built by the syndicate.\n';
    const out = excerptFromMarkdown(md, { excludeSections: ['GM Notes'] });
    assert.ok(!out.includes('construct'), 'must not leak excluded content');
  });

  it('recognizes indented and tab-indented headings as headings', () => {
    const spaceIndented = '  ## GM Notes\n\nThe director is secretly a construct built by the syndicate.\n';
    const tabIndented = '\t## GM Notes\n\nThe director is secretly a construct built by the syndicate.\n';
    const outSpace = excerptFromMarkdown(spaceIndented, { excludeSections: ['GM Notes'] });
    const outTab = excerptFromMarkdown(tabIndented, { excludeSections: ['GM Notes'] });
    assert.ok(!outSpace.includes('construct'), 'must not leak excluded content (space-indented)');
    assert.ok(!outSpace.includes('#'), 'must not leak the literal heading markup (space-indented)');
    assert.ok(!outTab.includes('construct'), 'must not leak excluded content (tab-indented)');
    assert.ok(!outTab.includes('#'), 'must not leak the literal heading markup (tab-indented)');
  });

  it('trims excludeSections entries before matching', () => {
    const md = '## GM Notes\n\nThe director is secretly a construct built by the syndicate.\n';
    const out = excerptFromMarkdown(md, { excludeSections: [' GM Notes '] });
    assert.ok(!out.includes('construct'), 'must not leak excluded content');
  });
});
