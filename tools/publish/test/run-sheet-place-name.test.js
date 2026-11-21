'use strict';
// A place's title, the one rule (lib/run-sheet/place-name.js).
const { it } = require('node:test');
const assert = require('node:assert');
const { placeTitle } = require('../lib/run-sheet/place-name');

it('name, then the first alias, then a folder note\'s folder, then the stem with _ as spaces', () => {
  assert.strictEqual(placeTitle('Places/North/index.md', { name: 'The Northern Reach' }), 'The Northern Reach');
  assert.strictEqual(placeTitle('Places/North/index.md', { aliases: ['Northmarch', 'N'] }), 'Northmarch');
  assert.strictEqual(placeTitle('Places/North/index.md', { aliases: 'Northmarch' }), 'Northmarch');
  assert.strictEqual(placeTitle('Places/North/index.md', {}), 'North');
  for (const stem of ['README', 'readme', '_index']) assert.strictEqual(placeTitle(`Places/Old_Mill/${stem}.md`, {}), 'Old Mill', stem);
  assert.strictEqual(placeTitle('Places/The_Docks.md', { name: '  ' }), 'The Docks');
  assert.strictEqual(placeTitle('index.md', {}), 'index', 'no folder to name it by');
  assert.strictEqual(placeTitle('Places/Index Card Shop.md', null), 'Index Card Shop');
});
