// #510: local gravity (B350) on the GURPS sheet and party board, oz weights, and gear
// added after a player saved ticks.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const matter = require('gray-matter');
const { extractSections } = require('../lib/processor');
const { renderGURPSSheet } = require('../lib/templates/gurps/index');
const { buildPartyManifest } = require('../lib/party-manifest');
const { rowCells } = require('../js/gurps-party');
const gl = require('../js/gurps-live');

const META = { campaignId: 'c', pcSlug: 'gravity-test', buildVersion: 'v1', tohit: false };

// The fixture: ST 13 (BL 34), Basic Move 7, Basic Speed 7.00, Combat Reflexes, Weight 215 lb.
// Gear: 56 + 4 + 3.3 + 9.6 oz (0.6) + 3.6 = 67.5 lb. Its table: Light <=68, Medium <=102, Heavy <=204.
function sheet(edit) {
  let raw = fs.readFileSync(path.join(__dirname, 'fixtures/gurps/gurps-gravity.md'), 'utf8');
  if (edit) raw = edit(raw);
  const { data, content } = matter(raw);
  return renderGURPSSheet(data, extractSections(content), META);
}

test('9.6 oz reads as 0.6 lb, so the fixture carries 67.5 lb (Light at 1G)', () => {
  const out = sheet(raw => raw.replace('gravity: 1.2\n', ''));
  const total = out.liveData.items.reduce((s, it) => s + it.weight, 0);
  assert.equal(Math.round(total * 100) / 100, 67.5);
  const v = gl.deriveLive(out.liveData, null);
  assert.equal(v.encName, 'Light');
  assert.equal(v.gravity, null);
});

test('1.2G (B350): (215 + 67.5) x 0.2 = 56.5 extra, 124 lb -> Heavy, Move 2, Dodge 8', () => {
  const out = sheet();
  assert.equal(out.liveData.gravity, 1.2);
  assert.equal(out.liveData.bodyWeight, 215);
  const v = gl.deriveLive(out.liveData, null);
  assert.equal(v.load, 124);
  assert.equal(v.encName, 'Heavy');
  assert.equal(v.move.cur, 2);
  assert.equal(v.dodge.cur, 8);
  assert.equal(v.gravity, 1.2);
  assert.equal(v.bodyMissing, false);
});

test('the party board carries gravity through the manifest and shows the value', () => {
  const out = sheet();
  const m = buildPartyManifest('c', [{ name: 'Gravity Test', outputPath: 'pcs/g.html', data: out.liveData }]);
  const v = gl.deriveLive(m.pcs[0], null);
  assert.equal(v.encName, 'Heavy');
  const cells = rowCells(v);
  assert.match(cells.enc, /Heavy/);
  assert.match(cells.enc, /1\.2G/);
  assert.equal(cells.move.startsWith('2'), true);
});

test('the sheet shows the gravity where the encumbrance shows', () => {
  const out = sheet();
  assert.match(out.sheetHtml, /1\.2G/);
  assert.doesNotMatch(out.sheetHtml, /No Weight row/);
});

test('no gravity, or gravity 1, shows no marker and changes nothing', () => {
  for (const edit of [raw => raw.replace('gravity: 1.2\n', ''), raw => raw.replace('gravity: 1.2', 'gravity: 1')]) {
    const out = sheet(edit);
    assert.equal(out.liveData.gravity, null);
    assert.doesNotMatch(out.sheetHtml, /\dG\b/);
    const v = gl.deriveLive(out.liveData, null);
    assert.equal(v.encName, 'Light');
    assert.doesNotMatch(rowCells(v).enc, /G</);
  }
});

test('0.5G (B350): gear counts at half, body weight plays no part: 33.75 lb -> None', () => {
  const out = sheet(raw => raw.replace('gravity: 1.2', 'gravity: 0.5'));
  const v = gl.deriveLive(out.liveData, null);
  assert.equal(v.load, 33.75);
  assert.equal(v.encName, 'None');
  assert.equal(v.move.cur, 7);
  assert.match(rowCells(v).enc, /0\.5G/);
});

test('above 1G with no Weight row: the gear share only, and the sheet says the body is missing', () => {
  const out = sheet(raw => raw.replace('| Weight | 215 lb |\n', ''));
  assert.equal(out.liveData.bodyWeight, null);
  const v = gl.deriveLive(out.liveData, null);
  // 67.5 + 67.5 x 0.2 = 81 -> Medium; the 43 lb of body share is not guessed.
  assert.equal(v.load, 81);
  assert.equal(v.encName, 'Medium');
  assert.equal(v.bodyMissing, true);
  assert.match(out.sheetHtml, /No Weight row/);
});

test('an unreadable gravity is a build warning and reads as 1G', () => {
  const out = sheet(raw => raw.replace('gravity: 1.2', 'gravity: heavy'));
  assert.equal(out.liveData.gravity, null);
  assert.ok(out.warnings.some(w => /gravity/.test(w)));
});

test('gravityLoad: the B350 example, 150 lb body + 30 lb gear at 1.2G = 66 lb', () => {
  assert.equal(gl.gravityLoad(30, 1.2, 150).load, 66);
  assert.equal(gl.gravityLoad(30, null, 150).load, 30);
  assert.equal(gl.gravityLoad(30, 0, 150).load, 0);
});

test('saved ticks: an item missing from the saved state falls back to its default', () => {
  const pc = {
    levels: [
      { name: 'None', maxWeight: 20, move: 5, dodge: 8 }, { name: 'Light', maxWeight: 40, move: 4, dodge: 7 },
      { name: 'Medium', maxWeight: 60, move: 3, dodge: 6 }, { name: 'Heavy', maxWeight: 120, move: 2, dodge: 5 },
      { name: 'X-Heavy', maxWeight: 200, move: 1, dodge: 4 },
    ],
    items: [
      { key: 'Old', weight: 10, defaultCarried: true },
      { key: 'Dropped', weight: 30, defaultCarried: true },
      { key: 'New', weight: 25, defaultCarried: true },
      { key: 'Kit', weight: 50, defaultCarried: false },
    ],
  };
  // Saved before "New" and "Kit" were on the sheet; "Dropped" was unticked and stays unticked.
  const v = gl.deriveLive(pc, { items: { Old: true, Dropped: false } });
  assert.equal(v.load, 35);
  assert.equal(v.encName, 'Light');
});

test('no gear rows: gravity still applies to body weight (215 x 0.2 = 43 lb -> Light)', () => {
  const noGear = raw => raw.replace(/## Equipment[\s\S]*?(?=### Encumbrance)/, '## Equipment\n\n');
  const out = sheet(noGear);
  assert.ok(out.liveData, 'a gravity PC with no gear still gets live data');
  assert.equal(out.liveData.items.length, 0);
  const v = gl.deriveLive(out.liveData, null);
  assert.equal(v.load, 43);
  assert.equal(v.encName, 'Light');
  assert.equal(v.move.cur, 5);
  assert.equal(gl.deriveLive(out.liveData, { items: {} }).encName, 'Light');
  // Without gravity a gearless sheet has nothing live, as before.
  assert.equal(sheet(raw => noGear(raw).replace('gravity: 1.2\n', '')).liveData, null);
});
