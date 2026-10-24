const { describe, it, before, after } = require('node:test');
require('../helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');
const { writePublishList } = require('../helpers/publish-list');

// Scenes and session Plans are prep by type: the publish list cannot put them on the player site,
// and the build says so for each one it was asked to list.
describe('build: a prep-type note on the publish list', () => {
  let work;
  let warnings;
  let docs;

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-prep-types-'));
    const vault = path.join(work, 'vault');
    const write = (rel, body) => {
      const full = path.join(vault, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    };
    write('Locations/Tavern.md', '---\ntype: location\n---\n\nA tavern.\n');
    write('Locations/Docks Scene.md', '---\ntype: scene\nstatus: played\n---\n\nThe docks.\n');
    write('Locations/Plan.md', '---\ntype: session-plan\n---\n\nThe plan.\n');
    writePublishList(vault, { publishing: ['Locations/Tavern.md', 'Locations/Docks Scene.md', 'Locations/Plan.md'] });
    const configPath = path.join(work, 'vault.config.json');
    docs = path.join(work, 'docs');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Prep', siteUrl: 'https://example.github.io/prep', vaultPath: vault, outputDir: docs,
      excludeDirs: ['_meta', '_Templates'], folderMap: { Locations: 'locations' },
    }, null, 2));
    warnings = [];
    const saved = { log: console.log, warn: console.warn };
    console.log = () => {};
    console.warn = (...a) => warnings.push(a.join(' '));
    try { build({ configPath }); } finally { Object.assign(console, saved); }
  });

  after(() => { fs.rmSync(work, { recursive: true, force: true }); });

  it('warns once for each listed prep note', () => {
    assert.ok(warnings.some((w) => w.includes('prep note on the publish list: Locations/Docks Scene.md never publishes')), warnings.join('\n'));
    assert.ok(warnings.some((w) => w.includes('prep note on the publish list: Locations/Plan.md never publishes')), warnings.join('\n'));
    assert.ok(!warnings.some((w) => w.includes('Tavern')));
  });

  it('keeps them off the site and publishes the rest', () => {
    const all = fs.readdirSync(path.join(docs, 'locations'));
    assert.ok(all.includes('tavern.html'), all.join(','));
    assert.ok(!all.some((f) => /docks|plan/.test(f)), all.join(','));
  });
});
