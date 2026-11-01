'use strict';
// `props links`: the local files a page or stylesheet names, as the build reads them (props/links.js), for prop_move.py
// to ask rather than keep its own copy of the rule (#521).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');
const run = (...args) => spawnSync(process.execPath, [CLI, 'props', 'links', ...args], { encoding: 'utf8' });

test('props links --json names each file\'s local refs, a data- picture among them', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'props-links-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const page = path.join(dir, 'map.html');
  const css = path.join(dir, 'map.css');
  fs.writeFileSync(page, [
    '<link rel="stylesheet" href="map.css"><img src="assets/plate.jpg">',
    '<div data-full="assets/plate%20big.png" data-label="not a picture" data-x="https://x.org/a.png"></div>',
    '<a href="other.html">a page link is not a file</a><img src="/rooted.png">',
  ].join('\n'));
  fs.writeFileSync(css, 'body { background: url("assets/paper.jpg"); } @import "more.css";');
  const r = run('--json', page, css);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [
    { file: page, refs: ['map.css', 'assets/plate.jpg', 'assets/plate%20big.png'], rooted: ['/rooted.png'] },
    { file: css, refs: ['assets/paper.jpg', 'more.css'], rooted: [] },
  ]);
  const plain = run(page);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /assets\/plate%20big\.png/);
});

test('props links: a file that cannot be read is an error line and exit 1', () => {
  const r = run('--json', path.join(os.tmpdir(), 'no-such-page-props-links.html'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^Error: .*no-such-page-props-links\.html could not be read/);
  const none = run('--json');
  assert.equal(none.status, 1);
  assert.match(none.stderr, /props links needs at least one file/);
});

// An error that is not a file that cannot be read is the tool's own fault: it is thrown with its stack, never passed
// off as a one-line answer.
test('runLinks rethrows an internal error', (t) => {
  const links = require('../../lib/props/links');
  const cli = require('../../lib/props/links-cli');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'props-links-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const page = path.join(dir, 'p.html');
  fs.writeFileSync(page, '<img src="a.png">');
  t.mock.method(links, 'localRefs', () => { throw new TypeError('a bug'); });
  const saved = console.error;
  console.error = () => {};
  try { assert.throws(() => cli.runLinks({ files: [page], json: true }), /a bug/); } finally { console.error = saved; }
});
