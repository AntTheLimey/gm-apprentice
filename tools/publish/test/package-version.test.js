'use strict';
// The release tag (publish-vX.Y.Z) is taken from package.json, so a bump that reaches only package-lock.json
// ships no release: 1.10.78 did that, and publish-v1.37.0 was never tagged.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('package.json and package-lock.json carry the same version', () => {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  const lock = require(path.join(__dirname, '..', 'package-lock.json'));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
});
