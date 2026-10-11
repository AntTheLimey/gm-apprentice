'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildConnections, isEmpty } = require('../../lib/connections');
const { buildLinkMap } = require('../../lib/scanner');
const { buildBacklinks } = require('../../lib/backlinks');

// A page as the build holds it once frontmatter is reduced. `links` are names its
// published text links.
function page(title, type, fm = {}, links = [], dir = 'p') {
  const body = links.map((l) => `[[${l}]]`).join(' ');
  return { title, displayTitle: title.replace(/_/g, ' '), outputPath: `${dir}/${title.toLowerCase()}.html`,
    frontmatter: { type, ...fm }, markdown: body, publishedMarkdown: body };
}
function ctx(pages, more = {}) {
  const linkMap = buildLinkMap(pages);
  return { pages, linkMap, backlinks: buildBacklinks(pages, linkMap), ...more };
}
const tab = (model, id) => model.tabs.find((t) => t.id === id);
const group = (model, id, label) => (tab(model, id) || { groups: [] }).groups.find((g) => g.label === label);
const names = (g) => g.items.map((i) => i.title);

test('an outgoing relationship is an item under its kind, in the tab of the other page', () => {
  const emma = page('Emma', 'npc', { relationships: [{ target: '[[Hallam]]', type: 'serves', tone: 'loyal', description: 'His secretary.' }] });
  const hallam = page('Hallam', 'npc');
  const m = buildConnections(ctx([emma, hallam])).for(emma);
  const g = group(m, 'people', 'Serves');
  assert.deepStrictEqual(names(g), ['Hallam']);
  assert.deepStrictEqual(g.items[0], { title: 'Hallam', outputPath: 'p/hallam.html', kind: 'NPC', tone: 'warm', lines: ['His secretary.'], own: 1, sessions: null, image: null });
});

test('the other end sees it too, worded by the inverse', () => {
  const emma = page('Emma', 'npc', { relationships: [{ target: 'Hallam', type: 'serves', description: 'His secretary.' }] });
  const hallam = page('Hallam', 'npc');
  const m = buildConnections(ctx([emma, hallam])).for(hallam);
  assert.deepStrictEqual(names(group(m, 'people', 'Served by')), ['Emma']);
  assert.deepStrictEqual(group(m, 'people', 'Served by').items[0].lines, ['His secretary.']);
  assert.strictEqual(group(m, 'people', 'Served by').items[0].own, 0);
});

test('a pair written from both ends is one item: own line first, the other second, own tone', () => {
  const a = page('A', 'npc', { relationships: [{ target: 'B', type: 'knows', tone: 'warm', description: 'Old friends.' }] });
  const b = page('B', 'npc', { relationships: [{ target: 'A', type: 'rival_of', tone: 'hostile', description: 'Owes me.' }, { target: 'A', type: 'knows', description: 'Old friends.' }] });
  const m = buildConnections(ctx([a, b])).for(a);
  assert.strictEqual(m.tabs.length, 1);
  assert.strictEqual(tab(m, 'people').groups.length, 1);
  const item = group(m, 'people', 'Knows').items[0];
  assert.deepStrictEqual(item.lines, ['Old friends.', 'Owes me.']);
  assert.strictEqual(item.own, 1);
  assert.strictEqual(item.tone, 'warm');
});

test('a note related to itself is no item', () => {
  const a = page('A', 'npc', { relationships: [{ target: 'A', type: 'knows' }] });
  assert.ok(isEmpty(buildConnections(ctx([a])).for(a)));
});

test('two pages with one title are two items, each with its own lines', () => {
  const npc = page('Mara', 'npc', {}, [], 'npcs');
  const pc = page('Mara', 'pc', {}, [], 'pcs');
  const boss = page('Boss', 'npc', { relationships: [{ target: 'Mara', type: 'employs', description: 'Pays her.' }] });
  const linkMap = { Mara: 'npcs/mara.html', Boss: 'p/boss.html' };
  const index = buildConnections({ pages: [npc, pc, boss], linkMap, backlinks: {} });
  assert.strictEqual(index.for(npc).tabs[0].groups[0].items[0].title, 'Boss');
  assert.ok(isEmpty(index.for(pc)));
});

test('a target with no page is an unlinked item in Other, called by its label', () => {
  const a = page('A', 'npc', { relationships: [
    { target: '[[Vesper_Hale|the stranger]]', type: 'fears' },
    { target: '[[Old_Tom]]', type: 'knows' }] });
  const m = buildConnections(ctx([a])).for(a);
  const items = tab(m, 'other').groups.flatMap((g) => g.items);
  assert.deepStrictEqual(items.map((i) => [i.title, i.outputPath]).sort(), [['Old Tom', null], ['the stranger', null]]);
  assert.strictEqual(items.find((i) => i.title === 'the stranger').key, 'Vesper_Hale');
  assert.ok(!JSON.stringify({ ...m, tabs: m.tabs.map((t) => ({ ...t, groups: t.groups.map((g) => ({ ...g, items: g.items.map(({ key, ...rest }) => rest) })) })) }).includes('Vesper'));
});

