'use strict';
// The packed tool carries the MIT text (#418): tools/publish/LICENSE is a copy of the repo's
// LICENSE-CODE, kept byte for byte so the two cannot drift.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the tool LICENSE is the repo LICENSE-CODE, byte for byte', () => {
  const tool = fs.readFileSync(path.join(__dirname, '../../LICENSE'));
  const root = fs.readFileSync(path.join(__dirname, '../../../../LICENSE-CODE'));
  assert.ok(tool.equals(root), 'copy LICENSE-CODE to tools/publish/LICENSE');
});
