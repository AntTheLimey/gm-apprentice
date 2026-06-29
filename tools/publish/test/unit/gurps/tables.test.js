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
});
