'use strict';
// The style gallery fails, naming the style, when a plugin style gives no styled page.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { missingStyles } = require('../../scripts/style-gallery');

test("a plugin style with no page in the gallery is named; a vault style is not the plugin's", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-'));
  try {
    for (const rel of ['plugin/terminal/layout.html', 'plugin/letter/layout.html', 'plugin/scroll/layout.html', 'vault/_meta/prop-styles/scroll/layout.html']) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), '');
    }
    const gallery = [{ style: 'terminal' }];
    assert.deepStrictEqual(missingStyles(gallery, path.join(root, 'vault'), path.join(root, 'plugin')), ['letter']);
    assert.deepStrictEqual(missingStyles([{ style: 'terminal' }, { style: 'letter' }], path.join(root, 'vault'), path.join(root, 'plugin')), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('every shipped plugin style is one the gallery fixture shows', () => {
  const fixture = path.join(__dirname, '..', 'fixtures', 'prop-styles');
  const used = new Set();
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name.endsWith('.md')) {
        const m = /^prop_style:\s*(\S+)/m.exec(fs.readFileSync(path.join(dir, e.name), 'utf8'));
        if (m) used.add(m[1]);
      }
    }
  }(fixture));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-v-'));
  try { assert.deepStrictEqual(missingStyles([...used].map((style) => ({ style })), vault), []); } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});
