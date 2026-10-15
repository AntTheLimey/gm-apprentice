'use strict';
// tools/publish/test/unit/settings-resolve.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSettings, forSite } = require('../../lib/settings');
const { loadPublishConfig } = require('../../lib/config');
const { writeNewConfig } = require('../helpers/settings-files');

const vaultWith = (text) => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-'));
  writeNewConfig(v, text);
  return v;
};
const BASE = [
  'player_site:',
  '  title: Players',
  '  footer: Foot',
  '  after_build: [node a.js]',
  '  features: { live_stats: on, inbox: on }',
  '  hide: { sections: [GM Notes, Secrets] }',
  'gm_site:',
  '  publish: on',
  '  title: Table',
  '  hide: { sections: [GM Notes] }',
  '',
].join('\n');

test('the player site is the player values, untouched', () => {
  const r = readSettings({ vaultPath: vaultWith(BASE) });
  assert.equal(forSite(r, 'player').site, r.values.player_site);
});

test('the GM site lays the overrides over, whole values replacing', () => {
  const s = forSite(readSettings({ vaultPath: vaultWith(BASE) }), 'gm').site;
  assert.equal(s.title, 'Table');
  assert.equal(s.footer, 'Foot');
  // A hide list under gm_site is not a setting: what players see has one source, the player site.
  assert.deepEqual(s.hide.sections, ['GM Notes', 'Secrets']);
});

test('the GM site never inherits build steps, live stats or the inbox', () => {
  const s = forSite(readSettings({ vaultPath: vaultWith(BASE) }), 'gm').site;
  assert.deepEqual(s.after_build, []);
  assert.deepEqual(s.before_build, []);
  assert.equal(s.features.live_stats, false);
  assert.equal(s.features.inbox, false);
});

test('the GM site takes its own build steps', () => {
  const s = forSite(readSettings({ vaultPath: vaultWith(BASE + '  after_build: [node g.js]\n') }), 'gm').site;
  assert.deepEqual(s.after_build, ['node g.js']);
});

test('forSite never changes the values it is given', () => {
  const r = readSettings({ vaultPath: vaultWith(BASE) });
  const before = JSON.stringify(r.values);
  forSite(r, 'gm');
  assert.equal(JSON.stringify(r.values), before);
});

test('the adapter reads the GM site through forSite', () => {
  const v = vaultWith(BASE);
  const gm = loadPublishConfig(v, {}, () => {}, { site: 'gm' });
  const player = loadPublishConfig(v, {}, () => {});
  assert.equal(gm.site_title, 'Table');
  assert.deepEqual(gm.exclude_sections, ['GM Notes', 'Secrets']);
  assert.equal(gm.switches.liveStats, false);
  assert.deepEqual(gm.steps.after, []);
  assert.equal(gm.mode, 'player');
  assert.equal(gm.buildsFor, 'gm');
  assert.equal(player.buildsFor, 'player');
  assert.equal(player.gm.publish, true);
  assert.equal(player.site_title, 'Players');
});

test('an unknown site is a mistake in the calling code', () => {
  assert.throws(() => forSite(readSettings({ vaultPath: vaultWith(BASE) }), 'public'), /unknown site "public"/);
});

test('the GM site sees an override as written, under the player name', () => {
  const r = readSettings({ vaultPath: vaultWith(BASE) });
  const gm = forSite(r, 'gm');
  assert.equal(gm.origins['player_site.title'], 'file');
  assert.equal(gm.origins['player_site.footer'], r.origins['player_site.footer']);
  assert.equal(r.origins['player_site.title'], 'file');
  assert.equal(forSite(r, 'player').origins, r.origins);
  // the reader's own origins are not changed
  const own = readSettings({ vaultPath: vaultWith(BASE.replace('  title: Players\n', '')) });
  assert.equal(own.origins['player_site.title'], 'default');
  assert.equal(forSite(own, 'gm').origins['player_site.title'], 'file');
  assert.equal(own.origins['player_site.title'], 'default');
});

test('a genre written only for the GM site counts as written there, not on the player site', () => {
  const v = vaultWith(['player_site:', '  title: P', 'gm_site:', '  theme: { genre: noir }', ''].join('\n'));
  const gm = loadPublishConfig(v, {}, () => {}, { site: 'gm' });
  const player = loadPublishConfig(v, {}, () => {});
  assert.equal(gm.theme.genre, 'noir');
  assert.equal(gm.theme.palette, null);
  assert.notEqual(player.theme.palette, null);
  assert.equal(player.theme.genre, null);
});

test('a switch written only for the GM site is not unset on the GM site', () => {
  const v = vaultWith(['player_site:', '  title: P', 'gm_site:', '  sheets: { show: off }', ''].join('\n'));
  const gm = loadPublishConfig(v, {}, () => {}, { site: 'gm' });
  const player = loadPublishConfig(v, {}, () => {});
  assert.equal(gm.switches.characterSheets, false);
  assert.ok(!gm.switches.unset.includes('character_sheets'));
  assert.ok(player.switches.unset.includes('character_sheets'));
  assert.equal(player.switches.characterSheets, true);
});

test('on the GM site a stop fault is a warning, but a GM site kept by a player vault still stops', () => {
  const bad = vaultWith(['player_site:', '  hide: { field_exceptions: { "a.md": { include: sec } } }', ''].join('\n'));
  const r = readSettings({ vaultPath: bad });
  const gm = loadPublishConfig(bad, {}, () => {}, { site: 'gm' });
  assert.ok(gm.faults.length > 0);
  assert.ok(gm.faults.every((f) => f.level !== 'stop'));
  assert.ok(r.faults.concat(loadPublishConfig(bad, {}, () => {}).faults).some((f) => f.level === 'stop'));
  const kept = vaultWith(['vault: { kept_by: player }', 'gm_site: { publish: on }', ''].join('\n'));
  assert.ok(loadPublishConfig(kept, {}, () => {}, { site: 'gm' }).faults.some((f) => f.kind === 'gm-kept-by-player' && f.level === 'stop'));
});

test('a twin that failed to read inherits the player value', () => {
  const v = vaultWith(['player_site:', '  title: Players', 'gm_site:', '  title: [not, text]', ''].join('\n'));
  const r = readSettings({ vaultPath: v });
  assert.equal(r.origins['gm_site.title'], 'fault');
  const gm = forSite(r, 'gm');
  assert.equal(gm.site.title, 'Players');
  assert.equal(gm.origins['player_site.title'], r.origins['player_site.title']);
});

test('names under gm_site that are not settings are never laid over the site', () => {
  const v = vaultWith(['player_site:', '  title: Players', 'gm_site:', '  hid: 1', '  hide: {}', '  extra: { a: 1 }', ''].join('\n'));
  const r = readSettings({ vaultPath: v });
  const gm = forSite(r, 'gm').site;
  assert.equal(gm.hid, undefined);
  assert.equal(gm.extra, undefined);
  assert.deepEqual(gm.hide, r.values.player_site.hide);
  assert.equal(gm.title, 'Players');
});
