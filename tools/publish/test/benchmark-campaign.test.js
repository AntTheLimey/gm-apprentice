'use strict';
// The benchmark campaign (tests/benchmark-campaign, The Ashford Case) feeds the theme showcase and the skill
// benchmarks. It must be a vault the site audit accepts: every wikilink on a published page resolves, except the
// ones planted on purpose for campaign-qa to find (#496).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..', '..');
const BENCH = path.join(REPO, 'tests', 'benchmark-campaign');
const CLI = path.join(__dirname, '..', 'bin', 'gm-publish.js');

// Expected: `[[Dr. Marsh]]` is a planted broken link (commit 4acfb023); the rest are fixture state kept stable: stale
// session titles in the chapter overview, and two NPCs from the-midwife fixture who have no note.
const PLANTED = [
  'Adventures/The Darkened Pier.md: [[Martha Hale]]',
  'Adventures/The Darkened Pier.md: [[Silas Marsh]]',
  'Chapters/Chapter 1/Sessions/Session 02 - The Docks at Night - Play Notes.md: [[Dr. Marsh]]',
  'Chapters/Chapter 1/chapter-overview.md: [[Session 1 - The Missing Professor]]',
  'Chapters/Chapter 1/chapter-overview.md: [[Session 2 - The Docks at Night]]',
  'Chapters/Chapter 1/chapter-overview.md: [[Session 3 - The Inner Sanctum]]',
];

test('the benchmark campaign has no unresolved wikilinks but the planted ones', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-links-'));
  try {
    const config = path.join(work, 'vault.config.json');
    fs.writeFileSync(config, JSON.stringify({ vaultPath: BENCH }));
    const run = spawnSync(process.execPath, [CLI, 'doctor', '--site', '--config', config, '--json'], { encoding: 'utf8' });
    const report = JSON.parse(run.stdout);
    assert.strictEqual(report.counts.errors, 0, run.stdout);
    const unresolved = report.findings.filter((f) => f.code === 'LINK_UNRESOLVED')
      .map((f) => `${f.path}: ${/^(\[\[[^\]]*\]\])/.exec(f.detail)[1]}`).sort();
    assert.deepStrictEqual(unresolved, [...PLANTED].sort());
    assert.deepStrictEqual(report.findings.filter((f) => f.code !== 'LINK_UNRESOLVED'), [],
      'the audit finds nothing else, so a publish list and a layout the tool reads are in place');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('the benchmark campaign has a publish list', () => {
  assert.ok(fs.existsSync(path.join(BENCH, '_meta', 'publish-list.yaml')));
});

test('the theme showcase builds from it with no warnings and working links', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-showcase-'));
  try {
    const run = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'build-theme-showcase.mjs'), '--out', out], { encoding: 'utf8' });
    assert.strictEqual(run.status, 0, run.stderr);
    // The script exits 1 on any build warning outside its allowed list, so status 0 means a clean build.
    for (const preset of ['fantasy', 'horror', 'military', 'noir', 'scifi']) {
      assert.ok(fs.existsSync(path.join(out, preset, 'index.html')), preset);
    }
    for (const preset of ['fantasy', 'horror', 'military', 'noir', 'scifi']) {
      assert.ok(fs.readFileSync(path.join(out, preset, 'index.html'), 'utf8').includes(`css/themes/${preset}.css`), `${preset} page carries its theme`);
    }
    const page = fs.readFileSync(path.join(out, 'horror', 'characters', 'npcs', 'professor-ashford.html'), 'utf8');
    assert.ok(page.includes('href="brother-ezra.html"'), 'Professor Ashford links to Brother Ezra');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
