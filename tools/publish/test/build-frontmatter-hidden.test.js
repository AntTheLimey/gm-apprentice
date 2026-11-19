const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildVault } = require('./helpers/build-vault');

// Every built file, as one text.
function everything(v) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f); else if (/\.(html|json|js|xml|txt)$/.test(e.name)) out.push(fs.readFileSync(f, 'utf8'));
    }
  })(path.join(v.root, 'docs'));
  return out.join('\n');
}

test('an HTML comment or a hidden block in a frontmatter value is in no built file', () => {
  const v = buildVault({
    'People/Jon.md': '---\ntype: npc\ntitle: "Jon Vell <!-- hidtitle -->"\noccupation: "Clerk <!-- hidcomment --> of works"\n'
      + 'status: "alive <!-- SPOILER -->hidspoil<!-- /spoiler -->"\n'
      + 'aliases:\n  - "The Clerk <!-- hidalias -->"\ntags:\n  - "<!-- hidtag -->"\n'
      + 'relationships:\n  - target: "[[Mara]]"\n    type: knows\n    description: "old friends <!-- hiddeep -->"\n---\nOpenbody.\n',
    'People/Mara.md': '---\ntype: npc\noccupation: "Baker <!-- hidopen never closed"\n---\nSees [[Jon]].\n',
    'People/Guild.md': '---\ntype: npc\noccupation: "Guild <!-- gm-only -->hidblock<!-- /gm-only --> of Scribes"\n---\nBody.\n',
    'People/Code.md': '---\ntype: npc\noccupation: "types `<!-- showncode -->` in notes"\n---\nBody.\n',
  });
  try {
    const all = everything(v);
    for (const word of ['hidtitle', 'hidcomment', 'hidblock', 'hidspoil', 'hidalias', 'hidtag', 'hiddeep', 'hidopen']) {
      assert.ok(!all.includes(word), `${word} is published`);
    }
    assert.ok(all.includes('showncode'), 'a comment in backticks is literal text');
    const jon = v.read('people', 'jon.html');
    assert.match(jon, /<title>Jon Vell[^<!]*<\/title>/);
    assert.ok(jon.includes('Clerk of works'), 'the words either side of a comment stay');
    assert.ok(v.read('people', 'guild.html').includes('Guild of Scribes'), 'the words either side of a block stay');
    assert.ok(!jon.includes('&lt;!--') && !/<!--\s*\/?(gm-only|spoiler)/i.test(jon), 'no marker is printed');
    const mara = v.read('people', 'mara.html');
    assert.ok(mara.includes('Baker'), 'the words before an unclosed comment stay');
    const index = v.read('search-index.json');
    assert.ok(index.includes('Clerk of works'));
  } finally { v.cleanup(); }
});

test('unmasked_name and unmasked_portrait never reach a page and the picture is not copied', () => {
  const v = buildVault({
    'People/Pedlar.md': '---\ntype: npc\noccupation: Pedlar\nportrait: "_attachments/pedlar.png"\n'
      + 'unmasked_name: "Captain Rook"\nunmasked_portrait: "_attachments/true-face.png"\n---\nSells ribbons.\n',
    '_attachments/pedlar.png': 'png',
    '_attachments/true-face.png': 'png',
  });
  try {
    const all = everything(v);
    for (const word of ['Captain Rook', 'unmasked', 'true-face']) assert.ok(!all.includes(word), `${word} is published`);
    assert.ok(v.read('people', 'pedlar.html').includes('Pedlar'));
    const files = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(dir, e.name)); else files.push(e.name);
      }
    })(path.join(v.root, 'docs'));
    assert.ok(files.some((f) => f.startsWith('pedlar')), 'the portrait itself is copied');
    assert.ok(!files.some((f) => f.startsWith('true-face')), 'the unmasked face is not');
  } finally { v.cleanup(); }
});
