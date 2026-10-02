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

describe('section filter: what reaches the page', () => {
  const { processContent, extractSections } = require('../../lib/processor');
  const page = (markdown, frontmatter = { type: 'npc' }) => ({ markdown, frontmatter, outputPath: 'npcs/x.html' });
  const html = (markdown, fm) => processContent(page(markdown, fm), {}, ['GM Notes'], {}).html;

  it('a divider typed straight under a line of GM Notes publishes nothing', () => {
    const out = html('# Inn\nA cosy inn.\n\n## GM Notes\nThe innkeeper is the cultist.\n---\nHe poisons the ale.\n');
    assert.strictEqual(out, '<p>A cosy inn.</p>\n');
  });
  it('a `##` line in a code block under GM Notes publishes nothing after it', () => {
    const out = html('# Inn\nA cosy inn.\n\n## GM Notes\nsecret\n```\n## Example\n```\nHe poisons the ale.\n');
    assert.strictEqual(out, '<p>A cosy inn.</p>\n');
  });
  it('an underlined, an indented and a non-breaking-space GM Notes heading are all withheld', () => {
    for (const heading of ['GM Notes\n--------', '  ## GM Notes', '## GM Notes']) {
      const out = html(`# Inn\nA cosy inn.\n\n${heading}\nHe poisons the ale.\n`);
      assert.ok(!out.includes('poisons'), `${JSON.stringify(heading)} published: ${out}`);
      assert.ok(out.includes('A cosy inn.'));
    }
  });
  it('an unclosed code block above GM Notes does not publish it', () => {
    assert.ok(!html('# Inn\n## Menu\n```\nale\n## GM Notes\nHe poisons the ale.\n').includes('poisons'));
  });
  it('a note whose title line is itself withheld publishes no body', () => {
    assert.strictEqual(html('# GM Notes\nthe butler did it\n\n## Plan\nambush\n').trim(), '');
    assert.strictEqual(html('\n# GM Notes #\nthe butler did it\n').trim(), '');
  });
  it('a withheld title runs to the next level 1 heading', () => {
    const out = html('# GM Notes\nsecret\n# Players\nshown\n');
    assert.ok(!out.includes('secret') && out.includes('shown'), out);
  });
  it('an ordinary title is dropped and the body kept, as before', () => {
    assert.strictEqual(html('# Inn\nA cosy inn.\n'), '<p>A cosy inn.</p>\n');
  });
  it('extractSections does not make a section of a bare ##', () => {
    assert.deepStrictEqual(extractSections('## Gear\nrope\n##\nmore\n').map((s) => s.title), ['Gear']);
  });
});
