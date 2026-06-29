const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderAttributes } = require('../../../lib/templates/gurps/blocks/attributes');

describe('renderAttributes', () => {
  it('renders primary attribute cards with values and footnote legend', () => {
    const model = { attributes: {
      primary: { ST:{value:'10',markers:[]}, DX:{value:'12',markers:[]}, IQ:{value:'18',markers:['*']}, HT:{value:'10',markers:[]} },
      secondary: { HP:{value:'10',markers:[]} }, bl:'20 lb', thrust:'1d-2', swing:'1d', dodge:'8' } };
    const html = renderAttributes(model);
    assert.ok(html.includes('cat-attr'));
    assert.ok(html.includes('18'));
    assert.ok(html.includes('attrgrid'));
  });
  it('returns null when no attributes', () => {
    assert.strictEqual(renderAttributes({ attributes: { primary:{}, secondary:{} } }), null);
  });
});
