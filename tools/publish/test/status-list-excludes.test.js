const { describe, it, after } = require('node:test');
require('./helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { build } = require('../lib/build');
const { runExplain } = require('../lib/explain-cli');
const { runSiteDoctor } = require('../lib/site-doctor');
const { shapeFrontmatter } = require('../lib/frontmatter-shape');

const made = [];
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

// A site over a small vault with no manifest. Folders are mapped to themselves, lower-cased.
function site(files, { mode = 'player', extra = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-findings-'));
  made.push(root);
  const vault = path.join(root, 'vault');
  const folders = new Set();
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
    if (rel.includes('/')) folders.add(path.dirname(rel));
  }
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'),
    `---\npublish:\n  mode: ${mode}\n${extra}  folder_map:\n${[...folders].map((f) => `    ${f}: ${f.toLowerCase()}\n`).join('')}---\n`);
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: './docs', attachmentsDir: '_attachments', siteTitle: 'T', excludeDirs: ['_meta', '_Templates'] }));
  return { root, vault, configPath };
}

function quietBuild(configPath) {
  const said = [];
  let faults = null;
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = (...a) => said.push(a.join(' '));
  console.error = (...a) => said.push(a.join(' '));
  try { build({ configPath, onNoteFaults: (f) => { faults = f; } }); } finally { Object.assign(console, saved); }
  return { said, faults };
}

describe('a list in a field that can keep a note off the site', () => {
  it('status: a value that excludes is taken alone, and the warning says which', () => {
    const got = shapeFrontmatter({ type: 'npc', status: ['alive', 'Planned'] });
    assert.strictEqual(got.frontmatter.status, 'Planned');
    assert.deepStrictEqual(got.wrong, [{ field: 'status', problem: 'is a list where one value is expected; it holds "Planned", which keeps a note off a player site, so it is read as "Planned"' }]);
    assert.strictEqual(shapeFrontmatter({ status: ['x', 'planned'] }).frontmatter.status, 'planned');
    assert.strictEqual(shapeFrontmatter({ status: [['prepped'], 'alive'] }).frontmatter.status, 'prepped');
  });
  it('canon_status and its older names: DRAFT is taken alone', () => {
    for (const field of ['canon_status', 'source_confidence', 'confidence']) {
      assert.strictEqual(shapeFrontmatter({ [field]: ['AUTHORITATIVE', 'DRAFT'] }).frontmatter[field], 'DRAFT', field);
    }
  });
  it('type: a kind of note that gets no page is taken alone', () => {
    assert.strictEqual(shapeFrontmatter({ type: ['npc', 'world_flags'] }).frontmatter.type, 'world_flags');
  });
  it('a list with no such value reads joined, as before', () => {
    const got = shapeFrontmatter({ status: ['alive', 'well'], canon_status: ['STUB', 'draft-ish'] });
    assert.strictEqual(got.frontmatter.status, 'alive, well');
    assert.strictEqual(got.frontmatter.canon_status, 'STUB, draft-ish');
    assert.match(got.wrong[0].problem, /it is read as "alive, well"/);
  });

  it('a player build with no manifest keeps every such note off the site', () => {
    const npc = (lines) => `---\ntype: npc\n${lines}\n---\n\nBody.\n`;
    const { configPath, root } = site({
      'People/Listed_Status.md': npc('status: [planned, alive]'),
      'People/Listed_Canon.md': npc('canon_status: [AUTHORITATIVE, DRAFT]'),
      'People/Listed_Source.md': npc('source: [table, prep]'),
      'People/Listed_Flags.md': '---\ntype: [npc, world_flags]\n---\n\nBody.\n',
      'Scenes/Listed_Dropped.md': '---\ntype: scene\nstatus: [played, dropped]\n---\n\nBody.\n',
      'People/Plain_List.md': npc('status: [alive, well]'),
      'People/Fine.md': npc('status: alive'),
    }, { extra: '  exclude_drafts: true\n' });
    const { said } = quietBuild(configPath);
    const built = (dir, name) => fs.existsSync(path.join(root, 'docs', dir, name));
    for (const name of ['listed-status.html', 'listed-canon.html', 'listed-source.html', 'listed-flags.html']) {
      assert.ok(!built('people', name), `${name} was published`);
    }
    assert.ok(!built('scenes', 'listed-dropped.html'), 'the dropped scene was published');
    assert.ok(built('people', 'plain-list.html') && built('people', 'fine.html'));
    assert.ok(said.some((l) => /Listed_Status\.md — status: is a list where one value is expected; it holds "planned", which keeps a note off a player site/.test(l)), said.join('\n'));
  });
});
