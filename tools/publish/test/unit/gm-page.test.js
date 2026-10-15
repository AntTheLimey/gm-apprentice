'use strict';
// tools/publish/test/unit/gm-page.test.js: the GM page post-process and the GM folder's own files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gmPage, hiddenPanel, insideGitWorkTree, writeMarker, gmOutputReason, GM_META_TAG, ROBOTS_META, ROBOTS_TXT, MARKER_FILE } = require('../../lib/gm-site');
const { createMarks } = require('../../lib/gm-marks');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gm-page-')));
const PAGE = '<!DOCTYPE html><html><head><title>Vex</title>\n<link rel="stylesheet" href="../css/style.css">\n</head>'
  + '<body><nav>menu</nav><main class="content" data-x="1"><h1>Vex</h1><p>A clerk.</p></main></body></html>';

test('the head gets noindex, the GM meta tag and gm.css beside style.css, in that order', () => {
  const out = gmPage(PAGE, { marks: createMarks() });
  const head = out.slice(0, out.indexOf('</head>'));
  const at = (s) => head.indexOf(s);
  assert.ok(at(ROBOTS_META) > 0 && at(ROBOTS_META) < at(GM_META_TAG), head);
  assert.ok(at(GM_META_TAG) < at('<link rel="stylesheet" href="../css/gm.css">'), head);
  assert.equal(ROBOTS_META, '<meta name="robots" content="noindex, nofollow">');
});

test('a page at the root and a page with an absolute style.css address each link gm.css beside it', () => {
  assert.match(gmPage(PAGE.replace('../css/style.css', 'css/style.css'), { marks: createMarks() }), /href="css\/gm\.css"/);
  assert.match(gmPage(PAGE.replace('../css/style.css', '/site/css/style.css'), { marks: createMarks() }), /href="\/site\/css\/gm\.css"/);
});

test('the band, the reason and the panel come right after <main>, in that order', () => {
  const out = gmPage(PAGE, { marks: createMarks(), hiddenBecause: 'status: planned', hidden: [{ kind: 'fields', label: 'field: secrets', value: 'Works for the duke.' }] });
  const main = out.indexOf('<main class="content" data-x="1">') + '<main class="content" data-x="1">'.length;
  const band = out.indexOf('<div class="gm-band" role="note">GM copy: not for players</div>');
  const reason = out.indexOf('<div class="gm-band gm-band--hidden gm-mark" data-gm-kind="notes" data-gm-label="Players don\'t see this page: status: planned">Players don\'t see this page: status: planned</div>');
  const panel = out.indexOf('<aside class="gm-hidden">');
  assert.equal(band, main, out);
  assert.ok(reason > band, out);
  assert.ok(panel > reason && panel < out.indexOf('<h1>Vex</h1>'), out);
});

test('no reason and nothing hidden: the band alone', () => {
  const out = gmPage(PAGE, { marks: createMarks() });
  assert.match(out, /class="gm-band" role="note"/);
  assert.doesNotMatch(out, /gm-band--hidden|gm-hidden/);
});

test('a page with no <main> (a redirect) has the band after <body>', () => {
  const out = gmPage('<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=x.html"></head><body><a href="x.html">X</a></body></html>', { marks: createMarks() });
  assert.match(out, /<body><div class="gm-band" role="note">/);
  assert.match(out, new RegExp(GM_META_TAG));
  assert.doesNotMatch(out, /gm\.css/, 'no style.css to put it beside');
});

test('the marks in the page are rendered', () => {
  const marks = createMarks();
  const html = PAGE.replace('A clerk.', `A ${marks.open('fields', 'gm_aliases; players see: Vex')}Hand${marks.close()} clerk.`);
  const out = gmPage(html, { marks });
  assert.match(out, /<span class="gm-mark gm-mark--fields" data-gm-kind="fields" data-gm-label="gm_aliases; players see: Vex">Hand<\/span>/);
  assert.doesNotMatch(out, /[-]/);
});

