'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { REGISTRY, entry, names, GROUPS } = require('../../lib/settings/registry');
const { TYPES } = require('../../lib/settings/types');

test('every entry is complete and its default is a value its own type takes', () => {
  const groups = new Set(GROUPS.map((g) => g.id));
  for (const e of REGISTRY) {
    assert.ok(TYPES[e.type], `${e.name}: unknown type ${e.type}`);
    if (e.state || e.retired || e.container) continue;
    assert.ok(typeof e.does === 'string' && e.does.trim().length > 10, `${e.name}: needs a "does" line`);
    assert.ok(groups.has(e.group), `${e.name}: group ${e.group}`);
    if (e.default !== undefined && e.default !== null) {
      assert.deepEqual(TYPES[e.type].read(e.default, e), { ok: true, value: e.default }, `${e.name}: default`);
    }
  }
});

test('names are unique, and no old name collides with a live one', () => {
  const live = names();
  assert.equal(new Set(live).size, live.length);
  for (const e of REGISTRY) for (const o of e.oldNames || []) assert.ok(!live.includes(o.name) || o.in === 'site', `${o.name} is both old and live`);
});

test('the hiding side is marked', () => {
  for (const n of ['publish.mode', 'publish.exclude_sections', 'publish.exclude_fields', 'publish.exclude_dirs', 'publish.exclude_callouts', 'publish.exclude_drafts', 'publish.overrides.fields']) {
    assert.equal(entry(n).guards, true, n);
  }
});

test('a switch that must never fail on says so', () => {
  for (const n of ['publish.site', 'publish.character_sheets', 'publish.live_stats', 'publish.inbox']) assert.equal(entry(n).onFault, false, n);
});

test('ids owned elsewhere are imported, not restated', () => {
  const { SKINS, FRAME_IDS } = require('../../lib/skins');
  assert.deepEqual(entry('publish.sheet_skin').values, Object.keys(SKINS));
  assert.deepEqual(entry('publish.sheet_frame').values, ['none', ...FRAME_IDS]);
});

test('a value that cannot be read falls back to the side that shows less', () => {
  // What each hiding entry and each must-not-fail-on switch uses when its value is unreadable:
  // onFault when the entry says so, else its default.
  const fallback = (n) => { const e = entry(n); return e.onFault !== undefined ? e.onFault : e.default; };
  const expected = {
    'publish.mode': 'player',
    'publish.exclude_callouts': true,
    'publish.exclude_drafts': true,
    'publish.exclude_sections': entry('publish.exclude_sections').default,
    'publish.exclude_fields': entry('publish.exclude_fields').default,
    'publish.exclude_dirs': entry('publish.exclude_dirs').default,
    'publish.overrides.fields': {},
    'publish.site': false,
    'publish.character_sheets': false,
    'publish.live_stats': false,
    'publish.inbox': false,
  };
  assert.deepEqual(expected['publish.exclude_sections'], ['GM Notes', 'DM Notes', 'Player Notes', 'Source References', 'Reconciliation Context', 'Handoff to Reconcile']);
  assert.deepEqual(expected['publish.exclude_fields'], ['secrets', 'current_plan', 'plan_progress', 'gm_notes', 'prep_notes', 'reliability']);
  assert.deepEqual(expected['publish.exclude_dirs'], ['_meta', '_Templates']);
  for (const [n, want] of Object.entries(expected)) assert.deepEqual(fallback(n), want, n);
  // Every entry on the hiding side is in the list above (`publish.overrides` only holds `fields`).
  for (const e of REGISTRY) if (e.guards && e.name !== 'publish.overrides') assert.ok(e.name in expected, `${e.name}: guards but no pinned fallback`);
});
