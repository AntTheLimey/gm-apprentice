const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseNote } = require('../../lib/frontmatter');

// The same notes tests/test_vaultlib.py reads with the scripts' reader: the two must agree
// on a quoted value's escapes and on a note that opens with a byte-order mark (#593, #597).
const { vectors } = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'frontmatter-scalar-vectors.json'), 'utf8'));

describe('frontmatter values (shared vectors)', () => {
  for (const v of vectors) {
    it(v.name, () => assert.deepStrictEqual(parseNote(v.text).data[v.key], v.value));
  }
});
