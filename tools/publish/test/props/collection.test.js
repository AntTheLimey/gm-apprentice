'use strict';
// What a container lists: its shown items linked, in the order they arrived; with
// `show_sealed: titles` the title alone of each item not yet found; a withheld item never.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { containerItems, byArrival } = require('../../lib/props/collection');
const { propListHtml } = require('../../lib/templates/props-page');

// A prop plan as planProps makes it, for a note at `rel` with frontmatter `fm`.
function prop(rel, fm, { kind = 'document', shown = true } = {}) {
  const name = rel.split('/').pop().replace(/\.md$/, '');
  const page = {
    title: name, displayTitle: fm.title || name, vaultPath: rel.replace(/\.md$/, ''),
    outputPath: `documents/${name.toLowerCase().replace(/ /g, '-')}.html`,
    frontmatter: { type: 'prop', ...fm }, sourceFrontmatter: { type: 'prop', ...fm }, shown,
  };
  return { rel, page, ships: shown, kind, address: null, files: [], made: null };
}
const container = (fm = {}) => prop('Props/Bookshelf.md', { prop_kind: 'container', ...fm }, { kind: 'container' });
const SESSIONS = {
  'Session 3': { displayTitle: 'Session 3', outputPath: 'sessions/session-3.html' },
  'Session 14': { displayTitle: 'Session 14', outputPath: 'sessions/session-14.html' },
};
const listing = (props, extra = {}) => {
  const problems = [];
  const out = containerItems({
    props, isShown: (pg) => pg.shown, excludeFields: [], resolvePage: (t) => SESSIONS[t] || null, problems, ...extra,
  });
  return { out, problems, rows: out.get('Props/Bookshelf.md') ? out.get('Props/Bookshelf.md').rows : null };
};
const IN = '[[Bookshelf]]';

test('a container lists its revealed items in arrival order', () => {
  const props = [
    container(),
    prop('Props/Diary.md', { prop_container: IN, revealed_in: '[[Session 14]]', prop_line: 'A water-stained diary' }),
    prop('Props/Atlas.md', { prop_container: IN, revealed_in: ['[[Session 3]]', '[[Session 14]]'] }),
    prop('Props/Zither.md', { prop_container: [['Bookshelf']], lastUpdated: '2026-01-02' }),
    prop('Props/Map.md', { prop_container: IN, prop_title: 'A Map of the Fens', lastUpdated: '2026-01-01' }),
    prop('Props/Loose.md', { prop_container: IN }),
  ];
  const { rows, problems } = listing(props);
  assert.deepEqual(problems, []);
  assert.deepEqual(rows.map((r) => r.title), ['Atlas', 'Diary', 'A Map of the Fens', 'Zither', 'Loose']);
  const diary = rows[1];
  assert.deepEqual(diary, {
    rel: 'Props/Diary.md', title: 'Diary', href: 'documents/diary.html', line: 'A water-stained diary',
    arrived: { title: 'Session 14', href: 'sessions/session-14.html' }, sealed: false, unrevealed: false,
  });
  assert.equal(rows[0].arrived.title, 'Session 3', 'the first entry of revealed_in');
  const html = propListHtml(rows, 'props/bookshelf.html');
  assert.match(html, /<li class="prop-item"><a href="\.\.\/documents\/diary\.html">Diary<\/a> <span class="prop-line">A water-stained diary<\/span> <span class="prop-arrived">Arrived in <a href="\.\.\/sessions\/session-14\.html">Session 14<\/a><\/span><\/li>/);
});

test('an arrival in an unpublished session shows no chip', () => {
  const { rows } = listing([container(), prop('Props/Diary.md', { prop_container: IN, revealed_in: '[[Session 99]]' })]);
  assert.equal(rows[0].arrived, null);
});

test('a sealed item is its title and nothing else', () => {
  const sealed = prop('Props/Letter.md', {
    prop_container: IN, prop_line: 'SECRET LINE', revealed_in: '[[Session 3]]', lastUpdated: '2026-01-01',
  }, { shown: false });
  sealed.address = 'props/letter.html';
  const shownItem = prop('Props/Diary.md', { prop_container: IN });
  const { rows } = listing([container({ show_sealed: 'titles' }), sealed, shownItem]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], { rel: 'Props/Letter.md', title: 'Letter', href: null, line: null, arrived: null, sealed: true, unrevealed: false });
  const html = propListHtml(rows, 'props/bookshelf.html');
  assert.match(html, /<li class="prop-item prop-sealed"><span class="prop-title">Letter<\/span> <span class="prop-seal">Sealed<\/span><\/li>/);
  assert.doesNotMatch(html, /SECRET|letter\.html|Session 3/);

  for (const fm of [{}, { show_sealed: 'none' }]) {
    const none = listing([container(fm), sealed, shownItem]);
    assert.deepEqual(none.rows.map((r) => r.title), ['Diary'], JSON.stringify(fm));
  }
});

