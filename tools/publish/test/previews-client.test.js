const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const lp = require('../js/previews.js');

const ROOT = 'https://site.example/campaign/';
test('keyFor resolves a link to the key the build wrote', () => {
  const page = ROOT + 'characters/pcs/mara.html';
  assert.strictEqual(lp.keyFor('../npcs/hallam.html', page, ROOT), 'characters/npcs/hallam.html');
  assert.strictEqual(lp.keyFor('../npcs/hallam.html#notes', page, ROOT), 'characters/npcs/hallam.html');
  assert.strictEqual(lp.keyFor('../npcs/hallam.html?x=1', page, ROOT), 'characters/npcs/hallam.html');
  assert.strictEqual(lp.keyFor('../npcs/abb%C3%A9-ferrant.html', page, ROOT), 'characters/npcs/abbé-ferrant.html');
  assert.strictEqual(lp.keyFor('../../locations/a%20b.html', page, ROOT), 'locations/a b.html');
});
test('keyFor refuses what is not another page of this site', () => {
  const page = ROOT + 'characters/pcs/mara.html';
  assert.strictEqual(lp.keyFor('#top', page, ROOT), null);
  assert.strictEqual(lp.keyFor('mara.html#notes', page, ROOT), null, 'the page itself');
  assert.strictEqual(lp.keyFor('https://elsewhere.example/x.html', page, ROOT), null);
  assert.strictEqual(lp.keyFor('../../../outside.html', page, ROOT), null);
  assert.strictEqual(lp.keyFor('mailto:a@b.c', page, ROOT), null);
  assert.strictEqual(lp.keyFor('%E0%A4%A', page, ROOT), null, 'a bad escape is not an error');
});
test('placeCard goes below, or above when there is no room, and stays in the window', () => {
  const view = { width: 400, height: 600, scrollX: 0, scrollY: 1000 };
  const card = { width: 320, height: 200 };
  assert.deepStrictEqual(lp.placeCard({ left: 20, top: 100, right: 120, bottom: 120 }, card, view), { left: 20, top: 1128 });
  assert.deepStrictEqual(lp.placeCard({ left: 20, top: 500, right: 120, bottom: 520 }, card, view), { left: 20, top: 1292 });
  assert.strictEqual(lp.placeCard({ left: 300, top: 100, right: 390, bottom: 120 }, card, view).left, 68);
  assert.strictEqual(lp.placeCard({ left: -50, top: 100, right: 10, bottom: 120 }, card, view).left, 12);
});
test('a tap opens the card first only for a finger, only when previews are fully on', () => {
  const a = {}, b = {};
  assert.strictEqual(lp.tapAction({ owner: null }, a, 'touch', 'on'), 'open');
  assert.strictEqual(lp.tapAction({ owner: a }, a, 'touch', 'on'), 'follow');
  assert.strictEqual(lp.tapAction({ owner: b }, a, 'touch', 'on'), 'open');
  assert.strictEqual(lp.tapAction({ owner: null }, a, 'mouse', 'on'), 'follow');
  assert.strictEqual(lp.tapAction({ owner: null }, a, 'pen', 'on'), 'follow');
  assert.strictEqual(lp.tapAction({ owner: null }, a, 'touch', 'desktop'), 'follow');
  assert.strictEqual(lp.tapAction({ owner: a }, a, 'mouse', 'on'), 'follow', 'a mouse click is never held back');
});

// ---- the DOM part, against the least document it needs ----
const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'previews.js'), 'utf8');

function matchOne(node, sel) {
  const m = /^([a-z]*)((?:\.[\w-]+)*)(?:\[([\w-]+)\])?(?::([\w-]+))?$/.exec(sel.trim());
  if (m[1] && node.tag !== m[1]) return false;
  for (const c of m[2].split('.').filter(Boolean)) if (!node.classes.includes(c)) return false;
  if (m[3] && !(m[3] in node.attrs)) return false;
  return true;
}

