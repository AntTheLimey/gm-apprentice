const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { playerSafeMarkdown } = require('../../lib/processor');
const { headingKey, headingKeys, titleNamedIn, SPACE_RANGES, INVISIBLE_RANGES } = require('../../lib/heading-key');
const { buildVault } = require('../helpers/build-vault');

const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'heading-key-vectors.json'), 'utf8'));

describe('heading-key (shared vectors; vault_check._bare_section_title must agree)', () => {
  for (const v of VECTORS.cases) {
    it(JSON.stringify(v.title), () => {
      assert.strictEqual(headingKey(v.title), v.key);
      assert.deepStrictEqual(headingKeys(v.title), v.keys);
    });
  }
});

describe('heading-key: what hides a section (shared vectors)', () => {
  for (const v of VECTORS.named) {
    it(`${JSON.stringify(v.title)} is ${v.named ? '' : 'not '}named by ${JSON.stringify(v.name)}`, () => {
      assert.strictEqual(titleNamedIn(v.title, [v.name]), v.named);
    });
  }
});

describe('heading-key: the two character classes', () => {
  // Every code point in the ranges, as a set.
  const setOf = (ranges) => {
    const out = new Set();
    for (const r of ranges.split(' ')) {
      const [a, b = a] = r.split('-').map((h) => parseInt(h, 16));
      for (let cp = a; cp <= b; cp++) out.add(cp);
    }
    return out;
  };
  const sweep = (re) => {
    const out = new Set();
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      if (re.test(String.fromCodePoint(cp))) out.add(cp);
    }
    return out;
  };
  it('are the ones in the shared vectors (vault_check.py must hold the same)', () => {
    assert.strictEqual(SPACE_RANGES, VECTORS.spaces);
    assert.strictEqual(INVISIBLE_RANGES, VECTORS.invisible);
  });
  it('a space is every Unicode White_Space character, and the blank Braille cell', () => {
    const want = sweep(/\p{White_Space}/u);
    want.add(0x2800);
    assert.deepStrictEqual(setOf(SPACE_RANGES), want);
  });
  it('invisible is every default-ignorable and control character that is not a space, and the annotation marks', () => {
    const want = sweep(/[\p{Default_Ignorable_Code_Point}\p{Cc}\ufff9-\ufffb]/u);
    for (const cp of setOf(SPACE_RANGES)) want.delete(cp);
    assert.deepStrictEqual(setOf(INVISIBLE_RANGES), want);
  });
  it('each one is read as its class says, between two words', () => {
    for (const cp of setOf(SPACE_RANGES)) {
      assert.strictEqual(headingKey(`GM${String.fromCodePoint(cp)}Notes`), 'gm notes', cp.toString(16));
    }
    for (const cp of setOf(INVISIBLE_RANGES)) {
      assert.deepStrictEqual(headingKeys(`GM${String.fromCodePoint(cp)}Notes`), ['gmnotes', 'gm notes'], cp.toString(16));
    }
  });
});

describe('heading-key: character references', () => {
  const md = new (require('markdown-it'))();
  it('every named reference the renderer decodes to a space or to nothing visible is read as one', () => {
    // The renderer's whole table is not exported; the HTML5 names that matter here are.
    const names = ['Tab', 'NewLine', 'nbsp', 'NonBreakingSpace', 'ensp', 'emsp', 'emsp13', 'emsp14', 'numsp', 'puncsp',
      'thinsp', 'ThinSpace', 'hairsp', 'VeryThinSpace', 'MediumSpace', 'ZeroWidthSpace', 'NegativeVeryThinSpace',
      'NegativeThinSpace', 'NegativeMediumSpace', 'NegativeThickSpace', 'zwnj', 'zwj', 'lrm', 'rlm', 'NoBreak',
      'ApplyFunction', 'af', 'InvisibleTimes', 'it', 'InvisibleComma', 'ic', 'shy'];
    for (const name of names) {
      const ref = `&${name};`;
      assert.notStrictEqual(md.utils.unescapeAll(ref), ref, `${ref} is one the renderer decodes`);
      assert.ok(titleNamedIn(`GM${ref}Notes`, ['GM Notes']), ref);
    }
  });
  it('a reference the renderer does not decode stays as typed', () => {
    assert.strictEqual(headingKey('GM&nosuchname;Notes'), 'gm&nosuchname;notes');
    assert.strictEqual(headingKey('GM&constructor;Notes'), 'gm&constructor;notes');
  });
});

