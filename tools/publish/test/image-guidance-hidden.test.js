const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildVault } = require('./helpers/build-vault');

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

test('the Image Guidance note is in no file of the built player site', () => {
  const v = buildVault({
    '_Campaign/Image_Guidance.md': '---\ntype: meta\ntags: [image-guidance]\n---\n# Image Guidance\n\n<!-- gm-only -->\n\n'
      + '## Direction\n\nZZ-GUIDANCE-MARKER direction.\n\n## Always\n\nZZ-GUIDANCE-MARKER always.\n\n'
      + '## Blocks\n\n### Oil\n\nZZ-GUIDANCE-MARKER block.\n\n<!-- /gm-only -->\n',
    'People/Jon.md': '---\ntype: npc\n---\nA clerk.\n',
  });
  try {
    assert.ok(everything(v).includes('A clerk.'), 'the build produced the other page');
    assert.ok(!everything(v).includes('ZZ-GUIDANCE-MARKER'), 'the guidance note is published');
  } finally { v.cleanup(); }
});
