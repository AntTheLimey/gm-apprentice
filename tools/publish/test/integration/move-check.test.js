'use strict';
// `props move-check`: the vault alone (no build steps, no kept folder) builds the player site into a temp folder, and
// every page the live site serves under the named folders must still be there with its words.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runMoveCheck } = require('../../lib/props/compare-cli');
const { writeNewConfig } = require('../helpers/settings-files');

const CLI = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');
const PAGE = '<!doctype html><html><head><title>Menu</title></head><body><h1>Dinner</h1><p>Turtle soup, then a saddle of mutton.</p></body></html>';
const NOTE = '---\ntype: prop\nprop_file: menu.html\nprop_address: gazetteer/papers/menu.html\n---\nThe menu from the dinner.\n';

// A vault whose prop note publishes menu.html at gazetteer/papers/menu.html, and a site whose live output holds the
// same page in its kept folder gazetteer/ (put there by hand or by a build step, as before the move).
function liveSite(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'move-check-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vaultDir = path.join(root, 'vault');
  const siteDir = path.join(root, 'campaign');
  const put = (abs, text) => { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, text); };
  put(path.join(vaultDir, 'Documents', 'Menu.md'), NOTE);
  put(path.join(vaultDir, 'Documents', 'menu.html'), PAGE);
  fs.mkdirSync(siteDir);
  writeNewConfig(vaultDir, { version: 1, player_site: { folder: siteDir, title: 'T', folder_map: { Documents: 'documents' }, keep: ['gazetteer'] } });
  const configPath = path.join(siteDir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vaultDir }));
  const out = path.join(siteDir, 'docs');
  put(path.join(out, 'gazetteer', 'papers', 'menu.html'), PAGE);
  put(path.join(out, 'gazetteer', 'cover.css'), 'body{}');
  return { root, vaultDir, siteDir, configPath, out };
}

const quietly = (fn) => {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const lines = [];
  console.log = (...a) => lines.push(a.join(' ')); console.warn = () => {}; console.error = () => {};
  try { return { rc: fn(), lines }; } finally { Object.assign(console, saved); }
};
const snapshot = (dir) => {
  const out = {};
  (function walk(abs, rel) {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(abs, e.name), r); else out[r] = fs.readFileSync(path.join(abs, e.name), 'utf8');
    }
  }(dir, ''));
  return out;
};

test('move-check builds the new site alone', (t) => {
  const s = liveSite(t);
  const before = snapshot(s.siteDir);
  const vaultBefore = snapshot(s.vaultDir);
  const tmpBefore = new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('gm-move-check-')));
  const ok = quietly(() => runMoveCheck({ configPath: s.configPath, serves: ['gazetteer/'], listings: [], expectGone: [] }));
  assert.equal(ok.rc, 0, ok.lines.join('\n'));
  assert.ok(ok.lines.some((l) => /^SAME-WORDS\tgazetteer\/papers\/menu\.html\t/.test(l)), ok.lines.join('\n'));
  // The kept folder's stylesheet is not copied into the new site: the vault alone is built.
  assert.ok(ok.lines.some((l) => /^FILE-DROPPED\tgazetteer\/cover\.css\t/.test(l)), ok.lines.join('\n'));
  // The live site and the vault are untouched, and the temp folder is gone.
  assert.deepEqual(snapshot(s.siteDir), before);
  assert.deepEqual(snapshot(s.vaultDir), vaultBefore);
  const tmpAfter = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('gm-move-check-') && !tmpBefore.has(n));
  assert.deepEqual(tmpAfter, []);

  fs.rmSync(path.join(s.vaultDir, 'Documents', 'Menu.md'));
  const gone = quietly(() => runMoveCheck({ configPath: s.configPath, serves: ['gazetteer/'], listings: [], expectGone: [] }));
  assert.equal(gone.rc, 1);
  assert.ok(gone.lines.some((l) => /^MISSING\tgazetteer\/papers\/menu\.html\t/.test(l)), gone.lines.join('\n'));
  assert.match(gone.lines[gone.lines.length - 1], /blockers: 1$/);
});

test('gm-publish props move-check: the exit code and --json', (t) => {
  const s = liveSite(t);
  const cli = (...extra) => spawnSync(process.execPath, [CLI, 'props', 'move-check', '--config', s.configPath, '--serves', 'gazetteer/', ...extra], { encoding: 'utf8' });
  const ok = cli('--json');
  assert.equal(ok.status, 0, ok.stderr);
  // The build's own lines go to stderr: stdout is the object alone.
  const parsed = JSON.parse(ok.stdout);
  assert.equal(parsed.blockers, 0);
  assert.equal(parsed.rows.find((r) => r.address === 'gazetteer/papers/menu.html').kind, 'same-words');
  fs.writeFileSync(path.join(s.out, 'gazetteer', 'papers', 'extra.html'), PAGE);
  const blocked = cli();
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout, /^MISSING\tgazetteer\/papers\/extra\.html\t/m);
  const none = spawnSync(process.execPath, [CLI, 'props', 'move-check', '--config', s.configPath], { encoding: 'utf8' });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /--serves/);
});

test('move-check runs the leak check on the new build and lists what it finds', (t) => {
  const s = liveSite(t);
  const cli = () => spawnSync(process.execPath, [CLI, 'props', 'move-check', '--config', s.configPath, '--serves', 'gazetteer/', '--json'], { encoding: 'utf8' });
  const clean = cli();
  assert.equal(clean.status, 0, clean.stderr);
  assert.deepEqual(JSON.parse(clean.stdout).leaks, []);
  // A sentence from the menu note's GM Notes, put on the page itself: the note's hidden text on its own prop file.
  fs.writeFileSync(path.join(s.vaultDir, 'Documents', 'Menu.md'),
    `${NOTE.trimEnd()}\n\n## GM Notes\n\nThe fish course hides the poisoned sauce boat.\n`);
  fs.writeFileSync(path.join(s.vaultDir, 'Documents', 'menu.html'), PAGE.replace('</body>', '<p>The fish course hides the poisoned sauce boat.</p></body>'));
  const leaky = cli();
  assert.equal(leaky.status, 0, 'a leak never changes the exit code: the page lost no word');
  const parsed = JSON.parse(leaky.stdout);
  assert.deepEqual(parsed.leaks.map((f) => [f.code, f.page, f.note]), [['HIDDEN_TEXT', 'gazetteer/papers/menu.html', 'Documents/Menu.md']]);
  const text = spawnSync(process.execPath, [CLI, 'props', 'move-check', '--config', s.configPath, '--serves', 'gazetteer/'], { encoding: 'utf8' });
  assert.match(text.stdout, /^LEAK\tgazetteer\/papers\/menu\.html\t"the fish course hides the poisoned sauce boat" from Documents\/Menu\.md/m);
  assert.match(text.stdout, / leaks: 1 blockers: \d+$/m);
});
