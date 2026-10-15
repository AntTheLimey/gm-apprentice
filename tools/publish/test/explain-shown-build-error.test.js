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
function site(files, { extra = '' } = {}) {
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
    `---\npublish:\n${extra}  folder_map:\n${[...folders].map((f) => `    ${f}: ${f.toLowerCase()}\n`).join('')}---\n`);
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

describe('explain --shown when the site cannot be built in memory', () => {
  const buildModule = require('../lib/build');
  const failing = async (fn) => {
    const real = buildModule.build;
    buildModule.build = () => { throw new Error('the theme could not be read\nmore detail'); };
    try { return await fn(); } finally { buildModule.build = real; }
  };
  const note = { 'People/Vesper.md': '---\ntype: npc\n---\n\nA ferryman.\n\n## GM Notes\n\nHidden.\n' };

  it('says it could not read the page, with the error, and exits non-zero', async () => {
    const { configPath } = site(note);
    const out = [];
    const rc = await failing(() => runExplain({ configPath, target: 'People/Vesper.md', shown: true }, { out: (l) => out.push(String(l)) }));
    assert.strictEqual(rc, 1);
    const text = out.join('\n');
    assert.match(text, /what the site holds of this note: could not be read — the site could not be built in memory: the theme could not be read$/m);
    // It must not read as "the build makes no page of this note".
    assert.ok(!/can build no page|body as published|A ferryman/.test(text), text);
  });
  it('--json carries the error in place of a view', async () => {
    const { configPath } = site(note);
    const out = [];
    const rc = await failing(() => runExplain({ configPath, target: 'People/Vesper.md', shown: true, json: true }, { out: (l) => out.push(String(l)) }));
    assert.strictEqual(rc, 1);
    assert.deepStrictEqual(JSON.parse(out.join('')).shown, { from: 'error', error: 'the theme could not be read' });
  });
  it('a note the build can make no page of is still shown as the note, with exit 0', async () => {
    const { configPath } = site({ 'People/Loose.md': '---\nname: Loose\n---\n\nOpen words.\n' });
    const out = [];
    const rc = await runExplain({ configPath, target: 'People/Loose.md', shown: true, json: true }, { out: (l) => out.push(String(l)) });
    assert.strictEqual(rc, 0);
    assert.strictEqual(JSON.parse(out.join('')).shown.from, 'note');
  });
});
