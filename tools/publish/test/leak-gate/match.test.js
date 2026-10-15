'use strict';
// tools/publish/test/leak-gate/match.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMatcher, fileText, readOutput, isToolScript } = require('../../lib/leak-gate/match');
const { wordsOf } = require('../../lib/leak-gate/text');

const piece = (s, note = 'N.md', reason = 'r') => { const words = wordsOf(s); return { words, text: words.join(' '), shown: s, note, reason }; };

describe('leak gate: match', () => {
  it('finds a whole piece and only a whole piece', () => {
    const m = createMatcher([piece("Don't tell the duke about the well")]);
    assert.equal(m.scan(wordsOf('x Don’t tell the duke about the well y')).length, 1);
    assert.equal(m.scan(wordsOf("Don't tell the duke about it")).length, 0);
  });
  it('matches through rendering', () => {
    const html = '<p>Don’t tell the <strong>duke</strong> about the\n‘well’ &amp; the–mill.</p>';
    const m = createMatcher([piece("Don't tell the **duke** about the 'well' & the-mill.")]);
    assert.equal(m.scan(wordsOf(fileText('a.html', html))).length, 1);
  });
  it('reads alt, title, aria-label and a meta description, and inline scripts', () => {
    const html = '<head><meta name="description" content="the duke owns the mill"></head><img alt="the vicar hides the key"><script>var d={"t":"the twins swap at dawn"}</script>';
    const words = wordsOf(fileText('a.html', html));
    for (const s of ['the duke owns the mill', 'the vicar hides the key', 'the twins swap at dawn']) {
      assert.equal(createMatcher([piece(s)]).scan(words).length, 1, s);
    }
  });
  it('reads every string of a JSON file, HTML in it as text', () => {
    const json = JSON.stringify({ 'npcs/a.html': { x: '<p>the cellar opens onto the sea</p>' } });
    assert.equal(createMatcher([piece('the cellar opens onto the sea')]).scan(wordsOf(fileText('previews.json', json))).length, 1);
  });
  it('odd files: invalid JSON and non-UTF-8 bytes are read as text, never a crash', () => {
    assert.match(fileText('x.json', '{ not json the cellar opens onto the sea'), /cellar opens/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-odd-'));
    try {
      fs.writeFileSync(path.join(dir, 'bad.txt'), Buffer.from([0xff, 0xfe, 0x41, 0x20, 0x42]));
      fs.mkdirSync(path.join(dir, 'js'));
      fs.writeFileSync(path.join(dir, 'js', 'search.js'), 'tool code');
      fs.writeFileSync(path.join(dir, 'pic.png'), 'the cellar opens onto the sea');
      const rels = readOutput(dir).map((f) => f.rel);
      assert.ok(rels.includes('bad.txt'));
      assert.ok(!rels.includes('pic.png'));
      assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'js', 'search.js')));
      // A file named like a tool script is read unless it is the tool's own bytes (M4).
      assert.ok(rels.includes('js/search.js'));
      fs.copyFileSync(path.join(__dirname, '..', '..', 'js', 'search.js'), path.join(dir, 'js', 'search.js'));
      assert.equal(isToolScript('js/search.js', fs.readFileSync(path.join(dir, 'js', 'search.js'), 'utf8')), true);
      assert.ok(!readOutput(dir).map((f) => f.rel).includes('js/search.js'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('reads .xml, .svg, .md, .mjs, .csv and .webmanifest files for text (M3)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-ext-'));
    try {
      const files = {
        'feed.xml': '<rss><item><title>the cellar opens onto the sea</title></item></rss>',
        'map.svg': '<svg><text x="1">the cellar opens</text><text>onto the sea</text></svg>',
        'notes.md': 'the cellar opens onto the sea',
        'app.mjs': 'export const t = "the cellar opens onto the sea";',
        'table.csv': 'a,the cellar opens onto the sea',
        'site.webmanifest': '{"description":"the cellar opens onto the sea"}',
      };
      for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text);
      const m = createMatcher([piece('the cellar opens onto the sea')]);
      for (const f of readOutput(dir)) assert.equal(m.scan(f.words).length, 1, f.rel);
      assert.deepEqual(readOutput(dir).map((f) => f.rel).sort(), Object.keys(files).sort());
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('reads a JSON island\'s strings as text, and data-* attributes (M5)', () => {
    const html = '<div data-note="the vicar hides the key"></div><script type="application/json" id="cx-data">{"t":"one line\\nthe twins swap at dawn"}</script>';
    const words = wordsOf(fileText('a.html', html));
    for (const s of ['the vicar hides the key', 'the twins swap at dawn']) assert.equal(createMatcher([piece(s)]).scan(words).length, 1, s);
  });
});
