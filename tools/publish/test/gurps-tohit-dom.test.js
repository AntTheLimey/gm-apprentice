'use strict';
// The to-hit calculator's DOM half, run in a vm against the least document it needs
// (the way test/previews-client.test.js does). Data blocks are built by hand; names are invented.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('../js/gurps-tohit');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'gurps-tohit.js'), 'utf8');
const HOSTILE = '<img src=x onerror=1>';

// ---- a document small enough to read ----
function matchOne(node, sel) {
  const re = /(#[\w-]+|\.[\w-]+|\[[\w-]+(?:="[^"]*")?\]|^[a-z0-9]+)/g;
  const parts = sel.match(re) || [];
  if (!parts.length) return false;
  for (const p of parts) {
    if (p[0] === '#') { if (node.attrs.id !== p.slice(1)) return false; }
    else if (p[0] === '.') { if (!node.classNames().includes(p.slice(1))) return false; }
    else if (p[0] === '[') {
      const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(p);
      if (!(m[1] in node.attrs)) return false;
      if (m[2] !== undefined && node.attrs[m[1]] !== m[2]) return false;
    } else if (node.tag !== p) return false;
  }
  return true;
}
class El {
  constructor(tag) {
    this.tag = tag; this.attrs = {}; this.children = []; this.parent = null; this.listeners = {};
    this._text = ''; this.value = ''; this.checked = false; this.disabled = false; this.open = false; this.hidden = false;
  }
  classNames() { return (this.attrs.class || '').split(/\s+/).filter(Boolean); }
  set className(v) { this.attrs.class = v; }
  get className() { return this.attrs.class || ''; }
  get classList() { const self = this; return { add: (c) => { if (!self.classNames().includes(c)) self.attrs.class = (self.className + ' ' + c).trim(); }, remove: (c) => { self.attrs.class = self.classNames().filter((x) => x !== c).join(' '); }, toggle: (c, on) => { const has = self.classNames().includes(c); if (on === undefined ? !has : on) this.add(c); else this.remove(c); }, contains: (c) => self.classNames().includes(c) }; }
  get parentNode() { return this.parent; }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = v; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children.forEach((c) => { c.parent = null; }); this.children = []; this._text = String(v); }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parent = null; return c; }
  get firstChild() { return this.children[0] || null; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel) {
    const chain = sel.split(/\s+/).filter(Boolean);
    return this.all().filter((n) => {
      if (!matchOne(n, chain[chain.length - 1])) return false;
      let at = n.parent; let i = chain.length - 2;
      while (i >= 0 && at) { if (matchOne(at, chain[i])) i--; at = at.parent; }
      return i < 0;
    });
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function dataBlock(over = {}) {
  const w = (o) => Object.assign({ aids: [], bonuses: [], beam: false, range: '', damage: '', base: null }, o);
  return Object.assign({
    pc: 'six',
    weapons: [
      w({ key: 'Hatchet', type: 'melee', name: 'Hatchet', skill: 'Axe/Mace', level: 14, base: 14, damage: 'sw+1 cut' }),
      w({ key: 'Punch', type: 'melee', name: 'Punch', skill: 'Brawling', level: 13, base: 13, damage: 'thr cr' }),
      w({
        key: 'Blaster pistol', type: 'ranged', name: 'Blaster pistol', skill: 'Beam Weapons (Pistol)', level: 17, base: 17,
        acc: 6, rof: 10, rcl: 1, bulk: 2, range: '150/450', damage: '3d burn', beam: true,
        aids: [
          { id: 'row-laser', name: 'Laser sight', bonus: 1, acc: false, fixed: false, from: 'row', on: true },
          { id: 'row-prog', name: 'Targeting program', bonus: null, acc: false, fixed: false, from: 'row', on: true },
        ],
      }),
    ],
    aids: [{ id: 'gear-spare', name: 'Reflex sight', bonus: 2, acc: true, fixed: false, from: 'gear', on: false }],
    techniques: { targeted: [{ skill: 'Beam Weapons (Pistol)', loc: 'skull', net: -5, name: 'Targeted Attack (Beam/Skull)' }], dual: {}, other: [{ skill: 'Axe/Mace', name: 'Hook', level: 15 }] },
    traits: { ambidextrous: false, offHand: [], halfRapid: false, telescopic: 0, nightVision: 0 },
    freeFall: 12,
    locations: [['torso', 'Torso', 0], ['vitals', 'Vitals', -3], ['arm', 'Arm', -2], ['leg', 'Leg', -2], ['extremity', 'Hand or foot', -4], ['groin', 'Groin', -3], ['face', 'Face', -5], ['neck', 'Neck', -5], ['skull', 'Skull', -7], ['eye', 'Eye', -9]],
    bands: [2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100, 150, 200, 300, 500, 700],
  }, over);
}

// opts: store (initial localStorage contents), lsThrows, cells ({key: '15'}), noData
function load(data, opts = {}) {
  const body = new El('body');
  const box = body.appendChild(new El('div')); box.id = 'tohit-calc';
  // The sheet prints the number it shows in each row; the page takes only the live cell's difference from it.
  if (!opts.noShown && data && Array.isArray(data.weapons)) for (const w of data.weapons) if (w.shown === undefined) w.shown = w.level;
  const blob = body.appendChild(new El('script')); blob.id = 'gurps-tohit-data';
  blob.textContent = opts.noData ? '' : JSON.stringify(data);
  // A built page prints the weapon tables twice: in the Sheet tab and in the Combat tab.
  const sheet = opts.sheetTab ? body.appendChild(new El('div')) : null;
  if (sheet) sheet.id = 'tab-sheet';
  const tab = body.appendChild(new El('div')); tab.id = 'tab-combat';
  const rows = {};
  const sheetRows = {};
  // cells: { Name: '15' } puts a melee row in the Melee Attacks table; [[type, name, level], ...] puts rows in the
  // table of their type, in order (two rows may share a name).
  const list = Array.isArray(opts.cells) ? opts.cells : Object.entries(opts.cells || {}).map(([k, v]) => ['melee', k, v]);
  for (const [host, into] of [[sheet, sheetRows], [tab, rows]]) {
    if (!host) continue;
    const tables = {};
    for (const [type, key, level] of list) {
      if (!tables[type]) {
        const wide = host.appendChild(new El('div')); wide.className = 'wide cat-table';
        const hd = wide.appendChild(new El('h2')); hd.textContent = type === 'ranged' ? 'Ranged Attacks' : 'Melee Attacks';
        tables[type] = wide.appendChild(new El('table'));
      }
      const tr = tables[type].appendChild(new El('tr')); tr.setAttribute('data-weapon-key', key);
      const td = tr.appendChild(new El('td')); const sp = td.appendChild(new El('span')); sp.className = 'wp-tohit'; sp.textContent = level;
      (into[key] = into[key] || []).push(sp);
    }
  }
  const store = new Map(Object.entries(opts.store || {}));
  const localStorage = opts.lsThrows ? {
    getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); },
  } : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
  const observers = [];
  class MutationObserver { constructor(fn) { this.fn = fn; this.targets = []; observers.push(this); } observe(t) { this.targets.push(t); } disconnect() {} }
  const doc = {
    readyState: 'complete',
    getElementById: (id) => body.all().find((n) => n.id === id) || null,
    createElement: (t) => new El(t),
    querySelector: (s) => body.querySelector(s),
    querySelectorAll: (s) => body.querySelectorAll(s),
    addEventListener() {},
  };
  const timers = [];
  const win = { localStorage, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; } };
  const flushTimers = () => { for (const t of timers.splice(0)) if (t.fn) t.fn(); };
  const ctx = { document: doc, window: win, MutationObserver, JSON, Math, Number, String, Object, Array, Boolean, parseInt, parseFloat, isFinite, Set, Map, console };
  vm.runInNewContext(SOURCE, ctx);
  const $ = (sel) => body.querySelector(sel);
  const fire = (el, type) => { for (const fn of el.listeners[type] || []) fn({ type, target: el, preventDefault() {} }); };
  const set = (sel, v) => { const el = $(sel); assert.ok(el, sel); if (el.attrs.type === 'checkbox') el.checked = v; else el.value = String(v); fire(el, 'input'); fire(el, 'change'); return el; };
  const names = () => body.querySelectorAll('.th-gname').map((n) => n.textContent);
  const saved = () => { const raw = store.get('tohit-calc:' + data.pc); return raw ? JSON.parse(raw) : null; };
  return { flushTimers, body, box, $, all: (s) => body.querySelectorAll(s), fire, set, names, store, saved, rows, sheetRows, observers, blob, tab };
}

