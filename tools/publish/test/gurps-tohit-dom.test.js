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
    locations: [['torso', 'Torso', 0], ['vitals', 'Vitals', -3], ['limb', 'Arm or leg', -2], ['extremity', 'Hand or foot', -4], ['groin', 'Groin', -3], ['face', 'Face', -5], ['neck', 'Neck', -5], ['skull', 'Skull', -7], ['eye', 'Eye', -9]],
    bands: [2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100, 150, 200, 300, 500, 700],
  }, over);
}

// opts: store (initial localStorage contents), lsThrows, cells ({key: '15'}), noData
function load(data, opts = {}) {
  const body = new El('body');
  const box = body.appendChild(new El('div')); box.id = 'tohit-calc';
  const blob = body.appendChild(new El('script')); blob.id = 'gurps-tohit-data';
  blob.textContent = opts.noData ? '' : JSON.stringify(data);
  const tab = body.appendChild(new El('div')); tab.id = 'tab-combat';
  const rows = {};
  for (const [key, level] of Object.entries(opts.cells || {})) {
    const tr = tab.appendChild(new El('tr')); tr.setAttribute('data-weapon-key', key);
    const td = tr.appendChild(new El('td')); const sp = td.appendChild(new El('span')); sp.className = 'wp-tohit'; sp.textContent = level;
    rows[key] = sp;
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
  const win = { localStorage };
  const ctx = { document: doc, window: win, MutationObserver, JSON, Math, Number, String, Object, Array, Boolean, parseInt, parseFloat, isFinite, Set, Map, console };
  vm.runInNewContext(SOURCE, ctx);
  const $ = (sel) => body.querySelector(sel);
  const fire = (el, type) => { for (const fn of el.listeners[type] || []) fn({ type, target: el, preventDefault() {} }); };
  const set = (sel, v) => { const el = $(sel); assert.ok(el, sel); if (el.attrs.type === 'checkbox') el.checked = v; else el.value = String(v); fire(el, 'input'); fire(el, 'change'); return el; };
  const names = () => body.querySelectorAll('.th-gname').map((n) => n.textContent);
  const saved = () => { const raw = store.get('tohit-calc:' + data.pc); return raw ? JSON.parse(raw) : null; };
  return { body, box, $, all: (s) => body.querySelectorAll(s), fire, set, names, store, saved, rows, observers, blob, tab };
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
    p.rows.Hatchet.textContent = '10';
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
