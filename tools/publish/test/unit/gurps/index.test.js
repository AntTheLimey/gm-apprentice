const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderGURPSSheet } = require('../../../lib/templates/gurps/index');

const statSheet = { title: 'Stat Sheet', id: 'stat-sheet',
  html: '<h3>Primary Attributes</h3><table><tr><th>Attr</th><th>Level</th></tr><tr><td>ST</td><td>10</td></tr></table>' };

describe('renderGURPSSheet (index)', () => {
  it('returns an object with sheetHtml containing the attributes block', () => {
    const out = renderGURPSSheet({}, [statSheet]);
    assert.strictEqual(typeof out, 'object');
    assert.ok(out.sheetHtml.includes('cat-attr'));
  });
  it('returns { sheetHtml: null } when there is no GURPS data', () => {
    const out = renderGURPSSheet({ type: 'pc' }, []);
    assert.strictEqual(out.sheetHtml, null);
  });
});