test('the panel: each value as text, a relationship as type and target, a list joined, the rest as JSON', () => {
  const out = hiddenPanel([
    { kind: 'fields', label: 'field: secrets', value: 'Loves <b>[[Ann|Annie]]</b>' },
    { kind: 'relationships', label: 'GM-only relationship', value: { type: 'rival', target: '[[Ann]]', description: 'old feud' } },
    { kind: 'relationships', label: 'GM-only relationship', value: { type: 'ally', target: 'Bo' } },
    { kind: 'fields', label: 'field: gm_aliases', value: ['The Hand', 'Red'] },
    { kind: 'fields', label: 'field: level', value: 3 },
  ]);
  assert.match(out, /^<aside class="gm-hidden"><h2 class="gm-hidden__title">Hidden from players<\/h2>/);
  assert.match(out, /<\/aside>$/);
  assert.match(out, /<div class="gm-mark gm-mark--fields" data-gm-kind="fields" data-gm-label="field: secrets"><p class="gm-mark__label">GM: field: secrets<\/p><p>Loves &lt;b&gt;Annie&lt;\/b&gt;<\/p><\/div>/);
  assert.match(out, /<p>rival: Ann — old feud<\/p>/);
  assert.match(out, /<p>ally: Bo<\/p>/);
  assert.match(out, /<p>The Hand, Red<\/p>/);
  assert.match(out, /<p>3<\/p>/);
  assert.equal(hiddenPanel([]), '');
  assert.equal(hiddenPanel(undefined), '');
});

test('the panel prints a link to a page the site has as a link, from the page it is on', () => {
  const out = hiddenPanel([
    { kind: 'fields', label: 'field: secrets', value: 'Serves [[Duke Orrin]] and [[Nobody]].' },
    { kind: 'relationships', label: 'GM-only relationship', value: { type: 'serves', target: '[[Duke Orrin]]' } },
  ], { linkMap: { 'Duke Orrin': 'npcs/duke-orrin.html' }, from: 'npcs/vex.html' });
  assert.match(out, /<p>Serves <a href="duke-orrin\.html" class="entity-link">Duke Orrin<\/a> and Nobody\.<\/p>/);
  assert.match(out, /<p>serves: <a href="duke-orrin\.html" class="entity-link">Duke Orrin<\/a><\/p>/);
  assert.doesNotMatch(out, /\[\[/);
});

test('a page gmPage made is one deploy knows as the GM site\'s', () => {
  const { isGmOutput } = require('../../lib/gm-site');
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'other.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'page.html'), PAGE);
  assert.equal(isGmOutput(dir), false);
  fs.writeFileSync(path.join(dir, 'page.html'), gmPage(PAGE, { marks: createMarks() }));
  assert.equal(isGmOutput(dir), true);
  assert.match(gmOutputReason(dir), /did not make/);
});

test('a $ in the page\'s stylesheet address is not expanded as a replacement pattern', () => {
  const html = '<html><head><link rel="stylesheet" href="a$&b/css/style.css"></head><body><main>x</main></body></html>';
  assert.match(gmPage(html, { marks: createMarks() }), /href="a\$&b\/css\/gm\.css"\>\n<\/head>/);
});

test('the marker file: build, tool, time, and a line end', () => {
  const dir = tmp();
  writeMarker(dir, { version: '1.26.0', now: new Date('2026-10-14T12:00:00Z') });
  assert.equal(fs.readFileSync(path.join(dir, MARKER_FILE), 'utf8'), '{"build":"gm","tool":"1.26.0","built":"2026-10-14T12:00:00.000Z"}\n');
  assert.equal(ROBOTS_TXT, 'User-agent: *\nDisallow: /\n');
});

test('inside a git work tree: a .git folder or file above, found without running git', () => {
  const root = tmp();
  const deep = path.join(root, 'a', 'b', 'not-made-yet');
  fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
  assert.equal(insideGitWorkTree(deep), insideGitWorkTree(root));
  fs.writeFileSync(path.join(root, 'a', '.git'), 'gitdir: elsewhere\n');
  assert.equal(insideGitWorkTree(deep), true);
  assert.equal(insideGitWorkTree(path.join(root, 'b')), insideGitWorkTree(root));
});