describe('what it draws', () => {
  it('draws Aiming for a ranged weapon and Setup for a melee one, never both', () => {
    const p = load(dataBlock());
    p.set('#th-weapon', 'Blaster pistol');
    assert.deepStrictEqual(p.names(), ['Aiming', 'Attack', 'Target', 'Environment', 'You', "Foe's defence"]);
    p.set('#th-weapon', 'Punch');
    assert.deepStrictEqual(p.names(), ['Setup', 'Attack', 'Target', 'Environment', 'You', "Foe's defence"]);
    assert.strictEqual(p.$('#th-aim'), null);
    assert.ok(p.$('#th-evaluate'));
  });
  it('draws nothing, and does not throw, with no data block', () => {
    const p = load(dataBlock(), { noData: true });
    assert.strictEqual(p.box.children.length, 0);
  });
  it('shows the roll that effective() gives for the default state', () => {
    const d = dataBlock();
    const p = load(d);
    const want = T.effective(d, T.defaultState(d)).roll;
    assert.strictEqual(p.$('#th-roll').textContent, String(want));
    p.set('#th-weapon', 'Blaster pistol');
    assert.strictEqual(p.$('#th-roll').textContent, String(T.effective(d, Object.assign(T.defaultState(d), { weapon: 'Blaster pistol' })).roll));
  });
  it('the roll follows the controls', () => {
    const d = dataBlock();
    const p = load(d);
    p.set('#th-weapon', 'Blaster pistol');
    const before = Number(p.$('#th-roll').textContent);
    p.set('#th-aim', 3);
    const after = Number(p.$('#th-roll').textContent);
    assert.ok(after > before);
    const s = Object.assign(T.defaultState(d), { weapon: 'Blaster pistol', aim: 3 });
    assert.strictEqual(after, T.effective(d, s).roll);
    p.set('#th-yards', 100);
    assert.strictEqual(Number(p.$('#th-roll').textContent), T.effective(d, Object.assign(s, { yards: '100' })).roll);
  });
  it('offers 0 to 6 turns aimed', () => {
    const p = load(dataBlock());
    p.set('#th-weapon', 'Blaster pistol');
    assert.deepStrictEqual(p.$('#th-aim').children.map((o) => o.attrs.value), ['0', '1', '2', '3', '4', '5', '6']);
  });
  it('draws cover as three controls and no -3, -4 or -5 steps', () => {
    const p = load(dataBlock());
    p.set('#th-weapon', 'Blaster pistol');
    assert.deepStrictEqual(p.$('#th-cover').children.map((o) => o.attrs.value), ['0', 'partial', 'light']);
    assert.ok(p.$('#th-behind'));
    assert.strictEqual(p.$('#th-targetLow').attrs.type, 'checkbox');
    p.set('#th-weapon', 'Punch');
    assert.strictEqual(p.$('#th-cover'), null);
    assert.strictEqual(p.$('#th-targetLow'), null);
  });
  it('draws the first line, the included line and the notes from effective()', () => {
    const d = dataBlock();
    d.weapons[1] = Object.assign({}, d.weapons[1], { level: 16, base: 13 });
    const p = load(d);
    p.set('#th-weapon', 'Punch');
    const rows = p.all('#th-lines tr');
    assert.match(rows[0].textContent, /Brawling.*16/);
    assert.ok(p.all('.th-included').some((r) => /\+3.*Brawling 13/.test(r.textContent)));
    p.set('#th-man', 'aodbl');
    assert.match(p.$('#th-notes').textContent, /All-Out Attack \(Double\)/);
  });
  it('Telegraphic Attack shows the critical chance of the skill without the +4, and the strip agrees', () => {
    const p = load(dataBlock());
    p.set('#th-weapon', 'Hatchet');
    p.set('#th-telegraphic', true);
    assert.strictEqual(p.$('#th-roll').textContent, '18');
    assert.strictEqual(p.$('#th-crit').textContent, '1.9%');
    const cells = p.all('.th-cell');
    assert.match(cells[5 - 3].className, /th-S\b/);
    assert.match(cells[6 - 3].className, /th-S\b/);
    assert.match(cells[4 - 3].className, /th-CS\b/);
    p.set('#th-telegraphic', false);
    p.set('#th-other', 4);
    assert.strictEqual(p.$('#th-roll').textContent, '18');
    assert.match(p.all('.th-cell')[5 - 3].className, /th-CS\b/);
    assert.strictEqual(p.$('#th-crit').textContent, '9.3%');
  });
  it('says no roll below 3', () => {
    const p = load(dataBlock());
    p.set('#th-other', -30);
    assert.strictEqual(p.$('#th-hit').textContent, 'no roll');
    assert.match(p.$('#th-notes').textContent, /no roll to make/);
  });
  it('shows the zero-gravity box with the Free Fall level, and leaves it out when there is none', () => {
    const p = load(dataBlock());
    assert.match(p.$('#th-zerog').parent.textContent, /Free Fall 12/);
    p.set('#th-zerog', true);
    assert.match(p.$('#th-lines').textContent, /Free Fall 12 in place of Axe\/Mace 14/);
    const q = load(dataBlock({ freeFall: null }));
    assert.strictEqual(q.$('#th-zerog'), null);
  });
});

