const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// js/story-links.js ships as a static asset the build never runs, so this drives it against the least page it needs:
// one copy-link icon, a clipboard (or none, for the fallback) and a clock the test moves by hand.
const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'story-links.js'), 'utf8');

function page({ clipboard = true, secure = true, execOk = true } = {}) {
  const attrs = { href: '#session-3', 'aria-label': 'Copy the link to Session 3' };
  const classes = new Set(['story-anchor']);
  const anchor = {
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    setAttribute: (n, v) => { attrs[n] = String(v); },
    hasAttribute: (n) => n in attrs,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    closest: (sel) => (sel === '.story-anchor' ? anchor : null),
  };
  const copied = [];
  const commands = [];
  let box = null;
  const timers = new Map();
  let next = 1;
  let now = 0;
  let click = null;
  const document = {
    addEventListener: (type, fn) => { if (type === 'click') click = fn; },
    createElement: () => {
      box = { value: '', style: {}, setAttribute() {}, select() {} };
      return box;
    },
    body: { appendChild() {}, removeChild() {} },
    execCommand: (name) => { commands.push([name, box && box.value]); return execOk; },
  };
  const window = { isSecureContext: secure };
  const navigator = clipboard ? { clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } } : {};
  const context = {
    document, window, navigator,
    location: { href: 'https://example.test/pcs/ada-story.html#old' },
    setTimeout: (fn, ms) => { const id = next++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    Promise, Error,
  };
  vm.runInNewContext(SOURCE, context);
  return {
    attrs, classes, copied, commands,
    click: async () => { click({ target: anchor }); await new Promise((r) => setImmediate(r)); },
    wait: (ms) => {
      now += ms;
      for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
    },
  };
}

test('a click copies the full link to the session and says so for a moment', async () => {
  const p = page();
  await p.click();
  assert.deepStrictEqual(p.copied, ['https://example.test/pcs/ada-story.html#session-3']);
  assert.ok(p.classes.has('copied'));
  assert.strictEqual(p.attrs['aria-label'], 'Link copied');
  p.wait(1500);
  assert.ok(!p.classes.has('copied'));
  assert.strictEqual(p.attrs['aria-label'], 'Copy the link to Session 3');
});

test('a second click inside the moment still puts the icon\'s own label back', async () => {
  const p = page();
  await p.click();
  p.wait(500);
  await p.click();
  p.wait(1000);
  assert.ok(p.classes.has('copied'), 'the second click starts the moment again');
  p.wait(500);
  assert.ok(!p.classes.has('copied'));
  assert.strictEqual(p.attrs['aria-label'], 'Copy the link to Session 3');
});

test('without the clipboard (not a secure page) it copies through a hidden text box', async () => {
  const p = page({ clipboard: true, secure: false });
  await p.click();
  assert.deepStrictEqual(p.copied, []);
  assert.deepStrictEqual(p.commands, [['copy', 'https://example.test/pcs/ada-story.html#session-3']]);
  assert.strictEqual(p.attrs['aria-label'], 'Link copied');
});

test('a copy that fails says nothing: the address bar still holds the link', async () => {
  const p = page({ clipboard: false, execOk: false });
  await p.click();
  assert.ok(!p.classes.has('copied'));
  assert.strictEqual(p.attrs['aria-label'], 'Copy the link to Session 3');
});