class Node {
  constructor(tag, { classes = [], attrs = {} } = {}) {
    this.tag = tag; this.classes = classes; this.attrs = { ...attrs };
    this.children = []; this.parent = null; this.listeners = {};
    this.style = {}; this.dataset = {}; this.id = '';
    this.textContent = '';
    this.focusVisible = true;
  }
  set className(v) { this.classes = v.split(/\s+/).filter(Boolean); }
  get className() { return this.classes.join(' '); }
  get parentNode() { return this.parent; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parent = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  contains(o) { for (let n = o; n; n = n.parent) if (n === this) return true; return false; }
  matches(sel) { return sel === ':focus-visible' ? this.focusVisible : sel.split(',').some((s) => matchOne(this, s)); }
  closest(sel) { for (let n = this; n; n = n.parent) if (n.tag && sel.split(',').some((s) => matchOne(n, s))) return n; return null; }
  getBoundingClientRect() { return { left: 20, top: 100, right: 120, bottom: 120, width: 100, height: 20 }; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  find(pred) { return [this, ...this.children.flatMap((c) => c.find(pred))].filter(pred); }
}

const CARDS = {
  'characters/npcs/hallam.html': { t: 'Hallam', k: 'NPC', f: [['Role', 'Smith'], ['Home', 'Dock']], x: 'He mends things.', i: 'images/characters/hallam.webp' },
  'locations/inn.html': { t: '<b>Inn</b>', k: '<img src=x onerror=alert(1)>', f: [['<i>a</i>', '<img src=x onerror=alert(1)>']], x: '<script>x</script>', d: 1 },
};

function setup({ mode = 'on', fetchImpl } = {}) {
  const timers = [];
  let tid = 0;
  const html = new Node('html');
  const body = html.appendChild(new Node('body'));
  const brand = body.appendChild(new Node('a', { classes: ['nav-brand'], attrs: { href: '../../index.html' } }));
  const nav = body.appendChild(new Node('nav'));
  const crumbs = body.appendChild(new Node('div', { classes: ['breadcrumbs'] }));
  const main = body.appendChild(new Node('main', { classes: ['content'] }));
  if (mode) main.dataset.previews = mode;
  const quiet = main.appendChild(new Node('div', { attrs: { 'data-no-preview': '' } }));
  const mk = (parent, href) => parent.appendChild(new Node('a', { attrs: { href } }));
  const links = {
    hallam: mk(main, '../npcs/hallam.html'), inn: mk(main, '../../locations/inn.html'),
    unknown: mk(main, '../npcs/nobody.html'), self: mk(main, 'mara.html#x'),
    nav: mk(nav, '../npcs/hallam.html'), crumb: mk(crumbs, '../npcs/hallam.html'), quiet: mk(quiet, '../npcs/hallam.html'),
  };
  const other = body.appendChild(new Node('p'));
  const doc = {
    body, activeElement: null, listeners: {},
    querySelector: (sel) => (sel === 'main.content' ? main : sel === '.nav-brand' ? brand : null),
    createElement: (tag) => new Node(tag),
    addEventListener: (t, fn) => { (doc.listeners[t] = doc.listeners[t] || []).push(fn); },
  };
  const win = {
    location: { href: ROOT + 'characters/pcs/mara.html' }, innerWidth: 1000, innerHeight: 800,
    pageXOffset: 0, pageYOffset: 0, listeners: {},
    addEventListener: (t, fn) => { (win.listeners[t] = win.listeners[t] || []).push(fn); },
  };
  let fetched = 0;
  const fetchFn = fetchImpl || (() => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(CARDS)) }));
  const ctx = {
    document: doc, window: win, URL, Promise, JSON, Object, String, Math,
    setTimeout: (fn, ms) => { timers.push({ id: ++tid, fn, ms }); return tid; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    fetch: (...a) => { fetched++; return fetchFn(...a); },
  };
  vm.runInNewContext(SOURCE, ctx);
  const flush = () => new Promise((r) => setImmediate(r));
  const fire = (node, type, extra = {}) => {
    const ev = { type, target: node, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
    for (let n = node; n; n = n.parent) {
      (n.listeners[type] || []).forEach((fn) => fn(ev));
    }
    (doc.listeners[type] || []).forEach((fn) => fn(ev));
    return ev;
  };
  const runTimers = async (ms) => {
    for (const t of timers.filter((x) => x.ms <= ms)) { const i = timers.indexOf(t); if (i >= 0) { timers.splice(i, 1); t.fn(); } }
    await flush();
  };
  const card = () => body.find((n) => n.classes.includes('link-preview'))[0] || null;
  return { doc, win, main, body, links, other, timers, fire, runTimers, flush, card, fetched: () => fetched, ctx };
}

const textsOf = (n) => n.find(() => true).map((x) => x.textContent).filter(Boolean);

test('resting on a link opens its card after 300 ms, with text only', async () => {
  const p = setup();
  p.fire(p.links.hallam, 'pointerover', { pointerType: 'mouse' });
  await p.flush();
  assert.strictEqual(p.card(), null);
  assert.ok(p.timers.some((t) => t.ms === 300));
  await p.runTimers(300);
  const c = p.card();
  assert.ok(c);
  const texts = textsOf(c);
  for (const s of ['Hallam', 'NPC', 'Role', 'Smith', 'Home', 'Dock', 'He mends things.']) assert.ok(texts.includes(s), s);
  assert.strictEqual(p.links.hallam.getAttribute('aria-describedby'), c.attrs.id);
  const img = c.find((n) => n.tag === 'img')[0];
  assert.strictEqual(img.attrs.src, '../../images/characters/hallam.webp');
});

test('leaving closes after 150 ms; reaching the card in time keeps it', async () => {
  const p = setup();
  p.fire(p.links.hallam, 'pointerover', { pointerType: 'mouse' });
  await p.runTimers(300);
  p.fire(p.links.hallam, 'pointerout', { pointerType: 'mouse', relatedTarget: p.other });
  assert.ok(p.timers.some((t) => t.ms === 150));
  await p.runTimers(150);
  assert.strictEqual(p.card(), null);
  assert.strictEqual(p.links.hallam.getAttribute('aria-describedby'), null);

  p.fire(p.links.hallam, 'pointerover', { pointerType: 'mouse' });
  await p.runTimers(300);
  const c = p.card();
  p.fire(p.links.hallam, 'pointerout', { pointerType: 'mouse', relatedTarget: c });
  p.fire(c, 'pointerover', { pointerType: 'mouse' });
  await p.runTimers(150);
  assert.ok(p.card(), 'still open');
  p.fire(c, 'pointerout', { pointerType: 'mouse', relatedTarget: p.other });
  await p.runTimers(150);
  assert.strictEqual(p.card(), null);
});

test('moving to another link swaps the card at once', async () => {
  const p = setup();
  p.fire(p.links.hallam, 'pointerover', { pointerType: 'mouse' });
  await p.runTimers(300);
  p.fire(p.links.hallam, 'pointerout', { pointerType: 'mouse', relatedTarget: p.links.inn });
  p.fire(p.links.inn, 'pointerover', { pointerType: 'mouse' });
  await p.runTimers(0);
  assert.ok(textsOf(p.card()).includes('<b>Inn</b>'));
  await p.runTimers(150);
  assert.ok(p.card(), 'the old close timer did not fire');
  assert.strictEqual(p.links.hallam.getAttribute('aria-describedby'), null);
});

test('card values are text, never markup', async () => {
  const p = setup();
  p.fire(p.links.inn, 'pointerover', { pointerType: 'mouse' });
  await p.runTimers(300);
  const c = p.card();
  assert.strictEqual(c.find((n) => n.tag === 'img').length, 0);
  assert.ok(textsOf(c).includes('<img src=x onerror=alert(1)>'));
  assert.ok(textsOf(c).includes('Draft'));
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(SOURCE.replace(/\/\/.*$/gm, '')));
});

