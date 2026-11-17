// The plugin's own working folders (#680): the Midwife's drafts, QA reports and the ingest inbox are hidden folders on
// every site, whatever the vault's own player_site.hide.folders holds. A Midwife workspace holds the whole design (the
// villain, the twist, the clock), so no build publishes it and no publish list asks about its files one by one.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { withWorkspaceDirs, isWorkspaceDir, WORKSPACE_DIRS } = require('../lib/excluding-values');
const { writeSettings, mergeSettings } = require('./helpers/vault-files');

const CLI = path.join(__dirname, '..', 'bin', 'gm-publish.js');
const SECRETS = ['Zebrawyrm', 'Quokkapriest', 'Xenoclock', 'Vexillary', 'Jacquard'];

function write(root, rel, body) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}
const cli = (args, cwd) => execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

describe('the working folders are added to any hide.folders list', () => {
  it('adds each one the list lacks, and keeps the GM\'s own spelling of one it has', () => {
    assert.deepStrictEqual(withWorkspaceDirs(['_meta', '_Templates']), ['_meta', '_Templates', ...WORKSPACE_DIRS]);
    assert.deepStrictEqual(withWorkspaceDirs(['_qa', 'Secrets', '_MIDWIFE']), ['_qa', 'Secrets', '_MIDWIFE', '_inbox']);
    assert.deepStrictEqual(withWorkspaceDirs(undefined), WORKSPACE_DIRS);
  });

  it('knows a working folder by its top folder alone, in any capitals', () => {
    assert.ok(isWorkspaceDir('_midwife'));
    assert.ok(isWorkspaceDir('_Midwife/long-tide/npcs'));
    assert.ok(isWorkspaceDir('_qa'));
    assert.ok(!isWorkspaceDir('Chapters/_midwife'));
    assert.ok(!isWorkspaceDir('_midwifery'));
    assert.ok(!isWorkspaceDir('_archive'));
  });
});

describe('a vault that owns its hide.folders list, with a Midwife workspace', () => {
  let root; let vault; let site; let config;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-dirs-'));
    vault = path.join(root, 'V');
    site = path.join(root, 'site');
    write(vault, 'Locations/The Inn.md', '---\ntype: location\ncanon_status: AUTHORITATIVE\nname: "The Inn"\n---\n\n## Description\n\nA warm taproom.\n');
    write(vault, '_midwife/index.md', '# Adventures\n\nThe keeper wrecks ships for the Zebrawyrm.\n');
    write(vault, '_midwife/long-tide/npcs/the-keeper.md', '# The keeper\n\nShe is the Quokkapriest.\n');
    // A typed sketch: with the folder unhidden, the publish list asked about it as a campaign note.
    write(vault, '_midwife/long-tide/entity-sketches/The Clock.md', '---\ntype: npc\ncanon_status: AUTHORITATIVE\nname: "The Clock"\n---\n\nThe Xenoclock runs three nights.\n');
    write(vault, '_QA/QA_full_2026-11-16.md', '# QA\n\nThe Vexillary contradiction.\n');
    write(vault, '_inbox/old-notes.md', '# Raw\n\nThe Jacquard cipher.\n');
    cli(['init', site, '--vault', vault, '--title', 'Workspace Test']);
    fs.rmSync(path.join(site, 'package.json'));
    // The vault's own list, as `init` writes it and as most vaults hold it: without the working folders.
    writeSettings(vault, { 'player_site.title': 'Workspace Test', 'player_site.hide.folders': ['_meta', '_Templates'],
      'player_site.folder_map': { Locations: 'locations', _midwife: 'drafts' } });
    config = path.join(site, 'vault.config.json');
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it('the publish list asks about none of its files', () => {
    const diff = JSON.parse(cli(['manifest', 'diff', '--config', config, '--json']));
    const paths = diff.new.map((r) => r.path);
    assert.deepStrictEqual(paths.filter((p) => /^_(midwife|QA|inbox)\//.test(p)), []);
    assert.ok(paths.includes('Locations/The Inn.md'), paths.join(', '));
  });

  it('explain says why, and names no setting the GM could change', () => {
    for (const rel of ['_midwife/index.md', '_midwife/long-tide/entity-sketches/The Clock.md', '_QA/QA_full_2026-11-16.md', '_inbox/old-notes.md']) {
      const said = cli(['explain', rel, '--config', config]);
      const folder = rel.split('/')[0];
      assert.ok(said.includes(`VERDICT: does not publish — in ${folder}/ — the plugin's own working notes, never published (DIR_CONFIG_EXCLUDED)`), `${rel}: ${said}`);
      assert.doesNotMatch(said, /player_site\.hide\.folders|hide:\s*\n?\s*folders/, rel);
    }
  });

  it('the publish list refuses to list one under Publishing, and writes nothing', () => {
    const r = spawnSync('node', [CLI, 'manifest', 'apply', '--config', config, '--publish', '_midwife/index.md'], { encoding: 'utf8' });
    assert.notStrictEqual(r.status, 0, r.stdout);
    assert.match(r.stdout + r.stderr, /_midwife\/index\.md is in the plugin's own working notes, which are never published/);
    assert.ok(!fs.existsSync(path.join(vault, '_meta', 'publish-list.yaml')));
  });

  it('no build puts a word of it on the site, with no publish list at all', () => {
    cli(['build'], site);
    const docs = path.join(site, 'docs');
    const files = fs.readdirSync(docs, { recursive: true }).map((f) => path.join(docs, f)).filter((f) => fs.statSync(f).isFile());
    assert.ok(files.some((f) => f.endsWith(path.join('locations', 'the-inn.html'))), 'the ordinary page is built');
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      assert.deepStrictEqual(SECRETS.filter((w) => text.includes(w)), [], path.relative(docs, file));
    }
    assert.ok(!files.some((f) => /drafts|midwife/i.test(path.relative(docs, f))), 'no page from the workspace');
  });

  it('the GM site shows none of it either, and its build asks nothing about those folders', () => {
    const gmSite = path.join(root, 'site-gm');
    mergeSettings(vault, { 'gm_site.publish': true, 'gm_site.folder': gmSite });
    const said = cli(['build', '--site', 'gm'], site);
    assert.doesNotMatch(said, /_midwife|_QA|_inbox/);
    const files = fs.readdirSync(gmSite, { recursive: true }).map((f) => path.join(gmSite, f)).filter((f) => fs.statSync(f).isFile());
    assert.ok(files.some((f) => f.endsWith(path.join('locations', 'the-inn.html'))), 'the ordinary page is built');
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      assert.deepStrictEqual(SECRETS.filter((w) => text.includes(w)), [], path.relative(gmSite, file));
    }
  });
});