describe('aids and targeted attacks', () => {
  it('ticks each aid as its `on` says, a number box for one with no bonus', () => {
    const p = load(dataBlock());
    p.set('#th-weapon', 'Blaster pistol');
    const laser = p.$('[data-aid="row-laser"]');
    assert.strictEqual(laser.attrs.type, 'checkbox');
    assert.strictEqual(laser.checked, true);
    assert.strictEqual(p.$('[data-aid="gear-spare"]').checked, false);
    const prog = p.$('[data-aid="row-prog"]');
    assert.strictEqual(prog.attrs.type, 'number');
    assert.strictEqual(p.all('[data-aid="row-prog"]').length, 1);
    p.set('[data-aid="row-prog"]', 2);
    assert.strictEqual(p.saved().state.aidBonus['row-prog'], '2');
    assert.match(p.$('#th-lines').textContent, /Targeting program/);
  });
  it('draws a button for a targeted attack, which sets the location', () => {
    const d = dataBlock();
    const p = load(d);
    p.set('#th-weapon', 'Blaster pistol');
    const chip = p.$('.th-chip[data-loc="skull"]');
    assert.ok(chip);
    assert.match(chip.textContent, /Skull.*5.*plain.*7/);
    const before = Number(p.$('#th-roll').textContent);
    p.fire(chip, 'click');
    assert.strictEqual(p.$('#th-loc').value, 'skull');
    assert.strictEqual(Number(p.$('#th-roll').textContent), before - 5);
    p.fire(p.$('.th-chip[data-loc="skull"]'), 'click');
    assert.strictEqual(p.$('#th-loc').value, 'torso', 'a second tap puts it back');
    p.set('#th-weapon', 'Hatchet');
    assert.strictEqual(p.$('.th-chip'), null, 'none for a weapon whose skill has none');
  });
  it('offers a technique picker for the weapon\'s skill, and uses it', () => {
    const p = load(dataBlock());
    assert.deepStrictEqual(p.$('#th-tech').children.map((o) => o.attrs.value), ['', 'Hook']);
    p.set('#th-tech', 'Hook');
    assert.match(p.$('#th-lines').textContent, /Hook.*15/);
    p.set('#th-weapon', 'Blaster pistol');
    assert.strictEqual(p.$('#th-tech'), null);
    p.set('#th-weapon', 'Hatchet');
    assert.strictEqual(p.$('#th-tech').value, '', 'a technique does not follow to another weapon');
  });
  it('disables Deceptive while Telegraphic is on, and the reverse', () => {
    const p = load(dataBlock());
    p.set('#th-telegraphic', true);
    assert.strictEqual(p.$('#th-deceptive').disabled, true);
    p.set('#th-telegraphic', false);
    assert.strictEqual(p.$('#th-deceptive').disabled, false);
    p.set('#th-deceptive', -2);
    assert.strictEqual(p.$('#th-telegraphic').disabled, true);
  });
});