test('Escape closes the card; keyboard focus opens it and blur closes it', async () => {
  const p = setup();
  p.fire(p.links.hallam, 'pointerover', { pointerType: 'mouse' });
  await p.runTimers(300);
  p.fire(p.doc, 'keydown', { key: 'Escape' });
  assert.strictEqual(p.card(), null);

  p.doc.activeElement = p.links.hallam;
  p.fire(p.links.hallam, 'focusin');
  await p.flush();
  assert.ok(p.card());
  assert.strictEqual(p.card().find((n) => n.tag === 'a').length, 0, 'nothing focusable in it');
  p.fire(p.links.hallam, 'focusout');
  assert.strictEqual(p.card(), null);

  p.links.hallam.focusVisible = false;
  p.fire(p.links.hallam, 'focusin');
  await p.flush();
  assert.strictEqual(p.card(), null, 'a mouse focus does not open it');
});

test('touch: first tap opens the card, second follows, a tap elsewhere closes', async () => {
  const p = setup();
  p.fire(p.links.hallam, 'pointerdown', { pointerType: 'touch' });
  await p.flush();
  const first = p.fire(p.links.hallam, 'click');
  assert.ok(first.prevented);
  const open = p.card().find((n) => n.classes.includes('lp-open'))[0];
  assert.strictEqual(open.attrs.href, '../npcs/hallam.html');
  assert.strictEqual(open.textContent, 'Open page');
  p.fire(p.links.hallam, 'pointerdown', { pointerType: 'touch' });
  assert.ok(p.card(), 'tapping the same link keeps the card');
  assert.ok(!p.fire(p.links.hallam, 'click').prevented);
  p.fire(p.other, 'pointerdown', { pointerType: 'touch' });
  assert.strictEqual(p.card(), null);
});

