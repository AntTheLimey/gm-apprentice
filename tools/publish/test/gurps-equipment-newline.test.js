'use strict';
// A GURPS PC with no sheet and an Equipment table: the Equipment tab gets the table's notes on
// rows appended, and nothing at all, not even a newline, when there are none (#348).
const { test } = require('node:test');
const assert = require('node:assert');
const { renderGURPSSheet } = require('../lib/templates/gurps');

const EQUIPMENT = (extra) => ({
  title: 'Equipment',
  html: `<table><thead><tr><th>Item</th><th>Qty</th></tr></thead><tbody><tr><td>Rope</td><td>1</td>${extra}</tr></tbody></table>`,
});

test('no notes on rows: the Equipment tab ends where its markup ends', () => {
  const out = renderGURPSSheet({}, [EQUIPMENT('')], null);
  assert.ok(!out.sheetHtml, 'the fixture has no sheet');
  assert.ok(out.equipmentHtml, 'the fixture has an equipment tab');
  assert.ok(!out.equipmentHtml.endsWith('\n'), JSON.stringify(out.equipmentHtml.slice(-20)));
});

test('a cell beyond the header is still listed on the Equipment tab', () => {
  const html = EQUIPMENT('<td>ZZNOTE</td>').html.replace('<th>Qty</th>', '<th>Qty</th><th data-widened="1"></th>');
  const out = renderGURPSSheet({}, [{ title: 'Equipment', html }], null);
  assert.ok(out.equipmentHtml.includes('ZZNOTE'));
});
