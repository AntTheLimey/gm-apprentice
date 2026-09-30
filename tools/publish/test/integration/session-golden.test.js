const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { VARIANTS, buildVariant, mainBlocks } = require('../fixtures/session-golden/variants');
const expected = require('../fixtures/session-golden/expected.json');

// Review of #276: a recap-in-hub session (no Wrap-Up) must render exactly as it did in
// 1.10.17 — the badge block, the page-title H1, the body with "What the Party Learned",
// and, in a vault with no chapters, the prev/next links. expected.json was built by the
// 1.10.17 tool (see fixtures/session-golden/generate.js).
const LIB = path.join(__dirname, '..', '..');
const withoutNav = (html) => html.replace(/<div class="story-nav">[\s\S]*?<\/div>/g, '<div class="story-nav"></div>');

describe('recap-in-hub session pages render as in 1.10.17 (#276 review)', () => {
  for (const variant of Object.keys(VARIANTS)) {
    it(`${variant}: the <main> block is byte-identical${variant === 'chapters' ? ' outside the story-nav' : ''}`, () => {
      const work = fs.mkdtempSync(path.join(os.tmpdir(), `session-golden-${variant}-`));
      try {
        const actual = mainBlocks(buildVariant(LIB, work, variant));
        assert.deepStrictEqual(Object.keys(actual).sort(), Object.keys(expected[variant]).sort());
        for (const [page, html] of Object.entries(expected[variant])) {
          // Chapters restart numbering; #276 regroups their prev/next on purpose.
          if (variant === 'chapters') assert.strictEqual(withoutNav(actual[page]), withoutNav(html), page);
          else assert.strictEqual(actual[page], html, page);
        }
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
      }
    });
  }
});
