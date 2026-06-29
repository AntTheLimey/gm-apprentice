const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseGurps } = require('../../../lib/templates/gurps/parse');

const statSheet = {
  title: 'Stat Sheet', id: 'stat-sheet',
  html: '<h3>Primary Attributes</h3><table><tr><th>Attr</th><th>Level</th></tr>' +
        '<tr><td>ST</td><td>10</td></tr><tr><td>DX</td><td>12</td></tr>' +
        '<tr><td>IQ</td><td>18*</td></tr><tr><td>HT</td><td>10</td></tr></table>' +
        '<h3>Secondary Characteristics</h3><table><tr><td>HP</td><td>10</td></tr>' +
        '<tr><td>Will</td><td>18</td></tr></table>',
};

describe('parseGurps', () => {
  it('reads primary attributes from the Stat Sheet, splitting footnote markers', () => {
    const c = parseGurps({}, [statSheet]);
    assert.strictEqual(c.attributes.primary.ST.value, '10');
    assert.strictEqual(c.attributes.primary.IQ.value, '18');
    assert.deepStrictEqual(c.attributes.primary.IQ.markers, ['*']);
  });
  it('reads secondary characteristics', () => {
    const c = parseGurps({}, [statSheet]);
    assert.strictEqual(c.attributes.secondary.HP.value, '10');
  });
  it('frontmatter.attributes overrides parsed primary values', () => {
    const c = parseGurps({ attributes: { ST: 20 } }, [statSheet]);
    assert.strictEqual(c.attributes.primary.ST.value, '20');
  });
  it('returns a model even with no sections', () => {
    const c = parseGurps({}, []);
    assert.ok(c.attributes && c.skills && c.melee);
  });
});
