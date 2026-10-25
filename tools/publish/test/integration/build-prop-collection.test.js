'use strict';
// One props page per site: every prop it shows, grouped by container, prop_group, chapter, then
// the rest; in the menu, on every prop page's bar, and (when asked) as a box on the landing page.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../../lib/build');
const { buildBoth } = require('../helpers/gm-build');
const { latestProps } = require('../../lib/props/collection');

const rels = (site) => site.files().map((f) => path.relative(site.dir, f).split(path.sep).join('/'));
const htmlFiles = (site) => site.files().filter((f) => f.endsWith('.html'));
// Every line a build prints (the helper keeps only warnings).
const lines = (fn) => {
  const saved = { log: console.log, warn: console.warn };
  const out = [];
  console.log = (m) => out.push(String(m)); console.warn = (m) => out.push(String(m));
  try { fn(); } finally { Object.assign(console, saved); }
  return out;
};
const headings = (page) => [...page.matchAll(/<section class="prop-group">\n<h2>(?:<a href="([^"]*)">)?([^<]*)/g)].map((m) => (m[1] ? `${m[2]} -> ${m[1]}` : m[2]));
const SESSION = (n, extra = '') => `---\ntype: session\nsession_number: ${n}\nstatus: played\n${extra}---\nPlayed.\n`;

describe('a vault with no prop', () => {
  const s = buildBoth({
    'Documents/Desk.md': '---\ntype: document\n---\nA desk.\n',
    'Sessions/Session 01.md': SESSION(1),
  }, { player: { landing: { latest_props: 3 } } });
  after(() => s.cleanup());

  it('builds no collection, link or box', () => {
    for (const site of [s.player, s.gm]) {
      assert.ok(!site.exists('props', 'index.html'), rels(site).join(', '));
      assert.ok(!site.exists('css', 'props.css'));
      for (const f of htmlFiles(site)) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), />Props<|props-latest|All props/, f);
    }
  });
});

const GROUPED = {
  'Documents/Bookshelf.md': '---\ntype: prop\nprop_kind: container\nshow_sealed: titles\n---\nA shelf.\n',
  'Documents/Diary.md': '---\ntype: prop\nprop_container: "[[Bookshelf]]"\nrevealed_in: "[[Session 03]]"\n---\nA diary.\n',
  'Documents/Sealed Letter.md': '---\ntype: prop\nprop_container: "[[Bookshelf]]"\npublish: false\n---\nA letter.\n',
  'Documents/Badge.md': '---\ntype: prop\nprop_group: Evidence\n---\nA badge.\n',
  'Documents/Ticket.md': '---\ntype: prop\nchapter: "[[Chapter Two]]"\n---\nA ticket.\n',
  'Documents/Coin.md': '---\ntype: prop\n---\nA coin.\n',
  'Documents/Stamp.md': '---\ntype: prop\nrevealed_in: "[[Session 04]]"\n---\nA stamp.\n',
  'Chapters/Chapter One/Chapter One.md': '---\ntype: chapter\nstatus: played\n---\nThe first.\n',
  'Chapters/Chapter One/Map.md': '---\ntype: prop\n---\nA map.\n',
  'Chapters/Chapter Two.md': '---\ntype: chapter\nstatus: played\n---\nThe second.\n',
  'Sessions/Session 03.md': SESSION(3),
  'Sessions/Session 04.md': SESSION(4, 'publish: false\n'),
  'Art/cover.png': 'PNG',
};