describe('strings from the data are text, never markup', () => {
  it('a weapon name, an aid name and a technique name with markup in them', () => {
    const d = dataBlock();
    d.weapons[0] = Object.assign({}, d.weapons[0], { key: '<b>Axe</b>', name: '<b>Axe</b>' });
    const p = load(d);
    assert.ok(p.$('#th-weapon').all().some((o) => o.tag === 'option' && o.textContent.includes('<b>Axe</b>')));
    assert.strictEqual(p.all('b').length, 0);
  });
  it('every string field carries <img src=x onerror=1> and no element is made from it', () => {
    const d = dataBlock();
    d.weapons[0] = Object.assign({}, d.weapons[0], { key: HOSTILE + 'w', name: HOSTILE + 'w', skill: HOSTILE + 's', damage: HOSTILE + 'd' });
    d.weapons[2] = Object.assign({}, d.weapons[2], {
      range: HOSTILE + 'r',
      aids: [{ id: 'a1', name: HOSTILE + 'a', bonus: 2, acc: true, fixed: true, from: 'row', on: true }, { id: 'a2', name: HOSTILE + 'n', bonus: null, acc: false, from: 'row', on: true }],
    });
    d.techniques = { targeted: [{ skill: HOSTILE + 's', loc: 'skull', net: -2, name: HOSTILE + 't' }], dual: {}, other: [{ skill: HOSTILE + 's', name: HOSTILE + 'o', level: 15 }] };
    const p = load(d);
    p.set('#th-weapon', HOSTILE + 'w');
    p.set('#th-tech', HOSTILE + 'o');
    assert.ok(p.box.textContent.includes(HOSTILE + 'w'), 'the weapon name is on the page as text');
    assert.ok(p.box.textContent.includes(HOSTILE + 'd'), 'so is its damage');
    assert.ok(p.box.textContent.includes(HOSTILE + 'o'), 'and the technique');
    assert.strictEqual(p.all('img').length, 0);
    p.set('#th-weapon', 'Blaster pistol');
    p.set('#th-aim', 1);
    assert.ok(p.box.textContent.includes(HOSTILE + 'a'), 'an aid name');
    assert.ok(p.box.textContent.includes(HOSTILE + 'n'), 'an aid with no bonus');
    assert.ok(p.box.textContent.includes(HOSTILE + 'r'), 'the range');
    assert.strictEqual(p.all('img').length, 0);
  });
  it('notes that come from effective() are text', () => {
    const d = dataBlock();
    d.weapons[2] = Object.assign({}, d.weapons[2], { aids: [{ id: 's', name: 'Scope', bonus: 4, acc: true, fixed: true, from: 'row', on: true }] });
    const p = load(d);
    p.set('#th-weapon', 'Blaster pistol'); p.set('#th-aim', 1);
    assert.ok(p.$('#th-notes').children.length > 0);
    assert.ok(p.$('#th-notes').children.every((n) => n.children.length === 0), 'a note is one text node');
  });
});

describe('what is remembered', () => {
  const KEY = 'tohit-calc:six';
  it('still draws when localStorage throws on every access', () => {
    const p = load(dataBlock(), { lsThrows: true });
    p.set('#th-weapon', 'Blaster pistol');
    p.set('#th-aim', 2);
    assert.strictEqual(p.$('#th-aim').value, '2');
    assert.ok(p.$('#th-roll').textContent.length > 0);
  });
  it('saves the setup, the open groups and typed aid bonuses, and reads them back', () => {
    const d = dataBlock();
    const p = load(d);
    p.set('#th-weapon', 'Blaster pistol');
    p.set('#th-aim', 3); p.set('#th-yards', 40); p.set('[data-aid="row-prog"]', 2);
    const grp = p.$('details[data-g="env"]');
    grp.open = true; p.fire(grp, 'toggle');
    const saved = p.saved();
    assert.strictEqual(saved.state.weapon, 'Blaster pistol');
    assert.strictEqual(saved.open.env, true);
    const q = load(d, { store: { [KEY]: JSON.stringify(saved) } });
    assert.strictEqual(q.$('#th-weapon').value, 'Blaster pistol');
    assert.strictEqual(q.$('#th-aim').value, '3');
    assert.strictEqual(q.$('#th-yards').value, '40');
    assert.strictEqual(q.$('[data-aid="row-prog"]').value, '2');
    assert.strictEqual(q.$('details[data-g="env"]').open, true);
  });
  it('garbage JSON falls back to the defaults without throwing', () => {
    for (const bad of ['{not json', '', 'null', '[1,2]', '"x"', '12', '{"state":5}', '{"state":{"weapon":{}}}']) {
      const p = load(dataBlock(), { store: { [KEY]: bad } });
      assert.strictEqual(p.$('#th-weapon').value, 'Hatchet', bad);
      assert.strictEqual(p.$('#th-roll').textContent, '14', bad);
    }
  });
  it('a saved weapon key that no longer exists falls back to the first weapon', () => {
    const p = load(dataBlock(), { store: { [KEY]: JSON.stringify({ state: { weapon: 'Old gun', foe: '12' } }) } });
    assert.strictEqual(p.$('#th-weapon').value, 'Hatchet');
    assert.strictEqual(p.$('#th-foe').value, '12', 'the rest of a good state is still used');
  });
  it('a saved aid id that is gone is ignored', () => {
    const state = { weapon: 'Blaster pistol', aids: { 'old-scope': true, 'row-laser': false }, aidBonus: { 'old-scope': 9 } };
    const p = load(dataBlock(), { store: { [KEY]: JSON.stringify({ state }) } });
    assert.strictEqual(p.$('[data-aid="row-laser"]').checked, false);
    p.set('#th-aim', 1);
    assert.ok(!('old-scope' in p.saved().state.aids));
    assert.ok(!('old-scope' in p.saved().state.aidBonus));
  });
});

