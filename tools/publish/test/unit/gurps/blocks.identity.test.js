const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderIdentity } = require('../../../lib/templates/gurps/blocks/identity');
const { parseGurps } = require('../../../lib/templates/gurps/parse');
const { buildSheet } = require('../../../lib/templates/gurps/layout');

const appearanceSheet = {
  title: 'Stat Sheet', id: 'stat-sheet',
  html: '<h3>Primary Attributes</h3><table><tr><th>Attribute</th><th>Score</th></tr>' +
        '<tr><td>ST</td><td>13</td></tr></table>' +
        '<h3>Appearance &amp; Social</h3>' +
        '<table><tr><th>Trait</th><th>Value</th></tr>' +
        '<tr><td>Religion</td><td>None</td></tr>' +
        '<tr><td>Height</td><td>6&#39;2&quot;</td></tr>' +
        '<tr><td>Weight</td><td>215 lb</td></tr>' +
        '<tr><td>Eyes</td><td>Pale grey</td></tr>' +
        '<tr><td>Batch</td><td>MACE-06</td></tr></table>',
};

describe('renderIdentity', () => {
  it('returns null when there is no identity data', () => {
    assert.strictEqual(renderIdentity({ identity: {} }), null);
    assert.strictEqual(renderIdentity({}), null);
  });

  it('drops keys whose value is blank', () => {
    const html = renderIdentity({ identity: { Height: '6\'2"', Weight: '   ' } });
    assert.ok(html.includes('Height'));
    assert.ok(!html.includes('Weight'));
  });

  it('orders physical description ahead of the rest, extras last', () => {
    const html = renderIdentity({
      identity: { Religion: 'None', Batch: 'MACE-06', Height: '6\'2"', Eyes: 'Pale grey' },
    });
    const order = ['Height', 'Eyes', 'Religion', 'Batch'].map(k => html.indexOf(`>${k}<`));
    assert.deepStrictEqual(order, [...order].sort((a, b) => a - b));
    assert.ok(order.every(i => i > -1));
  });

  it('escapes values exactly once', () => {
    const html = renderIdentity({ identity: { Height: '6\'2"' } });
    assert.ok(html.includes('6\'2&quot;'));
    assert.ok(!html.includes('&amp;quot;'));
  });
});

describe('parseIdentity', () => {
  it('reads the Appearance & Social sub-table into model.identity', () => {
    const model = parseGurps({}, [appearanceSheet]);
    assert.strictEqual(model.identity.Height, '6\'2"');
    assert.strictEqual(model.identity.Weight, '215 lb');
    assert.strictEqual(model.identity.Eyes, 'Pale grey');
  });

  it('drops the header row rather than the first real row', () => {
    const model = parseGurps({}, [appearanceSheet]);
    assert.strictEqual(model.identity.Religion, 'None');
    assert.ok(!('Trait' in model.identity));
  });

  it('leaves senses empty when the sheet has no Senses sub-table', () => {
    const model = parseGurps({}, [appearanceSheet]);
    assert.deepStrictEqual(model.senses, {});
  });

  it('still reads a real Senses sub-table', () => {
    const sheet = {
      title: 'Stat Sheet', id: 'stat-sheet',
      html: '<h3>Senses</h3><table><tr><th>Sense</th><th>Value</th></tr>' +
            '<tr><td>Vision</td><td>13</td></tr></table>',
    };
    const model = parseGurps({}, [sheet]);
    assert.strictEqual(model.senses.Vision, '13');
    assert.deepStrictEqual(model.identity, {});
  });

  it('accepts an appearance object in frontmatter', () => {
    const model = parseGurps({ appearance: { Height: '5\'6"', Eyes: 'Brown' } }, []);
    assert.strictEqual(model.identity.Height, '5\'6"');
  });
});

describe('identity band placement', () => {
  it('renders full width above the two-column flow', () => {
    const html = buildSheet(parseGurps({}, [appearanceSheet]));
    const band = html.indexOf('identity-band');
    const flow = html.indexOf('<div class="flow">');
    assert.ok(band > -1, 'band renders');
    assert.ok(flow > -1, 'flow renders');
    assert.ok(band < flow, 'band precedes the flow');
  });
});
