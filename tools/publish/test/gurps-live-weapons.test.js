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

const DATA = {
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

function run() {
  // rows: key -> [{ tab, tohit, parry }]
  const rows = [];
  const add = (tab, key, tohit, parry) => rows.push({ tab, key, tohit: span(tohit), parry: span(parry) });
  for (const tab of ['sheet', 'combat']) {
    add(tab, 'Rapier', 15, 11);
    add(tab, 'Pistol', 12, '');
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

test('a lowered to-hit is written into the Sheet tab and the Combat tab alike', () => {
  const { rows } = run();
  const rapier = rows.filter((r) => r.key === 'Rapier');
  assert.strictEqual(rapier.length, 2);
  // Armor is carried by default: weight 56 is Light, where a Rapier is one lower.
  for (const r of rapier) assert.strictEqual(String(r.tohit.textContent), '14', r.tab);
  for (const r of rapier) assert.strictEqual(String(r.parry.textContent), '10', r.tab);
  for (const r of rows.filter((x) => x.key === 'Pistol')) assert.strictEqual(String(r.tohit.textContent), '12', r.tab);
});
