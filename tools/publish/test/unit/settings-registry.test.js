'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { REGISTRY, entry, names, GROUPS, legacyNameOf, resolve } = require('../../lib/settings/registry');
const { TYPES } = require('../../lib/settings/types');

// The list is written by hand, one entry a line: a comma is followed by a space.
test('the list is written as the rest of the code is: a space after every comma that ends a key', () => {
  const source = require('node:fs').readFileSync(require.resolve('../../lib/settings/registry'), 'utf8');
  const bad = source.split('\n').map((line, i) => [i + 1, line]).filter(([, line]) => /^\s*\{ name: '[^']+',[^ \n]/.test(line));
  assert.deepEqual(bad.map(([n, line]) => `${n}: ${line.slice(0, 60)}`), []);
});

test('every entry is complete and its default is a value its own type takes', () => {
  const groups = new Set(GROUPS.map((g) => g.id));
  for (const e of REGISTRY) {
    assert.ok(TYPES[e.type], `${e.name}: unknown type ${e.type}`);
    if (e.state || e.retired || e.container || e.legacyOnly) continue;
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
  for (const e of REGISTRY) for (const o of e.was || []) assert.ok(!live.includes(o.name) || o.in === 'site', `${o.name} is both old and live`);
});

test('a name the list declares is under vault. or player_site., except the legacy-only ones', () => {
  for (const e of REGISTRY) {
    if (e.legacyOnly) { assert.ok(!e.was, `${e.name}: legacy-only with a was`); continue; }
    assert.match(e.name, /^(vault|player_site)\./, e.name);
  }
  assert.deepEqual(REGISTRY.filter((e) => e.legacyOnly).map((e) => e.name).sort(), [
    'publish.backend', 'publish.four_oh_four.style', 'publish.overrides', 'publish.setup_progress', 'publish.total_sessions', 'publish.wrap_up',
  ]);
});

test('every old name is unique across the list, and resolves to its setting', () => {
  const seen = new Map();
  for (const e of REGISTRY) {
    for (const w of e.was || []) {
      const key = `${w.in}:${w.name}`;
      assert.ok(!seen.has(key), `${key} belongs to ${seen.get(key)} and ${e.name}`);
      seen.set(key, e.name);
      if (w.in === 'vault') assert.equal(resolve(w.name).entry, e, w.name);
    }
    if (!e.legacyOnly && (e.was || []).length) assert.equal(legacyNameOf(e), (e.was.find((w) => w.in === 'vault') || {}).name || null);
  }
});

test('the settings the site file also holds are the fifteen it always held, each under its own key', () => {
  const siteKeys = ['siteTitle', 'footer', 'searchEnabled', 'folderMap', 'attachmentsDir', 'system', 'excludeDirs', 'excludeSections',
    'excludeFields', 'excludeCallouts', 'sheet_crest', 'landing', 'images', 'banners', 'locations'];
  const carrying = REGISTRY.filter((e) => e.legacyKind && !e.siteFallback);
  assert.deepEqual(carrying.map((e) => e.was.find((w) => w.in === 'site').name), siteKeys);
  for (const e of carrying) assert.ok(['scalar', 'list', 'map'].includes(e.legacyKind), e.name);
});

test('the five site-folder keys are settings read from the site file while the vault sets none, and have no name in the old file', () => {
  const fallback = REGISTRY.filter((e) => e.siteFallback);
  assert.deepEqual(fallback.map((e) => [e.was.find((w) => w.in === 'site').name, e.name]), [
    ['siteUrl', 'player_site.url'], ['host', 'player_site.host'], ['outputDir', 'player_site.output'],
    ['cloudflarePagesProject', 'player_site.cloudflare_project'], ['preserveDirs', 'player_site.keep'],
  ]);
  for (const e of fallback) {
    assert.equal(e.was.length, 1, e.name);
    assert.equal(legacyNameOf(e), null, e.name);
    assert.ok(['scalar', 'list'].includes(e.legacyKind), e.name);
  }
  assert.deepEqual(fallback.filter((e) => e.stopOnFault).map((e) => e.name), ['player_site.output', 'player_site.keep']);
});

test('the two settings the old file never had have no old name', () => {
  assert.deepEqual(entry('vault.kept_by').values, ['gm', 'player']);
  assert.equal(entry('vault.kept_by').default, 'gm');
  for (const n of ['vault.kept_by', 'vault.campaign']) assert.equal(legacyNameOf(entry(n)), null, n);
});

test('the hiding side is marked', () => {
  for (const n of ['player_site.hide.mode', 'player_site.hide.sections', 'player_site.hide.fields', 'player_site.hide.folders', 'player_site.hide.callouts', 'player_site.hide.drafts', 'player_site.hide.field_exceptions']) {
    assert.equal(entry(n).guards, true, n);
  }
});

test('a switch that must never fail on says so', () => {
  for (const n of ['player_site.publish', 'player_site.sheets.show', 'player_site.features.live_stats', 'player_site.features.inbox']) assert.equal(entry(n).onFault, false, n);
});

test('ids owned elsewhere are imported, not restated', () => {
  const { SKINS, FRAME_IDS } = require('../../lib/skins');
  assert.deepEqual(entry('player_site.sheets.skin').values, Object.keys(SKINS));
  assert.deepEqual(entry('player_site.sheets.frame').values, ['none', ...FRAME_IDS]);
});

test('a value that cannot be read falls back to the side that shows less', () => {
  // What each hiding entry and each must-not-fail-on switch uses when its value is unreadable:
  // onFault when the entry says so, else its default.
  const fallback = (n) => { const e = entry(n); return e.onFault !== undefined ? e.onFault : e.default; };
  const expected = {
    'player_site.hide.mode': 'player',
    'player_site.hide.callouts': true,
    'player_site.hide.drafts': true,
    'player_site.hide.sections': entry('player_site.hide.sections').default,
    'player_site.hide.fields': entry('player_site.hide.fields').default,
    'player_site.hide.folders': entry('player_site.hide.folders').default,
    'player_site.hide.field_exceptions': {},
    'player_site.publish': false,
    'player_site.sheets.show': false,
    'player_site.features.live_stats': false,
    'player_site.features.inbox': false,
  };
  assert.deepEqual(expected['player_site.hide.sections'], ['GM Notes', 'DM Notes', 'Player Notes', 'Source References', 'Reconciliation Context', 'Handoff to Reconcile']);
  assert.deepEqual(expected['player_site.hide.fields'], ['secrets', 'current_plan', 'plan_progress', 'gm_notes', 'prep_notes', 'reliability']);
  assert.deepEqual(expected['player_site.hide.folders'], ['_meta', '_Templates']);
  for (const [n, want] of Object.entries(expected)) assert.deepEqual(fallback(n), want, n);
  // Every entry on the hiding side is in the list above (the old `publish.overrides` only held `fields`).
  for (const e of REGISTRY) if (e.guards && !e.legacyOnly) assert.ok(e.name in expected, `${e.name}: guards but no pinned fallback`);
});
