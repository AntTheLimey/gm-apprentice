'use strict';
// Every fixture vault, built once, and three claims made over the same builds:
//   - a note with no page (type: world_flags) is in no output file (L1 of "a note with no page is listed nowhere"),
//   - every card string occurs in its own built page (link previews),
//   - every search entry names a built file (L2).
// Each fixture gets a probe note of that kind dropped into its first mapped folder, so one build serves all three.
const { describe, it, before, after } = require('node:test');
require('../helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../../lib/build');
const { fixtureNames, prepareFixture } = require('../helpers/fixture-build');
const { pageText, cardProblems } = require('../helpers/card-subset');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
function filesMentioning(root, re) {
  return walk(root).filter((f) => /\.(html|json|js|xml|txt|css)$/.test(f) && re.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(root, f));
}

const built = [];   // { name, root, probed }

describe('every fixture vault, built once', () => {
  before(() => {
    for (const name of fixtureNames()) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-sweep-'));
      const configPath = prepareFixture(name, root);
      const dir = Object.keys(JSON.parse(fs.readFileSync(configPath, 'utf8')).folderMap)[0];
      if (dir) fs.writeFileSync(path.join(root, 'vault', dir, 'Zzflagsprobe.md'), '---\ntype: world_flags\n---\nZZSECRETFLAG\n');
      const log = console.log; const warn = console.warn;
      console.log = () => {}; console.warn = () => {};
      try { build({ configPath }); } catch (e) {
        assert.fail(`fixture ${name} no longer builds (${e.message})`);
      } finally { console.log = log; console.warn = warn; }
      built.push({ name, root, probed: !!dir });
    }
  });
  after(() => { for (const b of built) fs.rmSync(b.root, { recursive: true, force: true }); });

  it('a note with no page is in no output file of any fixture vault', () => {
    const probed = built.filter((b) => b.probed);
    for (const b of probed) assert.deepStrictEqual(filesMentioning(path.join(b.root, 'docs'), /zzflagsprobe|ZZSECRETFLAG/i), [], b.name);
    assert.ok(probed.length > 20, `checked ${probed.length} fixtures`);
  });

  it('every card string occurs in its own built page, on every fixture vault that builds', () => {
    const failures = [];
    let checked = 0;
    for (const { name, root } of built) {
      const cards = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'previews.json'), 'utf8'));
      for (const [rel, card] of Object.entries(cards)) {
        // Every key names a file the build wrote.
        if (!fs.existsSync(path.join(root, 'docs', ...rel.split('/')))) failures.push(`${name}/${rel}: a card with no page`);
        const html = fs.readFileSync(path.join(root, 'docs', ...rel.split('/')), 'utf8');
        const { problems } = cardProblems(card, pageText(html));
        for (const pr of problems) failures.push(`${name}/${rel}: ${pr}`);
        checked++;
      }
    }
    assert.deepStrictEqual(failures, []);
    assert.ok(checked > 60, `checked ${checked} cards`);
  });

  it('the search index names a built file in every entry, on every fixture vault', () => {
    const failures = [];
    let checked = 0;
    for (const { name, root } of built) {
      const indexFile = path.join(root, 'docs', 'search-index.json');
      if (!fs.existsSync(indexFile)) continue;
      for (const doc of Object.values(JSON.parse(fs.readFileSync(indexFile, 'utf8')).documents)) {
        checked++;
        if (!fs.existsSync(path.join(root, 'docs', ...doc.href.split('/')))) failures.push(`${name}: ${doc.href}`);
      }
    }
    assert.deepStrictEqual(failures, []);
    assert.ok(checked > 60, `checked ${checked} entries`);
  });
});
