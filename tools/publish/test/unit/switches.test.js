const { describe, it } = require('node:test');
const assert = require('node:assert');
const { resolveSwitches } = require('../../lib/switches');
const on = (p, j) => { const s = resolveSwitches(p || {}, j || {}); return [s.characterSheets, s.liveStats, s.inbox]; };

describe('publish switches', () => {
  it('defaults: sheets on, live stats off, inbox off', () => assert.deepStrictEqual(on(), [true, false, false]));
  it('reads the three keys', () => assert.deepStrictEqual(on({ character_sheets: true, live_stats: true, inbox: true }), [true, true, true]));
  it('sheets off forces live stats off and says so', () => {
    const s = resolveSwitches({ character_sheets: false, live_stats: true }, {});
    assert.deepStrictEqual([s.characterSheets, s.liveStats], [false, false]);
    assert.ok(s.notes.some((n) => n.key === 'live_stats' && /character_sheets is off/.test(n.problem)));
  });
  it('sheets off leaves the inbox alone', () => assert.deepStrictEqual(on({ character_sheets: false, inbox: true }), [false, false, true]));
  for (const [text, value] of [['no', false], ['No', false], ['off', false], ['false', false], ['yes', true], ['on', true], ['TRUE', true]]) {
    it(`accepts the word ${text}`, () => assert.strictEqual(resolveSwitches({ character_sheets: text }, {}).characterSheets, value));
  }
  it('an unreadable value withholds, for every switch, and is reported', () => {
    const s = resolveSwitches({ character_sheets: 'maybe', live_stats: 3, inbox: [] }, {});
    assert.deepStrictEqual([s.characterSheets, s.liveStats, s.inbox], [false, false, false]);
    assert.deepStrictEqual(s.notes.map((n) => n.key).sort(), ['character_sheets', 'inbox', 'live_stats']);
  });
  it('old names in the vault file are still read, and reported', () => {
    const s = resolveSwitches({ backend: { statusBar: true, inbox: true } }, {});
    assert.deepStrictEqual([s.liveStats, s.inbox], [true, true]);
    assert.ok(s.notes.some((n) => n.key === 'backend.statusBar'));
  });
  it('old names in the site file are read only when the vault file is silent', () => {
    assert.deepStrictEqual(on({}, { backend: { statusBar: true, inbox: true } }), [true, true, true]);
    assert.deepStrictEqual(on({ live_stats: false, inbox: false }, { backend: { statusBar: true, inbox: true } }), [true, false, false]);
  });
  it('a new name beats an old name in the same file', () =>
    assert.strictEqual(resolveSwitches({ inbox: false, backend: { inbox: true } }, {}).inbox, false));
  it('unset means off even when the caller passes nothing about the backend', () =>
    assert.deepStrictEqual(on({}, {}), [true, false, false]));

  it('a present but empty value is unreadable: off, with a note, for every switch', () => {
    for (const key of ['character_sheets', 'live_stats', 'inbox']) {
      const s = resolveSwitches({ [key]: null }, {});
      assert.ok(s.notes.some((n) => n.key === key), key);
    }
    assert.strictEqual(resolveSwitches({ character_sheets: null }, {}).characterSheets, false);
    assert.strictEqual(resolveSwitches({ inbox: null }, {}).inbox, false);
  });
  it('an empty vault-file value wins over the site file and does not fall through', () =>
    assert.strictEqual(resolveSwitches({ live_stats: null }, { backend: { statusBar: true } }).liveStats, false));
  it('a backend that is not a map is ignored and reported', () => {
    const s = resolveSwitches({ backend: true }, { backend: 'yes' });
    assert.deepStrictEqual(s.notes.map((n) => n.key).sort(), ['backend', 'vault.config.json backend']);
    assert.ok(s.notes.every((n) => /not a map/.test(n.problem)));
  });
  it('an unreadable old-name value withholds and reports both', () => {
    const s = resolveSwitches({ backend: { statusBar: 'maybe' } }, {});
    assert.strictEqual(s.liveStats, false);
    assert.ok(s.notes.some((n) => n.key === 'backend.statusBar'));
    assert.ok(s.notes.some((n) => n.key === 'live_stats' && /not true or false/.test(n.problem)));
  });
  it('a site-file old name is reported under its own label', () =>
    assert.ok(resolveSwitches({}, { backend: { statusBar: true } }).notes.some((n) => n.key === 'vault.config.json backend.statusBar')));
  it('live stats via an old name is forced off when sheets are off', () => {
    const s = resolveSwitches({ character_sheets: false, backend: { statusBar: true } }, {});
    assert.strictEqual(s.liveStats, false);
    assert.ok(s.notes.some((n) => /character_sheets is off/.test(n.problem)));
  });
  it('loadPublishConfig returns switches and no backend', () => {
    const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
    const { loadPublishConfig } = require('../../lib/config');
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-sw-'));
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    const cfg = loadPublishConfig(vault, {});
    assert.ok(cfg.switches);
    assert.ok(!('backend' in cfg));
  });
});

describe('explicitOff: which off switches were the GM\'s choice', () => {
  const off = (p, j) => resolveSwitches(p || {}, j || {}).explicitOff;
  it('unset is not explicit', () => assert.deepStrictEqual(off({}, {}), { liveStats: false, inbox: false }));
  it('false is explicit, under the new name or either old one', () => {
    assert.deepStrictEqual(off({ live_stats: false, inbox: false }), { liveStats: true, inbox: true });
    assert.deepStrictEqual(off({ backend: { statusBar: false } }), { liveStats: true, inbox: false });
    assert.deepStrictEqual(off({}, { backend: { inbox: false } }), { liveStats: false, inbox: true });
  });
  it('an unreadable value counts as set', () => assert.deepStrictEqual(off({ live_stats: 'maybe', inbox: null }), { liveStats: true, inbox: true }));
  it('character_sheets: false makes live stats explicit, not the inbox', () => {
    assert.deepStrictEqual(off({ character_sheets: false }), { liveStats: true, inbox: false });
  });
  it('an on switch is never explicitly off', () => assert.deepStrictEqual(off({ live_stats: true, inbox: true }), { liveStats: false, inbox: false }));
});
