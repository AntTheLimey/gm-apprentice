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
});
