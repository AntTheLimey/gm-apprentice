'use strict';
// An entry added to a built-in hiding list after vaults began owning their lists says when it was
// added and why, so the update can offer it to a list the GM owns. The voice field is the first.
const test = require('node:test');
const assert = require('node:assert/strict');
const { runSettings } = require('../lib/settings/cli');

function describe(name) {
  const out = [];
  const rc = runSettings({ verb: 'describe', args: [name], json: true }, { out: (l) => out.push(l), err: () => {} });
  return { rc, data: JSON.parse(out.join('\n')) };
}

test('describe player_site.hide.fields names voice as added, and hides it by default', () => {
  const { rc, data } = describe('player_site.hide.fields');
  assert.equal(rc, 0);
  assert.ok(data.default.includes('voice'));
  assert.equal(data.added[0].entry, 'voice');
  assert.equal(data.added[0].since, '1.11.2');
  assert.ok(data.added[0].why.length > 10);
  // Every entry it says was added is in the default.
  for (const a of data.added) assert.ok(data.default.includes(a.entry), a.entry);
});

test('a setting with no added entries describes without the key', () => {
  assert.equal('added' in describe('player_site.hide.sections').data, false);
});

test('vault.voices is a switch, on by default, in the vault group', () => {
  const { rc, data } = describe('vault.voices');
  assert.equal(rc, 0);
  assert.equal(data.kind, 'switch');
  assert.equal(data.default, true);
  assert.ok(data.does.includes('voice'));
});
