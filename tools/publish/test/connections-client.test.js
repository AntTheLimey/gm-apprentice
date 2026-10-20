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

// ---- the web's geometry ----

const FULL = 2 * Math.PI;
const SHAPES = [[1], [2], [1, 1], [3, 4], [20], [1, 1, 1, 1, 1, 1, 1, 1, 1], [25, 3, 1], [1, 25, 1], [60, 10], [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]];
const LABELS = ['Knows', 'Member of the household of', 'Enemy of', 'Child of', 'Was once the sworn rival of', 'Employs', 'Located at', 'Friend of', 'Owns'];
const webGroups = (sizes) => sizes.map((n, g) => ({ n: LABELS[g % LABELS.length], d: Array.from({ length: n }, (_, i) => ({ t: i % 3 ? `Name ${g}-${i}` : `A Much Longer Name Than Most ${g}-${i}` })) }));
// the text widths the layout was given, so a test asks of it what the page asks
const measured = (text, kind) => text.length * (kind === 'band' ? 9.1 : kind === 'root' ? 8.7 : 6.9);
const within = (a) => ((a % FULL) + FULL) % FULL;

test('the web puts every name on one ring, in order, inside the drawing', () => {
  for (const sizes of SHAPES) {
    const lay = api.webLayout(webGroups(sizes), { subject: 'Emma Wentworth', measure: measured });
    const total = sizes.reduce((a, b) => a + b, 0);
    assert.strictEqual(lay.nodes.length, total, String(sizes));
    // every label whole, but a lone name's, which is cut as a name is; its whole text is kept for the tooltip
    assert.deepStrictEqual(lay.bands.map((b) => b.full), webGroups(sizes).map((g) => g.n));
    for (const b of lay.bands) assert.strictEqual(b.label, b.single && b.full.length > 26 ? `${b.full.slice(0, 25)}…` : b.full);
    const { x, y, w, h } = lay.box;
    for (const n of lay.nodes) {
      assert.ok(Math.abs(Math.hypot(n.x, n.y) - lay.radius) < 1e-6, 'on the ring');
      for (const [cx, cy] of [[n.x, n.y], ...n.corners, ...(n.labelCorners || [])]) assert.ok(cx >= x && cx <= x + w && cy >= y && cy <= y + h, `${sizes}: a name, its mark or its label lies outside the drawing`);
    }
    assert.ok(x <= -lay.root.r && y <= -lay.root.r && x + w >= lay.root.r && y + h >= lay.root.r, 'the subject is inside');
  }
});

test('no two names of a web meet: neighbours are a row apart where they start', () => {
  for (const sizes of SHAPES) {
    const lay = api.webLayout(webGroups(sizes), { subject: 'Emma', measure: measured });
    const start = lay.radius + 13;
    lay.nodes.forEach((n, i) => {
      const next = lay.nodes[(i + 1) % lay.nodes.length];
      if (next === n) return;
      const turn = within(next.angle - n.angle);
      assert.ok(turn * start >= 16 - 1e-6 || turn > Math.PI, `${sizes}: names ${i} and ${i + 1} are ${(turn * start).toFixed(1)} apart`);
    });
  }
});

test('every group label of a web has an arc as long as its words, and no two arcs overlap', () => {
  for (const sizes of SHAPES) {
    const lay = api.webLayout(webGroups(sizes), { subject: 'Emma', measure: measured });
    lay.bands.forEach((band, g) => {
      if (band.single) return;   // a lone name's label is set under the name (the next test)
      const room = (band.labelTo - band.labelFrom) * lay.labelRadius;
      assert.ok(room >= measured(band.label, 'band'), `${sizes}: "${band.label}" needs ${measured(band.label, 'band')} and has ${room.toFixed(1)}`);
      assert.ok(band.labelFrom > band.from, 'the label starts clear of its own line');
      const next = lay.bands[(g + 1) % lay.bands.length];
      const gap = within(next.from - band.labelTo);
      // the next group's line (and so its label) starts after this label ends, with room between
      assert.ok(gap * lay.labelRadius >= 19.9 && gap < Math.PI * 2 - 1e-6, `${sizes}: label ${g} runs into group ${(g + 1) % lay.bands.length}`);
      assert.ok(band.to <= band.labelTo + 1e-9 || band.to - band.from <= band.labelTo - band.from + 1e-9);
    });
    const used = lay.bands.reduce((sum, b) => sum + (b.labelTo - b.from), 0);
    assert.ok(used < FULL, `${sizes}: the groups take ${used.toFixed(2)} of a turn`);
    assert.ok(lay.labelRadius > lay.root.r + 8, 'labels are outside the subject');
    assert.ok(lay.spine > lay.labelRadius + 9 + 4, 'a group arc is outside its label');
  }
});