test('an alias resolves to its page', () => {
  const a = page('A', 'npc', { relationships: [{ target: 'The Widow', type: 'knows' }] });
  const emma = page('Emma', 'npc', { aliases: ['The Widow'] });
  assert.deepStrictEqual(names(group(buildConnections(ctx([a, emma])).for(a), 'people', 'Knows')), ['Emma']);
});

test('two aliases of one page are one item', () => {
  const a = page('A', 'npc', { relationships: [{ target: 'The Widow', type: 'knows' }, { target: 'Em', type: 'knows' }] });
  const emma = page('Emma', 'npc', { aliases: ['The Widow', 'Em'] });
  assert.deepStrictEqual(names(group(buildConnections(ctx([a, emma])).for(a), 'people', 'Knows')), ['Emma']);
});

test('an outgoing relationship with no tone lets the first incoming tone show; an outgoing tone wins', () => {
  const a = page('A', 'npc', { relationships: [{ target: 'B', type: 'knows' }, { target: 'C', type: 'knows', tone: 'warm' }] });
  const b = page('B', 'npc', { relationships: [{ target: 'A', type: 'knows', tone: 'hostile' }] });
  const c = page('C', 'npc', { relationships: [{ target: 'A', type: 'knows', tone: 'hostile' }] });
  const m = buildConnections(ctx([a, b, c])).for(a);
  const items = group(m, 'people', 'Knows').items;
  assert.strictEqual(items.find((i) => i.title === 'B').tone, 'hostile');
  assert.strictEqual(items.find((i) => i.title === 'C').tone, 'warm');
});

test('tabs follow the fixed order and empty ones are left out', () => {
  const a = page('A', 'npc', { relationships: [
    { target: 'Dagger', type: 'owns' }, { target: 'Docks', type: 'located_at' },
    { target: 'Guild', type: 'member_of' }, { target: 'B', type: 'knows' }] });
  const m = buildConnections(ctx([a, page('Dagger', 'item'), page('Docks', 'location'), page('Guild', 'faction'), page('B', 'pc')])).for(a);
  assert.deepStrictEqual(m.tabs.map((t) => t.label), ['People', 'Places', 'Organisations', 'Things']);
});

test('Family is first, then groups by size with the largest last', () => {
  const rels = [
    { target: 'K1', type: 'knows' }, { target: 'K2', type: 'knows' }, { target: 'K3', type: 'knows' },
    { target: 'S1', type: 'serves' }, { target: 'F1', type: 'parent_of' }, { target: 'F2', type: 'sibling_of' }];
  const others = ['K1', 'K2', 'K3', 'S1', 'F1', 'F2'].map((n) => page(n, 'npc'));
  const a = page('A', 'npc', { relationships: rels });
  const m = buildConnections(ctx([a, ...others])).for(a);
  assert.deepStrictEqual(tab(m, 'people').groups.map((g) => g.label), ['Family', 'Serves', 'Knows']);
});

test('sessions shared: counted, first and last named, a hub and its Wrap-Up once', () => {
  const a = page('A', 'npc', { relationships: [{ target: 'B', type: 'knows' }, { target: 'C', type: 'knows' }] });
  const b = page('B', 'npc'); const c = page('C', 'npc');
  const s1 = page('Session_1', 'session', { session_number: 1 }, ['A', 'B']);
  const s2 = page('Session_2', 'session', { session_number: 2 }, []);
  const w2 = page('Session_2_Wrap', 'session_wrap', {}, ['A', 'B']);
  const s3 = page('Session_3', 'session', { session_number: 3 }, ['A', 'B', 'C']);
  const pages = [a, b, c, s1, s2, w2, s3];
  const m = buildConnections(ctx(pages, { hubPairs: new Map([[s2, w2]]) })).for(a);
  const g = group(m, 'people', 'Knows');
  assert.deepStrictEqual(names(g), ['B', 'C']);     // most sessions first
  assert.deepStrictEqual(g.items[0].sessions, { count: 3, first: 'Session 1', last: 'Session 3' });
  assert.deepStrictEqual(g.items[1].sessions, { count: 1, first: 'Session 3', last: 'Session 3' });
});

test('within a group, equal sessions fall back to the title', () => {
  const a = page('A', 'npc', { relationships: [{ target: 'Zed', type: 'knows' }, { target: 'Abe', type: 'knows' }] });
  const m = buildConnections(ctx([a, page('Zed', 'npc'), page('Abe', 'npc')])).for(a);
  assert.deepStrictEqual(names(group(m, 'people', 'Knows')), ['Abe', 'Zed']);
});

test('mentions are the backlinks that are not items, Sessions first, never an index page', () => {
  const a = page('A', 'npc', { relationships: [{ target: 'B', type: 'knows' }] });
  const b = page('B', 'npc', {}, ['A']);
  const loc = page('Docks', 'location', {}, ['A']);
  const s1 = page('Session_1', 'session', { session_number: 1 }, ['A']);
  const idx = page('index', 'index', {}, ['A']);
  const m = buildConnections(ctx([a, b, loc, s1, idx])).for(a);
  assert.deepStrictEqual(m.mentions.map((g) => [g.label, g.items.map((i) => i.title)]), [['Sessions', ['Session 1']], ['Places', ['Docks']]]);
  assert.deepStrictEqual(m.mentions[0].items[0], { title: 'Session 1', outputPath: 'p/session_1.html', kind: 'Session' });
});

