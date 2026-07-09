const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseTableRows, findSectionByTitle, extractSubsectionHtml } = require('../../../lib/templates/gurps/tables');

describe('gurps/tables', () => {
  it('parses rendered table rows into cell-text arrays', () => {
    const html = '<table><tr><th>A</th><th>B</th></tr><tr><td>Brawling</td><td>15†</td></tr></table>';
    const rows = parseTableRows(html);
    assert.deepStrictEqual(rows[1], ['Brawling', '15†']);
  });
  it('finds a section by any of several titles, case-insensitive', () => {
    const secs = [{ title: 'Stat Sheet', html: '' }];
    assert.ok(findSectionByTitle(secs, 'secondary characteristics', 'stat sheet'));
  });
  it('extracts an h3 subsection body', () => {
    const html = '<h3>Secondary Characteristics</h3><table><tr><td>HP</td><td>10</td></tr></table><h3>Next</h3>';
    assert.ok(extractSubsectionHtml(html, 'Secondary Characteristics').includes('HP'));
  });
  it('extractSubsectionHtml matches title with HTML-entity-encoded & (&amp;)', () => {
    const html = '<h3>Appearance &amp; Social</h3><table><tr><td>Appearance</td><td>Attractive</td></tr></table><h3>Next</h3>';
    const result = extractSubsectionHtml(html, 'Appearance & Social');
    assert.ok(result.includes('Attractive'), 'should extract content under &amp;-encoded heading');
  });
  it('extractSubsectionHtml escapes regex metacharacters in title', () => {
    // A title with () should not cause a regex syntax error
    const html = '<h3>Senses (Extended)</h3><p>test</p>';
    assert.doesNotThrow(() => extractSubsectionHtml(html, 'Senses (Extended)'));
  });
});

describe('topLevelHtml (issue #82)', () => {
  const { topLevelHtml, parseTableRows } = require('../../../lib/templates/gurps/tables');

  it('excludes tables under a ### subheading', () => {
    const html = '<table><tr><th>Name</th></tr><tr><td>Choke Hold</td></tr></table>'
      + '<h3>At a glance</h3><table><tr><th>Technique</th></tr><tr><td>Arm Lock</td></tr></table>';
    const rows = parseTableRows(topLevelHtml(html));
    assert.deepStrictEqual(rows, [['Name'], ['Choke Hold']]);
  });

  it('falls back to the whole section when the only table is under a subheading', () => {
    const html = '<h3>Techniques</h3><table><tr><th>Name</th></tr><tr><td>Kicking</td></tr></table>';
    const rows = parseTableRows(topLevelHtml(html));
    assert.deepStrictEqual(rows, [['Name'], ['Kicking']]);
  });

  it('keeps multiple top-level tables', () => {
    const html = '<table><tr><td>a</td></tr></table><table><tr><td>b</td></tr></table>';
    assert.deepStrictEqual(parseTableRows(topLevelHtml(html)), [['a'], ['b']]);
  });

  it('is inert on a section with no table at all', () => {
    assert.strictEqual(topLevelHtml('<p>prose</p>'), '<p>prose</p>');
  });
});
