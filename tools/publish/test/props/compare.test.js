'use strict';
// The page-by-page comparison of a live site with what the vault alone builds: no served page goes missing, loses a
// word or loses a link.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { compareSites, pageWords, formatRows } = require('../../lib/props/compare');
const { propBar, withPropBar } = require('../../lib/templates/prop-bar');

const CLI = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');

// Two site folders, old and new, each written from { rel: text }.
function sites(t, oldFiles, newFiles) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'compare-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (dir, files) => {
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    }
  };
  const oldDir = path.join(root, 'old');
  const newDir = path.join(root, 'new');
  fs.mkdirSync(oldDir); fs.mkdirSync(newDir);
  write(oldDir, oldFiles); write(newDir, newFiles);
  return { oldDir, newDir };
}

const page = (body, head = '') => `<!doctype html><html><head><title>T</title>${head}</head><body>${body}</body></html>`;
const LETTER = page('<h1>A letter</h1><p>Meet me at the old mill by the river at midnight.</p>');
const BAR = propBar({ noteHref: '../documents/letter.html', noteTitle: 'The Letter', collectionHref: '../props.html' });
const run = (dirs, opts = {}) => compareSites({ serves: ['props/'], listings: [], expectGone: [], ...dirs, ...opts });
const rowOf = (result, address) => result.rows.find((r) => r.address === address);

test('an identical page is same', (t) => {
  const r = run(sites(t, { 'props/letter.html': LETTER }, { 'props/letter.html': LETTER }));
  assert.equal(rowOf(r, 'props/letter.html').kind, 'same');
  assert.equal(r.blockers, 0);
});

test('a page with only the prop bar added is same-words', (t) => {
  const r = run(sites(t, { 'props/letter.html': LETTER }, { 'props/letter.html': withPropBar(LETTER, BAR) }));
  const row = rowOf(r, 'props/letter.html');
  assert.equal(row.kind, 'same-words');
  assert.equal(row.blocker, false);
  // The bar's own words are not new words of the page.
  assert.doesNotMatch(row.detail, /letter|props/i);
  assert.equal(r.blockers, 0);
});

test('pageWords reads the page as the leak gate does, without the prop bar', () => {
  assert.deepEqual(pageWords('props/letter.html', withPropBar(LETTER, BAR)), pageWords('props/letter.html', LETTER));
  assert.deepEqual(pageWords('a.html', '<p>Don’t   GO</p><img alt="A map">'), ["don't", 'go', 'a', 'map']);
  // Words that only look like the bar stay.
  assert.deepEqual(pageWords('a.html', '<nav class="gma-prop-bar"><a href="x">Back</a></nav>'), ['back']);
});

test('a removed word is words-differ', (t) => {
  const cut = LETTER.replace(' at midnight', '');
  const r = run(sites(t, { 'props/letter.html': LETTER }, { 'props/letter.html': withPropBar(cut, BAR) }));
  const row = rowOf(r, 'props/letter.html');
  assert.equal(row.kind, 'words-differ');
  assert.equal(row.blocker, true);
  assert.match(row.detail, /at midnight/);
  assert.equal(r.blockers, 1);
});

test('an added word is listed, not a blocker', (t) => {
  const more = LETTER.replace('midnight.', 'midnight. Come alone.');
  const row = rowOf(run(sites(t, { 'props/letter.html': LETTER }, { 'props/letter.html': more })), 'props/letter.html');
  assert.equal(row.kind, 'same-words');
  assert.match(row.detail, /come alone/);
});

