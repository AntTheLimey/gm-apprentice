'use strict';
// tools/publish/test/leaks-cli.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { leakSite, leakInto } = require('./helpers/leak-site');
const { runLeaks, gateFolderFor } = require('../lib/leaks-cli');
const { loadManifest, loadPublishList } = require('../lib/manifest');

const NOTES = {
  '_meta/publish-list.yaml': 'publishing:\n  - NPCs/A.md\n  - NPCs/B.md\n',
  'NPCs/A.md': '---\ntype: npc\n---\nThe baker is a kind man.\n\n## GM Notes\n\nThe baker poisoned the mayor last winter. He keeps the vial in his oven.\n',
  'NPCs/B.md': '---\ntype: npc\n---\nA fisher.\n',
};
const SETTINGS = { player: { folder_map: { NPCs: 'npcs' } } };
const run = async (site, verb, extra = {}) => {
  const out = [];
  const rc = await runLeaks({ verb, configPath: site.configPath, ...extra }, { out: (l) => out.push(String(l)) });
  return { rc, out, text: out.join('\n') };
};
const vaultOf = (site) => path.join(site.root, 'vault');

describe('leaks', () => {
  it('check is clean on a clean build and stops on a leak, listing the id', async () => {
    const site = leakSite(NOTES, SETTINGS);
    try {
      assert.equal((await run(site, 'check')).rc, 0);
      leakInto(site.outputDir, 'npcs/b.html', 'The baker poisoned the mayor last winter.');
      const r = await run(site, 'check');
      assert.equal(r.rc, 1);
      assert.match(r.text, /\[[0-9a-f]{6}\] npcs\/b\.html: "The baker poisoned the mayor last winter\."/);
      assert.match(r.text, /from NPCs\/A\.md \(GM Notes section\)/);
    } finally { site.cleanup(); }
  });

  it('accepted stays accepted; a changed sentence or another page asks again', async () => {
    const site = leakSite(NOTES, SETTINGS);
    try {
      leakInto(site.outputDir, 'npcs/b.html', 'The baker poisoned the mayor last winter.');
      const listed = JSON.parse((await run(site, 'list', { json: true })).out.join(''));
      const id = listed.findings[0].id;
      assert.equal((await run(site, 'accept', { page: 'npcs/b.html', text: id })).rc, 0);
      assert.equal(loadManifest(vaultOf(site), { warn: () => {} }).accepted.length, 1);
      assert.equal((await run(site, 'check')).rc, 0);
      // The same sentence on another page asks again.
      leakInto(site.outputDir, 'npcs/a.html', 'The baker poisoned the mayor last winter.');
      const again = await run(site, 'check');
      assert.equal(again.rc, 1);
      assert.match(again.text, /npcs\/a\.html/);
      assert.doesNotMatch(again.text, /\] npcs\/b\.html/);
    } finally { site.cleanup(); }
  });

  it('a changed sentence in the note asks again, and the old acceptance is no longer needed', async () => {
    const site = leakSite(NOTES, SETTINGS);
    try {
      leakInto(site.outputDir, 'npcs/b.html', 'He keeps the vial in his oven.');
      assert.equal((await run(site, 'accept', { page: 'npcs/b.html', text: 'He keeps the vial in his oven.' })).rc, 0);
      const note = path.join(vaultOf(site), 'NPCs', 'A.md');
      fs.writeFileSync(note, fs.readFileSync(note, 'utf8').replace('in his oven', 'under his bed'));
      leakInto(site.outputDir, 'npcs/b.html', 'He keeps the vial under his bed.');
      const r = await run(site, 'check');
      assert.equal(r.rc, 1);
      assert.match(r.text, /under his bed/);
      assert.match(r.text, /no longer needed: the accepted "he keeps the vial in his oven"/);
      assert.equal((await run(site, 'prune')).rc, 0);
      assert.equal(loadManifest(vaultOf(site), { warn: () => {} }).accepted.length, 0);
    } finally { site.cleanup(); }
  });

  it('accept refuses a page and text that are not a current finding', async () => {
    const site = leakSite(NOTES, SETTINGS);
    try {
      const r = await run(site, 'accept', { page: 'npcs/b.html', text: 'abc123' });
      assert.equal(r.rc, 1);
      assert.match(r.text, /not a finding/);
    } finally { site.cleanup(); }
  });

  it('list with no built folder says there is nothing to check', async () => {
    const site = leakSite(NOTES, SETTINGS);
    try {
      fs.rmSync(site.outputDir, { recursive: true, force: true });
      const r = await run(site, 'list');
      assert.equal(r.rc, 2);
      assert.match(r.text, /no built site/i);
    } finally { site.cleanup(); }
  });

  it('a vault with no publish list can accept: the list is created holding only accepted (amendment 7a)', async () => {
    const { '_meta/publish-list.yaml': dropped, ...noList } = NOTES;
    assert.ok(dropped);
    const site = leakSite(noList, SETTINGS);
    try {
      leakInto(site.outputDir, 'npcs/b.html', 'The baker poisoned the mayor last winter.');
      assert.equal((await run(site, 'check')).rc, 1);
      assert.equal((await run(site, 'accept', { page: 'npcs/b.html', text: 'The baker poisoned the mayor last winter.' })).rc, 0);
      const file = path.join(vaultOf(site), '_meta', 'publish-list.yaml');
      assert.match(fs.readFileSync(file, 'utf8'), /^accepted:/);
      assert.equal(loadManifest(vaultOf(site), { warn: () => {} }), null, 'still no publish list for page decisions');
      assert.equal(loadPublishList(vaultOf(site), { warn: () => {} }).accepted.length, 1);
      assert.equal((await run(site, 'check')).rc, 0);
      assert.equal((await run(site, 'prune')).rc, 0);
      assert.equal(loadManifest(vaultOf(site), { warn: () => {} }), null);
    } finally { site.cleanup(); }
  });

  it('accept on a vault still on the old Markdown list refuses and names the update', async () => {
    const { '_meta/publish-list.yaml': dropped, ...rest } = NOTES;
    assert.ok(dropped);
    const site = leakSite({ ...rest, '_meta/publish-manifest.md': '## Publishing\n\n- [x] NPCs/A.md\n- [x] NPCs/B.md\n' }, SETTINGS);
    try {
      leakInto(site.outputDir, 'npcs/b.html', 'The baker poisoned the mayor last winter.');
      const r = await run(site, 'accept', { page: 'npcs/b.html', text: 'The baker poisoned the mayor last winter.' });
      assert.equal(r.rc, 1);
      assert.match(r.text, /update|manifest convert/);
      assert.ok(!fs.existsSync(path.join(vaultOf(site), '_meta', 'publish-list.yaml')));
    } finally { site.cleanup(); }
  });

  it('gateFolderFor follows the wrangler.toml output folder, else the output folder', () => {
    const site = leakSite(NOTES, SETTINGS);
    try {
      assert.equal(gateFolderFor(site.configPath), fs.realpathSync(site.outputDir));
      const siteRoot = path.dirname(site.configPath);
      fs.writeFileSync(path.join(siteRoot, 'wrangler.toml'), 'name = "x"\npages_build_output_dir = "./elsewhere"\n');
      assert.equal(gateFolderFor(site.configPath), path.join(fs.realpathSync(siteRoot), 'elsewhere'));
    } finally { site.cleanup(); }
  });
});
