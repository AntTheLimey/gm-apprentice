const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildVault } = require('./helpers/build-vault');

// Every built file path under the output folder.
function paths(v) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f); else out.push(f);
    }
  })(path.join(v.root, 'docs'));
  return out;
}

// Every built file, whatever its type, as one text.
function everything(v) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f); else out.push(fs.readFileSync(f).toString('latin1'));
    }
  })(path.join(v.root, 'docs'));
  return out.join('\n');
}

const BODY = '# Image Guidance\n\n%OPEN%## Direction\n\nZZ-GUIDANCE-MARKER direction.\n\n## Always\n\nZZ-GUIDANCE-MARKER always.\n\n'
  + '## Blocks\n\n### Oil\n\nZZ-GUIDANCE-MARKER block.\n\n%CLOSE%';
const FRONT = '---\ntype: meta\npublish: false\ntags: [image-guidance]\n---\n';

for (const [name, wrapped] of [['with the gm-only wrapper', true], ['without the gm-only wrapper', false]]) {
  test(`the Image Guidance note is not published (${name})`, () => {
    const body = BODY.replace('%OPEN%', wrapped ? '<!-- gm-only -->\n\n' : '')
      .replace('%CLOSE%', wrapped ? '<!-- /gm-only -->\n' : '');
    const v = buildVault({
      '_Campaign/Image_Guidance.md': FRONT + body,
      'People/Jon.md': '---\ntype: npc\n---\nA clerk.\n',
    });
    try {
      const all = everything(v);
      assert.ok(all.includes('A clerk.'), 'the build produced the other page');
      assert.ok(!all.includes('ZZ-GUIDANCE-MARKER'), 'the guidance text is published');
      assert.ok(!all.includes('Image Guidance'), 'the note title is published');
      assert.ok(!all.includes('image-guidance'), 'the note tag or page is published');
      assert.deepStrictEqual(paths(v).filter((f) => /image-guidance/i.test(f)), [], 'the note has a page');
    } finally { v.cleanup(); }
  });
}