test('an expected-gone phrase is not a blocker', (t) => {
  const old = page('<p class="crumb">Chapter 1 props</p><p>Meet me at the old mill.</p><p>About this handout</p>');
  const now = page('<p>Meet me at the old mill.</p>');
  const dirs = sites(t, { 'props/letter.html': old }, { 'props/letter.html': now });
  const blocked = run(dirs);
  assert.equal(rowOf(blocked, 'props/letter.html').kind, 'words-differ');
  const r = run(dirs, { expectGone: ['Chapter 1 PROPS', 'About this handout'] });
  const row = rowOf(r, 'props/letter.html');
  assert.equal(row.kind, 'same-words');
  assert.match(row.detail, /chapter 1 props/);
  assert.equal(r.blockers, 0);
  // Only a whole expected phrase: part of one, with another word gone, still blocks.
  const partly = run(sites(t, { 'props/letter.html': old }, { 'props/letter.html': page('<p>Meet me at the mill.</p>') }), { expectGone: ['Chapter 1 props', 'About this handout'] });
  assert.equal(rowOf(partly, 'props/letter.html').kind, 'words-differ');
});

test('a missing served page blocks', (t) => {
  const r = run(sites(t, { 'props/letter.html': LETTER, 'index.html': page('<p>Home</p>') }, { 'index.html': page('<p>Home</p>') }));
  const row = rowOf(r, 'props/letter.html');
  assert.equal(row.kind, 'missing');
  assert.equal(row.blocker, true);
  assert.equal(r.blockers, 1);
  // A page outside the served set is not a served page.
  assert.equal(rowOf(r, 'index.html'), undefined);
});

const shelf = (links) => page(`<h1>The papers</h1><ul>${links.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('')}</ul>`);
const PAPERS = { 'gazetteer/papers/menu.html': page('<p>Soup</p>'), 'gazetteer/papers/bill.html': page('<p>Bill</p>'), 'gazetteer/papers/card.html': page('<p>Card</p>') };

test('a listing keeps its links', (t) => {
  const old = shelf([['papers/menu.html', 'The menu'], ['./papers/bill.html?x=1', 'A bill'], ['papers/card.html#top', 'A card']]);
  const kept = shelf([['/gazetteer/papers/menu.html', 'Dinner menu'], ['papers/bill.html', 'Tailor’s bill'], ['papers/card.html', 'Calling card']]);
  const opts = { serves: ['gazetteer/'], listings: ['gazetteer/'] };
  const ok = run(sites(t, { 'gazetteer/index.html': old, ...PAPERS }, { 'gazetteer/index.html': kept, ...PAPERS }), opts);
  const row = rowOf(ok, 'gazetteer/index.html');
  assert.equal(row.kind, 'listing-ok');
  assert.equal(row.blocker, false);
  assert.equal(ok.blockers, 0);

  const dropped = shelf([['papers/menu.html', 'Dinner menu'], ['papers/bill.html', 'Tailor’s bill']]);
  const lost = run(sites(t, { 'gazetteer/index.html': old, ...PAPERS }, { 'gazetteer/index.html': dropped, ...PAPERS }), opts);
  const lostRow = rowOf(lost, 'gazetteer/index.html');
  assert.equal(lostRow.kind, 'listing-lost');
  assert.equal(lostRow.blocker, true);
  assert.match(lostRow.detail, /gazetteer\/papers\/card\.html/);
  assert.doesNotMatch(lostRow.detail, /menu|bill/);
  assert.equal(lost.blockers, 1);
});

test('a lost link into the served set blocks', (t) => {
  const old = { 'index.html': page('<div class="banner"><a href="gazetteer/">The Gazetteer</a></div>'), 'gazetteer/index.html': page('<p>Cover</p>') };
  const opts = { serves: ['gazetteer/'] };
  const ok = run(sites(t, old, { 'index.html': page('<a href="gazetteer/index.html">Read the Gazetteer</a>'), 'gazetteer/index.html': page('<p>Cover</p>') }), opts);
  assert.equal(ok.rows.filter((r) => r.kind === 'link-lost').length, 0);
  assert.equal(ok.blockers, 0);

  const lost = run(sites(t, old, { 'index.html': page('<p>Welcome</p>'), 'gazetteer/index.html': page('<p>Cover</p>') }), opts);
  const row = rowOf(lost, 'index.html');
  assert.equal(row.kind, 'link-lost');
  assert.equal(row.blocker, true);
  assert.match(row.detail, /gazetteer\/index\.html/);
  assert.equal(lost.blockers, 1);
});

