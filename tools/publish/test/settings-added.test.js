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
  // Every entry it says was added is in the default, and says what, when and why as text.
  for (const a of data.added) {
    for (const k of ['entry', 'since', 'why']) assert.equal(typeof a[k], 'string', `${a.entry}: ${k}`);
    assert.ok(data.default.includes(a.entry), a.entry);
  }
});

test('every setting that names added entries gives each one as text', () => {
  const { REGISTRY } = require('../lib/settings/registry');
  const names = REGISTRY.filter((e) => e.added).map((e) => e.name);
  assert.ok(names.length >= 1);
  for (const name of names) {
    for (const a of describe(name).data.added) {
      for (const k of ['entry', 'since', 'why']) assert.equal(typeof a[k], 'string', `${name}: ${k}`);
    }
  }
});

test('describe player_site.hide.sections names Dormant Threads as added, and hides it by default', () => {
  const { rc, data } = describe('player_site.hide.sections');
  assert.equal(rc, 0);
  assert.ok(data.default.includes('Dormant Threads'));
  assert.deepEqual(data.added.map((a) => [a.entry, a.since]), [['Dormant Threads', '1.12.7']]);
});

test('a setting with no added entries describes without the key', () => {
  assert.equal('added' in describe('player_site.hide.folders').data, false);
});

test('a published note never shows a Dormant Threads heading or its text', () => {
  const { playerSafeMarkdown } = require('../lib/processor');
  const { loadPublishConfig } = require('../lib/config');
  const note = '## Open Threads\n- the visible one\n\n## Dormant Threads\n- the parked GM-only one\n\n## Other\nkept\n';
  const { text } = playerSafeMarkdown(note, { excludeSections: loadPublishConfig('/nonexistent/path').exclude_sections });
  assert.match(text, /the visible one/);
  assert.match(text, /kept/);
  assert.doesNotMatch(text, /Dormant Threads|parked GM-only/);
});

test('vault.voices is a switch, on by default, in the vault group', () => {
  const { rc, data } = describe('vault.voices');
  assert.equal(rc, 0);
  assert.equal(data.kind, 'switch');
  assert.equal(data.default, true);
  assert.ok(data.does.includes('voice'));
});
