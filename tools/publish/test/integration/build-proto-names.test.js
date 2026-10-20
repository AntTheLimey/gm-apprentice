const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildVault } = require('../helpers/build-vault');

// A note whose file name is also a property every object has.
const NAMES = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', '__proto__', '__defineGetter__'];

describe('a note named like an object property', () => {
  // All seven in one vault, built once: each has a note of its own, Mara has a tie to it and a link to it.
  it('builds, is linked to, and links nothing it should not, for every name', () => {
    const files = {
      'People/Mara.md': `---\ntype: npc\nrelationships:\n${NAMES.map((n) => `  - target: "[[${n}]]"\n    type: friend_of\n    description: Old pals with ${n}.\n`).join('')}---\n\n${NAMES.map((n) => `Mara met [[${n}]] and [[${n}|a friend]].`).join(' ')} Also [[constructor]] and [[toString]].\n`,
      'People/Other.md': '---\ntype: npc\n---\n\nSee [[constructor]], [[__proto__]], [[valueOf]] and [[hasOwnProperty]].\n',
    };
    NAMES.forEach((n, i) => { files[`People/${n}.md`] = `---\ntype: npc\nlocation: Quay\nrelationships:\n  - target: "[[Mara]]"\n    type: knows\n---\n\nOpening words number ${i}. See [[Mara]].\n`; });
    const v = buildVault(files);
    try {
      const mara = v.read('people', 'mara.html');
      const other = v.read('people', 'other.html');
      const pages = fs.readdirSync(path.join(v.root, 'docs', 'people')).filter((f) => f.endsWith('.html')).map((f) => v.read('people', f)).join('\n');
      NAMES.forEach((n, i) => {
        assert.ok(mara.includes(`Old pals with ${n}`), `${n}: the tie is on Mara's page`);
        assert.ok(pages.includes(`Opening words number ${i}.`), `${n}: its own note built`);
      });
      // Links to names with no note stay words: no "function Object()" and no stray [object Object].
      assert.ok(!/function |\[object |\[native code\]/.test(other + pages), (other + pages).match(/function .{0,40}|\[object .{0,20}/));
    } finally { v.cleanup(); }
  });
});
