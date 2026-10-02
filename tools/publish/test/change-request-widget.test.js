const { test } = require('node:test');
const assert = require('node:assert');
const { pcTemplate } = require('../lib/templates/pc');

const page = { frontmatter: { type: 'pc', name: 'Six' }, displayTitle: 'Six', outputPath: 'pcs/six.html', title: 'Six' };
const noop = () => '';
const cfg = { siteTitle: 'S', footer: '' };

const inboxOn = { publishConfig: { live: { inbox: true } } };

test('PC page prepends the change-request widget when inbox is enabled', () => {
  const html = pcTemplate(page, { html: '', relationships: '' }, [], noop, cfg, {}, undefined, inboxOn);
  assert.ok(html.includes('id="cr-root"'), 'widget root present');
  assert.ok(html.includes('data-character="Six"'), 'character tagged');
  assert.ok(html.includes('js/change-request.js'), 'widget script included');
  assert.ok(html.indexOf('id="cr-root"') < html.indexOf('class="tab-bar"'), 'widget is above the sheet');
  assert.ok(html.includes('class="tab-bar"'), 'sheet tabs still present');
  assert.ok(html.includes('id="tab-sheet"'), 'sheet panel still present');
});

test('widget falls back to displayTitle when frontmatter.name is absent', () => {
  const p2 = { frontmatter: { type: 'pc' }, displayTitle: 'Hero', outputPath: 'pcs/hero.html', title: 'Hero' };
  const html = pcTemplate(p2, { html: '', relationships: '' }, [], noop, cfg, {}, undefined, inboxOn);
  assert.ok(html.includes('data-character="Hero"'));
});

// The attribute is the only author-typed string that leaves the build and comes
// back at runtime: the browser posts it as the inbox entry's `character`, which
// the GM side matches against vault note names. A decomposed name emitted as-is
// never matches a composed note title, so normalize at this boundary like every
// other comparison site does (#139).
test('data-character is emitted NFC-normalized even when the name is decomposed', () => {
  const nfd = 'Gonza\u0301lez'; // n, a, combining acute
  const nfc = 'Gonz\u00e1lez';   // precomposed a-acute
  const p = { frontmatter: { type: 'pc', name: nfd }, displayTitle: nfd, outputPath: 'pcs/gonzalez.html', title: nfd };
  const html = pcTemplate(p, { html: '', relationships: '' }, [], noop, cfg, {}, undefined, inboxOn);
  assert.ok(html.includes(`data-character="${nfc}"`), 'attribute carries the composed form');
  assert.ok(!html.includes(`data-character="${nfd}"`), 'attribute does not carry the decomposed form');
});

const fs = require('node:fs');
test('widget script ships the chat-log and hint UI hooks', () => {
  const src = fs.readFileSync(require('path').join(__dirname, '../js/change-request.js'), 'utf8');
  assert.ok(src.includes('cr-hint'), 'has the helper-text element');
  assert.ok(src.includes('cr-log-btn'), 'has the always-visible chat-history button');
  assert.ok(src.includes('cr-text'), 'has the resizable message box');
  assert.ok(src.includes("'cr:log'"), 'uses the cr:log storage key');
});

// With sheets off (#cr-root data-sheets="off") the widget is a question channel:
// no sheet or change wording anywhere a player can read, same payload as ever.
const cr = require('../js/change-request.js');
const readSrc = () => fs.readFileSync(require('path').join(__dirname, '../js/change-request.js'), 'utf8');

test('default widget copy is unchanged without data-sheets', () => {
  const html = cr.widgetHtml(cr.copyFor(false));
  assert.ok(html.includes('✎ Request a change / ask a question'));
  assert.ok(html.includes('Type a change ("spend 1 xp to raise Streetwise") or a question ("is it worth raising DX?").'));
  assert.ok(html.includes('placeholder="Type your change or question…"'));
  assert.ok(html.includes('💬 History'));
  const c = cr.copyFor(false);
  assert.strictEqual(c.empty, 'Type your request first.');
  assert.strictEqual(c.received, 'Request received.');
  assert.strictEqual(c.live, '✓ your change is live');
});

test('sheets-off widget asks a question and mentions no sheet or change', () => {
  const html = cr.widgetHtml(cr.copyFor(true));
  assert.ok(html.includes('>Ask the GM</button>'), 'toggle button');
  assert.ok(html.includes('placeholder="Your question for the GM"'), 'placeholder');
  assert.ok(!/sheet|change|\bxp\b|raise/i.test(html), 'no sheet-edit wording in markup');
  for (const [k, v] of Object.entries(cr.copyFor(true))) {
    assert.ok(!/sheet|change/i.test(v), `copy.${k} has no sheet wording`);
  }
  assert.ok(!/sheet|change/i.test(cr.GONE_TEXT), 'expiry message has no sheet wording');
  assert.ok(html.includes('class="cr-send"') && html.includes('class="cr-text"'), 'same form controls');
});

// ---- real runs of init() against a minimal fake DOM (no dependency) ----
function makeEl() {
  const el = {
    hidden: false, value: '', textContent: '', innerHTML: '', style: {}, handlers: {}, attrs: {}, kids: {}, dataset: {},
    classList: { add() {} },
    addEventListener(ev, fn) { (el.handlers[ev] = el.handlers[ev] || []).push(fn); },
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
    appendChild() {}, focus() {},
    querySelector(sel) { return el.kids[sel] || (el.kids[sel] = makeEl()); },
    click() { (el.handlers.click || []).forEach((f) => f()); },
  };
  return el;
}