test('a web of one name is a short strip, not an empty ring', () => {
  const lay = api.webLayout(webGroups([1]), { subject: 'Emma', measure: measured });
  assert.ok(lay.box.h < lay.radius * 1.5, `height ${lay.box.h} for radius ${lay.radius}`);
  assert.ok(Math.abs(lay.nodes[0].y) < 1e-6 && lay.nodes[0].x > 0, 'the name is set level, to the right');
  const two = api.webLayout(webGroups([2]), { subject: 'Emma', measure: measured });
  assert.ok(two.nodes.every((n) => Math.abs(n.y) < 1e-6), 'two names sit level, one each side');
  const pair = api.webLayout(webGroups([1, 1]), { subject: 'Emma', measure: measured });
  assert.ok(pair.nodes.every((n) => Math.abs(n.y) < 1e-6) && pair.nodes[0].x > 0 && pair.nodes[1].x < 0, 'two lone names sit level too');
});

test('a lone name carries its group label under it, clear of the subject, where it reads level', () => {
  for (const sizes of [[1], [1, 1], [1, 1, 1, 6], [1, 1, 1, 1, 1, 1, 1, 1, 1]]) {
    const lay = api.webLayout(webGroups(sizes), { subject: 'Emma Wentworth', measure: measured });
    lay.nodes.forEach((n) => {
      if (!lay.bands[n.group].single) return;
      assert.ok(n.labelCorners, `${sizes}: a lone name's label is placed`);
      // the label starts where the name starts, a row further round: never inside the ring, so never under the disc
      for (const [cx, cy] of n.labelCorners) assert.ok(Math.hypot(cx, cy) > lay.radius, `${sizes}: the label of ${n.text} reaches in to ${Math.hypot(cx, cy).toFixed(0)}`);
    });
  }
  const one = api.webLayout(webGroups([1]), { subject: 'Emma', measure: measured });
  assert.ok(one.nodes[0].labelCorners.every(([, cy]) => cy > 0), 'one name: its label is under it');
});

test('groups of one name take two rows each, so a web of small groups stays round', () => {
  const wordy = ['Was once the sworn rival of', 'Member of the household of', 'Keeper of the keys of', 'Knows'];
  const g = [...wordy.slice(0, 3).map((n, i) => ({ n, d: [{ t: `Lone ${i}` }] })), { n: 'Knows', d: Array.from({ length: 6 }, (_, i) => ({ t: `Staff ${i}` })) }];
  const lay = api.webLayout(g, { subject: 'Emma', measure: measured });
  // the turn from each name to the next round the ring: no lone name sits in a wide empty arc of its own
  const turns = lay.nodes.map((n, i) => within(lay.nodes[(i + 1) % lay.nodes.length].angle - n.angle));
  assert.ok(Math.max(...turns) <= 3 * Math.min(...turns) + 1e-6, `turns between names run from ${Math.min(...turns).toFixed(2)} to ${Math.max(...turns).toFixed(2)}`);
});

test('the subject of a web is whole up to 40 characters, cut past that with the whole name kept, in lines that fit its disc', () => {
  const long = 'Mr Bartholomew Fitzwilliam-Throckmorton of the Upper Hawthorne Grange Estate and Surrounds';
  const radii = [];
  for (const subject of ['Emma', 'Emma Wentworth', 'Supercalifragilisticexpialidocious', long, `${long} ${long} ${long} the Third, Keeper of the Keys`]) {
    const lay = api.webLayout(webGroups([3, 4]), { subject, measure: measured });
    // a line may break after a hyphen, which it keeps
    const drawn = lay.root.lines.map((l) => l.text).join(' ').replace(/- /g, '-');
    assert.strictEqual(drawn, subject.length > 40 ? `${subject.slice(0, 39)}…` : subject);
    assert.strictEqual(lay.root.full, subject);
    if (subject.length > 40) assert.ok(lay.root.r <= 80, `a disc of radius ${lay.root.r} for "${drawn}"`);
    for (const line of lay.root.lines) {
      const half = measured(line.text, 'root') / 2;
      assert.ok(Math.hypot(half, Math.abs(line.y) + 9) <= lay.root.r, `"${line.text}" is inside the disc`);
    }
    assert.ok(lay.labelRadius > lay.root.r + 8);
    radii.push(lay.root.r);
  }
  assert.strictEqual(radii[3], radii[4], 'a 315-character subject draws no bigger a disc than a 90-character one');
});

