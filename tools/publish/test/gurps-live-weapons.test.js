'use strict';
// The live script writes a weapon's lowered to-hit into every row of that weapon: a built page
// prints the weapon tables in the Sheet tab and again in the Combat tab. Run in a vm against the
// least document the script needs. Names are invented.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'gurps-live.js'), 'utf8');

const DATA0 = {
  levels: [
    { name: 'None', num: 0, maxWeight: 10, move: 6, dodge: 10 },
    { name: 'Light', num: 1, maxWeight: 100, move: 4, dodge: 9 },
  ],
  vitals: null,
  skills: {},
  weapons: {
    Rapier: { toHit: [15, 14], parry: [11, 10], block: null },
    Pistol: { toHit: [12, 12], parry: null, block: null },
  },
  items: [{ key: 'Armor', weight: 56, defaultCarried: true, table: 'main' }],
};

function span(text) { return { textContent: String(text), classList: { toggle() {} } }; }

// spec: [[table, key, tohit, parry], ...] in page order; each tab gets its own Melee Attacks and
// Ranged Attacks block holding those rows.
function run(DATA, spec) {
  const rows = [];
  const blocks = [];
  for (const tab of ['sheet', 'combat']) {
    for (const [table, title] of [['melee', 'Melee Attacks'], ['ranged', 'Ranged Attacks']]) {
      const mine = [];
      for (const [t, key, tohit, parry] of spec) {
        if (t !== table) continue;
        const r = { tab, table, key, tohit: span(tohit), parry: span(parry) };
        rows.push(r); mine.push(r);
      }
      blocks.push({
        querySelector: (s) => (s === 'h2' ? { textContent: title } : null),
        querySelectorAll: (s) => (s === '[data-weapon-key]'
          ? mine.map((r) => ({ getAttribute: () => r.key, querySelector: (c) => (c === '.wp-tohit' ? r.tohit : r.parry) }))
          : []),
      });
    }
  }
  const toggle = { checked: false, getAttribute: () => 'Armor', addEventListener() {} };
  let ready = null;
  const key = (sel) => (/data-weapon-key="([^"]*)"\] \.(wp-[a-z]+)/.exec(sel) || []);
  const document = {
    readyState: 'complete',
    addEventListener: (t, fn) => { if (t === 'DOMContentLoaded') ready = fn; },
    getElementById: (id) => (id === 'gurps-live-data' ? { textContent: JSON.stringify(DATA) } : null),
    querySelectorAll: (sel) => {
      if (sel === '.eq-toggle') return [toggle];
      if (sel === '#tab-sheet .wide, #tab-combat .wide') return blocks;
      const [, k, cls] = key(sel);
      if (!k) return [];
      return rows.filter((r) => r.key === k).map((r) => (cls === 'wp-tohit' ? r.tohit : r.parry));
    },
    querySelector: (sel) => document.querySelectorAll(sel)[0] || null,
    documentElement: { classList: { add() {} } },
  };
  const store = { readCache: () => null, save() {}, hydrate() {} };
  const win = { __liveState: { createStore: () => store } };
  vm.runInNewContext(SOURCE, Object.assign(win, { document, window: win, globalThis: win }));
  // The script ran with root = window (it is defined).
  ready();
  return { rows, toggle };
}

const LEGACY_SPEC = [['melee', 'Rapier', 15, 11], ['melee', 'Pistol', 12, '']];

test('a lowered to-hit is written into the Sheet tab and the Combat tab alike', () => {
  const { rows } = run(DATA0, LEGACY_SPEC);
  const rapier = rows.filter((r) => r.key === 'Rapier');
  assert.strictEqual(rapier.length, 2);
  // Armor is carried by default: weight 56 is Light, where a Rapier is one lower.
  for (const r of rapier) assert.strictEqual(String(r.tohit.textContent), '14', r.tab);
  for (const r of rapier) assert.strictEqual(String(r.parry.textContent), '10', r.tab);
  for (const r of rows.filter((x) => x.key === 'Pistol')) assert.strictEqual(String(r.tohit.textContent), '12', r.tab);
});

// Three attacks, two names: two Knife modes in Melee Attacks (15 and 12) and a Knife in Ranged
// Attacks (13). Each carries its own key/table/nth in the data block.
const SAME = Object.assign({}, DATA0, {
  weapons: {
    Knife: { key: 'Knife', table: 'melee', nth: 0, toHit: [15, 14], parry: [11, 10], block: null },
    'Knife#melee#1': { key: 'Knife', table: 'melee', nth: 1, toHit: [12, 11], parry: [9, 8], block: null },
    'Knife#ranged#0': { key: 'Knife', table: 'ranged', nth: 0, toHit: [13, 13], parry: null, block: null },
  },
  items: [{ key: 'Armor', weight: 5, defaultCarried: true, table: 'main' }],
});
const SAME_SPEC = [['melee', 'Knife', 15, 11], ['melee', 'Knife', 12, 9], ['ranged', 'Knife', 13, '']];
const read = (rows, tab, table, i) => rows.filter((r) => r.tab === tab && r.table === table)[i];

test('same-named attacks keep their own to-hit and parry at no encumbrance, in both tabs', () => {
  const { rows } = run(SAME, SAME_SPEC);
  for (const tab of ['sheet', 'combat']) {
    assert.strictEqual(String(read(rows, tab, 'melee', 0).tohit.textContent), '15', tab);
    assert.strictEqual(String(read(rows, tab, 'melee', 1).tohit.textContent), '12', tab);
    assert.strictEqual(String(read(rows, tab, 'ranged', 0).tohit.textContent), '13', tab);
    assert.strictEqual(String(read(rows, tab, 'melee', 0).parry.textContent), '11', tab);
    assert.strictEqual(String(read(rows, tab, 'melee', 1).parry.textContent), '9', tab);
  }
});

test('same-named attacks each take their own lowered number under encumbrance, in both tabs', () => {
  const heavy = Object.assign({}, SAME, { items: [{ key: 'Armor', weight: 56, defaultCarried: true, table: 'main' }] });
  const { rows } = run(heavy, SAME_SPEC);
  for (const tab of ['sheet', 'combat']) {
    assert.strictEqual(String(read(rows, tab, 'melee', 0).tohit.textContent), '14', tab);
    assert.strictEqual(String(read(rows, tab, 'melee', 1).tohit.textContent), '11', tab);
    assert.strictEqual(String(read(rows, tab, 'ranged', 0).tohit.textContent), '13', tab);
    assert.strictEqual(String(read(rows, tab, 'melee', 0).parry.textContent), '10', tab);
    assert.strictEqual(String(read(rows, tab, 'melee', 1).parry.textContent), '8', tab);
  }
});
