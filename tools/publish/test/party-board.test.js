const { test } = require('node:test');
const assert = require('node:assert');
const { renderPartyBoard } = require('../lib/templates/gurps/party-board');
const { buildPartyManifest } = require('../lib/party-manifest');

function entry(name, slug, bs, dx, vitals) {
  return {
    name, outputPath: 'characters/pcs/' + slug + '.html',
    data: {
      pcSlug: slug, buildVersion: 'v1', basicSpeed: bs, dx, authoredLevel: 0,
      levels: [
        { name: 'None', num: 0, maxWeight: 26, move: 6, dodge: 10 },
        { name: 'Light', num: 1, maxWeight: 52, move: 4, dodge: 9 },
        { name: 'Medium', num: 2, maxWeight: 78, move: 3, dodge: 8 },
        { name: 'Heavy', num: 3, maxWeight: 156, move: 2, dodge: 7 },
        { name: 'X-Heavy', num: 4, maxWeight: 260, move: 1, dodge: 6 },
      ],
      items: [{ key: 'Pack', weight: 10, defaultCarried: true, table: 'main' }],
      vitals,
    },
  };
}
const healthy = { hp: { cur: 13, max: 13 }, fp: { cur: 12, max: 12 }, st: 13 };

test('renderPartyBoard emits rows in initiative order with per-PC hooks', () => {
  const m = buildPartyManifest('space-game', [
    entry('Rock', 'rock', 5.5, 10, healthy),
    entry('Six', 'six', 6.5, 14, healthy),
  ]);
  const html = renderPartyBoard(m, 'characters/pcs/index.html');
  // Six (BS 6.5) before Rock (BS 5.5)
  assert.ok(html.indexOf('data-gl-party="six"') < html.indexOf('data-gl-party="rock"'));
  // dynamic field hooks present
  ['hp', 'fp', 'move', 'dodge', 'st', 'status', 'enc'].forEach((f) => {
    assert.match(html, new RegExp('data-gl-party-field="' + f + '"'));
  });
  // link back to the sheet (relative)
  assert.match(html, /href="six\.html"/);
  // live indicator element for the poller
  assert.match(html, /gl-party-live-time/);
});

test('renderPartyBoard shows condition badge + base→cur for an injured PC', () => {
  const m = buildPartyManifest('c', [entry('Six', 'six', 6.5, 14, { hp: { cur: 3, max: 13 }, fp: { cur: 12, max: 12 }, st: 13 })]);
  const html = renderPartyBoard(m, 'characters/pcs/index.html');
  // authored cur seeds the status: hp 3/13 → reeling
  assert.match(html, /Reeling/);
  assert.match(html, /gl-party-row reeling/);
});

test('renderPartyBoard returns null for a falsy/empty manifest', () => {
  assert.equal(renderPartyBoard(null, 'x.html'), null);
  assert.equal(renderPartyBoard({ campaignId: 'c', pcs: [] }, 'x.html'), null);
});
