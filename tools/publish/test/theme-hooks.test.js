'use strict';
// The hooks a theme may style (#360), end to end. A fixture site is built with player_site.theme.hooks on, and every
// hook in the one list (lib/theme-hooks.js) must be found on the pages it marks: a hook that leaves the output fails
// here. With the switch off the pages are as they were. docs/theme-hooks.md prints the same list (checked last).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildBoth } = require('./helpers/gm-build');
const { HOOKS } = require('../lib/theme-hooks');

const FILES = {
  'NPCs/Mara Quill.md': '---\ntype: npc\noccupation: Ferry pilot\n---\n\nShe has run the north channel for twenty years.\n\nShe knows every buoy.\n\n## Current Status\n\nWaiting out the fog.\n\n## GM Notes\n\nShe carries letters for the smugglers.\n',
  'Locations/Harbour.md': '---\ntype: location\n---\n\nA cold grey harbour.\n\n## Moorings\n\nTwelve berths.\n',
  'Events/The Fog.md': '---\ntype: event\nevent_type: storm\nin_game_date: 1 March\n---\n\nThe fog came in at dusk.\n',
  'Sessions/Session 01.md': '---\ntype: session\nsession_number: 1\nstatus: played\n---\n\nThe party met at the harbour.\n\n## What the Party Learned\n\n- **The fog** is not natural.\n',
  'PCs/Ash.md': '---\ntype: pc\nplayer_name: Pat\nstatus: alive\n---\n\nA climber.\n\n## Background\n\nRaised in the hills.\n',
  'Factions/Salt Guild.md': '---\ntype: faction\n---\n\nThe guild owns the salt works.\n',
  'Items/Brass Key.md': '---\ntype: item\n---\n\nIt opens the lighthouse.\n',
  'Creatures/Fog Eel.md': '---\ntype: creature\n---\n\nIt swims in the fog.\n',
  'Heritages/Tidefolk.md': '---\ntype: heritage\n---\n\nPeople of the shore.\n',
  'World/Tides.md': '---\ntype: world_domain\n---\n\nThe tides rule the town.\n',
  'Documents/Harbour Ledger.md': '---\ntype: document\n---\n\nA ledger of every berth.\n',
  '_attachments/Fog Header.png': 'not-really-a-png',
};

// One note of each kind that has its own template (the plain-note template among them): each must carry the hooks.
const NOTE_PAGES = ['npcs/mara-quill.html', 'locations/harbour.html', 'events/the-fog.html', 'sessions/session-01.html',
  'factions/salt-guild.html', 'items/brass-key.html', 'creatures/fog-eel.html', 'heritages/tidefolk.html', 'world/tides.html',
  'documents/harbour-ledger.html'];

// The pages each hook must be found on, by their path in the site. Every listed hook needs an entry.
const SEEN_ON = {
  'main.content': ['index.html', 'npcs/mara-quill.html', 'locations/index.html', '404.html'],
  'header.top-nav': ['index.html', 'npcs/mara-quill.html'],
  'nav.breadcrumbs': ['npcs/mara-quill.html', 'sessions/session-01.html'],
  '.page-title': ['sessions/session-01.html', 'locations/index.html'],
  '.metadata-badge[data-field]': ['sessions/session-01.html'],
  '.landing-hero': ['index.html'],
  'main[data-page-type]': ['index.html', ...NOTE_PAGES, 'pcs/ash.html', 'locations/index.html', 'timeline.html', '404.html'],
  '[data-title-block]': ['index.html', ...NOTE_PAGES, 'pcs/ash.html', 'locations/index.html'],
  'h1[data-page-title]': ['index.html', ...NOTE_PAGES, 'pcs/ash.html'],
  'p[data-first-paragraph]': NOTE_PAGES,
  'h2[data-section]': ['npcs/mara-quill.html', 'locations/harbour.html', 'sessions/session-01.html'],
  '.landing-hero--full-bleed': ['index.html'],
  'body.landing-full-bleed': ['index.html'],
  '.landing-hero--align-left': ['index.html'],
  '.page-banner': NOTE_PAGES,
};

