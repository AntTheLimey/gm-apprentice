const { describe, it } = require('node:test');
require('../helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../../lib/build');
const { buildVault } = require('../helpers/build-vault');
const { fixtureNames, prepareFixture } = require('../helpers/fixture-build');

// A note the build writes no page for (type: world_flags) is listed nowhere: no output file
// names it, links to it or counts it. Walks every output file, whatever its kind.
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
function filesMentioning(root, re) {
  return walk(root).filter((f) => /\.(html|json|js|xml|txt|css)$/.test(f) && re.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(root, f));
}

describe('a note with no page is listed nowhere', () => {
  it('is in no output file, and a link to it reads as a link to any unpublished note', () => {
    const site = buildVault({
      'Locations/Cellar.md': '---\ntype: location\nlocation_type: Cellar\n---\nA damp cellar. See [[Zzflagsprobe]] and [[Tab]].\n',
      'Locations/Tab.md': '---\ntype: location\nlocation_type: Tavern\nrelationships:\n  - type: near\n    target: "[[Cellar]]"\n---\nA tavern.\n',
      'Locations/Zzflagsprobe.md': '---\ntype: world_flags\nrelationships:\n  - type: near\n    target: "[[Cellar]]"\n  - type: near\n    target: "[[Tab]]"\n---\nThe mayor is ZZSECRETFLAG.\nSee [[Cellar]] and [[Tab]].\n',
    });
    try {
      assert.ok(!site.exists('locations', 'zzflagsprobe.html'));
      assert.deepStrictEqual(filesMentioning(path.join(site.root, 'docs'), /zzflagsprobe\.html|ZZSECRETFLAG|World flags|>Zzflagsprobe</i), []);
      // The link to it prints its name as plain text, as for any unpublished note.
      assert.match(site.read('locations', 'cellar.html'), /See Zzflagsprobe and <a href="tab\.html">Tab<\/a>/);
    } finally { site.cleanup(); }
  });

  it('is in no output file of any fixture vault', () => {
    let checked = 0;
    for (const name of fixtureNames()) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-page-'));
      try {
        const configPath = prepareFixture(name, root);
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const dir = Object.keys(cfg.folderMap)[0];
        if (!dir) continue;
        fs.writeFileSync(path.join(root, 'vault', dir, 'Zzflagsprobe.md'), '---\ntype: world_flags\n---\nZZSECRETFLAG\n');
        const log = console.log; const warn = console.warn;
        console.log = () => {}; console.warn = () => {};
        try { build({ configPath }); } finally { console.log = log; console.warn = warn; }
        assert.deepStrictEqual(filesMentioning(path.join(root, 'docs'), /zzflagsprobe|ZZSECRETFLAG/i), [], name);
        checked++;
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
    assert.ok(checked > 20, `checked ${checked} fixtures`);
  });
});