test('a group label is whole on a wide web, however long, and cut only when asked; a lone name’s is cut as a name is', () => {
  const long = 'Was once the reluctant keeper of the keys of';
  const g = [{ n: long, d: [{ t: 'Ann' }, { t: 'Al' }] }, { n: 'Knows', d: [{ t: 'Bo' }, { t: 'Cy' }, { t: 'Di' }, { t: 'Ed' }] }];
  const lay = api.webLayout(g, { measure: measured });
  assert.strictEqual(lay.bands[0].label, long);
  assert.ok((lay.bands[0].labelTo - lay.bands[0].labelFrom) * lay.labelRadius >= measured(long, 'band'));
  assert.strictEqual(api.webLayout(g, { measure: measured, clipLabel: 14 }).bands[0].label.length, 14);
  const lone = api.webLayout([{ n: long, d: [{ t: 'Ann' }] }, g[1]], { measure: measured }).bands[0];
  assert.deepStrictEqual([lone.single, lone.label, lone.full], [true, `${long.slice(0, 25)}…`, long]);
});

test('past six groups, the web’s lines leave from a ring round the disc', () => {
  assert.strictEqual(api.webLayout(webGroups([3, 4]), { subject: 'Emma', measure: measured }).hub, 0);
  assert.strictEqual(api.webLayout(webGroups([1, 1, 1, 1, 1, 1]), { subject: 'Emma', measure: measured }).hub, 0);
  const crowd = api.webLayout(webGroups(Array(25).fill(1)), { subject: 'Emma', measure: measured });
  assert.ok(crowd.hub > crowd.root.r && crowd.hub < crowd.labelRadius, `hub ${crowd.hub}, disc ${crowd.root.r}, labels ${crowd.labelRadius}`);
});

test('a long name on the ring is cut to the length asked for', () => {
  const g = [{ n: 'Knows', d: [{ t: 'Mr Bartholomew Fitzwilliam-Throckmorton of the Upper Hawthorne Grange' }, { t: 'Bo' }, { t: 'Cy' }] }];
  assert.strictEqual(api.webLayout(g, { measure: measured }).nodes[0].text.length, 26);
  assert.strictEqual(api.webLayout(g, { measure: measured, clip: 18 }).nodes[0].text.length, 18);
});

test('arrow keys move between tabs and wrap', () => {
  assert.strictEqual(api.nextTab(0, 3, 'ArrowRight'), 1);
  assert.strictEqual(api.nextTab(2, 3, 'ArrowRight'), 0);
  assert.strictEqual(api.nextTab(0, 3, 'ArrowLeft'), 2);
  assert.strictEqual(api.nextTab(1, 3, 'Home'), 0);
  assert.strictEqual(api.nextTab(1, 3, 'End'), 2);
  assert.strictEqual(api.nextTab(1, 3, 'a'), 1);
});

