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
  it('a withheld title runs to the next level 1 heading, which becomes the page title', () => {
    const out = html('# GM Notes\nsecret\n# Players\nshown\n');
    assert.strictEqual(out, '<p>shown</p>\n');
  });
  it('a withheld title on a sheets-off PC page leaves the kept sections under the real title', () => {
    const page = { markdown: '# GM Notes\nsecret\n# Jean\n## Current Status\nhp 10\n', frontmatter: { type: 'pc' }, outputPath: 'pcs/jean.html' };
    const out = processContent(page, {}, ['GM Notes'], {}, { pcKeepSections: ['Current Status'] }).html;
    assert.ok(!out.includes('secret') && out.includes('hp 10'), out);
  });
  it('an ordinary title is dropped and the body kept, as before', () => {
    assert.strictEqual(html('# Inn\nA cosy inn.\n'), '<p>A cosy inn.</p>\n');
  });
  it('extractSections does not make a section of a bare ##', () => {
    assert.deepStrictEqual(extractSections('## Gear\nrope\n##\nmore\n').map((s) => s.title), ['Gear']);
  });
});

describe('section filter: a PC page with character sheets off', () => {
  const { processContent, filterSections: filter } = require('../../lib/processor');
  const pc = { type: 'pc' };
  const rules = { pcKeepSections: ['Background'] };
  const html = (markdown) => processContent({ markdown, frontmatter: pc, outputPath: 'pcs/aria.html' }, {}, ['GM Notes'], {}, { pcKeepSections: ['Background'] }).html;

  it('withholds an excluded heading the parser does not see, as on any other page', () => {
    for (const note of [
      '# Aria\n## Background\nborn\n## GM Notes\nSECRET\n',
      '# Aria\n## Background\n```\nale\n## GM Notes\nSECRET\n',
      '# Aria\n## Background\n````\nale\n```\n## GM Notes\nSECRET\n',
    ]) {
      assert.ok(!html(note).includes('SECRET'), JSON.stringify(note));
      assert.ok(!filter(note, ['GM Notes'], pc, rules).includes('SECRET'), JSON.stringify(note));
    }
  });
  it('still keeps the keep-listed prose', () => {
    assert.match(html('# Aria\n## Background\nborn\n## GM Notes\nSECRET\n'), /born/);
  });
  it('reports an excluded section once, as excluded', () => {
    assert.deepStrictEqual(strippedSectionTitles('# Aria\n## Background\nborn\n## GM Notes\nSECRET\n## Skills\nx\n', ['GM Notes'], pc, rules), ['GM Notes']);
  });
});

describe('section filter: stub pages open only where both readings agree', () => {
  it('a title the two readings spell differently opens nothing, as before', () => {
    assert.strictEqual(keepOnlySections('x\n## GM  Notes\nSECRET\n', ['GM Notes']), '');
    assert.strictEqual(keepOnlySections('x\n## GM Notes ##\nSECRET\n', ['GM Notes']), '');
    assert.strictEqual(keepOnlySections('x\n## GM Notes\nkept\n', ['GM Notes']), '## GM Notes\nkept\n');
  });
  it('a heading and an include entry that are written the same way still match', () => {
    assert.strictEqual(keepOnlySections('## GM  Notes\nkept', ['GM  Notes']), '## GM  Notes\nkept');
    assert.strictEqual(keepOnlySections('## Overview ##\nkept', ['Overview ##']), '## Overview ##\nkept');
    assert.strictEqual(keepOnlySections('## Over\u00a0view\nkept', ['Over\u00a0view']), '## Over\u00a0view\nkept');
  });
});

describe('section filter: a withheld opening section on a sheets-off PC page', () => {
  const { processContent } = require('../../lib/processor');
  it('does not turn the next # line into the title', () => {
    const page = { markdown: '> ## Secrets\n\nintro\n\n# Public\n\n## Backstory\n\nstory TOK\n', frontmatter: { type: 'pc' }, outputPath: 'pcs/a.html' };
    const { html } = processContent(page, {}, ['GM Notes', 'Secrets'], {}, { pcKeepSections: ['Backstory', 'Overview'] });
    assert.ok(!html.includes('TOK'), html);
  });
});

describe('section filter: the title line and the open code block', () => {
  const { processContent } = require('../../lib/processor');
  const run = (markdown) => processContent({ markdown, frontmatter: { type: 'npc' }, outputPath: 'npcs/x.html' }, {}, ['GM Notes'], {});

  it('a withheld title is recognised however the walk recognises it', () => {
    for (const title of ['# GM  Notes', '# GM Notes', '# GM\tNotes', '  # GM Notes', 'GM Notes\n===']) {
      assert.strictEqual(run(`${title}\nSECRET\n`).html.trim(), '', JSON.stringify(title));
    }
  });
  it('a code block left open inside a withheld section is said out loud', () => {
    const { html, warnings } = run('# Inn\n## GM Notes\n```\nstat block\n## Menu\nale\n');
    assert.strictEqual(html.trim(), '');
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /code block opened inside the withheld section "GM Notes" is never closed/);
  });
  it('a closed code block, or an open one with nothing after it, draws no warning', () => {
    assert.deepStrictEqual(run('# Inn\n## GM Notes\n```\nx\n```\n## Menu\nale\n').warnings, []);
    assert.deepStrictEqual(run('# Inn\n## GM Notes\n```\nstat block\n').warnings, []);
    assert.deepStrictEqual(run('# Inn\n## Menu\n```\nale\n## Rooms\n').warnings, []);
  });
});
