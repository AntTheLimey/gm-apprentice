'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderConnections, islandOf, sessionsText } = require('../../lib/templates/connections');

const item = (more = {}) => ({ title: 'Hallam', outputPath: 'npcs/hallam.html', kind: 'NPC', tone: 'warm', lines: ['His secretary.'], own: 1, sessions: { count: 2, first: 'Session 1', last: 'Session 3' }, image: 'images/people/h.png', ...more });
const model = (items = [item()], mentions = []) => ({
  subject: { title: 'Emma', outputPath: 'npcs/emma.html' },
  tabs: items.length ? [{ id: 'people', label: 'People', groups: [{ label: 'Serves', items }] }] : [],
  mentions,
});
const island = (html) => JSON.parse(/<script type="application\/json" class="cx-data">([^]*?)<\/script>/.exec(html)[1]);

test('off and an empty model give nothing', () => {
  assert.strictEqual(renderConnections(model(), { mode: 'off', currentOutputPath: 'npcs/emma.html' }), '');
  assert.strictEqual(renderConnections(model([]), { mode: 'tree', currentOutputPath: 'npcs/emma.html' }), '');
  assert.strictEqual(renderConnections(null, { mode: 'tree', currentOutputPath: 'npcs/emma.html' }), '');
});

test('the built HTML is a plain list: tab, group, item with link, kind, tone, line, sessions', () => {
  const html = renderConnections(model(), { mode: 'web', currentOutputPath: 'npcs/emma.html' });
  assert.match(html, /^<section class="cx" data-cx-mode="web" aria-labelledby="cx-heading">/);
  assert.match(html, /<h2 id="cx-heading">Connections<\/h2>/);
  assert.match(html, /<h3>People<\/h3>\s*<h4>Serves<\/h4>\s*<ul>/);
  assert.match(html, /<li><a href="hallam\.html">Hallam<\/a> <span class="cx-kind">NPC<\/span> <span class="cx-tone cx-warm">warm<\/span><span class="cx-line">His secretary\.<\/span><span class="cx-sess">2 sessions, Session 1 to Session 3<\/span><\/li>/);
});

test('an item with no page is text, not a link', () => {
  const html = renderConnections(model([item({ title: 'the stranger', outputPath: null, kind: '', tone: null, lines: [], sessions: null, image: null, key: 'Vesper_Hale' })]), { mode: 'tree', currentOutputPath: 'npcs/emma.html' });
  assert.match(html, /<li><span class="cx-name">the stranger<\/span><\/li>/);
  assert.ok(!html.includes('Vesper'), 'the key is never written');
});

test('mentions follow as the last block, links only', () => {
  const html = renderConnections(model([], [{ label: 'Sessions', items: [{ title: 'Session 1', outputPath: 'sessions/s1.html', kind: 'Session' }] }]), { mode: 'tree', currentOutputPath: 'npcs/emma.html' });
  assert.match(html, /<h3>Mentions<\/h3>\s*<h4>Sessions<\/h4>\s*<ul class="cx-mentions">\s*<li><a href="\.\.\/sessions\/s1\.html">Session 1<\/a><\/li>/);
});

test('markup in a line is text in the list and cannot close the island', () => {
  const html = renderConnections(model([item({ lines: ['</script><b>x</b> & "q"'] })]), { mode: 'tree', currentOutputPath: 'npcs/emma.html' });
  assert.ok(html.includes('&lt;/script&gt;&lt;b&gt;x&lt;/b&gt; &amp; &quot;q&quot;'));
  assert.strictEqual((html.match(/<\/script>/g) || []).length, 1);
  assert.deepStrictEqual(island(html).t[0].g[0].d[0].l, ['</script><b>x</b> & "q"']);
});

test('the island holds the model, hrefs relative, no key', () => {
  const data = islandOf(model([item(), item({ title: 'X', outputPath: null, key: 'Secret', image: null })]), 'npcs/emma.html');
  assert.deepStrictEqual(data.t[0].g[0].d[0], { t: 'Hallam', h: 'hallam.html', k: 'NPC', o: 'w', l: ['His secretary.'], f: 1, s: [2, 'Session 1', 'Session 3'], i: '../images/people/h.png' });
  assert.ok(!JSON.stringify(data).includes('Secret'));
});

test('every string in the island is in the plain list', () => {
  const html = renderConnections(model([item()], [{ label: 'Places', items: [{ title: 'Docks', outputPath: 'places/docks.html', kind: 'Location' }] }]), { mode: 'cards', currentOutputPath: 'npcs/emma.html' });
  const list = html.slice(0, html.indexOf('<script'));
  const d = island(html).t[0].g[0].d[0];
  for (const s of [d.t, d.k, ...d.l, d.s[1], d.s[2], 'Docks', 'People', 'Serves']) assert.ok(list.includes(s), s);
});

test('a path with a space is percent-encoded', () => {
  const html = renderConnections(model([item({ outputPath: 'npcs/old tom.html' })]), { mode: 'tree', currentOutputPath: 'npcs/emma.html' });
  assert.ok(html.includes('href="old%20tom.html"'));
});

test('the heading level can be h3, for a page that nests the section', () => {
  const html = renderConnections(model(), { mode: 'tree', currentOutputPath: 'a.html', heading: 'h3' });
  assert.match(html, /<h3 id="cx-heading">Connections<\/h3>/);
  assert.match(html, /<h4>People<\/h4>\s*<h5>Serves<\/h5>/);
});

test('sessions text', () => {
  assert.strictEqual(sessionsText(null), '');
  assert.strictEqual(sessionsText({ count: 1, first: 'Session 4', last: 'Session 4' }), '1 session: Session 4');
  assert.strictEqual(sessionsText({ count: 4, first: 'Session 2', last: 'Session 9' }), '4 sessions, Session 2 to Session 9');
});

test('a path holding & or a quote gives a valid, encoded href', () => {
  const html = renderConnections(model([item({ outputPath: 'npcs/a&b "c".html', image: 'images/a&b.png' })]), { mode: 'tree', currentOutputPath: 'npcs/emma.html' });
  assert.ok(html.includes('href="a%26b%20%22c%22.html"'), html);
  assert.ok(!/href="[^"]*[&][^"]*"/.test(html), 'no raw & inside an href');
  assert.strictEqual(island(html).t[0].g[0].d[0].h, 'a%26b%20%22c%22.html');
  assert.strictEqual(island(html).t[0].g[0].d[0].i, '../images/a%26b.png');
});

test('an image path is site-root relative and is made relative to the page', () => {
  const d = islandOf(model(), 'npcs/emma.html').t[0].g[0].d[0];
  assert.strictEqual(d.i, '../images/people/h.png');
  assert.strictEqual(islandOf(model(), 'index.html').t[0].g[0].d[0].i, 'images/people/h.png');
});

test('U+2028, U+2029 and <!-- in an island string round-trip and leave one </script>', () => {
  const lines = ['a\u2028b\u2029c', 'x <!-- y <script> z'];
  const html = renderConnections(model([item({ lines })]), { mode: 'tree', currentOutputPath: 'npcs/emma.html' });
  assert.strictEqual((html.match(/<\/script>/g) || []).length, 1);
  assert.ok(!html.slice(html.indexOf('class="cx-data"')).includes('<!--'));
  assert.deepStrictEqual(island(html).t[0].g[0].d[0].l, lines);
});
