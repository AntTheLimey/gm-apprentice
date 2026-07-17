// tools/publish/test/party-manifest.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildPartyManifest, partyDataScript } = require('../lib/party-manifest');

function entry(name, slug, basicSpeed, dx) {
  return {
    name, outputPath: 'characters/pcs/' + slug + '.html',
    data: {
      pcSlug: slug, buildVersion: 'v1', basicSpeed, dx, authoredLevel: 0,
      levels: [{ name: 'None', num: 0, maxWeight: 26, move: 6, dodge: 10 }],
      items: [{ key: 'Pack', weight: 10, defaultCarried: true, table: 'main' }],
      vitals: { hp: { cur: 13, max: 13 }, fp: { cur: 12, max: 12 }, st: 13 },
    },
  };
}

test('buildPartyManifest sorts by Basic Speed desc, DX tiebreak, then name', () => {
  const m = buildPartyManifest('space-game', [
    entry('Rock Lavey', 'rock', 5.5, 10),
    entry('Six', 'six', 6.5, 14),
    entry('Shackleton', 'shackleton', 6.0, 11),
    entry('Ronin', 'ronin', 6.0, 13),
  ]);
  assert.equal(m.campaignId, 'space-game');
  assert.deepEqual(m.pcs.map((p) => p.pcSlug), ['six', 'ronin', 'shackleton', 'rock']);
  assert.equal(m.pcs[0].name, 'Six');
  assert.equal(m.pcs[0].basicSpeed, 6.5);
});

test('buildPartyManifest carries the fields deriveLive needs', () => {
  const m = buildPartyManifest('c', [entry('Six', 'six', 6.5, 14)]);
  const pc = m.pcs[0];
  assert.ok(Array.isArray(pc.levels));
  assert.ok(Array.isArray(pc.items));
  assert.equal(pc.buildVersion, 'v1');
  assert.equal(pc.vitals.hp.max, 13);
  assert.equal(pc.outputPath, 'characters/pcs/six.html');
  assert.equal(pc.portrait, null);   // absent when the entry carries no portrait
});

test('buildPartyManifest carries the portrait path when present', () => {
  const e = entry('Six', 'six', 6.5, 14);
  e.portrait = 'images/characters/Six.png';
  const pc = buildPartyManifest('c', [e]).pcs[0];
  assert.equal(pc.portrait, 'images/characters/Six.png');
});

test('buildPartyManifest returns null when no entries have live data', () => {
  assert.equal(buildPartyManifest('c', []), null);
  assert.equal(buildPartyManifest('c', [{ name: 'X', outputPath: 'x.html', data: null }]), null);
});

test('a PC missing basicSpeed sorts last', () => {
  const noBS = entry('Zed', 'zed', null, 10);
  const m = buildPartyManifest('c', [noBS, entry('Six', 'six', 6.5, 14)]);
  assert.deepEqual(m.pcs.map((p) => p.pcSlug), ['six', 'zed']);
});

test('partyDataScript emits an escaped JSON island', () => {
  const m = buildPartyManifest('c', [entry('Six', 'six', 6.5, 14)]);
  const html = partyDataScript(m);
  assert.match(html, /id="gurps-party-data"/);
  assert.doesNotMatch(html, /<script[^>]*>[^]*<script/);   // no raw nested <script
  const json = html.replace(/^[^>]*>/, '').replace(/<\/script>$/, '').replace(/\\u003c/g, '<');
  assert.equal(JSON.parse(json).pcs[0].pcSlug, 'six');
});