test('a page scroll closes a touch-opened card', async () => {
  const p = setup();
  p.fire(p.links.hallam, 'pointerdown', { pointerType: 'touch' });
  await p.flush();
  p.fire(p.links.hallam, 'click');
  assert.ok(p.card());
  p.win.listeners.scroll.forEach((fn) => fn({}));
  assert.strictEqual(p.card(), null);
});

test('in desktop mode a touch tap is never held back', async () => {
  const p = setup({ mode: 'desktop' });
  p.fire(p.links.hallam, 'pointerdown', { pointerType: 'touch' });
  await p.flush();
  assert.ok(!p.fire(p.links.hallam, 'click').prevented);
  assert.strictEqual(p.card(), null);
});

test('nav, breadcrumbs, no-preview areas and same-page links open nothing', async () => {
  const p = setup();
  for (const l of [p.links.nav, p.links.crumb, p.links.quiet, p.links.self]) {
    p.fire(l, 'pointerover', { pointerType: 'mouse' });
    await p.runTimers(300);
    p.fire(l, 'pointerdown', { pointerType: 'touch' });
    await p.flush();
    assert.ok(!p.fire(l, 'click').prevented);
    assert.strictEqual(p.card(), null);
  }
  assert.strictEqual(p.fetched(), 0, 'nothing was fetched either');
});

test('a file that cannot be fetched or parsed leaves every link alone, silently', async () => {
  for (const fetchImpl of [
    () => Promise.reject(new Error('offline')),
    () => { throw new Error('sync'); },
    () => Promise.resolve({ ok: true, text: () => Promise.resolve('<html>not json') }),
    () => Promise.resolve({ ok: false, text: () => Promise.resolve('') }),
  ]) {
    const p = setup({ fetchImpl });
    p.fire(p.links.hallam, 'pointerdown', { pointerType: 'touch' });
    await p.flush();
    assert.ok(!p.fire(p.links.hallam, 'click').prevented);
    p.fire(p.links.hallam, 'pointerover', { pointerType: 'mouse' });
    await p.runTimers(300);
    assert.strictEqual(p.card(), null);
  }
});

test('a link whose key is not in the file opens nothing and is not held back', async () => {
  const p = setup();
  p.fire(p.links.unknown, 'pointerover', { pointerType: 'mouse' });
  await p.runTimers(300);
  assert.strictEqual(p.card(), null);
  p.fire(p.links.unknown, 'pointerdown', { pointerType: 'touch' });
  await p.flush();
  assert.ok(!p.fire(p.links.unknown, 'click').prevented);
});

test('a mouse click while the hover card is open is not held back', async () => {
  const p = setup();
  p.fire(p.links.hallam, 'pointerover', { pointerType: 'mouse' });
  await p.runTimers(300);
  p.fire(p.links.hallam, 'pointerdown', { pointerType: 'mouse' });
  assert.ok(!p.fire(p.links.hallam, 'click').prevented);
});

test('a touch tap before the file has loaded follows the link', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const p = setup({ fetchImpl: () => gate.then(() => ({ ok: true, text: () => Promise.resolve(JSON.stringify(CARDS)) })) });
  p.fire(p.links.hallam, 'pointerdown', { pointerType: 'touch' });
  assert.ok(!p.fire(p.links.hallam, 'click').prevented);
  release();
  await p.flush();
});

test('while loading nothing shows; the card appears only if the pointer is still there', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const p = setup({ fetchImpl: () => gate.then(() => ({ ok: true, text: () => Promise.resolve(JSON.stringify(CARDS)) })) });
  p.fire(p.links.hallam, 'pointerover', { pointerType: 'mouse' });
  await p.runTimers(300);
  assert.strictEqual(p.card(), null);
  p.fire(p.links.hallam, 'pointerout', { pointerType: 'mouse', relatedTarget: p.other });
  release();
  await p.flush();
  assert.strictEqual(p.card(), null, 'pointer had left');
});

test('the script does nothing without data-previews, and loads in Node', async () => {
  const p = setup({ mode: null });
  p.fire(p.links.hallam, 'pointerover', { pointerType: 'mouse' });
  await p.runTimers(300);
  assert.strictEqual(p.card(), null);
  assert.strictEqual(p.fetched(), 0);
  assert.strictEqual(p.win.listeners.scroll, undefined);
});