test('a page outside the served set that is gone is reported, not blocking', (t) => {
  const r = run(sites(t, { 'old.html': page('<a href="props/letter.html">Letter</a>'), 'props/letter.html': LETTER }, { 'props/letter.html': LETTER }));
  const row = rowOf(r, 'old.html');
  assert.equal(row.kind, 'file-dropped');
  assert.equal(row.blocker, false);
  assert.equal(r.blockers, 0);
});

test('a dropped stylesheet is reported, not blocking', (t) => {
  const old = { 'props/letter.html': page('<p>Meet me at the old mill.</p>', '<link rel="stylesheet" href="props.css">'), 'props/props.css': 'body{color:red}', 'props/paper.jpg': 'JPEG' };
  const now = { 'props/letter.html': page('<p>Meet me at the old mill.</p>', '<link rel="stylesheet" href="../styles/letter.css">'), 'props/paper.jpg': 'JPEG2' };
  const r = run(sites(t, old, now));
  const css = rowOf(r, 'props/props.css');
  assert.equal(css.kind, 'file-dropped');
  assert.equal(css.blocker, false);
  const jpg = rowOf(r, 'props/paper.jpg');
  assert.equal(jpg.kind, 'file-differs');
  assert.equal(jpg.blocker, false);
  assert.equal(rowOf(r, 'props/letter.html').kind, 'same-words');
  assert.equal(r.blockers, 0);
});

test('a dropped file a new page still links blocks', (t) => {
  const linking = page('<p>Meet me at the old mill.</p><img src="paper.jpg">');
  const r = run(sites(t, { 'props/letter.html': linking, 'props/paper.jpg': 'JPEG' }, { 'props/letter.html': linking }));
  const row = rowOf(r, 'props/paper.jpg');
  assert.equal(row.kind, 'file-dropped');
  assert.equal(row.blocker, true);
  assert.match(row.detail, /props\/letter\.html/);
});

test('the text rows and the summary line', (t) => {
  const r = run(sites(t, { 'props/letter.html': LETTER, 'props/gone.html': LETTER }, { 'props/letter.html': LETTER }));
  const lines = formatRows(r);
  assert.ok(lines.includes('SAME\tprops/letter.html\t'));
  assert.ok(lines.some((l) => l.startsWith('MISSING\tprops/gone.html\t')));
  assert.equal(lines[lines.length - 1], '# served: 2 pages: 2 same: 1 blockers: 1');
});

