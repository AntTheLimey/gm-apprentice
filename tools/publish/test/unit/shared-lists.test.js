'use strict';
// The short lists the tool shares with the vault scripts come from ontology.json (shared-lists.js);
// the tool's own tables keyed by them must cover every entry.
const test = require('node:test');
const assert = require('node:assert/strict');
const lists = require('../../lib/shared-lists');
const { RENDERER_IDS, getRenderer } = require('../../lib/templates/pc-registry');
const { boardFor } = require('../../lib/party-board-registry');
const { clientFor } = require('../../lib/templates/live-mount');
const { DIR_LABELS } = require('../../lib/templates/base');
const { kindLabel } = require('../../lib/kind-label');
const { REGISTRABLE_TYPES, isPlayedSession } = require('../../lib/session-hub');
const { AUTO_EXCLUDE_STATUS, AUTO_EXCLUDE_STAGE } = require('../../lib/excluding-values');
const { entry } = require('../../lib/settings/registry');
const { TYPES } = require('../../lib/settings/types');

test('every game system has a sheet renderer, and the renderers are keyed by system id', () => {
  assert.deepEqual([...RENDERER_IDS].sort(), [...lists.SYSTEM_IDS].sort());
});

test('every alias reaches the same renderer, board and live client as its system id', () => {
  for (const [alias, id] of Object.entries(lists.SYSTEM_ALIASES)) {
    for (const written of [alias, alias.toUpperCase(), ` ${alias} `]) {
      assert.equal(lists.systemId(written), id, written);
      assert.equal(getRenderer(written), getRenderer(id), written);
      assert.equal(boardFor(written), boardFor(id), written);
      assert.equal(clientFor(written), clientFor(id), written);
    }
  }
  assert.equal(lists.systemId('not-a-system'), null);
  assert.equal(getRenderer(''), null);
});

test('vault.system reads every alias as the id it names', () => {
  const e = entry('vault.system');
  for (const [alias, id] of Object.entries(lists.SYSTEM_ALIASES)) {
    assert.deepEqual(TYPES.choice.read(alias, e), TYPES.choice.read(id, e), alias);
    assert.equal(TYPES.choice.read(alias, e).value, id, alias);
  }
  for (const id of lists.SYSTEM_IDS) assert.ok(e.shape.includes(`\`${id}\``), id);
});

test('every type folder has a site folder the site labels', () => {
  for (const f of lists.VAULT_FOLDERS) assert.ok(Object.hasOwn(DIR_LABELS, f.site), f.site);
});

test('every wrap-up spelling is registrable and reads as a session', () => {
  for (const t of lists.WRAP_UP_TYPES) {
    assert.ok(REGISTRABLE_TYPES.has(t), t);
    assert.equal(kindLabel(t), 'Session', t);
  }
});

test('a session is played or not yet run, never both', () => {
  for (const s of lists.SESSION_PLAYED) {
    assert.ok(!AUTO_EXCLUDE_STATUS.has(s), s);
    assert.ok(isPlayedSession({ type: 'session', status: s }), s);
  }
  for (const s of AUTO_EXCLUDE_STATUS) assert.ok(!isPlayedSession({ type: 'session', status: s }), s);
  assert.ok(AUTO_EXCLUDE_STAGE.has('outline'));
});