// Loads a fresh copy of the widget script in a browser-like environment and runs init().
function boot(t, { sheetsOff, live = false, fetchImpl }) {
  const root = makeEl();
  root.attrs['data-character'] = 'Six';
  if (sheetsOff) root.dataset.sheets = 'off';
  const store = new Map(live ? [['cr:live', '1']] : []);
  const modal = makeEl();
  const posts = [];
  const timers = [];
  const env = {
    document: {
      readyState: 'complete', title: 'T', body: makeEl(),
      getElementById: (id) => (id === 'cr-root' ? root : null),
      querySelector: () => null, createElement: () => modal, addEventListener() {},
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
    },
    location: { search: '', href: 'https://x.test/pcs/six.html', replace(u) { env.replaced = u; } },
    window: {}, history: {},
    fetch: (url, opts) => { if (opts && opts.method === 'POST') posts.push(JSON.parse(opts.body)); return fetchImpl(url, opts); },
    setInterval: (fn) => { timers.push(fn); return timers.length; },
    clearInterval() {},
  };
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { value: env[k], configurable: true, writable: true });
  }
  // Globals stay installed for the whole test (the widget reads them at click/poll time).
  t.after(() => {
    for (const k of Object.keys(env)) {
      if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k];
    }
  });
  const path = require.resolve('../js/change-request.js');
  delete require.cache[path];
  require(path);
  delete require.cache[path];
  const q = (s) => root.querySelector(s);
  return { root, modal, store, posts, timers, env, q, msg: () => q('.cr-msg').textContent };
}
const okSubmit = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'r1' }) });
const flush = () => new Promise((r) => setImmediate(r));

for (const sheetsOff of [false, true]) {
  const mode = sheetsOff ? 'sheets off' : 'default';
  const want = cr.copyFor(sheetsOff);

  test(`init (${mode}): submit posts exactly { code, character, text } and shows the mode's messages`, async (t) => {
    const w = boot(t, { sheetsOff, fetchImpl: okSubmit });
    w.q('.cr-send').click();
    assert.strictEqual(w.msg(), want.empty);
    assert.strictEqual(w.posts.length, 0, 'nothing posted for an empty message');
    w.q('.cr-text').value = '  hello  ';
    w.q('.cr-code').hidden = false;
    w.q('.cr-code').value = 'ABCD';
    w.q('.cr-send').click();
    await flush();
    assert.deepStrictEqual(w.posts, [{ code: 'ABCD', character: 'Six', text: 'hello' }]);
    assert.deepStrictEqual(Object.keys(w.posts[0]), ['code', 'character', 'text']);
    assert.strictEqual(w.msg(), want.received);
    if (sheetsOff) {
      assert.strictEqual(want.empty, 'Type your question first.');
      assert.strictEqual(want.received, 'Question received.');
    } else {
      assert.strictEqual(want.empty, 'Type your request first.');
      assert.strictEqual(want.received, 'Request received.');
    }
  });

  test(`init (${mode}): the live flag message and rendered markup use the mode's copy`, (t) => {
    const w = boot(t, { sheetsOff, live: true, fetchImpl: okSubmit });
    assert.strictEqual(w.msg(), want.live);
    assert.ok(w.root.innerHTML.includes(want.toggle) && w.root.innerHTML.includes(want.hint));
    assert.ok(w.root.innerHTML.includes(`placeholder="${want.placeholder}"`));
    assert.strictEqual(w.store.has('cr:live'), false, 'flag is consumed');
    if (sheetsOff) {
      const everything = [w.root.innerHTML, w.modal.innerHTML, w.msg()].join('\n');
      assert.ok(!/sheet|change/i.test(everything), 'no sheet or change wording rendered');
      assert.ok(w.root.innerHTML.includes('>Ask the GM</button>'));
    } else {
      assert.ok(w.root.innerHTML.includes('✎ Request a change / ask a question'));
      assert.strictEqual(w.msg(), '✓ your change is live');
    }
  });

  test(`init (${mode}): an applied reply ${sheetsOff ? 'is shown without reloading' : 'reloads the page'}`, async (t) => {
    const poll = () => Promise.resolve({ json: () => Promise.resolve({ r1: { status: 'handled', response: 'Done', kind: 'applied' } }) });
    const w = boot(t, { sheetsOff, fetchImpl: (u, o) => (o && o.method === 'POST' ? okSubmit() : poll()) });
    w.q('.cr-text').value = 'q';
    w.q('.cr-send').click();
    await flush();
    assert.strictEqual(w.timers.length, 1, 'polling started');
    w.timers[0]();
    await flush();
    if (sheetsOff) {
      assert.strictEqual(w.env.replaced, undefined, 'no reload');
      assert.strictEqual(w.msg(), 'Done');
      assert.strictEqual(w.store.has('cr:live'), false);
    } else {
      assert.ok(w.env.replaced && w.env.replaced.includes('_cr='), 'reloads');
      assert.strictEqual(w.store.get('cr:live'), '1');
    }
  });
}
