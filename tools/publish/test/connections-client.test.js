'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const api = require('../js/connections.js');

const groups = (...sizes) => sizes.map((n, g) => ({ n: `G${g}`, d: Array.from({ length: n }, (_, i) => ({ t: `I${g}-${i}`, h: `i${g}-${i}.html`, k: 'NPC', o: 'w', l: [], f: 0, s: null, i: null })) }));

test('the web falls back to the tree on a phone when the tab is crowded', () => {
  assert.strictEqual(api.treatmentFor('web', 17, 390), 'tree');
  assert.strictEqual(api.treatmentFor('web', 16, 390), 'web');
  assert.strictEqual(api.treatmentFor('web', 40, 1280), 'web');
  assert.strictEqual(api.treatmentFor('cards', 40, 390), 'cards');
  assert.strictEqual(api.treatmentFor('tree', 40, 390), 'tree');
});

test('the tree gives every item a row, in order, and grows with them', () => {
  const wide = api.treeLayout(groups(2, 3), 900);
  assert.strictEqual(wide.narrow, false);
  assert.strictEqual(wide.rows.length, 5);
  assert.deepStrictEqual(wide.rows.map((r) => [r.group, r.index]), [[0, 0], [0, 1], [1, 0], [1, 1], [1, 2]]);
  assert.ok(wide.rows.every((r, n) => n === 0 || r.y > wide.rows[n - 1].y));
  assert.ok(wide.height > wide.rows[4].y);
  const narrow = api.treeLayout(groups(2, 3), 390);
  assert.strictEqual(narrow.narrow, true);
  assert.ok(narrow.height > wide.height, 'a heading row per group');
  assert.deepStrictEqual(narrow.branches.map((b) => [b.label, b.first, b.count]), [['G0', 0, 2], ['G1', 2, 3]]);
});

test('the web puts every item on the ring, none on another', () => {
  const { nodes, bands } = api.webLayout(groups(3, 4), 600);
  assert.strictEqual(nodes.length, 7);
  const seen = new Set(nodes.map((n) => `${Math.round(n.x)},${Math.round(n.y)}`));
  assert.strictEqual(seen.size, 7);
  assert.deepStrictEqual(bands.map((b) => b.label), ['G0', 'G1']);
  for (const n of nodes) assert.ok(n.x >= 0 && n.x <= 600 && n.y >= 0 && n.y <= 600);
});

test('the web leaves a gap of one slot between groups', () => {
  const { nodes } = api.webLayout(groups(2, 2), 600);
  const step = (2 * Math.PI) / 6;
  assert.ok(Math.abs(nodes[2].angle - nodes[1].angle - 2 * step) < 1e-9);
});

test('arrow keys move between tabs and wrap', () => {
  assert.strictEqual(api.nextTab(0, 3, 'ArrowRight'), 1);
  assert.strictEqual(api.nextTab(2, 3, 'ArrowRight'), 0);
  assert.strictEqual(api.nextTab(0, 3, 'ArrowLeft'), 2);
  assert.strictEqual(api.nextTab(1, 3, 'Home'), 0);
  assert.strictEqual(api.nextTab(1, 3, 'End'), 2);
  assert.strictEqual(api.nextTab(1, 3, 'a'), 1);
});

test('on touch the first tap selects and the second follows', () => {
  const a = {}; const b = {};
  assert.strictEqual(api.tapAction(null, a, 'touch'), 'select');
  assert.strictEqual(api.tapAction(a, a, 'touch'), 'follow');
  assert.strictEqual(api.tapAction(a, b, 'touch'), 'select');
  assert.strictEqual(api.tapAction(null, a, 'mouse'), 'follow');
});

test('tone codes map to the three families, anything else to nothing', () => {
  assert.deepStrictEqual(['w', 'h', 'n', null, 'x'].map(api.toneClass), ['cx-warm', 'cx-hostile', 'cx-neutral', '', '']);
});

test('sessions text matches the build', () => {
  const { sessionsText } = require('../lib/templates/connections');
  for (const s of [null, [1, 'Session 4', 'Session 4'], [4, 'Session 2', 'Session 9']]) {
    assert.strictEqual(api.sessionsText(s), sessionsText(s && { count: s[0], first: s[1], last: s[2] }));
  }
});

