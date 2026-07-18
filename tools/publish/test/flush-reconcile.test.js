const { test } = require('node:test');
const assert = require('node:assert');
const { pcSlugOfKey, latestStateByPcSlug } = require('../lib/flush/reconcile');

test('pcSlugOfKey extracts segment 2 of a loadout key, null otherwise', () => {
  assert.equal(pcSlugOfKey('loadout:camp:jane-ashford:ABCD'), 'jane-ashford');
  assert.equal(pcSlugOfKey('roster:camp'), null);
  assert.equal(pcSlugOfKey('loadout:camp'), null); // too few segments
  assert.equal(pcSlugOfKey(42), null);
});

test('latestStateByPcSlug keeps the newest device blob per PC', () => {
  const states = {
    'loadout:c:jane:AAAA': { hp: 5, updatedAt: 100 },
    'loadout:c:jane:BBBB': { hp: 9, updatedAt: 200 }, // newer → wins
    'loadout:c:marcus:CCCC': { hp: 7, updatedAt: 50 },
  };
  const out = latestStateByPcSlug(states);
  assert.deepEqual(out.jane, { hp: 9, updatedAt: 200 });
  assert.deepEqual(out.marcus, { hp: 7, updatedAt: 50 });
});

test('latestStateByPcSlug treats missing updatedAt as oldest and breaks ties on key', () => {
  const states = {
    'loadout:c:jane:AAAA': { hp: 1 },                 // no updatedAt → 0
    'loadout:c:jane:BBBB': { hp: 2, updatedAt: 10 },  // wins over AAAA
  };
  assert.equal(latestStateByPcSlug(states).jane.hp, 2);
  const tie = {
    'loadout:c:jane:AAAA': { hp: 1, updatedAt: 10 },
    'loadout:c:jane:ZZZZ': { hp: 2, updatedAt: 10 },  // equal time, greater key wins
  };
  assert.equal(latestStateByPcSlug(tie).jane.hp, 2);
});

test('latestStateByPcSlug ignores non-object blobs and bad keys', () => {
  const states = {
    'loadout:c:jane:AAAA': null,
    'roster:c': '["loadout:c:jane:AAAA"]',
    'loadout:c:marcus:CCCC': { hp: 3, updatedAt: 1 },
  };
  const out = latestStateByPcSlug(states);
  assert.deepEqual(Object.keys(out), ['marcus']);
});