describe('titleNamedIn', () => {
  it('reads both sides the same way, and a link by its label and its target', () => {
    assert.ok(titleNamedIn('**GM Notes**:', [' gm notes ']));
    assert.ok(titleNamedIn('[[Secrets|Overview]]', ['Secrets']));
    assert.ok(titleNamedIn('GM Notes', ['_GM Notes_']));
  });
  it('reads a decorated heading as the name: wide-space entities, and a zero-width character for the space', () => {
    assert.ok(titleNamedIn('GM&ensp;Notes', ['GM Notes']));
    assert.ok(titleNamedIn('GM&emsp;Notes', ['GM Notes']));
    assert.ok(titleNamedIn('GM&shy; Notes', ['GM Notes']));
    assert.ok(titleNamedIn('GM\u200bNotes', ['GM Notes']));
    assert.ok(titleNamedIn('GM&#8203;Notes', ['GM Notes']));
  });
  it('different words are not the name', () => {
    assert.ok(!titleNamedIn('GM Notes on travel', ['GM Notes']));
    assert.ok(!titleNamedIn('GM Notes -', ['GM Notes']));
  });
  it('an empty reading names nothing', () => {
    assert.ok(!titleNamedIn('**', ['']));
    assert.ok(!titleNamedIn('GM Notes', []));
  });
});

describe('a decorated hidden heading is not published', () => {
  it('whatever stands in for the space', () => {
    for (const h of ['GM&ensp;Notes', 'GM&emsp;Notes', 'GM\u200bNotes', '**GM&shy; Notes**',
      'GM&hairsp;Notes', 'GM&numsp;Notes', 'GM&puncsp;Notes', 'GM&ZeroWidthSpace;Notes', 'GM&NoBreak;Notes', 'GM&Tab;Notes',
      'G\u200bM\u200bNotes', 'G&zwj;M&ZeroWidthSpace;No&shy;tes']) {
      const got = playerSafeMarkdown('## Pub\nok\n## ' + h + '\nsecret\n## End\nx', { excludeSections: ['GM Notes'] }).text;
      assert.strictEqual(got, '## Pub\nok\n## End\nx', h);
    }
  });
});

describe('a document page\'s Keeper section is withheld however it is spaced', () => {
  const doc = (h) => playerSafeMarkdown('## The Text\nok\n## ' + h + '\nsecret\n', { excludeSections: [], frontmatter: { type: 'document' } }).text;
  it('an invisible character in a word and for the space', () => {
    const plain = doc('Prop Notes');
    assert.ok(!plain.includes('secret'), plain);
    for (const h of ['Prop&hairsp;Notes', 'Prop\u200bNotes', 'Pr\u200bop\u200bNotes', 'Cl\u200bues\u200bfor\u200bthe table']) {
      assert.strictEqual(doc(h), plain, JSON.stringify(h));
    }
  });
});

describe('a hidden heading joined by an entity or a zero-width character is in no built file', () => {
  it('page, link previews and search index', () => {
    const titles = ['GM&hairsp;Notes', 'GM&numsp;Notes', 'GM&puncsp;Notes', 'GM&ZeroWidthSpace;Notes', 'GM&NoBreak;Notes',
      'GM&Tab;Notes', 'G\u200bM\u200bNotes'];
    const files = {};
    titles.forEach((t, i) => { files[`People/N${i}.md`] = `---\ntype: npc\n---\nOpenword ${i}.\n\n## ${t}\n\nHidword${i} here.\n`; });
    const v = buildVault(files);
    try {
      const all = [...titles.map((t, i) => ['people', `n${i}.html`]), ['previews.json'], ['search-index.json']].map((f) => v.read(...f)).join('\n');
      assert.ok(all.includes('Openword 3'), 'the open text is published');
      assert.ok(!/hidword/i.test(all), 'the hidden text is not: ' + (all.match(/hidword\d/gi) || []).join(' '));
    } finally { v.cleanup(); }
  });
});