describe('weapons and reset', () => {
  it('keeps the ranged choices across a melee weapon and back', () => {
    const p = load(dataBlock());
    p.set('#th-weapon', 'Blaster pistol');
    p.set('#th-aim', 3); p.set('#th-yards', 70); p.set('#th-cover', 'light'); p.set('#th-man', 'popup'); p.set('#th-behind', 2); p.set('#th-targetLow', true);
    p.set('#th-weapon', 'Hatchet');
    assert.strictEqual(p.$('#th-aim'), null);
    p.set('#th-posture', -2);
    p.set('#th-weapon', 'Blaster pistol');
    assert.strictEqual(p.$('#th-aim').value, '3');
    assert.strictEqual(p.$('#th-yards').value, '70');
    assert.strictEqual(p.$('#th-cover').value, 'light');
    assert.strictEqual(p.$('#th-man').value, 'popup');
    assert.strictEqual(p.$('#th-behind').value, '2');
    assert.strictEqual(p.$('#th-targetLow').checked, true);
    p.set('#th-weapon', 'Hatchet');
    assert.strictEqual(p.$('#th-posture').value, '-2');
  });
  it('reset returns every control to its default, keeps the weapon, and re-ticks aids', () => {
    const d = dataBlock();
    const p = load(d);
    p.set('#th-weapon', 'Blaster pistol');
    p.set('#th-aim', 4); p.set('#th-yards', 70); p.set('#th-cover', 'partial'); p.set('#th-foe', 12); p.set('#th-other', 3);
    p.set('[data-aid="row-laser"]', false); p.set('[data-aid="gear-spare"]', true); p.set('[data-aid="row-prog"]', 3);
    p.fire(p.$('#th-reset'), 'click');
    const fresh = T.defaultState(d);
    assert.strictEqual(p.$('#th-weapon').value, 'Blaster pistol');
    assert.strictEqual(p.$('#th-aim').value, '0');
    assert.strictEqual(p.$('#th-yards').value, '');
    assert.strictEqual(p.$('#th-cover').value, '0');
    assert.strictEqual(p.$('#th-foe').value, '');
    assert.strictEqual(p.$('#th-other').value, '');
    assert.strictEqual(p.$('[data-aid="row-laser"]').checked, true, 're-ticked');
    assert.strictEqual(p.$('[data-aid="gear-spare"]').checked, false, 'its `on` is false');
    assert.strictEqual(p.$('[data-aid="row-prog"]').value, '');
    assert.strictEqual(p.$('#th-roll').textContent, String(T.effective(d, Object.assign(fresh, { weapon: 'Blaster pistol' })).roll));
    const s = p.saved().state;
    assert.strictEqual(s.aim, 0);
    assert.strictEqual(s.weapon, 'Blaster pistol');
  });
  it('reset also puts the melee controls back', () => {
    const p = load(dataBlock());
    p.set('#th-posture', -4); p.set('#th-evaluate', 2); p.set('#th-telegraphic', true);
    p.fire(p.$('#th-reset'), 'click');
    assert.strictEqual(p.$('#th-posture').value, '0');
    assert.strictEqual(p.$('#th-evaluate').value, '0');
    assert.strictEqual(p.$('#th-telegraphic').checked, false);
    assert.strictEqual(p.$('#th-deceptive').disabled, false);
  });
});

describe('the live level', () => {
  it('reads the weapon level from the Combat tab\'s cell when it is there, and follows it', () => {
    const d = dataBlock();
    const p = load(d, { cells: { Hatchet: '12' } });
    assert.strictEqual(p.$('#th-roll').textContent, '12');
    p.rows.Hatchet[0].textContent = '10';
    assert.ok(p.observers.length > 0, 'it watches the cell');
    for (const o of p.observers) o.fn([]);
    assert.strictEqual(p.$('#th-roll').textContent, '10');
  });
  it('uses the data block\'s level for a weapon with no cell', () => {
    const p = load(dataBlock(), { cells: { Hatchet: '12' } });
    p.set('#th-weapon', 'Punch');
    assert.strictEqual(p.$('#th-roll').textContent, '13');
  });
  it('ignores a cell that is not a number', () => {
    const p = load(dataBlock(), { cells: { Hatchet: 'n/a' } });
    assert.strictEqual(p.$('#th-roll').textContent, '14');
  });
});