describe('the props page', () => {
  const s = buildBoth(GROUPED, { player: { props: { title: 'Evidence Locker', intro: 'All we found.', cover: 'Art/cover.png' } }, gm: { props: { title: 'GM Locker' } } });
  after(() => s.cleanup());
  const page = () => s.player.read('props', 'index.html');

  it('groups by container, prop_group, chapter, then the rest', () => {
    const one = rels(s.player).find((r) => /chapter-one\.html$/.test(r));
    const two = rels(s.player).find((r) => /chapter-two\.html$/.test(r));
    assert.ok(one && two, rels(s.player).join(', '));
    assert.deepEqual(headings(page()), [
      'Bookshelf -> bookshelf.html',
      'Evidence',
      'Other props',
      `Chapter One -> ../${encodeURI(one)}`,
      `Chapter Two -> ../${two}`,
    ]);
    // The container's rows are its own page's: the sealed item by title; it is in no other group.
    assert.match(page(), /<li class="prop-item prop-sealed"><span class="prop-title">Sealed Letter<\/span>/);
    assert.equal((page().match(/Diary</g) || []).length, 1);
    assert.match(page(), /<h2>Other props<\/h2>\n<ul class="prop-list">\n<li class="prop-item"><a href="\.\.\/documents\/coin\.html">Coin<\/a><\/li>\n<li class="prop-item"><a href="\.\.\/documents\/stamp\.html">Stamp<\/a><\/li>\n<\/ul>/);
  });

  it('a revealed prop arrived in a published session shows the chip; an unpublished session shows none', () => {
    const session = rels(s.player).find((r) => /session-03\.html$/.test(r));
    assert.match(page(), new RegExp(`<a href="\\.\\./documents/diary\\.html">Diary</a> <span class="prop-arrived">Arrived in <a href="\\.\\./${session.replace(/\./g, '\\.')}">Session 03</a></span>`));
    assert.match(page(), /<li class="prop-item"><a href="\.\.\/documents\/stamp\.html">Stamp<\/a><\/li>/);
  });

  it('title, intro and cover show; the menu link uses the title', () => {
    assert.match(page(), /<h1 class="page-title">Evidence Locker<\/h1>\n<img class="props-cover" src="\.\.\/images\/banners\/props\/cover\.png" alt="">\n<p class="props-intro">All we found\.<\/p>/);
    assert.equal(s.player.read('images', 'banners', 'props', 'cover.png'), 'PNG');
    assert.match(s.player.read('documents', 'coin.html'), /<a href="\.\.\/props\/index\.html">Evidence Locker<\/a>/);
    assert.match(s.player.read('index.html'), /<a href="props\/index\.html">Evidence Locker<\/a>/);
  });

  it('the GM site has its own collection', () => {
    assert.match(s.gm.read('props', 'index.html'), /<h1 class="page-title">GM Locker<\/h1>/);
    assert.match(s.gm.read('documents', 'coin.html'), /<a href="\.\.\/props\/index\.html">GM Locker<\/a>/);
    // Nothing is sealed from the GM: the letter is a link, marked unrevealed.
    assert.match(s.gm.read('props', 'index.html'), /Sealed Letter<\/a> <span class="gm-unrevealed">not yet revealed<\/span>/);
  });
});

