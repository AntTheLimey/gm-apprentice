const { describe, it } = require('node:test');
const assert = require('node:assert');
const { processContent } = require('../../lib/processor');

// The title line of a note is dropped by the page template. When that line is itself a
// withheld heading, the section it opens must go with it. The check reads only the first
// block of the note; these pin that it decides as the whole-note walk does.
const page = (markdown) => processContent({ markdown, frontmatter: { type: 'npc' }, outputPath: 'n/x.html' }, {}, ['GM Notes']).html;

describe('a note whose title line is a withheld heading', () => {
  for (const [name, text] of [
    ['a plain title', '# GM Notes\n\nSECRET\n'],
    ['after blank lines', '\n\n# GM Notes\n\nSECRET\n'],
    ['dressed', '# **GM Notes**\n\nSECRET\n'],
    ['with text straight under it', '# GM Notes\nSECRET on the next line\n\nSECRET\n'],
    ['typed with a non-breaking space and underlined', '# GM Notes\n===\n\nSECRET\n'],
  ]) {
    it(`${name}: the section goes with the title`, () => {
      assert.ok(!/SECRET/.test(page(text)), page(text));
    });
  }
  it('an ordinary title keeps its body, and a later hidden section is still cut', () => {
    const html = page('# Mara Quill\n\nShown.\n\n## GM Notes\n\nSECRET\n\n## After\n\nBack.\n');
    assert.ok(/Shown\./.test(html) && /Back\./.test(html) && !/SECRET/.test(html), html);
  });
  it('a long note is read no further than its title block', () => {
    const body = Array.from({ length: 4000 }, (_, i) => `Line ${i}.`).join('\n\n');
    assert.ok(/Line 3999\./.test(page(`# Mara Quill\n\n${body}\n`)));
  });
});
