const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../../lib/config');
const { writeFromOldText } = require('../helpers/vault-files');
const { loadPublishConfig, siteOff, siteOffText } = config;

// The switches as loadPublishConfig settles them, for a publish block and a site file.
function resolve(publish, json = {}) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-sw-'));
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  // JSON is YAML, so the block can be written as flow text.
  writeFromOldText(vault, `---\ntype: meta\npublish: ${JSON.stringify(publish || {})}\n---\n`);
  const cfg = loadPublishConfig(vault, json, () => {});
  fs.rmSync(vault, { recursive: true, force: true });
  return { ...cfg.switches, faults: cfg.faults };
}
const on = (p, j) => { const s = resolve(p, j); return [s.characterSheets, s.liveStats, s.inbox]; };
const faultNames = (s) => s.faults.map((f) => f.name).sort();

describe('publish switches', () => {
  it('defaults: sheets on, live stats off, inbox off', () => assert.deepStrictEqual(on(), [true, false, false]));
  it('reads the three keys', () => assert.deepStrictEqual(on({ character_sheets: true, live_stats: true, inbox: true }), [true, true, true]));
  it('sheets off forces live stats off and says so', () => {
    const s = resolve({ character_sheets: false, live_stats: true });
    assert.deepStrictEqual([s.characterSheets, s.liveStats], [false, false]);
    assert.ok(s.faults.some((f) => f.name === 'player_site.features.live_stats' && /player_site\.sheets\.show is off/.test(f.message)));
  });
  it('sheets off leaves the inbox alone', () => assert.deepStrictEqual(on({ character_sheets: false, inbox: true }), [false, false, true]));
  for (const [text, value] of [['no', false], ['No', false], ['off', false], ['false', false], ['yes', true], ['on', true], ['TRUE', true]]) {
    it(`accepts the word ${text}`, () => assert.strictEqual(resolve({ character_sheets: text }).characterSheets, value));
  }
  it('an unreadable value withholds, for every switch, and is reported', () => {
    const s = resolve({ character_sheets: 'maybe', live_stats: 3, inbox: [] });
    assert.deepStrictEqual([s.characterSheets, s.liveStats, s.inbox], [false, false, false]);
    assert.deepStrictEqual(faultNames(s), ['player_site.features.inbox', 'player_site.features.live_stats', 'player_site.sheets.show']);
  });
  it('a present but empty value is unreadable: off, with a fault, for every switch', () => {
    for (const [key, name] of [['character_sheets', 'player_site.sheets.show'], ['live_stats', 'player_site.features.live_stats'], ['inbox', 'player_site.features.inbox']]) {
      assert.ok(resolve({ [key]: null }).faults.some((f) => f.name === name), key);
    }
    assert.strictEqual(resolve({ character_sheets: null }).characterSheets, false);
    assert.strictEqual(resolve({ inbox: null }).inbox, false);
  });
  it('loadPublishConfig returns switches and no backend', () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-sw-'));
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    const cfg = loadPublishConfig(vault, {});
    assert.ok(cfg.switches);
    assert.ok(!('backend' in cfg));
  });
});

describe('explicitOff: which off switches were the GM\'s choice', () => {
  const off = (p, j) => resolve(p || {}, j || {}).explicitOff;
  it('unset is not explicit', () => assert.deepStrictEqual(off({}, {}), { liveStats: false, inbox: false, site: false }));
  it('false is explicit', () => {
    assert.deepStrictEqual(off({ live_stats: false, inbox: false }), { liveStats: true, inbox: true, site: false });
    assert.deepStrictEqual(off({ live_stats: false }), { liveStats: true, inbox: false, site: false });
    assert.deepStrictEqual(off({ inbox: false }), { liveStats: false, inbox: true, site: false });
  });
  it('an unreadable value counts as set', () => assert.deepStrictEqual(off({ live_stats: 'maybe', inbox: null }), { liveStats: true, inbox: true, site: false }));
  it('character_sheets: false makes live stats explicit, not the inbox', () => {
    assert.deepStrictEqual(off({ character_sheets: false }), { liveStats: true, inbox: false, site: false });
  });
  it('an on switch is never explicitly off', () => assert.deepStrictEqual(off({ live_stats: true, inbox: true }), { liveStats: false, inbox: false, site: false }));
  it('a site turned off, or set to something unreadable, is explicit; one never set is not', () => {
    assert.strictEqual(off({ site: false, site_dir: '/s' }).site, true);
    assert.strictEqual(off({ site: 'maybe', site_dir: '/s' }).site, true);
    assert.strictEqual(off({}).site, false);
    assert.strictEqual(off({ site: true }).site, false);
  });
  it('the switches left unset are listed, in order', () => {
    assert.deepStrictEqual(resolve({ inbox: true }).unset, ['site', 'character_sheets', 'live_stats']);
  });
});

describe('site: whether the vault has a site at all', () => {
  const site = (p) => resolve(p).site;
  it('is what the switch says, whatever site_dir says', () => {
    assert.strictEqual(site({ site: true }), true);
    assert.strictEqual(site({ site: 'on', site_dir: '/s' }), true);
    assert.strictEqual(site({ site: false, site_dir: '/s' }), false);
    assert.strictEqual(site({ site: 'off', site_dir: '/s' }), false);
  });
  it('unset, a site_dir says on and none says off', () => {
    assert.strictEqual(site({ site_dir: '/s' }), true);
    assert.strictEqual(site({}), false);
    assert.strictEqual(site({ site_dir: '' }), false);
    assert.strictEqual(site({ site_dir: null }), false);
  });
  it('an unreadable value is off, with a fault naming the key', () => {
    const got = resolve({ site: 'maybe', site_dir: '/s' });
    assert.strictEqual(got.site, false);
    assert.ok(got.faults.some((f) => f.name === 'player_site.publish'), JSON.stringify(got.faults));
  });
  it('siteOff stops a build only for an explicit off', () => {
    assert.strictEqual(siteOff(resolve({ site: false, site_dir: '/s' })), siteOffText());
    assert.match(siteOffText(), /^the site is off for this vault \(player_site\.publish in _meta\/vault-config\.yaml\); nothing was built\. Set player_site\.publish: true to publish again\.$/);
    assert.strictEqual(siteOff(resolve({})), null);
    assert.strictEqual(siteOff(resolve({ site: true })), null);
    assert.strictEqual(siteOff(undefined), null);
  });
});