describe('the props page address', () => {
  it('a taken address falls back with a warning', () => {
    const s = buildBoth({ 'Documents/Coin.md': '---\ntype: prop\n---\nA coin.\n' }, { sites: ['player'], player: { props: { address: 'index.html' } } });
    try {
      assert.ok(s.logs.some((l) => l.includes('WARNING: player_site.props.address "index.html" is taken by a file the site needs; the props page is at props/index.html')), s.logs.join('\n'));
      assert.match(s.player.read('props', 'index.html'), /<h1 class="page-title">Props<\/h1>/);
    } finally { s.cleanup(); }
  });

  it('an address that is not a page falls back with a warning', () => {
    const s = buildBoth({ 'Documents/Coin.md': '---\ntype: prop\n---\nA coin.\n' }, { sites: ['player'], player: { props: { address: 'props/all.txt' } } });
    try {
      assert.ok(s.logs.some((l) => l.includes('WARNING: player_site.props.address "props/all.txt" must end in .html; the props page is at props/index.html')), s.logs.join('\n'));
    } finally { s.cleanup(); }
  });

  it('an address in a kept folder replaces the kept file', () => {
    const s = buildBoth({ 'Documents/Coin.md': '---\ntype: prop\n---\nA coin.\n' }, { sites: [], player: { keep: ['extras'], props: { address: 'extras/props.html' } } });
    try {
      fs.mkdirSync(path.join(s.player.dir, 'extras'), { recursive: true });
      fs.writeFileSync(path.join(s.player.dir, 'extras', 'props.html'), 'MINE');
      const out = lines(() => build({ configPath: s.configPath, site: 'player' }));
      assert.match(s.player.read('extras', 'props.html'), /<h1 class="page-title">Props<\/h1>/);
      assert.ok(out.includes('  replaces kept file: extras/props.html'), out.join('\n'));
      assert.ok(!s.player.exists('props', 'index.html'));
      assert.match(s.player.read('documents', 'coin.html'), /<a href="\.\.\/extras\/props\.html">Props<\/a>/);
    } finally { s.cleanup(); }
  });

  it('a page the site builds at props/index.html moves it to props/collection.html (Ruling 17)', () => {
    const s = buildBoth({
      'Props/Index.md': '---\ntype: document\n---\nThe GM\'s own page.\n',
      'Documents/Coin.md': '---\ntype: prop\n---\nA coin.\n',
    }, { sites: ['player'] });
    try {
      assert.ok(s.logs.some((l) => l.includes('WARNING: player_site.props.address "props/index.html" is taken by a page the site builds; the props page is at props/collection.html')), s.logs.join('\n'));
      assert.match(s.player.read('props', 'index.html'), /own page\./);
      assert.match(s.player.read('props', 'collection.html'), /<h1 class="page-title">Props<\/h1>/);
    } finally { s.cleanup(); }
  });
});

describe('the prop bar', () => {
  const s = buildBoth({
    'Documents/Paper.md': '---\ntype: prop\nprop_file: paper.html\nprop_address: gazetteer/papers/x.html\n---\nA paper.\n',
    'Documents/paper.html': '<html><body><p>Read all about it.</p></body></html>',
    '_meta/prop-styles/t/layout.html': '<h1>{{title}}</h1>{{{body}}}',
    '_meta/prop-styles/t/style.css': '.t { color: red; }\n',
    'Documents/Letter.md': '---\ntype: prop\nprop_style: t\n---\nA letter.\n\n## The Text\n\nDear sir.\n',
  }, { sites: ['player'] });
  after(() => s.cleanup());

  it('links the collection', () => {
    assert.match(s.player.read('gazetteer', 'papers', 'x.html'), /<a href="\.\.\/\.\.\/props\/index\.html">All props<\/a>/);
    assert.match(s.player.read('props', 'letter.html'), /<a href="index\.html">All props<\/a>/);
  });
});

