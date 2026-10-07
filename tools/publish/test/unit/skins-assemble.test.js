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
    write('parchment', '/* parchment */\nmain.content[data-skin="parchment"] { --bg: #111; }\n@media (prefers-color-scheme: light) {\n  main.content[data-skin="parchment"] { --bg: #eee; }\n}\n');
    write('console', 'main.content[data-skin="console"] { --bg: #000; }\n');
    write('ledger', 'main.content[data-skin="ledger"] { --bg: #222; }\n');
    write('twice', '@media (prefers-color-scheme: light) { a { color: red; } }\n@media (prefers-color-scheme: light) { b { color: red; } }\n');
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('wraps every file in @media screen, so nothing sits at the top level', () => {
    const css = skinsCss(['parchment', 'console'], dir);
    for (const st of statements(css)) {
      if (!st.text.trim()) continue;
      assert.strictEqual(st.kind, 'at', st.text);
      assert.match(st.prelude, /^@media screen\b/, st.prelude);
    }
  });

  it('after scopeColorScheme there is no print block and no bare light query', () => {
    const out = scopeColorScheme(skinsCss(['parchment'], dir));
    assert.doesNotMatch(out, /@media print/);
    assert.doesNotMatch(out, /@media \(prefers-color-scheme: light\) \{/);
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
    assert.throws(() => skinsCss(['ledger'], dir), /ledger\.css/);
    write('ledger', 'main.content[data-skin="ledger"] { --bg: #222; }\n');
  });

  it('throws naming the file when a light block is repeated or not last', () => {
    write('case-file', '@media (prefers-color-scheme: light) { a { color: red; } }\nb { color: blue; }\n');
    assert.throws(() => skinsCss(['case-file'], dir), /case-file\.css.*last/);
    write('case-file', fs.readFileSync(path.join(dir, 'twice.css'), 'utf8'));
    assert.throws(() => skinsCss(['case-file'], dir), /case-file\.css.*last/);
  });

  it('reads the real layer and the three stub skins', () => {
    const css = skinsCss(['parchment', 'console', 'ledger']);
    assert.match(css, /\.sk-frame/);
    for (const id of ['parchment', 'console', 'ledger']) assert.match(css, new RegExp(`data-skin="${id}"`));
  });
});
