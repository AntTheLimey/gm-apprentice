'use strict';
// The no-Plan run sheet's record vault (test/fixtures/run-sheet-record): a GURPS vault with Sessions 13 and 14 wrapped
// up and no Plans. `copyRecordFixture({ crlf, drop })` returns a temp copy a test may change (copy and CRLF code are
// systems-fixture's). `drop` lists vault paths (relative, forward slashes) to delete from the copy, so a test can take
// away a Wrap-Up or a Table Log. Remove the copy with systems-fixture's `removeFixture`.
const fs = require('node:fs');
const path = require('node:path');
const { copyFixture } = require('./systems-fixture');

function copyRecordFixture({ crlf = false, drop = [] } = {}) {
  const dir = copyFixture('run-sheet-record', { crlf });
  for (const rel of drop) {
    const file = path.join(dir, ...rel.split('/'));
    if (!fs.existsSync(file)) throw new Error(`record fixture has no ${rel}`);
    fs.rmSync(file);
  }
  return dir;
}

module.exports = { copyRecordFixture };
