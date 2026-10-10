const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { markersIn } = require('../../lib/markers');
const { playerSafeMarkdown, strippedLines } = require('../../lib/processor');
const { buildVault } = require('../helpers/build-vault');

const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'marker-vectors.json'), 'utf8'));

describe('markers (shared vectors; vaultlib.markers_in must agree)', () => {
  for (const v of VECTORS.cases) {
    it(JSON.stringify(v.line), () => {
      assert.deepStrictEqual(markersIn(v.line).map(({ name, close }) => ({ name, close })), v.found);
    });
  }
});

describe('a marker is obeyed however it is capitalised or spaced', () => {
  const hidden = (md) => playerSafeMarkdown(md, { excludeSections: [] }).text;
  const PAIRS = [
    ['<!-- GM-ONLY -->', '<!-- /GM-ONLY -->'],
    ['<!-- Gm-Only -->', '<!-- /gm-ONLY -->'],
    ['<!--gm-only-->', '<!-- / gm-only -->'],
    ['<!--\tGM-Only\t-->', '<!--  /  GM-Only  -->'],
    ['<!-- SPOILER -->', '<!-- /Spoiler -->'],
    ['<!-- spoiler -->', '<!-- / SPOILER -->'],
  ];
  for (const [open, close] of PAIRS) {
    it(`${open} … ${close} on their own lines`, () => {
      const name = /spoiler/i.test(open) ? 'spoiler' : 'gm-only';
      const plain = hidden(`Before.\n\n<!-- ${name} -->\nSecret.\n<!-- /${name} -->\n\nAfter.`);
      assert.ok(!plain.includes('Secret') && plain.endsWith('After.'));
      assert.strictEqual(hidden(`Before.\n\n${open}\nSecret.\n${close}\n\nAfter.`), plain);
    });
    it(`${open} … ${close} inside a line`, () => {
      assert.strictEqual(hidden(`Before ${open}secret${close} after.`), 'Before  after.');
    });
  }
  it('a closer in capitals closes a block opened in small letters, so the text after it stays', () => {
    assert.strictEqual(hidden('<!-- gm-only -->\nSecret.\n<!-- /GM-ONLY -->\nAfter.'), '\nAfter.');
  });
  it('a marker of one name does not close a block of the other, in any capitals', () => {
    assert.strictEqual(hidden('<!-- GM-ONLY -->\nSecret.\n<!-- /SPOILER -->\nStill secret.'), '');
  });
  it('a marker in capitals shown in a closed code block is an example and prints', () => {
    const md = '```\n<!-- GM-ONLY -->\nshown\n<!-- /GM-ONLY -->\n```\nAfter.';
    assert.strictEqual(hidden(md), md);
  });
  it('the warnings name the marker in small letters', () => {
    const { warnings } = strippedLines('<!-- GM-ONLY -->\nSecret.', false);
    assert.ok(warnings.some((w) => w.includes('unclosed <!-- gm-only --> marker')), warnings.join('; '));
  });
});

describe('a block marked in capitals is in no built file', () => {
  it('page, link previews and search index', () => {
    const v = buildVault({
      'People/Caps.md': '---\ntype: npc\n---\nOpenword one.\n\n<!-- GM-ONLY -->\nSecretcaps here.\n<!-- /GM-ONLY -->\n\nOpenword two.\n',
      'People/Spoil.md': '---\ntype: npc\n---\nOpenword <!-- Spoiler -->secretspoil<!-- /SPOILER --> three.\n',
    });
    try {
      const all = ['people/caps.html', 'people/spoil.html', 'previews.json', 'search-index.json'].map((f) => v.read(...f.split('/'))).join('\n');
      assert.ok(all.includes('Openword'), 'the open text is published');
      assert.ok(!/secretcaps|secretspoil/i.test(all), 'the hidden text is not');
    } finally { v.cleanup(); }
  });
});
