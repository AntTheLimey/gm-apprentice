const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { skinsCss } = require('../../lib/skins');
const { scopeColorScheme, statements } = require('../../lib/color-mode');

describe('skinsCss', () => {
  let dir;
  const write = (name, css) => fs.writeFileSync(path.join(dir, name + '.css'), css);
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-skins-css-'));
    write('_layer', '.sk-frame { fill: none; }\n@media (max-width: 600px) { .sk-frame { width: 1px; } }\n');
    write('_print', '.sk-frame { display: none; }\n@media (min-width: 721px) { .sk-pic { width: 100%; } }\n');
    write('parchment', '/* parchment */\nmain.content[data-skin="parchment"] { --bg: #111; }\n@media (prefers-color-scheme: light) {\n  main.content[data-skin="parchment"] { --bg: #eee; }\n}\n');
    write('console', 'main.content[data-skin="console"] { --bg: #000; }\n');
    write('ledger', 'main.content[data-skin="ledger"] { --bg: #222; }\n');
    write('twice', '@media (prefers-color-scheme: light) { a { color: red; } }\n@media (prefers-color-scheme: light) { b { color: red; } }\n');
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('wraps every skin file in @media screen and puts the portrait print rules last, in @media print', () => {
    const css = skinsCss(['parchment', 'console'], dir);
    const blocks = statements(css).filter((st) => st.text.trim());
    for (const st of blocks) assert.strictEqual(st.kind, 'at', st.text);
    const last = blocks[blocks.length - 1];
    assert.match(last.prelude, /^@media print$/);
    assert.match(last.body, /\.sk-frame \{ display: none; \}/);
    for (const st of blocks.slice(0, -1)) assert.match(st.prelude, /^@media screen\b/, st.prelude);
  });

  it('after scopeColorScheme the only print block is the portrait\'s, and there is no bare light query', () => {
    for (const ids of [['parchment'], []]) {
      const out = scopeColorScheme(skinsCss(ids, dir));
      assert.strictEqual((out.match(/@media print/g) || []).length, 1);
      assert.match(out, /@media print \{\s*\.sk-frame \{ display: none; \}/);
      assert.doesNotMatch(out, /@media \(prefers-color-scheme: light\) \{/);
    }
  });

  it('leaves the print block exactly as written when the colour-mode transform runs', () => {
    const css = skinsCss(['parchment'], dir);
    const printBlock = css.slice(css.indexOf('@media print'));
    assert.ok(scopeColorScheme(css).endsWith(printBlock));
  });

  it('gives a light rule to the OS query and to a reader who chose light', () => {
    const out = scopeColorScheme(skinsCss(['parchment'], dir));
    assert.match(out, /@media screen and \(prefers-color-scheme: light\) \{\s*:where\(:root:not\(\[data-theme="dark"\]\)\) main\.content\[data-skin="parchment"\] \{ --bg: #eee; \}/);
    assert.match(out, /@media screen \{\s*:where\(:root\[data-theme="light"\]\) main\.content\[data-skin="parchment"\] \{ --bg: #eee; \}/);
  });

  it('keeps the dark base ahead of the light block and the layer first', () => {
    const css = skinsCss(['parchment'], dir);
    assert.ok(css.indexOf('.sk-frame') < css.indexOf('--bg: #111'));
    assert.ok(css.indexOf('--bg: #111') < css.indexOf('--bg: #eee'));
  });

  it('emits skins in registry order whatever order they are asked for', () => {
    const css = skinsCss(['ledger', 'console', 'parchment'], dir);
    const at = (id) => css.indexOf(`data-skin="${id}"`);
    assert.ok(at('parchment') < at('console') && at('console') < at('ledger'));
  });

  it('adds nothing for plain, and only the layer for no skins', () => {
    assert.strictEqual(skinsCss(['plain'], dir), skinsCss([], dir));
    assert.doesNotMatch(skinsCss(['plain'], dir), /data-skin/);
  });

  it('throws naming the file when a skin file is missing', () => {
    fs.rmSync(path.join(dir, 'ledger.css'));
    try {
      assert.throws(() => skinsCss(['ledger'], dir), /ledger\.css/);
    } finally {
      write('ledger', 'main.content[data-skin="ledger"] { --bg: #222; }\n');
    }
  });

  it('throws naming the file when a light block is repeated or not last', () => {
    write('case-file', '@media (prefers-color-scheme: light) { a { color: red; } }\nb { color: blue; }\n');
    assert.throws(() => skinsCss(['case-file'], dir), /case-file\.css.*last/);
    write('case-file', fs.readFileSync(path.join(dir, 'twice.css'), 'utf8'));
    assert.throws(() => skinsCss(['case-file'], dir), /case-file\.css.*last/);
  });

  it('reads the real layer, the real print rules and the three stub skins', () => {
    const css = skinsCss(['parchment', 'console', 'ledger']);
    assert.match(css, /\.sk-frame/);
    assert.match(css, /@media print \{[\s\S]*\.sk-frame \{[^}]*display: none/);
    for (const id of ['parchment', 'console', 'ledger']) assert.match(css, new RegExp(`data-skin="${id}"`));
  });
});