test('a withheld item never shows', () => {
  for (const shown of [true, false]) {
    const item = prop('Props/Letter.md', { prop_container: IN, withheld: true }, { shown });
    for (const fm of [{}, { show_sealed: 'titles' }]) {
      const { rows } = listing([container(fm), item]);
      assert.deepEqual(rows, [], `shown ${shown}, ${JSON.stringify(fm)}`);
    }
  }
});

test('a hidden prop_title never names a sealed item', () => {
  const item = prop('Props/Letter.md', { prop_container: IN, prop_title: 'From Lady Anne' }, { shown: false });
  const hidden = listing([container({ show_sealed: 'titles' }), item], { excludeFields: ['prop_title'] });
  assert.equal(hidden.rows[0].title, 'Letter');
  const perFile = prop('Props/Letter.md', { prop_container: IN, prop_title: 'From Lady Anne', publish_exclude_fields: ['prop_title'] }, { shown: false });
  assert.equal(listing([container({ show_sealed: 'titles' }), perFile]).rows[0].title, 'Letter');
  const shownTitle = listing([container({ show_sealed: 'titles' }), item]);
  assert.equal(shownTitle.rows[0].title, 'From Lady Anne');
});

test('an item naming a non-container is listed on its own, with a row', () => {
  const desk = prop('Props/Desk.md', {});
  const item = prop('Props/Diary.md', { prop_container: '[[Desk]]' });
  const nowhere = prop('Props/Atlas.md', { prop_container: 'Nowhere' });
  const heldItem = prop('Props/Held.md', { prop_container: 'Nowhere' }, { shown: false });
  const { out, problems } = listing([container(), desk, item, nowhere, heldItem]);
  assert.deepEqual(out.get('Props/Bookshelf.md').rows, []);
  assert.deepEqual(problems, [
    { rel: 'Props/Diary.md', code: 'PROP_NOT_COPIED', severity: 'warning', detail: 'prop_container names "Desk", which is not a container prop; it is listed on its own', fix: 'make "Desk" a container (prop_kind: container), or correct prop_container' },
    { rel: 'Props/Atlas.md', code: 'PROP_NOT_COPIED', severity: 'warning', detail: 'prop_container names "Nowhere", which is not a container prop; it is listed on its own', fix: 'make "Nowhere" a container (prop_kind: container), or correct prop_container' },
  ]);
});

test('one level: a container in a container is a row of its own container only', () => {
  const box = prop('Props/Box.md', { prop_kind: 'container', prop_container: IN }, { kind: 'container' });
  const ring = prop('Props/Ring.md', { prop_container: '[[Box]]' });
  const { out } = listing([container(), box, ring]);
  assert.deepEqual(out.get('Props/Bookshelf.md').rows.map((r) => r.title), ['Box']);
  assert.deepEqual(out.get('Props/Box.md').rows.map((r) => r.title), ['Ring']);
});

test('the GM site lists every item it shows, marks the unrevealed, and seals nothing', () => {
  const revealed = prop('Props/Diary.md', { prop_container: IN });
  const unrevealed = prop('Props/Letter.md', { prop_container: IN });
  const hiddenFromGm = prop('Props/Gone.md', { prop_container: IN }, { shown: false });
  const withheld = prop('Props/Ledger.md', { prop_container: IN, withheld: true });
  const { rows } = listing([container({ show_sealed: 'titles' }), revealed, unrevealed, hiddenFromGm, withheld], {
    site: 'gm', isPlayerShown: (pg) => pg !== unrevealed.page,
  });
  assert.deepEqual(rows.map((r) => [r.title, r.unrevealed, r.sealed]), [['Diary', false, false], ['Ledger', true, false], ['Letter', true, false]]);
  assert.match(propListHtml(rows, 'props/bookshelf.html'), /Letter<\/a> <span class="gm-unrevealed">not yet revealed<\/span>/);
});

test('byArrival: session, then lastUpdated, then title, none last; sealed after', () => {
  const r = (title, extra = {}) => ({ title, sealed: false, arrived: null, ...extra });
  const rows = [r('b', { sealed: true }), r('a', { sealed: true }), r('x'), r('m', { arrived: { title: 'Session 2' } }), r('c', { arrived: { title: 'Session 10' } })];
  assert.deepEqual(rows.sort(byArrival).map((x) => x.title), ['m', 'c', 'x', 'a', 'b']);
});

test('every text is escaped', () => {
  const html = propListHtml([
    { rel: 'r', title: '<b>T</b>', href: 'a b/c.html', line: '"x" & <y>', arrived: { title: '<s>', href: 'q.html' }, sealed: false, unrevealed: false },
    { rel: 's', title: '<i>S</i>', href: null, line: null, arrived: null, sealed: true, unrevealed: false },
  ], 'props/x.html');
  assert.doesNotMatch(html, /<b>|<y>|<s>|<i>/);
  assert.match(html, /href="\.\.\/a%20b\/c\.html"/);
});