describe('the live level, with the weapon tables in both tabs', () => {
  it('a lowered live number moves the roll by the difference, once', () => {
    const p = load(dataBlock(), { sheetTab: true, cells: { Hatchet: '12' } });
    assert.strictEqual(p.$('#th-roll').textContent, '12');
    const enc = p.all('#th-lines tr').filter((r) => /Encumbrance/.test(r.textContent));
    assert.strictEqual(enc.length, 1);
    assert.match(enc[0].textContent, /−2/);
    assert.match(p.$('#th-weapon').children[0].children[0].textContent, /Hatchet \(12\)/);
  });
  it('the Combat tab is the one read, even with a different number in the Sheet tab', () => {
    const p = load(dataBlock(), { sheetTab: true, cells: { Hatchet: '12' } });
    p.sheetRows.Hatchet[0].textContent = '9';
    for (const o of p.observers) o.fn([]);
    assert.strictEqual(p.$('#th-roll').textContent, '12');
  });
  it('a data block with no printed number takes no difference', () => {
    const p = load(dataBlock(), { noShown: true, cells: { Hatchet: '12' } });
    assert.strictEqual(p.$('#th-roll').textContent, '14');
  });
  it('the authored level drives the sum: a bonus in the level is not counted again', () => {
    const d = dataBlock();
    d.weapons[0] = Object.assign({}, d.weapons[0], { level: 15, base: 14, shown: 15, bonuses: [{ name: 'Weapon Bond', bonus: 1 }] });
    const p = load(d, { cells: { Hatchet: '14' } });
    assert.strictEqual(p.$('#th-roll').textContent, '14');
    assert.strictEqual(p.all('#th-lines tr').filter((r) => /Encumbrance/.test(r.textContent)).length, 1);
  });
});

