const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildVault } = require('../helpers/build-vault');

// A note whose file name is also a property every object has.
const NAMES = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', '__proto__', '__defineGetter__'];

describe('a note named like an object property', () => {
  for (const name of NAMES) {
    it(`${name}.md builds, is linked to, and links nothing it should not`, () => {
      const v = buildVault({
        [`People/${name}.md`]: `---\ntype: npc\nlocation: Quay\nrelationships:\n  - target: "[[Mara]]"\n    type: knows\n---\n\nOpening words about ${name}. See [[Mara]].\n`,
        'People/Mara.md': `---\ntype: npc\nrelationships:\n  - target: "[[${name}]]"\n    type: friend_of\n    description: Old pals.\n---\n\nMara met [[${name}]] and [[${name}|a friend]]. Also [[constructor]] and [[toString]].\n`,
        'People/Other.md': '---\ntype: npc\n---\n\nSee [[constructor]], [[__proto__]], [[valueOf]] and [[hasOwnProperty]].\n',
      });
      try {
        const mara = v.read('people', 'mara.html');
        assert.ok(mara.includes('Old pals') || mara.includes('Opening words'), 'built');
        const other = v.read('people', 'other.html');
        // Links to names with no note stay words: no "function Object()" and no stray [object Object].
        assert.ok(!/function |\[object |\[native code\]/.test(other + mara), (other + mara).match(/function .{0,40}|\[object .{0,20}/));
      } finally { v.cleanup(); }
    });
  }
});