// A regular expression that finds an element a simple selector (tag, one class, one attribute) names.
function finder(selector) {
  const m = /^([a-z][a-z0-9]*)?(?:\.([a-z][a-z0-9-]*))?(?:\[([a-z-]+)(?:="([^"]*)")?\])?$/.exec(selector);
  assert.ok(m, `the test cannot read the selector ${selector}`);
  const [, tag, cls, attr, value] = m;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagRe = tag ? esc(tag) : '[a-z][a-z0-9]*';
  const clsRe = cls ? `(?=[^>]*\\sclass="(?:[^"]*\\s)?${esc(cls)}(?:\\s[^"]*)?")` : '';
  const attrRe = attr ? `(?=[^>]*\\s${esc(attr)}(?:="${value === undefined ? '[^"]*' : esc(value)}")?[\\s>/])` : '';
  return new RegExp(`<${tagRe}\\b${clsRe}${attrRe}[^>]*>`);
}

const sites = [];
after(() => sites.forEach((s) => s.cleanup()));
function built(player) {
  const s = buildBoth(FILES, { player: { title: 'Fog Harbour', ...player }, sites: ['player', 'gm'] });
  sites.push(s);
  return s;
}
const on = built({ theme: { hooks: true } });
const off = built({});
const unset = built({ theme: { hooks: false } });
// The layout settings each 'setting' hook is written with (the hooks switch stays off: they do not need it).
const laidOut = built({ landing: { hero: { layout: 'full-bleed', align: 'left' } }, theme: { page_banner: '_attachments/Fog Header.png' } });

test('every listed hook has the pages it must be found on, and nothing else is listed there', () => {
  assert.deepEqual(Object.keys(SEEN_ON).sort(), HOOKS.map((h) => h.selector).sort());
});

for (const hook of HOOKS) {
  test(`${hook.selector} is on the pages it marks, ${hook.when === 'setting' ? 'with its setting' : 'with the hooks on'}`, () => {
    const re = finder(hook.selector);
    const site = hook.when === 'setting' ? laidOut : on;
    for (const page of SEEN_ON[hook.selector]) {
      assert.match(site.player.read(...page.split('/')), re, `${hook.selector} is missing from ${page}`);
    }
  });
  if (hook.when === 'setting') {
    test(`${hook.selector} is not written without its setting`, () => {
      const re = finder(hook.selector);
      for (const page of SEEN_ON[hook.selector]) assert.doesNotMatch(on.player.read(...page.split('/')), re, page);
    });
  }
  if (hook.when === 'always') {
    test(`${hook.selector} is there with the hooks off too`, () => {
      const re = finder(hook.selector);
      for (const page of SEEN_ON[hook.selector]) assert.match(off.player.read(...page.split('/')), re, `${hook.selector} is missing from ${page}`);
    });
  }
}

test('the 404 page has no menu bar: its plain header is header.site-header, and the list says so', () => {
  const page = off.player.read('404.html');
  assert.doesNotMatch(page, finder('header.top-nav'));
  assert.match(page, finder('header.site-header'));
  const topNav = HOOKS.find((h) => h.selector === 'header.top-nav');
  assert.match(topNav.marks, /404\.html/);
  assert.match(topNav.marks, /header\.site-header/);
});

test('the page types are the note\'s type, or the kind of page the tool makes', () => {
  const type = (page) => (on.player.read(...page.split('/')).match(/<main class="content" data-page-type="([^"]+)"/) || [])[1];
  assert.equal(type('index.html'), 'landing');
  assert.equal(type('npcs/mara-quill.html'), 'npc');
  assert.equal(type('pcs/ash.html'), 'pc');
  assert.equal(type('events/the-fog.html'), 'event');
  assert.equal(type('sessions/session-01.html'), 'session');
  assert.equal(type('locations/index.html'), 'index');
  assert.equal(type('timeline.html'), 'timeline');
  assert.equal(type('404.html'), 'not-found');
});

test('a section key is made from its heading, and the first paragraph is the body\'s first', () => {
  const npc = on.player.read('npcs', 'mara-quill.html');
  assert.ok(npc.includes('<h2 data-section="current-status">Current Status</h2>'));
  assert.ok(!npc.includes('gm-notes'), 'a hidden section is not on the player page');
  assert.match(npc, /<p data-first-paragraph>She has run the north channel for twenty years\.<\/p>/);
  assert.equal((npc.match(/data-first-paragraph/g) || []).length, 1);
  assert.equal((npc.match(/data-page-title/g) || []).length, 1);
  assert.equal((npc.match(/data-title-block/g) || []).length, 1);
  // The GM site carries the hooks too, its hidden section with its own key.
  assert.ok(on.gm.read('npcs', 'mara-quill.html').includes('data-section="gm-notes"'));
});

test('with the hooks off (or never set) no page carries an added hook, and the two builds are the same', () => {
  const added = /data-page-type=|data-title-block|data-page-title|data-first-paragraph|data-section=/;
  const pages = off.player.files().filter((f) => f.endsWith('.html'));
  assert.ok(pages.length > 10);
  for (const f of pages) {
    const rel = path.relative(off.player.dir, f);
    const text = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(text, added, rel);
    assert.equal(text, unset.player.read(...rel.split(path.sep)), rel);
  }
});

test('with the hooks on, taking the added attributes out gives the hooks-off page: nothing else moves', () => {
  const strip = (html) => html.replace(/ data-page-type="[^"]*"| data-title-block| data-page-title| data-first-paragraph| data-section="[^"]*"/g, '');
  for (const site of ['player', 'gm']) {
    const pages = on[site].files().filter((f) => f.endsWith('.html'));
    assert.ok(pages.length > 15);
    for (const f of pages) {
      const rel = path.relative(on[site].dir, f).split(path.sep);
      assert.equal(strip(fs.readFileSync(f, 'utf8')), off[site].read(...rel), `${site}: ${rel.join('/')}`);
    }
  }
});

test('docs/theme-hooks.md lists every hook, as the list says', () => {
  const { render } = require('../scripts/gen-theme-hooks-doc');
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'theme-hooks.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(render(doc), doc, 'docs/theme-hooks.md is out of date: run `node tools/publish/scripts/gen-theme-hooks-doc.js --write`');
  for (const h of HOOKS) assert.ok(doc.includes(`\`${h.selector}\``), `${h.selector} is not on the page`);
});
