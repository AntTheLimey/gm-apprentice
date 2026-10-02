const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { filterSections, strippedSectionTitles, keepOnlySections } = require('../../lib/processor');

// The heading shapes the section filter has to read as the renderer does.
const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'section-filter-vectors.json'), 'utf8'));

describe('filterSections (shared vectors)', () => {
  for (const v of VECTORS.filter) {
    it(v.name, () => {
      assert.strictEqual(filterSections(v.text, v.excludes), v.kept);
      assert.deepStrictEqual(strippedSectionTitles(v.text, v.excludes), v.stripped);
    });
  }
});

describe('keepOnlySections (shared vectors)', () => {
  for (const v of VECTORS.keepOnly) {
    it(v.name, () => assert.strictEqual(keepOnlySections(v.text, v.include), v.kept));
  }
});

describe('section filter: failure and code', () => {
  const { extractSections } = require('../../lib/processor');
  it('a note the parser cannot read is withheld whole, and says so', () => {
    const said = [];
    const rules = { parse: () => { throw new Error('boom'); }, warn: (m) => said.push(m) };
    assert.strictEqual(filterSections('# T\n## Public\nok\n', ['GM Notes'], null, rules), '');
    assert.match(said[0], /could not parse the note, body withheld \(boom\)/);
    assert.deepStrictEqual(strippedSectionTitles('# T\n', ['GM Notes'], null, rules), ['(unparsed note)']);
  });
  it('extractSections keeps a fenced `##` line inside its section', () => {
    const sections = extractSections('## Gear\n```\n## not a section\n```\nrope\n## Notes\nx\n');
    assert.deepStrictEqual(sections.map(s => s.title), ['Gear', 'Notes']);
    assert.match(sections[0].html, /## not a section/);
  });
  it('extractSections reads a setext level 2 heading as a section', () => {
    assert.deepStrictEqual(extractSections('Gear\n----\nrope\n').map(s => s.title), ['Gear']);
  });
});