test('a Wrap-Up page lists no mentions', () => {
  const w = page('Wrap', 'session_wrap');
  const a = page('A', 'npc', {}, ['Wrap']);
  assert.ok(isEmpty(buildConnections(ctx([w, a])).for(w)));
});

test("a location's parent is an item in Places under Part of", () => {
  const cellar = page('Cellar', 'location', { parent_location: '[[Inn]]' });
  const m = buildConnections(ctx([cellar, page('Inn', 'location')])).for(cellar);
  assert.deepStrictEqual(names(group(m, 'places', 'Part of')), ['Inn']);
});

test('extras become items in their own group and leave the mentions', () => {
  const ch = page('Chapter_1', 'chapter');
  const s1 = page('Session_1', 'session', { session_number: 1 }, ['Chapter_1']);
  const m = buildConnections(ctx([ch, s1], { extras: new Map([[ch, [{ group: 'Sessions', page: s1 }]]]) })).for(ch);
  assert.deepStrictEqual(names(group(m, 'sessions', 'Sessions')), ['Session 1']);
  assert.deepStrictEqual(m.mentions, []);
});

test('an item carries its page portrait when the image exists', () => {
  const a = page('A', 'npc', { relationships: [{ target: 'B', type: 'knows' }] });
  const b = page('B', 'npc', { portrait: '_attachments/people/B.png' });
  const m = buildConnections(ctx([a, b], { imageMap: { 'B.png': { relPath: 'people/B.png' } } })).for(a);
  assert.strictEqual(group(m, 'people', 'Knows').items[0].image, 'images/people/B.png');
});

test('frontmatter of the wrong shape never throws; the map form is read', () => {
  const b = page('B', 'npc'); const c = page('C', 'npc');
  for (const relationships of ['text', 7, null, [null, 'B', 3, {}, { type: 'knows' }, { target: null, type: 'knows' }, { target: ['B'], type: 'knows' }]]) {
    const a = page('A', 'npc', { relationships });
    assert.doesNotThrow(() => buildConnections(ctx([a, b])).for(a));
  }
  const tone = page('A', 'npc', { relationships: [{ target: 'B', type: 7, tone: 5, description: { x: 1 } }] });
  const item = buildConnections(ctx([tone, b])).for(tone).tabs[0].groups[0].items[0];
  assert.strictEqual(item.tone, 'neutral');
  assert.deepStrictEqual(item.lines, []);
  const mapped = page('A', 'npc', { relationships: { allied_with: ['B', '[[C]]'], serves: 'B' } });
  const m = buildConnections(ctx([mapped, b, c])).for(mapped);
  assert.deepStrictEqual(names(group(m, 'people', 'Allied with')).sort(), ['B', 'C']);
});

test('an index page has no connections', () => {
  const idx = page('index', 'index', { relationships: [{ target: 'B', type: 'knows' }] });
  assert.ok(isEmpty(buildConnections(ctx([idx, page('B', 'npc')])).for(idx)));
});

test('an index page is no item, whether it links the page or the page relates to it', () => {
  const hero = page('Hero', 'pc', { relationships: [{ target: 'Villain', type: 'nemesis' }, { target: 'index', type: 'listed_in' }] });
  const villain = page('Villain', 'npc');
  const idx = page('index', 'wiki', {}, ['Hero', 'Villain']);
  const m = buildConnections(ctx([hero, villain, idx])).for(hero);
  const all = JSON.stringify([...m.tabs.flatMap((t) => t.groups).flatMap((g) => g.items), ...m.mentions.flatMap((g) => g.items)].map((i) => i.title));
  assert.ok(!all.includes('index') && !all.includes('World'), all);
  assert.ok(all.includes('Villain'), 'ordinary relationships are unaffected');
});

test('the model for a page is the same object on a second call', () => {
  const a = page('A', 'npc', { relationships: [{ target: 'B', type: 'knows' }] });
  const index = buildConnections(ctx([a, page('B', 'npc')]));
  assert.strictEqual(index.for(a), index.for(a));
});

test('300 pages each related to one hub build without rescanning every page for every page', () => {
  const hub = page('Hub', 'npc');
  const spokes = [];
  for (let n = 0; n < 300; n += 1) spokes.push(page(`Spoke_${n}`, 'npc', { relationships: [{ target: 'Hub', type: 'knows' }] }, ['Hub']));
  const pages = [hub, ...spokes];
  const started = Date.now();
  const index = buildConnections(ctx(pages));
  for (const p of pages) index.for(p);
  // A per-page rescan of the 300 would take minutes at this size; the bound is generous so a
  // slow CI machine never trips it, and only that regression does.
  assert.ok(Date.now() - started < 20000, 'took ' + (Date.now() - started) + ' ms');
  assert.strictEqual(index.for(hub).tabs[0].groups[0].items.length, 300);
});
