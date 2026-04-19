const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getLatestSession, extractRecap } = require('../../lib/templates/landing-data');

describe('getLatestSession', () => {
  it('returns the most recent played session by session_number', () => {
    const pages = [
      { frontmatter: { type: 'session', status: 'played', session_number: 1, actual_date: '2026-01-01' }, markdown: '# S1' },
      { frontmatter: { type: 'session', status: 'played', session_number: 3, actual_date: '2026-03-01' }, markdown: '# S3' },
      { frontmatter: { type: 'session', status: 'played', session_number: 2, actual_date: '2026-02-01' }, markdown: '# S2' },
      { frontmatter: { type: 'pc', status: 'alive' }, markdown: '# PC' },
    ];
    const result = getLatestSession(pages);
    assert.strictEqual(result.frontmatter.session_number, 3);
  });

  it('ignores sessions that are not played', () => {
    const pages = [
      { frontmatter: { type: 'session', status: 'planned', session_number: 5 }, markdown: '# S5' },
      { frontmatter: { type: 'session', status: 'played', session_number: 2 }, markdown: '# S2' },
    ];
    const result = getLatestSession(pages);
    assert.strictEqual(result.frontmatter.session_number, 2);
  });

  it('returns null when no played sessions exist', () => {
    const pages = [
      { frontmatter: { type: 'pc' }, markdown: '# PC' },
    ];
    assert.strictEqual(getLatestSession(pages), null);
  });
});

describe('extractRecap', () => {
  it('extracts first paragraph from Narrative Recap section', () => {
    const page = {
      markdown: '# Session 1\n\nSome intro.\n\n## Narrative Recap\n\nThe party arrived at the castle. They were weary from travel.\n\nThen they fought a dragon.\n\n## Loot\n\nSword',
    };
    const result = extractRecap(page);
    assert.strictEqual(result, 'The party arrived at the castle. They were weary from travel.');
  });

  it('strips wiki-links to plain text', () => {
    const page = {
      markdown: '# S1\n\n## Narrative Recap\n\n[[John Smith]] met [[Jane|Jane Doe]] at the [[Tavern]].\n\n## Next',
    };
    const result = extractRecap(page);
    assert.strictEqual(result, 'John Smith met Jane Doe at the Tavern.');
  });

  it('falls back to first body paragraph when no Narrative Recap heading', () => {
    const page = {
      markdown: '# Session 1\n\nThe group gathered at dawn.\n\nThey set off.\n',
    };
    const result = extractRecap(page);
    assert.strictEqual(result, 'The group gathered at dawn.');
  });

  it('truncates to ~500 chars at word boundary', () => {
    const longParagraph = 'Word '.repeat(200).trim();
    const page = {
      markdown: '# S1\n\n## Narrative Recap\n\n' + longParagraph + '\n\n## Next',
    };
    const result = extractRecap(page);
    assert.ok(result.length <= 510);
    assert.ok(result.endsWith('…'));
  });

  it('returns null for null page', () => {
    assert.strictEqual(extractRecap(null), null);
  });
});
