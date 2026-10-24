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
const { AUTO_EXCLUDE_STATUS } = require('../../lib/excluding-values');
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
});

test('a wrap-up session is played on the landing page, and no file types the played list out', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { getLatestSession } = require('../../lib/templates/landing-data');
  const latest = getLatestSession([
    { frontmatter: { type: 'session', status: 'played', session_number: 1, play_date: '2026-01-01' } },
    { frontmatter: { type: 'session', status: 'wrap-up', session_number: 2, play_date: '2026-01-08' } },
    { frontmatter: { type: 'session', status: 'prepped', session_number: 3, play_date: '2026-01-15' } },
  ]);
  assert.equal(latest.frontmatter.session_number, 2);
  // Every "is this session played" question goes through session-hub; a status compared to
  // 'played' by hand is a copy that can drift (four did, leaving out `wrap-up`).
  const lib = path.join(__dirname, '../../lib');
  const hand = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') && /status\s*===\s*['"]played['"]/.test(fs.readFileSync(p, 'utf8'))) hand.push(path.relative(lib, p));
    }
  };
  walk(lib);
  assert.deepEqual(hand, []);
});
