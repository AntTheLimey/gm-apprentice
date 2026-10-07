const { describe, it } = require('node:test');
const assert = require('node:assert');
const { fontFamiliesFor } = require('../../lib/skins');
const fontsLib = require('../../lib/fonts');

describe('skins: fonts', () => {
  it('lists the families of the skins in use, once each', () => {
    assert.deepStrictEqual(fontFamiliesFor(['ledger', 'plain', 'ledger']), ['Spectral', 'Spectral SC']);
    assert.deepStrictEqual(fontFamiliesFor(['plain']), []);
  });
  it('names only families the font cache accepts', () => {
    for (const f of fontFamiliesFor(['parchment', 'case-file', 'console', 'ledger'])) assert.ok(fontsLib.isValidFamily(f), f);
  });
});