describe('the landing box', () => {
  const s = buildBoth({
    'Documents/Alpha.md': '---\ntype: prop\nrevealed_in: "[[Session 03]]"\n---\nA.\n',
    'Documents/Bravo.md': '---\ntype: prop\nrevealed_in: "[[Session 05]]"\n---\nB.\n',
    'Documents/Charlie.md': '---\ntype: prop\nlastUpdated: 2026-01-01\n---\nC.\n',
    'Documents/Delta.md': '---\ntype: prop\n---\nD.\n',
    'Sessions/Session 03.md': SESSION(3),
    'Sessions/Session 05.md': SESSION(5),
    'Locations/Inn.md': '---\ntype: location\n---\nAn inn.\n',
  }, { sites: ['player'], player: { landing: { latest_props: 3 } } });
  after(() => s.cleanup());

  it('shows the newest N, before Explore the World', () => {
    const index = s.player.read('index.html');
    const box = /<section class="dashboard-section props-latest">[\s\S]*?<\/section>/.exec(index);
    assert.ok(box, index);
    assert.match(box[0], /^<section class="dashboard-section props-latest"><h2><a href="props\/index\.html">Latest from Props<\/a><\/h2>\n<ul class="prop-list">/);
    assert.deepEqual([...box[0].matchAll(/<li class="prop-item"><a href="[^"]*">([^<]*)<\/a>/g)].map((m) => m[1]), ['Bravo', 'Alpha', 'Charlie']);
    assert.match(box[0], /<p><a href="props\/index\.html">All 4 props<\/a><\/p><\/section>$/);
    assert.match(index, /<\/section>\n<div class="dashboard-section">\n  <h2>Explore the World<\/h2>/);
  });

  it('orders by session, then lastUpdated, then title', () => {
    const row = (title, arrived, updated) => ({ rel: title, title, href: 'x', line: null, arrived: arrived ? { title: arrived, href: 'y' } : null, sealed: false, unrevealed: false, updated });
    const model = { groups: [{ heading: 'G', href: null, rows: [
      row('Zed', null, null), row('Amy', null, '2026-01-01'), row('Bob', null, '2026-02-01'),
      row('Cy', 'Session 2', null), row('Di', 'Session 10', null), row('Ed', null, null),
      { ...row('Sealed', null, null), sealed: true },
    ] }] };
    assert.deepEqual(latestProps(model, 10).map((r) => r.title), ['Di', 'Cy', 'Bob', 'Amy', 'Ed', 'Zed']);
    assert.deepEqual(latestProps(model, 2).map((r) => r.title), ['Di', 'Cy']);
  });
});

// Ruling 19 and 20: names as each note's own page prints them; a stub's row is its title and link.
describe('withheld and stub props', () => {
  const MARK = (name) => `<span class="gm-mark gm-mark--withheld_names" data-gm-kind="withheld_names" data-gm-label="players see: something">${name}</span>`;
  const s = buildBoth({
    'Documents/Vault Box.md': '---\ntype: prop\nprop_kind: container\nwithheld: true\npublish: false\n---\nA box.\n',
    'Documents/Ledger.md': '---\ntype: prop\nwithheld: true\npublish: false\n---\nA ledger.\n',
    'Documents/Rumour.md': '---\ntype: prop\npublish: stub\nprop_line: STUBLINE\nrevealed_in: "[[Session 02]]"\n---\nA rumour.\n',
    'Sessions/Session 02.md': SESSION(2),
  });
  after(() => s.cleanup());

  it('the player site lists the stub by title and link alone, and never a withheld prop', () => {
    const page = s.player.read('props', 'index.html');
    assert.match(page, /<li class="prop-item"><a href="\.\.\/documents\/rumour\.html">Rumour<\/a><\/li>/);
    assert.doesNotMatch(page, /STUBLINE|Ledger|Vault Box|something/);
  });

  it('the GM site marks the withheld names, in a heading and in a row', () => {
    const page = s.gm.read('props', 'index.html');
    assert.ok(page.includes(`<h2><a href="vault-box.html">${MARK('Vault Box')}</a></h2>`), page);
    assert.ok(page.includes(`<a href="../documents/ledger.html">${MARK('Ledger')}</a> <span class="gm-unrevealed">not yet revealed</span>`), page);
  });
});

describe('a sheets-only build', () => {
  it("a PC sheet's menu links the props page, as a full build's does", () => {
    const s = buildBoth({
      'Characters/PCs/Ann.md': '---\ntype: pc\nstatus: active\n---\nAnn.\n',
      'Documents/Coin.md': '---\ntype: prop\n---\nA coin.\n',
    }, { sites: ['player'] });
    try {
      const sheet = rels(s.player).find((r) => /ann\.html$/.test(r));
      const full = s.player.read(...sheet.split('/'));
      assert.match(full, />Props<\/a>/);
      lines(() => build({ configPath: s.configPath, site: 'player', only: 'sheets' }));
      assert.equal(s.player.read(...sheet.split('/')), full);
    } finally { s.cleanup(); }
  });
});
