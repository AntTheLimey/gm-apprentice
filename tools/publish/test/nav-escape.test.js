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
    querySelectorAll: (sel) => (sel === 'a' ? children.flatMap((c) => c.find('mobile-link')) : []),
    attrs: {},
    setAttribute: (name, value) => { node.attrs[name] = String(value); },
    getAttribute: (name) => (name in node.attrs ? node.attrs[name] : null),
    parentElement: null,
    clicks: [],
    addEventListener: (type, fn) => { if (type === 'click') node.clicks.push(fn); },
    click: () => node.clicks.forEach((fn) => fn({ target: node })),
    focus: () => { doc.activeElement = node; },
  };
  return node;
}

function page() {
  const doc = { activeElement: null, listeners: [] };
  const group = (open) => {
    const toggle = el(doc, ['nav-group-toggle']);
    const link = el(doc, ['nav-link']);
    const node = el(doc, open ? ['nav-group', 'open'] : ['nav-group'], [toggle, el(doc, ['nav-dropdown'], [link])]);
    toggle.parentElement = node;
    return { toggle, link, node };
  };
  const story = group(true);
  const world = group(false);
  const mobileToggle = el(doc, ['nav-mobile-toggle']);
  const mobileLink = el(doc, ['mobile-link']);
  const mobileClose = el(doc, ['mobile-nav-close']);
  const mobileNav = el(doc, ['mobile-nav-overlay', 'open'], [mobileClose, mobileLink]);
  const body = el(doc, ['body'], [story.node, world.node, mobileToggle, mobileNav]);
  doc.body = body;
  doc.getElementById = (id) => (id === 'mobile-nav' ? mobileNav : null);
  doc.querySelector = (sel) => body.find(sel.slice(1))[0] || null;
  doc.querySelectorAll = (sel) => {
    const [cls, open] = sel.slice(1).split('.');
    return body.find(cls, open === 'open');
  };
  doc.clickers = [];
  doc.click = (event) => doc.clickers.forEach((fn) => fn(event));
  doc.addEventListener = (type, fn) => {
    if (type === 'keydown') doc.listeners.push(fn);
    if (type === 'click') doc.clickers.push(fn);
  };
  vm.runInNewContext(SOURCE, { document: doc });
  const press = (key) => doc.listeners.forEach((fn) => fn({ key, preventDefault() {} }));
  return { doc, story, world, mobileNav, mobileToggle, mobileLink, mobileClose, press };
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

// The close button's own onclick hides the menu, the button with it.
test('the phone menu\'s close button hands the focus back to the menu button', () => {
  const p = page();
  p.doc.activeElement = p.mobileClose;
  p.mobileClose.click();
  assert.strictEqual(p.doc.activeElement, p.mobileToggle);
});

// #439: a menu button says whether its menu is open, to a screen reader.
test('a group button says aria-expanded as its menu opens and closes (#439)', () => {
  const p = page();
  p.world.toggle.click();
  assert.ok(p.world.node.classList.contains('open'));
  assert.ok(!p.story.node.classList.contains('open'));
  assert.strictEqual(p.world.toggle.getAttribute('aria-expanded'), 'true');
  assert.strictEqual(p.story.toggle.getAttribute('aria-expanded'), 'false');
  p.world.toggle.click();
  assert.strictEqual(p.world.toggle.getAttribute('aria-expanded'), 'false');
});

test('Escape sets aria-expanded back to false on the menus it closes (#439)', () => {
  const p = page();
  p.world.toggle.click();
  p.press('Escape');
  assert.strictEqual(p.world.toggle.getAttribute('aria-expanded'), 'false');
});

test('a click outside the menus closes them and says so (#439)', () => {
  const p = page();
  p.world.toggle.click();
  p.doc.click({ target: { closest: () => null } });
  assert.ok(!p.world.node.classList.contains('open'));
  assert.strictEqual(p.world.toggle.getAttribute('aria-expanded'), 'false');
});

test('the phone menu button opens the menu and says aria-expanded; close and Escape undo it (#439)', () => {
  const p = page();
  p.mobileNav.classList.remove('open');
  p.mobileToggle.click();
  assert.ok(p.mobileNav.classList.contains('open'));
  assert.strictEqual(p.mobileToggle.getAttribute('aria-expanded'), 'true');
  p.mobileClose.click();
  assert.ok(!p.mobileNav.classList.contains('open'));
  assert.strictEqual(p.mobileToggle.getAttribute('aria-expanded'), 'false');
  p.mobileToggle.click();
  p.press('Escape');
  assert.strictEqual(p.mobileToggle.getAttribute('aria-expanded'), 'false');
  p.mobileToggle.click();
  p.mobileLink.click();
  assert.strictEqual(p.mobileToggle.getAttribute('aria-expanded'), 'false');
});

test('the menu markup starts every menu button closed (#439)', () => {
  const { renderTopNav } = require('../lib/templates/nav');
  const pages = [{ outputDir: 'sessions', outputPath: 'sessions/a.html', frontmatter: {} }];
  const html = renderTopNav(pages, 'index.html', { siteTitle: 'S' }, {});
  assert.match(html, /<button class="nav-group-toggle" aria-expanded="false">/);
  assert.match(html, /class="nav-mobile-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="mobile-nav"|class="nav-mobile-toggle"[^>]*aria-controls="mobile-nav"[^>]*aria-expanded="false"/);
});