describe('aids and buttons that follow the weapon', () => {
  const withProgram = () => {
    const d = dataBlock({ aids: [{ id: 'prog', name: 'Targeting program', bonus: 2, acc: false, fixed: false, from: 'gear', on: true }] });
    d.weapons.push(Object.assign({}, d.weapons[2], { id: 'wg', key: 'Grenade', name: 'Grenade', skill: 'Throwing', aids: [], level: 12, base: 12 }));
    d.weapons.forEach((w, i) => { if (!w.id) w.id = 'w' + i; });
    d.weapons[2].aids = [];
    return d;
  };
  it('a character-wide skill bonus starts ticked on a gun and unticked on a grenade', () => {
    const p = load(withProgram());
    p.set('#th-weapon', 'w2');
    assert.strictEqual(p.$('[data-aid="prog"]').checked, true);
    p.set('#th-weapon', 'wg');
    assert.strictEqual(p.$('[data-aid="prog"]').checked, false);
  });
  it('a tick changed on one weapon does not flip the other, and Reset puts each back', () => {
    const p = load(withProgram());
    p.set('#th-weapon', 'w2');
    p.set('[data-aid="prog"]', false);
    p.set('#th-weapon', 'wg');
    p.set('[data-aid="prog"]', true);
    p.set('#th-weapon', 'w2');
    assert.strictEqual(p.$('[data-aid="prog"]').checked, false);
    p.set('#th-weapon', 'wg');
    assert.strictEqual(p.$('[data-aid="prog"]').checked, true);
    p.fire(p.$('#th-reset'), 'click');
    assert.strictEqual(p.$('[data-aid="prog"]').checked, false, 'the grenade is back to unticked');
    p.set('#th-weapon', 'w2');
    assert.strictEqual(p.$('[data-aid="prog"]').checked, true, 'the pistol is back to ticked');
  });
  it('an aid already in the sheet\'s number starts unticked with a hint, and Reset keeps it so', () => {
    const d = withProgram();
    d.weapons[2] = Object.assign({}, d.weapons[2], { level: 19, base: 17, shown: 19 });
    const p = load(d);
    p.set('#th-weapon', 'w2');
    const box = p.$('[data-aid="prog"]');
    assert.strictEqual(box.checked, false);
    assert.match(box.parent.textContent, /already in the sheet's number/);
    assert.strictEqual(p.$('#th-roll').textContent, '19');
    p.set('[data-aid="prog"]', true);
    assert.strictEqual(p.$('#th-roll').textContent, '21');
    p.fire(p.$('#th-reset'), 'click');
    assert.strictEqual(p.$('[data-aid="prog"]').checked, false);
    assert.match(p.$('[data-aid="prog"]').parent.textContent, /already in the sheet's number/);
    p.set('#th-weapon', 'wg');
    assert.doesNotMatch(p.$('[data-aid="prog"]').parent.textContent, /already in the sheet's number/);
  });
  it('the technique picker says defaults are in it too', () => {
    const p = load(dataBlock());
    assert.match(p.$('#th-tech').parent.textContent, /Use a technique or default instead/);
  });
  it('Rapid Strike is greyed out, with the reason, under Move and Attack', () => {
    const p = load(dataBlock());
    assert.strictEqual(p.$('#th-rapid').disabled, false);
    p.set('#th-man', 'move');
    assert.strictEqual(p.$('#th-rapid').disabled, true);
    assert.match(p.$('#th-rapid').title, /Move and Attack/);
  });
  it('the pressed state of the targeted-attack buttons follows the weapon', () => {
    const d = dataBlock();
    d.weapons.push(Object.assign({}, d.weapons[2], { id: 'wr', key: 'Rifle', name: 'Rifle', skill: 'Guns (Rifle)', aids: [] }));
    d.weapons.push(Object.assign({}, d.weapons[2], { id: 'wb', key: 'Beam rifle', name: 'Beam rifle', skill: 'Beam Weapons (Rifle)', aids: [] }));
    d.weapons.forEach((w, i) => { if (!w.id) w.id = 'w' + i; });
    d.techniques.targeted.push({ skill: 'Beam Weapons (Rifle)', loc: 'eye', net: -6, name: 'Targeted Attack (Beam Weapons (Rifle)/Eye)' });
    const p = load(d);
    p.set('#th-weapon', 'w2');
    p.fire(p.$('.th-chip[data-loc="skull"]'), 'click');
    assert.strictEqual(p.$('.th-chip[data-loc="skull"]').attrs['aria-pressed'], 'true');
    p.set('#th-weapon', 'wr');
    assert.strictEqual(p.$('.th-chip'), null);
    // A hit location is chosen for one attack: a new weapon starts back at the torso (#357).
    assert.strictEqual(p.$('#th-loc').value, 'torso');
    p.set('#th-weapon', 'wb');
    assert.strictEqual(p.all('.th-chip').length, 1);
    assert.strictEqual(p.$('.th-chip[data-loc="eye"]').attrs['aria-pressed'], 'false');
    p.set('#th-weapon', 'w2');
    assert.strictEqual(p.$('.th-chip[data-loc="skull"]').attrs['aria-pressed'], 'false');
  });
});

describe('weapons with the same name', () => {
  const twin = () => {
    const d = dataBlock();
    d.weapons.push(
      { id: 'w3', key: 'Twin Blade', type: 'melee', nth: 0, name: 'Twin Blade', skill: 'Knife', level: 17, base: 17, damage: '1d cut', aids: [], bonuses: [], beam: false, range: '' },
      { id: 'w4', key: 'Twin Blade', type: 'melee', nth: 1, name: 'Twin Blade', skill: 'Karate', level: 15, base: 15, damage: '1d cr', aids: [], bonuses: [], beam: false, range: '' },
    );
    d.weapons.forEach((w, i) => { if (!w.id) w.id = 'w' + i; });
    return d;
  };
  it('both can be picked and each shows its own numbers', () => {
    const p = load(twin());
    const opts = p.$('#th-weapon').all().filter((o) => o.tag === 'option');
    assert.strictEqual(new Set(opts.map((o) => o.attrs.value)).size, opts.length, 'option values are unique');
    p.set('#th-weapon', 'w3');
    assert.strictEqual(p.$('#th-weapon').value, 'w3');
    assert.strictEqual(p.$('#th-roll').textContent, '17');
    assert.match(p.$('#th-wline').textContent, /1d cut/);
    p.set('#th-weapon', 'w4');
    assert.strictEqual(p.$('#th-weapon').value, 'w4');
    assert.strictEqual(p.$('#th-roll').textContent, '15');
    assert.match(p.$('#th-wline').textContent, /1d cr/);
    assert.match(p.$('#th-lines').textContent, /Karate/);
    assert.strictEqual(p.saved().state.weapon, 'w4');
  });
  it('a saved state with the name as the weapon picks the first of that name', () => {
    const p = load(twin(), { store: { 'tohit-calc:six': JSON.stringify({ state: { weapon: 'Twin Blade' } }) } });
    assert.strictEqual(p.$('#th-weapon').value, 'w3');
  });
  it('reads each twin\'s level from its own row of its own table', () => {
    const p = load(twin(), { cells: [['melee', 'Twin Blade', '12'], ['melee', 'Twin Blade', '9'], ['ranged', 'Twin Blade', '20']] });
    p.set('#th-weapon', 'w3');
    assert.strictEqual(p.$('#th-roll').textContent, '12');
    p.set('#th-weapon', 'w4');
    assert.strictEqual(p.$('#th-roll').textContent, '9');
    p.rows['Twin Blade'][1].textContent = '8';
    for (const o of p.observers) o.fn([]);
    assert.strictEqual(p.$('#th-roll').textContent, '8');
  });
  it('when the live script lowers both, each moves by its own row\'s difference', () => {
    // Sheet prints 17 and 15; encumbrance lowers them by 2 and 1.
    const p = load(twin(), { sheetTab: true, cells: [['melee', 'Twin Blade', '15'], ['melee', 'Twin Blade', '14']] });
    p.set('#th-weapon', 'w3');
    assert.strictEqual(p.$('#th-roll').textContent, '15');
    p.set('#th-weapon', 'w4');
    assert.strictEqual(p.$('#th-roll').textContent, '14');
  });
  it('a ranged weapon takes the Ranged Attacks row, not a melee row of the same name', () => {
    const d = twin();
    d.weapons.push({ id: 'w5', key: 'Twin Blade', type: 'ranged', nth: 0, name: 'Twin Blade', skill: 'Guns (Pistol)', level: 16, base: 16, acc: 2, rof: 1, rcl: 1, bulk: 1, range: '10/20', damage: '1d pi', aids: [], bonuses: [], beam: false });
    const p = load(d, { cells: [['melee', 'Twin Blade', '12'], ['melee', 'Twin Blade', '9'], ['ranged', 'Twin Blade', '20']] });
    p.set('#th-weapon', 'w5');
    assert.strictEqual(p.$('#th-roll').textContent, '20');
  });
});

describe('the answer, said and drawn', () => {
  it('says the answer in one polite sentence, after a pause, once for a burst of changes', () => {
    const p = load(dataBlock());
    const live = p.$('#th-live');
    assert.strictEqual(live.attrs['aria-live'], 'polite');
    assert.match(live.textContent, /^Roll 14 or less on 3d6\. 90\.7 percent to hit\.$/);
    p.set('#th-other', 1); p.set('#th-other', 12); p.set('#th-other', -2);
    assert.match(live.textContent, /^Roll 14 or less/, 'not yet');
    p.flushTimers();
    assert.strictEqual(live.textContent, 'Roll 12 or less on 3d6. ' + (T.odds(12).hit * 100).toFixed(1) + ' percent to hit.');
    p.set('#th-other', -30);
    p.flushTimers();
    assert.match(live.textContent, /no roll/i);
  });
  it('draws the strip as one image, with the ranges in words and a title on each cell', () => {
    const p = load(dataBlock());
    const strip = p.$('#th-strip');
    assert.strictEqual(strip.attrs.role, 'img');
    assert.strictEqual(strip.attrs['aria-label'], 'Critical hit on 3 to 4, hit up to 14, miss from 15, critical miss on 17 to 18');
    const cells = p.all('.th-cell');
    assert.strictEqual(cells.length, 16);
    assert.strictEqual(cells[0].attrs.title, 'Roll 3: critical hit');
    assert.strictEqual(cells[9].attrs.title, 'Roll 12: hit');
    assert.strictEqual(cells[12].attrs.title, 'Roll 15: miss');
    assert.strictEqual(cells[15].attrs.title, 'Roll 18: critical miss');
  });
  it('keeps colour off the subtotals: the sign says it', () => {
    const p = load(dataBlock());
    p.set('#th-weapon', 'Blaster pistol'); p.set('#th-aim', 3);
    const sums = p.all('.th-gsum');
    assert.ok(sums.length > 0);
    assert.ok(sums.every((x) => !/th-(pos|neg|zero)/.test(x.className)));
    assert.match(sums[0].textContent, /^\+\d/);
  });
  it('a greyed control says why, and gives the reason as a title', () => {
    const p = load(dataBlock());
    p.set('#th-telegraphic', true);
    const hint = p.all('.th-hint').find((x) => !x.hidden);
    assert.ok(hint);
    assert.strictEqual(hint.textContent, 'Not with a Telegraphic Attack');
    assert.strictEqual(p.$('#th-deceptive').title, 'Not with a Telegraphic Attack');
    p.set('#th-telegraphic', false);
    assert.ok(p.all('.th-hint').every((x) => x.hidden));
    assert.strictEqual(p.$('#th-deceptive').title, '');
    p.set('#th-deceptive', -2);
    assert.strictEqual(p.$('#th-telegraphic').title, 'Not with a Deceptive Attack');
  });
});

describe('where it is remembered', () => {
  it('under the campaign, so two sites with one character name keep apart', () => {
    const p = load(dataBlock({ campaign: 'canticle' }));
    p.set('#th-foe', 12);
    assert.ok(p.store.has('tohit-calc:canticle:six'));
    assert.ok(!p.store.has('tohit-calc:six'));
    const other = load(dataBlock({ campaign: 'dead-end' }), { store: { 'tohit-calc:canticle:six': p.store.get('tohit-calc:canticle:six') } });
    assert.strictEqual(other.$('#th-foe').value, '', 'another campaign does not see it');
  });
  it('reads the key from before campaigns were in it, once, and saves it under the new one', () => {
    const d = dataBlock({ campaign: 'canticle' });
    const p = load(d, { store: { 'tohit-calc:six': JSON.stringify({ state: { foe: '13' } }) } });
    assert.strictEqual(p.$('#th-foe').value, '13');
    assert.ok(p.store.has('tohit-calc:canticle:six'));
    assert.strictEqual(JSON.parse(p.store.get('tohit-calc:canticle:six')).state.foe, '13');
  });
});

// #357: a skill with techniques and no weapon row has its own group, and no live cell.
describe('skills offered for their techniques', () => {
  it('sit in their own group of the weapon list and follow no table row', () => {
    const d = dataBlock();
    d.weapons.forEach((w, i) => { w.id = 'w' + i; });
    d.weapons.push({ id: 'w3', key: 'Judo', type: 'melee', nth: 0, name: 'Judo', skill: 'Judo', level: 16, base: 16, shown: null, damage: '', range: '', beam: false, aids: [], bonuses: [], bySkill: true });
    d.techniques.other.push({ skill: 'Judo', name: 'Arm Lock', level: 18 });
    // A table row that happens to share the skill's name is not this entry's live cell.
    const p = load(d, { cells: { Judo: '11' } });
    const groups = p.all('optgroup').map((g) => g.attrs.label);
    assert.deepStrictEqual(groups, ['Melee', 'Ranged', 'Skills with techniques']);
    p.set('#th-weapon', 'w3');
    assert.strictEqual(p.$('#th-roll').textContent, '16');
    assert.ok(p.$('#th-tech'), 'the technique picker is offered');
  });
});
