'use strict';

// Regenerates expected.json from a publish tool checked out at 1.10.17 (before #276):
//   git archive 95bdd0cf tools/publish | tar -x -C /tmp/old
//   node generate.js /tmp/old/tools/publish
// Never regenerate it from the current tool: it is the record of the old rendering.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { VARIANTS, buildVariant, mainBlocks } = require('./variants');

// No path, no run: a bare `node --test` picks this file up (Node's default patterns take every .js under test/),
// and falling back to the current folder rewrote the goldens from the current tool, twice in one day (#852 work).
if (!process.argv[2]) {
  console.error('usage: node generate.js <path to an old tools/publish>');
  process.exit(1);
}
const libRoot = path.resolve(process.argv[2]);
if (!fs.existsSync(path.join(libRoot, 'lib', 'build.js'))) {
  console.error('usage: node generate.js <path to an old tools/publish>');
  process.exit(1);
}
const expected = {};
for (const variant of Object.keys(VARIANTS)) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `session-golden-${variant}-`));
  expected[variant] = mainBlocks(buildVariant(libRoot, work, variant));
  fs.rmSync(work, { recursive: true, force: true });
}
fs.writeFileSync(path.join(__dirname, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
