'use strict';
// The to-hit calculator's page, run in a vm against the least document it needs (the way
// test/previews-client.test.js does). Shared by the DOM test and the golden test. Data blocks
// are built by hand; names are invented.
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TOHIT_RULES } = require('../../lib/templates/gurps/blocks/tohit-rules');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'gurps-tohit.js'), 'utf8');

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
    rules: TOHIT_RULES,
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

// The drawn calculator as plain data: every element's tag, attributes, own text, value, flags and
// children, in order. Two drawings that serialise the same are the same page.
function snapshot(el) {
  const out = { tag: el.tag, attrs: el.attrs };
  if (el._text) out.text = el._text;
  if (el.value) out.value = el.value;
  for (const k of ['checked', 'disabled', 'open', 'hidden']) if (el[k]) out[k] = true;
  if (el.children.length) out.kids = el.children.map(snapshot);
  return out;
}

module.exports = { El, dataBlock, load, snapshot, SOURCE };