test('a meta line that sits below its name is stacked; one beside it is not', () => {
  const name = { offsetTop: 10, offsetHeight: 20 };
  assert.strictEqual(api.metaStacked(name, { offsetTop: 32, offsetHeight: 16, offsetParent: {} }), true);
  assert.strictEqual(api.metaStacked(name, { offsetTop: 10, offsetHeight: 16, offsetParent: {} }), false);
  assert.strictEqual(api.metaStacked(name, { offsetTop: 14, offsetHeight: 16, offsetParent: {} }), false);
  // a hidden meta (not drawn) is never stacked; a row with no meta has nothing to stack
  assert.strictEqual(api.metaStacked(name, { offsetTop: 0, offsetHeight: 0, offsetParent: null }), false);
  assert.strictEqual(api.metaStacked(name, null), false);
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

test('a key chord with Alt, Ctrl or Cmd on a tab is left to the browser', () => {
  const p = setup([{ mode: 'tree', json: island([PEOPLE, PLACES]) }]);
  const s = p.secs[0];
  for (const mod of ['altKey', 'ctrlKey', 'metaKey']) {
    const ev = p.fire(s.querySelector('div.cx-tabs'), 'keydown', { key: 'ArrowLeft', [mod]: true });
    assert.strictEqual(ev.prevented, false, mod);
    assert.strictEqual(tabsOf(s)[0].getAttribute('aria-selected'), 'true', mod);
  }
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
  assert.ok(nodes.every((n) => 'data-no-preview' in n.attrs));
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

test('a web the phone would shrink past reading is drawn as the tree, a small one stays a web', () => {
  assert.strictEqual(api.readable(500, 358), true);
  assert.strictEqual(api.readable(569, 358), false);
  const nine = tab('things', 'Things', Array.from({ length: 9 }, (_, i) => grp(`A heading of some length ${i}`, item(`A thing with a longish name ${i}`))));
  const phone = setup([{ mode: 'web', json: island([nine]) }], { width: 358 });
  assert.ok(phone.secs[0].querySelector('ul.cx-tree'));
  assert.strictEqual(phone.secs[0].querySelector('svg.cx-web'), null);
  const small = setup([{ mode: 'web', json: island([PEOPLE]) }], { width: 358 });
  assert.ok(small.secs[0].querySelector('svg.cx-web'));
  const desk = setup([{ mode: 'web', json: island([nine]) }], { width: 900 });
  assert.ok(desk.secs[0].querySelector('svg.cx-web'));
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

// ---- the tree's lines ----

// Points along a path of M, C, H and V commands, close enough together that none can step
// over a box.
function pointsOf(d) {
  const out = [];
  let x = 0; let y = 0;
  for (const m of d.matchAll(/([MCHV])([^MCHV]*)/g)) {
    const v = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (m[1] === 'M') { [x, y] = v; out.push([x, y]); }
    if (m[1] === 'H') { for (let t = 0; t <= 1; t += 1 / 400) out.push([x + (v[0] - x) * t, y]); x = v[0]; }
    if (m[1] === 'V') { for (let t = 0; t <= 1; t += 1 / 400) out.push([x, y + (v[0] - y) * t]); y = v[0]; }
    if (m[1] === 'C') {
      for (let t = 0; t <= 1; t += 1 / 800) {
        const u = 1 - t;
        out.push([u * u * u * x + 3 * u * u * t * v[0] + 3 * u * t * t * v[2] + t * t * t * v[4], u * u * u * y + 3 * u * u * t * v[1] + 3 * u * t * t * v[3] + t * t * t * v[5]]);
      }
      x = v[4]; y = v[5];
    }
  }
  return out;
}

// A tree laid out as the stylesheet lays it out: the boxes treeLines is given (the subject,
// each heading's cell, each mark) and the boxes of every word (the subject, each heading's
// words, each name). `sizes` is the number of names in each group; `rows` their heights.
function layTree(sizes, { narrow, width, rowHigh = () => 30, labelWide = () => 90, labelHigh = () => 16, subjectWide = 150, subjectHigh = 26 }) {
  const texts = []; const heads = []; const marks = [];
  let subject;
  if (narrow) {
    subject = { left: 0, right: width, top: 0, bottom: subjectHigh };
    texts.push({ what: 'subject', left: 28, right: Math.min(width, 28 + subjectWide), top: 0, bottom: subjectHigh });
    let y = subjectHigh + 16;
    sizes.forEach((count, g) => {
      const high = labelHigh(g);
      heads.push({ left: 34, right: width, top: y, bottom: y + high + 12, count });
      texts.push({ what: `heading ${g}`, left: 34, right: 34 + labelWide(g), top: y + 6, bottom: y + 6 + high });
      y += high + 14;
      for (let k = 0; k < count; k++) {
        const high = rowHigh(g, k);
        marks.push({ left: 50, right: 61, top: y + 9, bottom: y + 20, o: 'w' });
        texts.push({ what: `name ${g}-${k}`, left: 71, right: width - 8, top: y + 4, bottom: y + high - 4 });
        y += high;
      }
      y += 14;
    });
  } else {
    const gap = Math.max(48, Math.min(96, width * 0.09));
    const first = Math.min(subjectWide, width * 0.24);
    const tree = first + gap;
    const labels = Math.min(Math.max(...sizes.map((_, g) => labelWide(g))), (width - tree) * 0.3);
    const names = tree + labels + 56;
    let y = 0;
    sizes.forEach((count, g) => {
      let high = 0;
      for (let k = 0; k < count; k++) high += rowHigh(g, k);
      const cell = 2 * labelHigh(g) + 10;      // the words, a gap, and as much again below
      const band = Math.max(high, cell);
      const top = y + (band - cell) / 2;
      heads.push({ left: tree, right: tree + labels, top, bottom: top + cell, count });
      texts.push({ what: `heading ${g}`, left: tree + labels - Math.min(labels, labelWide(g)), right: tree + labels, top, bottom: top + labelHigh(g) });
      let ry = y + (band - high) / 2;
      for (let k = 0; k < count; k++) {
        const high = rowHigh(g, k);
        marks.push({ left: names + 8, right: names + 19, top: ry + 9, bottom: ry + 20, o: k % 2 ? 'h' : null });
        texts.push({ what: `name ${g}-${k}`, left: names + 29, right: width - 8, top: ry + 4, bottom: ry + high - 4 });
        ry += high;
      }
      y += band + 14;
    });
    const all = y - 14;
    subject = { left: 0, right: first, top: (all - subjectHigh) / 2, bottom: (all + subjectHigh) / 2 };
    texts.push({ what: 'subject', ...subject });
  }
  return { subject, heads, marks, texts };
}

const TREES = [
  { sizes: [1] }, { sizes: [1, 1, 1, 1, 1, 1, 1, 1, 1] }, { sizes: [25] }, { sizes: [3, 1, 25, 2] }, { sizes: [2, 2, 1, 1, 1, 6, 8] },
  { sizes: [1, 12, 1], rowHigh: (g, k) => (k % 4 === 0 ? 74 : 30) },
  { sizes: [1, 1, 4], labelWide: () => 400, labelHigh: (g) => (g === 1 ? 48 : 16) },
  { sizes: [5, 5], subjectWide: 900, subjectHigh: 240 },
];

test('no line of a tree passes through a word, at any width, whatever the groups', () => {
  for (const narrow of [false, true]) {
    for (const width of narrow ? [300, 390, 559] : [560, 561, 700, 768, 1000, 1400]) {
      TREES.forEach((shape, n) => {
        const t = layTree(shape.sizes, { ...shape, narrow, width });
        const { paths } = api.treeLines(t.subject, t.heads, t.marks, narrow);
        for (const path of paths) {
          for (const [x, y] of pointsOf(path.d)) {
            const hit = t.texts.find((b) => x > b.left - 1 && x < b.right + 1 && y > b.top - 1 && y < b.bottom + 1);
            assert.ok(!hit, `tree ${n} at ${width}${narrow ? ' narrow' : ''}: a ${path.kind} line passes through ${hit && hit.what} at ${x.toFixed(0)}, ${y.toFixed(0)} (${path.d})`);
          }
        }
      });
    }
  }
});

test('lines end at each name’s own mark, whatever the row heights', () => {
  for (const narrow of [false, true]) {
    const t = layTree([2, 1], { narrow, width: narrow ? 390 : 900, rowHigh: (g, k) => (g === 0 && k === 1 ? 90 : 30) });
    t.marks[0].o = 'w'; t.marks[1].o = 'h'; t.marks[2].o = null;
    const { paths, dots } = api.treeLines(t.subject, t.heads, t.marks, narrow);
    const leaves = paths.filter((x) => x.kind === 'leaf');
    assert.strictEqual(leaves.length, 3);
    leaves.forEach((leaf, i) => {
      const end = pointsOf(leaf.d).pop();
      const mark = t.marks[i];
      assert.ok(Math.abs(end[0] - (mark.left - 3)) < 0.06 && Math.abs(end[1] - (mark.top + mark.bottom) / 2) < 0.06, `${narrow ? 'narrow' : 'wide'} ${i}`);
    });
    assert.deepStrictEqual(leaves.map((l) => l.tone), ['w', 'h', null]);
    assert.strictEqual(dots.filter((d) => d.kind === 'branch').length, 2);
    assert.strictEqual(dots.filter((d) => d.kind === 'root').length, 1);
  }
});

test('a name’s own line carries its tone; every line a group shares carries none', () => {
  const t = layTree([3], { narrow: true, width: 390 });
  t.marks[0].o = 'w'; t.marks[1].o = null; t.marks[2].o = 'h';
  const { paths } = api.treeLines(t.subject, t.heads, t.marks, true);
  const toned = paths.filter((x) => x.tone);
  assert.deepStrictEqual(toned.map((x) => x.kind), ['leaf', 'leaf']);
  // a name's own line is the level arm to its mark: it never runs down past another name
  for (const leaf of paths.filter((x) => x.kind === 'leaf')) assert.match(leaf.d, /^M[-\d.]+ [-\d.]+H[-\d.]+$/);
  const spine = paths.filter((x) => x.kind === 'trunk' && /V/.test(x.d));
  assert.ok(spine.length >= 2 && spine.every((x) => x.tone === null));
});

test('a wide tree of many groups leaves its subject by one line, not a sheaf from one dot', () => {
  const fromRoot = (sizes) => {
    const t = layTree(sizes, { narrow: false, width: 1000 });
    const { paths, dots } = api.treeLines(t.subject, t.heads, t.marks, false);
    const root = dots.find((d) => d.kind === 'root');
    return paths.filter((p) => { const [x, y] = pointsOf(p.d)[0]; return Math.abs(x - root.x) < 0.1 && Math.abs(y - root.y) < 0.1; }).length;
  };
  assert.strictEqual(fromRoot([2, 3, 1]), 3, 'a few groups keep their curves');
  assert.strictEqual(fromRoot(Array(25).fill(1)), 1);
  assert.strictEqual(fromRoot(Array(7).fill(2)), 1);
});

// ---- colours ----

test('a browser’s colour words are read, anything else is not', () => {
  assert.deepStrictEqual(api.parseColour('rgb(10, 20, 30)'), [10, 20, 30, 1]);
  assert.deepStrictEqual(api.parseColour('rgba(10, 20, 30, 0.5)'), [10, 20, 30, 0.5]);
  assert.deepStrictEqual(api.parseColour('rgb(10 20 30 / 50%)'), [10, 20, 30, 0.5]);
  assert.deepStrictEqual(api.parseColour('color(srgb 1 0 0.2)'), [255, 0, 51, 1]);
  for (const bad of ['oklch(0.5 0.1 20)', 'red', '', null, 'rgb(a, b, c)']) assert.strictEqual(api.parseColour(bad), null, String(bad));
});

test('a derived colour reaches its contrast on every ground, or is the text colour itself', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const colour = () => [Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256)];
  for (let n = 0; n < 500; n++) {
    const text = colour(); const grounds = n % 2 ? [colour()] : [colour(), colour()];
    for (const need of [3, 4.5]) {
      const got = api.ink(colour(), text, grounds, need);
      assert.ok(grounds.every((g) => api.contrast(got, g) >= need) || got.every((v, i) => v === text[i]), `pair ${n}`);
    }
  }
  // a colour that already reads is left alone
  assert.deepStrictEqual(api.ink([0, 0, 0], [40, 40, 40], [[255, 255, 255]], 4.5), [0, 0, 0]);
  const all = api.inks({ text: [20, 20, 20], muted: [150, 150, 150], accent: [200, 170, 90], success: [60, 180, 90], danger: [240, 80, 70], grounds: [[250, 250, 250]] });
  for (const name of ['muted', 'accent', 'warm-ink', 'hostile-ink']) assert.ok(api.contrast(all[name], [250, 250, 250]) >= 4.5, name);
  for (const name of ['warm', 'hostile', 'trunk']) assert.ok(api.contrast(all[name], [250, 250, 250]) >= 3, name);
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

// ---- the ground a section is drawn on ----

test('a paper painted by a background image is the ground, not the colour behind it', () => {
  // A sheet skin paints its paper with a gradient over a transparent background-colour; in the
  // dark scheme the body behind it is dark, the paper is not.
  const paper = [251, 246, 231];
  const body = [26, 20, 16, 1];
  const chain = [
    { color: [0, 0, 0, 0], image: 'none' },                                  // the section
    { color: [0, 0, 0, 0], image: 'linear-gradient(rgb(251, 246, 231), rgba(255, 250, 235, 0.35))' },   // the paper
    { color: [0, 0, 0, 0], image: 'none' },
    body && { color: body, image: 'none' },                                  // body
  ];
  assert.deepStrictEqual(api.groundOf(chain, paper), paper);
  // No image: the colour behind stands, as it did.
  assert.deepStrictEqual(api.groundOf([{ color: [0, 0, 0, 0], image: 'none' }, { color: body, image: 'none' }], paper), [26, 20, 16]);
  // A translucent layer over the paper is laid over the paper.
  const over = api.groundOf([{ color: [0, 0, 0, 0.5], image: 'none' }, { color: [0, 0, 0, 0], image: 'url(paper.png)' }], paper);
  assert.deepStrictEqual(over.map(Math.round), [126, 123, 116]);
  // A colour that cannot be read is no ground at all.
  assert.strictEqual(api.groundOf([{ color: null, image: 'none' }], paper), null);
  // Missing image information (an older engine) changes nothing.
  assert.deepStrictEqual(api.groundOf([{ color: [10, 20, 30, 1] }], paper), [10, 20, 30]);
});