// ---- the DOM part, against the least document it needs ----

function matchOne(node, sel) {
  const m = /^([a-z]*)((?:\.[\w-]+)*)(?:\[([\w-]+)\])?$/.exec(sel.trim());
  if (!m) throw new Error('stub selector: ' + sel);
  if (m[1] && node.tag !== m[1]) return false;
  for (const c of m[2].split('.').filter(Boolean)) if (!node.classes.includes(c)) return false;
  if (m[3] && !(m[3] in node.attrs)) return false;
  return true;
}

class Node {
  constructor(tag, size) {
    this.size = size || { width: 0 }; this.order = Node.count = (Node.count || 0) + 1;
    this.tag = tag; this.classes = []; this.attrs = {}; this.children = []; this.parent = null;
    this.listeners = {}; this.style = {}; this._text = ''; this.focused = false; this.innerHTMLWrites = [];
    const self = this;
    this.classList = {
      add(c) { if (!self.classes.includes(c)) self.classes.push(c); },
      remove(c) { self.classes = self.classes.filter((x) => x !== c); },
      contains(c) { return self.classes.includes(c); },
    };
  }
  set innerHTML(v) { this.innerHTMLWrites.push(v); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get parentNode() { return this.parent; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parent = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.classes = String(v).split(/\s+/).filter(Boolean); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  // The page's measurements are the test's to set: the app and the tree container are as wide
  // as size.width (0 = hidden); anything else is a 28px-high box stacked by creation order.
  getBoundingClientRect() {
    if (this.classes.includes('cx-app') || this.classes.includes('cx-tree-wrap')) {
      const w = this.size.width;
      return { left: 0, right: w, top: 0, bottom: w ? 400 : 0, width: w, height: w ? 400 : 0 };
    }
    const top = this.order * 30;
    return { left: 0, right: 100, top, bottom: top + 28, width: 100, height: 28 };
  }
  focus() { this.focused = true; }
  closest(sel) { for (let n = this; n; n = n.parent) if (sel.split(',').some((s) => matchOne(n, s))) return n; return null; }
  all(pred) { return [this, ...this.children.flatMap((c) => c.all(pred))].filter(pred); }
  querySelectorAll(sel) { return this.all((n) => n !== this && matchOne(n, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

const island = (tabs, mentions = [], s = 'Emma') => ({ s, t: tabs, m: mentions });
const item = (t, more = {}) => ({ t, h: `${t.toLowerCase().replace(/\W+/g, '-')}.html`, k: 'NPC', o: 'w', l: [], f: 0, s: null, i: null, ...more });
const tab = (id, n, g) => ({ id, n, g });
const grp = (n, ...d) => ({ n, d });

// A page with sections: each is { mode, json } where json is a string, an object or null (no island).
// `width` is what the section measures (0 = hidden); `resize(w)` changes it and tells every
// ResizeObserver, as a browser would. `noObserver` leaves the window without one.
function setup(sections, { width = 1000, noObserver = false } = {}) {
  const size = { width };
  const body = new Node('body', size);
  const secs = sections.map((s) => {
    const section = body.appendChild(new Node('section', size));
    section.setAttribute('class', 'cx');
    section.setAttribute('data-cx-mode', s.mode);
    section.setAttribute('aria-labelledby', 'cx-heading');
    section.appendChild(new Node('div', size)).setAttribute('class', 'cx-plain');
    if (s.json !== null) {
      const script = section.appendChild(new Node('script', size));
      script.setAttribute('class', 'cx-data');
      script.textContent = typeof s.json === 'string' ? s.json : JSON.stringify(s.json);
    }
    return section;
  });
  const doc = {
    body,
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    createElement: (tag) => new Node(tag, size),
    createElementNS: (ns, tag) => new Node(tag, size),
  };
  const observers = [];
  const win = { listeners: {}, addEventListener: (t, fn) => { (win.listeners[t] = win.listeners[t] || []).push(fn); } };
  if (!noObserver) {
    win.ResizeObserver = class { constructor(fn) { this.fn = fn; this.watched = new Set(); observers.push(this); } observe(n) { this.watched.add(n); } unobserve(n) { this.watched.delete(n); } disconnect() {} };
  }
  api.init(doc, win);
  const fire = (node, type, extra = {}) => {
    const ev = { type, target: node, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
    for (let n = node; n; n = n.parent) (n.listeners[type] || []).forEach((fn) => fn(ev));
    return ev;
  };
  const resize = (w) => { size.width = w; observers.forEach((o) => o.fn([])); };
  return { body, secs, doc, win, fire, resize, observers, size };
}

const tabsOf = (section) => section.querySelectorAll('button');
const panelsOf = (section) => section.all((n) => n.attrs.role === 'tabpanel');
const visible = (panel) => !('hidden' in panel.attrs);
const PEOPLE = tab('people', 'People', [grp('Family', item('Ann'), item('Bo')), grp('Friends', item('Cy'))]);
const PLACES = tab('places', 'Places', [grp('Home', item('Keep', { o: null }))]);
const MENT = [{ n: 'Sessions', d: [['Session 1', '../s1.html'], ['Session 2', '../s2.html']] }, { n: 'Places', d: [['Docks', '../docks.html'], ['Inn', '../inn.html']] }];

test('a section gets a tablist of tabs with counts, the first selected, and goes live', () => {
  const p = setup([{ mode: 'tree', json: island([PEOPLE, PLACES], MENT) }]);
  const s = p.secs[0];
  const list = s.querySelector('div.cx-tabs');
  assert.strictEqual(list.getAttribute('role'), 'tablist');
  assert.strictEqual(list.getAttribute('aria-labelledby'), 'cx-heading');
  const tabs = tabsOf(s);
  assert.deepStrictEqual(tabs.map((t) => t.getAttribute('role')), ['tab', 'tab', 'tab']);
  assert.deepStrictEqual(tabs.map((t) => t.getAttribute('aria-label')), ['People 3', 'Places 1', 'Mentions 4']);
  assert.deepStrictEqual(tabs.map((t) => t.getAttribute('aria-selected')), ['true', 'false', 'false']);
  assert.deepStrictEqual(tabs.map((t) => t.getAttribute('tabindex')), ['0', '-1', '-1']);
  assert.ok(s.classes.includes('cx-live'));
  const panels = panelsOf(s);
  assert.deepStrictEqual(panels.map((x) => x.getAttribute('aria-labelledby')), tabs.map((t) => t.getAttribute('id')));
  assert.deepStrictEqual(tabs.map((t) => t.getAttribute('aria-controls')), panels.map((x) => x.getAttribute('id')));
  assert.ok(s.querySelector('div.cx-plain'), 'the plain lists stay');
});

test('clicking a tab selects it and shows only its panel, drawn on first show', () => {
  const p = setup([{ mode: 'tree', json: island([PEOPLE, PLACES]) }]);
  const s = p.secs[0];
  const [a, b] = panelsOf(s);
  assert.strictEqual(b.children.length, 0, 'not drawn until shown');
  p.fire(tabsOf(s)[1], 'click');
  assert.strictEqual(tabsOf(s)[1].getAttribute('aria-selected'), 'true');
  assert.strictEqual(tabsOf(s)[0].getAttribute('aria-selected'), 'false');
  assert.strictEqual(tabsOf(s)[1].getAttribute('tabindex'), '0');
  assert.ok(visible(b));
  assert.ok(!visible(a));
  assert.ok(b.children.length > 0);
});

test('arrow keys on the tablist move selection and focus', () => {
  const p = setup([{ mode: 'tree', json: island([PEOPLE, PLACES]) }]);
  const s = p.secs[0];
  const ev = p.fire(s.querySelector('div.cx-tabs'), 'keydown', { key: 'ArrowRight' });
  assert.strictEqual(ev.prevented, true);
  assert.strictEqual(tabsOf(s)[1].getAttribute('aria-selected'), 'true');
  assert.strictEqual(tabsOf(s)[1].focused, true);
  p.fire(s.querySelector('div.cx-tabs'), 'keydown', { key: 'Home' });
  assert.strictEqual(tabsOf(s)[0].getAttribute('aria-selected'), 'true');
  const other = p.fire(s.querySelector('div.cx-tabs'), 'keydown', { key: 'a' });
  assert.strictEqual(other.prevented, false);
});

test('a web on a phone with a crowded tab is drawn as the tree', () => {
  const many = tab('people', 'People', [grp('All', ...Array.from({ length: 17 }, (_, i) => item(`N${i}`)))]);
  const phone = setup([{ mode: 'web', json: island([many]) }], { width: 390 });
  assert.ok(phone.secs[0].querySelector('ul.cx-tree'));
  assert.ok(!phone.secs[0].querySelector('svg.cx-web'));
  const desk = setup([{ mode: 'web', json: island([many]) }], { width: 1280 });
  assert.ok(desk.secs[0].querySelector('svg.cx-web'));
  assert.ok(!desk.secs[0].querySelector('ul.cx-tree'));
});

test('the tree: every item a link in island order, no preview, and the strip fills on focus', () => {
  const lines = tab('people', 'People', [grp('Family', item('Ann', { l: ['Mine.', 'Theirs.'], f: 1, s: [2, 'Session 1', 'Session 3'], k: 'PC', o: 'h' }), item('Bo', { h: null }))]);
  const p = setup([{ mode: 'tree', json: island([lines]) }]);
  const s = p.secs[0];
  const rows = s.querySelectorAll('[data-cx-i]');
  assert.deepStrictEqual(rows.map((r) => r.tag), ['a', 'span']);
  assert.strictEqual(rows[0].getAttribute('href'), 'ann.html');
  assert.ok(rows.every((r) => 'data-no-preview' in r.attrs));
  const strip = s.querySelector('div.cx-strip');
  assert.strictEqual(strip.getAttribute('aria-live'), 'polite');
  assert.strictEqual(strip.children.length, 0, 'empty until something is focused');
  p.fire(rows[0], 'focusin');
  const text = strip.textContent;
  for (const bit of ['Ann', 'PC', 'Family', 'hostile', 'Mine.', 'Theirs.', '2 sessions, Session 1 to Session 3']) assert.ok(text.includes(bit), bit);
  const froms = strip.querySelectorAll('span.cx-from');
  assert.strictEqual(froms.length, 1, 'only the line past f');
  assert.strictEqual(froms[0].textContent, ' from Ann’s page');
  assert.strictEqual(froms[0].parent.textContent, 'Theirs. from Ann’s page');
  const open = strip.querySelector('a.cx-open');
  assert.strictEqual(open.textContent, 'Open page');
  assert.strictEqual(open.getAttribute('href'), 'ann.html');
  assert.ok(!('data-no-preview' in open.attrs));
  assert.ok(rows[0].classes.includes('cx-sel'));
  p.fire(rows[1], 'pointerover', { pointerType: 'mouse' });
  assert.ok(!rows[0].classes.includes('cx-sel'));
  assert.ok(strip.textContent.includes('Bo'));
  assert.strictEqual(strip.querySelector('a.cx-open'), null, 'no page, no link');
});

test('on touch the first tap on a row shows its line, the second follows', () => {
  const p = setup([{ mode: 'tree', json: island([PEOPLE]) }]);
  const s = p.secs[0];
  const rows = s.querySelectorAll('[data-cx-i]');
  p.fire(rows[0], 'pointerover', { pointerType: 'touch' });
  assert.strictEqual(s.querySelector('div.cx-strip').children.length, 0, 'touch hover selects nothing');
  p.fire(rows[0], 'pointerdown', { pointerType: 'touch' });
  p.fire(rows[0], 'focusin');
  assert.strictEqual(s.querySelector('div.cx-strip').children.length, 0, 'a focus from a tap selects nothing');
  const first = p.fire(rows[0], 'click', { detail: 1 });
  assert.strictEqual(first.prevented, true);
  assert.ok(rows[0].classes.includes('cx-sel'));
  p.fire(rows[0], 'pointerdown', { pointerType: 'touch' });
  const second = p.fire(rows[0], 'click', { detail: 1 });
  assert.strictEqual(second.prevented, false);
  p.fire(rows[1], 'pointerdown', { pointerType: 'touch' });
  assert.strictEqual(p.fire(rows[1], 'click', { detail: 1 }).prevented, true, 'another row selects first');
  assert.strictEqual(p.fire(rows[1], 'click', { detail: 0 }).prevented, false, 'a keyboard click always follows');
});

test('the web draws each item as an svg link with a name, none as a link without a page', () => {
  const t = tab('people', 'People', [grp('Family', item('Ann'), item('Bo', { h: null, o: 'h' }))]);
  const p = setup([{ mode: 'web', json: island([t]) }]);
  const web = p.secs[0].querySelector('svg.cx-web');
  assert.ok('data-no-preview' in web.attrs);
  const nodes = web.querySelectorAll('[data-cx-i]');
  assert.deepStrictEqual(nodes.map((n) => n.tag), ['a', 'g']);
  assert.strictEqual(nodes[0].getAttribute('href'), 'ann.html');
  assert.strictEqual(nodes[0].getAttribute('aria-label'), 'Ann, Family, warm');
  assert.strictEqual(nodes[1].getAttribute('href'), null);
  assert.strictEqual(nodes[1].getAttribute('aria-label'), 'Bo, Family, hostile');
  assert.ok(web.querySelector('g.cx-edges').getAttribute('aria-hidden') === 'true');
  p.fire(nodes[0], 'focusin');
  assert.ok(p.secs[0].querySelector('div.cx-strip').textContent.includes('Ann'));
});

test('cards: the name link follows without a preview block, a portrait shows as an img', () => {
  const t = tab('people', 'People', [grp('Family', item('Ann', { i: 'images/ann.png', l: ['Line.'], o: 'w' }), item('Bo', { h: null }))]);
  const p = setup([{ mode: 'cards', json: island([t]) }]);
  const s = p.secs[0];
  const links = s.querySelectorAll('a.cx-name');
  assert.strictEqual(links.length, 1);
  assert.ok(!('data-no-preview' in links[0].attrs));
  const imgs = s.querySelectorAll('img');
  assert.deepStrictEqual(imgs.map((i) => i.getAttribute('src')), ['images/ann.png']);
  assert.strictEqual(s.querySelector('div.cx-strip'), null, 'cards have no strip');
  assert.ok(s.querySelector('span.cx-name'), 'an item with no page is text');
});

test('an item with no page is text in every treatment', () => {
  const t = tab('people', 'People', [grp('Family', item('Ghost', { h: null }))]);
  for (const mode of ['tree', 'web', 'cards']) {
    const p = setup([{ mode, json: island([t]) }]);
    assert.strictEqual(p.secs[0].querySelectorAll('a').filter((a) => a.textContent.includes('Ghost') || a.getAttribute('aria-label')).length, 0, mode);
    assert.ok(p.secs[0].textContent.includes('Ghost') || p.secs[0].all((n) => (n.attrs['aria-label'] || '').startsWith('Ghost')).length, mode);
  }
});

test('an island that is not JSON, or none at all, leaves the section as built', () => {
  for (const json of ['{not json', null, '{"t": 3}', '[]', 'null']) {
    const p = setup([{ mode: 'tree', json }]);
    assert.ok(!p.secs[0].classes.includes('cx-live'), String(json));
    assert.strictEqual(p.secs[0].querySelector('div.cx-app'), null);
  }
});

test('no model string is ever assigned to innerHTML', () => {
  const evil = '<img onerror=x>';
  const t = tab('people', 'People', [grp(evil, item(evil, { k: evil, l: [evil], f: 0 }))]);
  const written = [];
  const orig = Object.getOwnPropertyDescriptor(Node.prototype, 'innerHTML');
  Object.defineProperty(Node.prototype, 'innerHTML', { configurable: true, set(v) { written.push(v); } });
  try {
    for (const mode of ['tree', 'web', 'cards']) {
      const p = setup([{ mode, json: island([t], [{ n: evil, d: [[evil, 'x.html']] }], evil) }]);
      const row = p.secs[0].querySelector('[data-cx-i]');
      if (row) p.fire(row, 'focusin');
      assert.ok(p.secs[0].textContent.includes(evil), mode);
      p.fire(tabsOf(p.secs[0])[1], 'click');
      assert.ok(p.secs[0].textContent.includes(evil));
    }
  } finally {
    Object.defineProperty(Node.prototype, 'innerHTML', orig);
  }
  assert.deepStrictEqual(written, []);
});

test('the Mentions tab is a list of links in island order, whatever the mode', () => {
  for (const mode of ['tree', 'web', 'cards']) {
    const p = setup([{ mode, json: island([PEOPLE], MENT) }]);
    p.fire(tabsOf(p.secs[0])[1], 'click');
    const panel = panelsOf(p.secs[0])[1];
    const links = panel.querySelectorAll('a');
    assert.deepStrictEqual(links.map((a) => [a.textContent, a.getAttribute('href')]), [['Session 1', '../s1.html'], ['Session 2', '../s2.html'], ['Docks', '../docks.html'], ['Inn', '../inn.html']]);
    assert.ok(links.every((a) => !('data-no-preview' in a.attrs)));
    assert.strictEqual(panel.querySelector('div.cx-strip'), null);
  }
});

test('the key shows only when some item has a tone', () => {
  const toned = setup([{ mode: 'tree', json: island([PEOPLE]) }]);
  assert.deepStrictEqual(toned.secs[0].querySelectorAll('span.cx-key-word').map((n) => n.textContent), ['warm', 'hostile', 'neutral']);
  const bare = setup([{ mode: 'tree', json: island([tab('places', 'Places', [grp('Home', item('Keep', { o: null }))])]) }]);
  assert.strictEqual(bare.secs[0].querySelector('p.cx-key'), null);
});

test('two sections get ids that do not collide; a javascript: href is never a link', () => {
  const bad = tab('people', 'People', [grp('Family', item('Ann', { h: 'javascript:alert(1)' }))]);
  const p = setup([{ mode: 'tree', json: island([PEOPLE]) }, { mode: 'cards', json: island([bad]) }]);
  const ids = p.body.all((n) => 'id' in n.attrs).map((n) => n.attrs.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.strictEqual(p.secs[1].querySelectorAll('a').length, 0);
});

test('a width change lays the tree out again and keeps the chosen item', () => {
  const p = setup([{ mode: 'tree', json: island([PEOPLE]) }], { width: 1000 });
  const s = p.secs[0];
  assert.ok(s.querySelector('div.cx-wide'));
  p.fire(s.querySelectorAll('[data-cx-i]')[1], 'focusin');
  p.resize(390);
  assert.ok(s.querySelector('div.cx-narrow'));
  assert.ok(s.querySelectorAll('[data-cx-i]')[1].classes.includes('cx-sel'));
  assert.ok(s.querySelector('div.cx-strip').textContent.includes('Bo'));
});

test('a section that measures 0 at load draws nothing, then draws when it has a width', () => {
  for (const mode of ['tree', 'web']) {
    const p = setup([{ mode, json: island([PEOPLE]) }], { width: 0 });
    const s = p.secs[0];
    assert.ok(s.classes.includes('cx-live'));
    assert.strictEqual(s.querySelector('ul.cx-tree'), null, mode);
    assert.strictEqual(s.querySelector('svg.cx-web'), null, mode);
    assert.strictEqual(s.querySelector('div.cx-tree-wrap'), null, mode);
    p.resize(600);
    assert.ok(mode === 'tree' ? s.querySelector('ul.cx-tree') : s.querySelector('svg.cx-web'), mode);
  }
});

test('a tree draws its lines only once the container has a width', () => {
  const p = setup([{ mode: 'tree', json: island([PEOPLE]) }], { width: 0 });
  assert.strictEqual(p.secs[0].querySelectorAll('path').length, 0);
  p.resize(900);
  const paths = p.secs[0].querySelectorAll('path');
  assert.ok(paths.length >= 3 + 2, 'a path per group and per name');
  assert.ok(paths.every((x) => /^M[-\d.]/.test(x.getAttribute('d')) && !x.getAttribute('d').includes('NaN')));
  assert.strictEqual(p.secs[0].querySelector('svg.cx-lines').getAttribute('aria-hidden'), 'true');
});

test('a 17-item web switches to the tree when the width falls from 900 to 390', () => {
  const many = tab('people', 'People', [grp('All', ...Array.from({ length: 17 }, (_, i) => item(`N${i}`)))]);
  const p = setup([{ mode: 'web', json: island([many]) }], { width: 900 });
  const s = p.secs[0];
  assert.ok(s.querySelector('svg.cx-web'));
  p.resize(390);
  assert.ok(s.querySelector('ul.cx-tree'));
  assert.strictEqual(s.querySelector('svg.cx-web'), null);
  p.resize(900);
  assert.ok(s.querySelector('svg.cx-web'));
});

test('without a ResizeObserver the window resize stands in, and a 0 width still draws nothing', () => {
  const p = setup([{ mode: 'tree', json: island([PEOPLE]) }], { width: 0, noObserver: true });
  assert.strictEqual(p.secs[0].querySelector('ul.cx-tree'), null);
  const real = global.setTimeout;
  global.setTimeout = (fn) => { fn(); return 1; };
  try {
    p.size.width = 700;
    p.win.listeners.resize.forEach((fn) => fn());
  } finally { global.setTimeout = real; }
  assert.ok(p.secs[0].querySelector('ul.cx-tree'));
});

test('the tab shown later is drawn for the width it has then', () => {
  const many = tab('places', 'Places', [grp('All', ...Array.from({ length: 17 }, (_, i) => item(`P${i}`)))]);
  const p = setup([{ mode: 'web', json: island([PEOPLE, many]) }], { width: 900 });
  p.resize(390);
  p.fire(tabsOf(p.secs[0])[1], 'click');
  assert.ok(panelsOf(p.secs[0])[1].querySelector('ul.cx-tree'));
});

test('the tree is a list of groups, each a labelled nested list, in reading order', () => {
  const p = setup([{ mode: 'tree', json: island([PEOPLE]) }]);
  const s = p.secs[0];
  const branches = s.querySelectorAll('li.cx-branch');
  assert.strictEqual(branches.length, 2);
  for (const b of branches) {
    const head = b.querySelector('p.cx-group');
    const leaves = b.querySelector('ul.cx-leaves');
    assert.strictEqual(leaves.getAttribute('aria-labelledby'), head.getAttribute('id'));
    assert.strictEqual(b.children[0], head);
  }
  assert.deepStrictEqual(s.querySelectorAll('[data-cx-i]').map((r) => r.textContent.slice(0, 2)), ['An', 'Bo', 'Cy']);
});

test('rows are in the flow: no inline position, top or height on anything in the tree', () => {
  const p = setup([{ mode: 'tree', json: island([PEOPLE]) }]);
  for (const n of p.secs[0].querySelector('div.cx-tree-wrap').all(() => true)) {
    for (const k of ['position', 'top', 'height', 'left', 'width']) assert.strictEqual(n.style[k], undefined, `${n.tag}.${k}`);
  }
});

test('lines end at each name\u2019s own centre, whatever the row heights', () => {
  const rows = [{ x: 100, y: 20, o: 'w' }, { x: 100, y: 90, o: 'h' }, { x: 100, y: 400, o: null }];
  const branches = [{ x: 60, y: 55, first: 0, count: 2 }, { x: 60, y: 400, first: 2, count: 1 }];
  for (const narrow of [false, true]) {
    const { paths, dots } = api.treeLines(rows, branches, { narrow, rootX: 10, rootY: 5 });
    const leaves = paths.filter((x) => x.kind === 'leaf');
    assert.strictEqual(leaves.length, 3);
    leaves.forEach((leaf, i) => {
      const end = narrow ? /V([-\d.]+)H([-\d.]+)$/.exec(leaf.d) : /([-\d.]+) ([-\d.]+)$/.exec(leaf.d);
      const got = narrow ? [Number(end[2]), Number(end[1])] : [Number(end[1]), Number(end[2])];
      assert.deepStrictEqual(got, [100, rows[i].y], `${narrow ? 'narrow' : 'wide'} ${i}`);
    });
    assert.deepStrictEqual(leaves.map((l) => l.tone), ['w', 'h', null]);
    assert.strictEqual(dots.filter((d) => d.kind === 'branch').length, 2);
    assert.ok(dots.some((d) => d.kind === 'root'));
  }
});

test('only a plain relative path is a link', () => {
  for (const bad of ['javascript:alert(1)', 'java\tscript:x', '//evil.example/x', '/abs', 'data:text/html,x', 'https://x', 'a\\b', ' x.html', '', null, 5]) {
    assert.strictEqual(api.safeHref(bad), null, String(bad));
  }
  assert.strictEqual(api.safeHref('../npcs/a%20b.html'), '../npcs/a%20b.html');
  assert.strictEqual(api.safeHref('images/people/h.png'), 'images/people/h.png');
});

test('a bad link or image is no link or image: the item is text', () => {
  const t = tab('people', 'People', [grp('Family', item('Ann', { h: '//evil.example/x', i: 'java\tscript:x' }))]);
  for (const mode of ['tree', 'web', 'cards']) {
    const p = setup([{ mode, json: island([t]) }]);
    assert.strictEqual(p.secs[0].querySelectorAll('a').length, 0, mode);
    assert.strictEqual(p.secs[0].querySelectorAll('img').length, 0, mode);
  }
});

test('a malformed item, group or tab is skipped and nothing prints undefined', () => {
  const good = item('Good');
  const t = tab('people', 'People', [
    grp('Family', good, { h: 'x.html' }, { t: 5 }, null, item('Odd', { l: 'not an array', s: [1, 'only'], k: 7, f: 'x' })),
    { n: 'Broken', d: 'nope' }, { d: [item('NoName')] }, grp('Empty'),
  ]);
  const bad = [{ id: 'a', n: 'A', g: 'nope' }, { id: 'b', g: [] }, null, 'x', { id: 'c', n: 'C', g: [grp('Z', { t: '' })] }];
  for (const mode of ['tree', 'web', 'cards']) {
    const p = setup([{ mode, json: { t: [...bad, t], m: [{ n: 'M', d: 'x' }, { n: 'M2', d: [['ok', 'ok.html'], ['bad', '//x'], [5, 'y.html'], 'z'] }, null] } }]);
    const s = p.secs[0];
    assert.ok(s.classes.includes('cx-live'), mode);
    const shown = () => s.querySelector('div.cx-app').textContent;
    assert.ok(!/undefined|null|NaN/.test(shown()), mode);
    assert.deepStrictEqual(tabsOf(s).map((x) => x.getAttribute('aria-label')), ['People 2', 'Mentions 1'], mode);
    const row = s.querySelector('[data-cx-i]');
    if (row) p.fire(row, 'focusin');
    assert.ok(!/undefined|null|NaN/.test(shown()), mode);
  }
});

test('a missing or malformed island shape leaves the section as built', () => {
  for (const json of [{ t: [] }, { t: [{ id: 'a', n: 'A', g: 'x' }] }, { t: [tab('a', 'A', [grp('G', { t: 3 })])], m: [] }, { t: 'x' }]) {
    const p = setup([{ mode: 'tree', json }]);
    assert.ok(!p.secs[0].classes.includes('cx-live'), JSON.stringify(json));
    assert.strictEqual(p.secs[0].querySelector('div.cx-app'), null);
  }
});

test('the section is live before anything is measured', () => {
  const orig = Node.prototype.getBoundingClientRect;
  const seen = [];
  Node.prototype.getBoundingClientRect = function () { const s = this.closest('section'); seen.push(!!s && s.classes.includes('cx-live')); return orig.call(this); };
  try { setup([{ mode: 'tree', json: island([PEOPLE]) }]); } finally { Node.prototype.getBoundingClientRect = orig; }
  assert.ok(seen.length > 0 && seen.every(Boolean));
});
