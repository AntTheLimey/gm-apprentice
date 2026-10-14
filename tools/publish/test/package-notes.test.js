'use strict';
// What the build and `doctor --site` say about a prebuild/postbuild still in the site's package.json: true for each case
// the update treats differently (settings/move.js): unset in the vault is carried, equal is removed, different is left.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { packageNotes } = require('../lib/settings/steps');

test('equal to the vault\'s steps: runs twice under npm run build; the next update removes it', () => {
  const n = packageNotes({ postbuild: 'echo a && echo b' }, { before: [], after: ['echo a', 'echo b'] });
  assert.match(n.twice, /`postbuild`.*also runs under `npm run build`.*so those run twice there/);
  assert.match(n.twice, /The next update removes it from package\.json/);
  assert.doesNotMatch(n.twice, /\bmoves it/);
  assert.equal(n.only, null);
  assert.match(n.fix, /^nothing to do/);
});

test('different from the vault\'s steps: both run under npm run build; the update leaves it; say what the GM can do', () => {
  const n = packageNotes({ prebuild: 'echo other' }, { before: ['echo a'], after: [] });
  assert.match(n.twice, /`prebuild` in the site folder's package\.json differs from the vault's before_build steps/);
  assert.match(n.twice, /both run under `npm run build`/i);
  assert.match(n.twice, /next update leaves it/);
  assert.match(n.twice, /make them the same, or take the script out of package\.json/);
  assert.doesNotMatch(n.twice, /run twice|\bmoves it|removes it/);
  assert.match(n.fix, /same.*take it out of package\.json/);
});

test('unset in the vault: it moves into the vault at the next update', () => {
  const n = packageNotes({ postbuild: 'echo a' }, { before: ['echo x'], after: [] });
  assert.equal(n.twice, null);
  assert.match(n.only, /`postbuild`.*still runs under `npm run build` and `deploy`, and moves into the vault at the next update/);
});

test('one of each case is said once each', () => {
  const n = packageNotes({ prebuild: 'echo other', postbuild: 'echo a' }, { before: ['echo a'], after: ['echo a'] });
  assert.match(n.twice, /`postbuild`.*removes it/);
  assert.match(n.twice, /`prebuild`.*differs.*leaves it/);
});