test('props compare exits 1 on a blocker, 0 without, and --json gives the object', (t) => {
  const dirs = sites(t, { 'props/letter.html': LETTER, 'props/gone.html': LETTER }, { 'props/letter.html': LETTER });
  const cli = (...extra) => spawnSync(process.execPath, [CLI, 'props', 'compare', '--old', dirs.oldDir, '--new', dirs.newDir, '--serves', 'props/', ...extra], { encoding: 'utf8' });
  const blocked = cli();
  assert.equal(blocked.status, 1, blocked.stderr);
  assert.match(blocked.stdout, /^MISSING\tprops\/gone\.html/m);
  assert.match(blocked.stdout, /# served: 2 pages: 2 same: 1 blockers: 1\n$/);
  const json = cli('--json');
  assert.equal(json.status, 1);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.blockers, 1);
  assert.equal(parsed.rows.find((r) => r.address === 'props/gone.html').kind, 'missing');
  fs.rmSync(path.join(dirs.oldDir, 'props', 'gone.html'));
  assert.equal(cli().status, 0);
  const bad = spawnSync(process.execPath, [CLI, 'props', 'compare', '--old', dirs.oldDir, '--serves', 'props/'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--new/);
});

test('a listing that is gone loses its links; one that linked nothing served is no blocker', (t) => {
  const opts = { serves: ['gazetteer/'], listings: ['gazetteer/index.html'] };
  const lost = run(sites(t, { 'gazetteer/index.html': shelf([['papers/menu.html', 'Menu']]), ...PAPERS }, PAPERS), opts);
  assert.equal(rowOf(lost, 'gazetteer/index.html').kind, 'listing-lost');
  assert.match(rowOf(lost, 'gazetteer/index.html').detail, /gone.*gazetteer\/papers\/menu\.html/);
  const empty = run(sites(t, { 'gazetteer/index.html': shelf([['https://example.com/', 'Elsewhere']]) }, {}), opts);
  assert.equal(rowOf(empty, 'gazetteer/index.html').kind, 'listing-ok');
  assert.equal(empty.blockers, 0);
});

test('a served folder or a listing the old site does not have is an error', (t) => {
  const dirs = sites(t, { 'gazetteer/a.html': LETTER }, { 'gazetteer/a.html': LETTER });
  assert.throws(() => run(dirs, { serves: ['gazeteer/'] }), /--serves gazeteer\/ matches nothing in the old site/);
  assert.throws(() => run(dirs, { serves: ['gazetteer/'], listings: ['gazetteer/index.html'] }), /--listing gazetteer\/index\.html is not in the old site/);
  const cli = spawnSync(process.execPath, [CLI, 'props', 'compare', '--old', dirs.oldDir, '--new', dirs.newDir, '--serves', 'gazeteer/'], { encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /gazeteer\//);
  assert.equal(cli.stdout, '');
});

test('a link to a served folder without its slash is a link into it', (t) => {
  const opts = { serves: ['gazetteer/'] };
  const cover = { 'gazetteer/index.html': page('<p>Cover</p>') };
  for (const href of ['gazetteer', '/gazetteer']) {
    const old = { 'index.html': page(`<a href="${href}">The Gazetteer</a>`), ...cover };
    const kept = run(sites(t, old, { 'index.html': page('<a href="gazetteer/">Gazetteer</a>'), ...cover }), opts);
    assert.equal(kept.blockers, 0, href);
    const lost = run(sites(t, old, { 'index.html': page('<p>Welcome</p>'), ...cover }), opts);
    const row = rowOf(lost, 'index.html');
    assert.equal(row && row.kind, 'link-lost', href);
    assert.match(row.detail, /gazetteer\/index\.html/);
  }
  // A folder of the old site that is not served reads the same way: a listing's link to papers is a link to papers/.
  const old = { 'gazetteer/index.html': shelf([['papers', 'All papers']]), 'gazetteer/papers/index.html': page('<p>Papers</p>') };
  const lost = run(sites(t, old, { 'gazetteer/index.html': shelf([]), 'gazetteer/papers/index.html': page('<p>Papers</p>') }), { serves: ['gazetteer/'], listings: ['gazetteer/'] });
  assert.equal(rowOf(lost, 'gazetteer/index.html').kind, 'listing-lost');
  assert.match(rowOf(lost, 'gazetteer/index.html').detail, /gazetteer\/papers\/index\.html/);
});

test('a link inside a comment or a script is not a kept link', (t) => {
  const opts = { serves: ['gazetteer/'], listings: ['gazetteer/'] };
  const old = shelf([['papers/menu.html', 'The menu'], ['papers/bill.html', 'A bill']]);
  for (const hidden of ['<!-- <a href="papers/bill.html">A bill</a> -->', '<script>const s = \'<a href="papers/bill.html">x</a>\';</script>', '<!-- unclosed <a href="papers/bill.html">A bill</a>']) {
    const now = page(`<a href="papers/menu.html">Menu</a>${hidden}`);
    const r = run(sites(t, { 'gazetteer/index.html': old, ...PAPERS }, { 'gazetteer/index.html': now, ...PAPERS }), opts);
    const row = rowOf(r, 'gazetteer/index.html');
    assert.equal(row.kind, 'listing-lost', hidden);
    assert.match(row.detail, /gazetteer\/papers\/bill\.html/);
  }
});
