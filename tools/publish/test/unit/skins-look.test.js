// tools/publish/test/unit/skins-look.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { SKINS, FRAME_IDS, resolveLook, siteLook, isDressed } = require('../../lib/skins');

describe('skins: resolveLook', () => {
  const none = { skin: null, frame: null, notes: [] };
  it('defaults to plain with no frame', () => {
    assert.deepStrictEqual(resolveLook({}, none), { skin: 'plain', frame: 'none', notes: [] });
  });
  it("uses the skin's own frame", () => {
    assert.strictEqual(resolveLook({}, { skin: 'ledger', frame: null, notes: [] }).frame, 'gilt');
    for (const [id, s] of Object.entries(SKINS)) assert.ok(s.ownFrame === 'none' || FRAME_IDS.includes(s.ownFrame), id);
  });
  it('lets the PC override either setting alone', () => {
    const site = { skin: 'parchment', frame: null, notes: [] };
    assert.deepStrictEqual(resolveLook({ sheet_frame: 'thorns' }, site), { skin: 'parchment', frame: 'thorns', notes: [] });
    assert.deepStrictEqual(resolveLook({ sheet_skin: 'console' }, site), { skin: 'console', frame: 'hex', notes: [] });
  });
  it('keeps a campaign frame under a PC skin', () => {
    assert.strictEqual(resolveLook({ sheet_skin: 'console' }, { skin: 'parchment', frame: 'ring', notes: [] }).frame, 'ring');
  });
  it('frames a PC on a site with no skin', () => {
    assert.deepStrictEqual(resolveLook({ sheet_frame: 'hex' }, none), { skin: 'plain', frame: 'hex', notes: [] });
  });
  it('matches after trimming and lower-casing', () => {
    assert.strictEqual(resolveLook({ sheet_skin: '  Parchment ' }, none).skin, 'parchment');
    assert.strictEqual(resolveLook({ sheet_skin: 'Case-File', sheet_frame: 'NONE' }, none).frame, 'none');
  });
  it('warns once and falls back on an unknown or mistyped value', () => {
    const site = { skin: 'ledger', frame: null, notes: [] };
    for (const bad of ['vellum', 3, ['ledger'], { a: 1 }, true]) {
      const r = resolveLook({ sheet_skin: bad }, site);
      assert.strictEqual(r.skin, 'ledger');
      assert.strictEqual(r.notes.length, 1);
      assert.strictEqual(r.notes[0].key, 'sheet_skin');
    }
  });
  it('warns and falls back on an unknown frame, naming the key and the value', () => {
    const r = resolveLook({ sheet_frame: 'filigree' }, { skin: 'ledger', frame: null, notes: [] });
    assert.strictEqual(r.skin, 'ledger');
    assert.strictEqual(r.frame, 'gilt', "the skin's own frame");
    assert.strictEqual(r.notes.length, 1);
    assert.strictEqual(r.notes[0].key, 'sheet_frame');
    assert.strictEqual(r.notes[0].value, 'filigree');
    // a campaign frame is the fallback when there is one
    assert.strictEqual(resolveLook({ sheet_frame: 'filigree' }, { skin: 'ledger', frame: 'ring', notes: [] }).frame, 'ring');
  });
  it('treats an empty or null value as not set, silently', () => {
    for (const empty of [null, '', '   ']) {
      assert.deepStrictEqual(resolveLook({ sheet_skin: empty, sheet_frame: empty }, none), { skin: 'plain', frame: 'none', notes: [] });
    }
  });
});

describe('skins: siteLook', () => {
  it('reads the two publish keys', () => {
    assert.deepStrictEqual(siteLook({ sheet_skin: 'Console', sheet_frame: 'ring' }), { skin: 'console', frame: 'ring', notes: [] });
  });
  it('drops an unknown value with a note', () => {
    const r = siteLook({ sheet_skin: 'vellum' });
    assert.strictEqual(r.skin, null);
    assert.deepStrictEqual(r.notes.map(n => n.key), ['sheet_skin']);
  });
  it('is empty for no publish block', () => {
    assert.deepStrictEqual(siteLook(undefined), { skin: null, frame: null, notes: [] });
  });
});

describe('skins: isDressed', () => {
  it('is false only for plain with no frame', () => {
    assert.strictEqual(isDressed({ skin: 'plain', frame: 'none' }), false);
    assert.strictEqual(isDressed({ skin: 'plain', frame: 'ring' }), true);
    assert.strictEqual(isDressed({ skin: 'ledger', frame: 'none' }), true);
  });
});
