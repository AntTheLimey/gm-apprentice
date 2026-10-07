const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// js/nav.js ships as a static asset the build never runs, so this drives it against
// the least document it needs: classes, containment and which element has the focus.
const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'nav.js'), 'utf8');

function el(doc, classes, children = []) {
  const set = new Set(classes);
  const node = {
    children,
    classList: {
      contains: (c) => set.has(c),
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
    },
    contains: (other) => other === node || children.some((c) => c.contains(other)),
    find: (cls, open) => [
      ...(set.has(cls) && (!open || set.has('open')) ? [node] : []),
      ...children.flatMap((c) => c.find(cls, open)),
    ],
    querySelector: (sel) => children.flatMap((c) => c.find(sel.slice(1)))[0] || null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    focus: () => { doc.activeElement = node; },
  };
  return node;
}

function page() {
  const doc = { activeElement: null, listeners: [] };
  const group = (open) => {
    const toggle = el(doc, ['nav-group-toggle']);
    const link = el(doc, ['nav-link']);
    return { toggle, link, node: el(doc, open ? ['nav-group', 'open'] : ['nav-group'], [toggle, el(doc, ['nav-dropdown'], [link])]) };
  };
  const story = group(true);
  const world = group(false);
  const mobileToggle = el(doc, ['nav-mobile-toggle']);
  const mobileLink = el(doc, ['mobile-link']);
  const mobileNav = el(doc, ['mobile-nav-overlay', 'open'], [mobileLink]);
  const body = el(doc, ['body'], [story.node, world.node, mobileToggle, mobileNav]);
  doc.body = body;
  doc.getElementById = (id) => (id === 'mobile-nav' ? mobileNav : null);
  doc.querySelector = (sel) => body.find(sel.slice(1))[0] || null;
  doc.querySelectorAll = (sel) => {
    const [cls, open] = sel.slice(1).split('.');
    return body.find(cls, open === 'open');
  };
  doc.addEventListener = (type, fn) => { if (type === 'keydown') doc.listeners.push(fn); };
  vm.runInNewContext(SOURCE, { document: doc });
  const press = (key) => doc.listeners.forEach((fn) => fn({ key, preventDefault() {} }));
  return { doc, story, world, mobileNav, mobileToggle, mobileLink, press };
}

test('Escape closes an open menu and hands its focus back to the toggle (#321)', () => {
  const p = page();
  p.doc.activeElement = p.story.link;
  p.press('Escape');
  assert.ok(!p.story.node.classList.contains('open'));
  assert.strictEqual(p.doc.activeElement, p.story.toggle);
});

test('Escape leaves focus alone when it is outside the menu it closes', () => {
  const p = page();
  p.doc.activeElement = p.world.toggle;
  p.press('Escape');
  assert.ok(!p.story.node.classList.contains('open'));
  assert.strictEqual(p.doc.activeElement, p.world.toggle);
});

test('Escape on the toggle itself keeps focus on the toggle', () => {
  const p = page();
  p.doc.activeElement = p.story.toggle;
  p.press('Escape');
  assert.strictEqual(p.doc.activeElement, p.story.toggle);
});

test('Escape closes the phone menu and hands its focus back to the menu button', () => {
  const p = page();
  p.doc.activeElement = p.mobileLink;
  p.press('Escape');
  assert.ok(!p.mobileNav.classList.contains('open'));
  assert.strictEqual(p.doc.activeElement, p.mobileToggle);
});

test('another key closes nothing and moves nothing', () => {
  const p = page();
  p.doc.activeElement = p.story.link;
  p.press('a');
  assert.ok(p.story.node.classList.contains('open'));
  assert.strictEqual(p.doc.activeElement, p.story.link);
});
