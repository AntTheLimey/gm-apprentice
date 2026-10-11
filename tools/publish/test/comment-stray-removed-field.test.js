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

describe('COMMENT_STRAY in a frontmatter field the site removes', () => {
  const strays = async (frontmatter, extra = '') => {
    const { configPath } = site({ 'People/Case.md': `---\ntype: npc\n${frontmatter}---\n\nBody.\n` }, { mode: 'full', extra });
    const { faults } = quietBuild(configPath);
    const out = [];
    await runSiteDoctor({ configPath, json: true }, { out: (l) => out.push(String(l)), detect: () => null });
    const fromDoctor = JSON.parse(out.join('')).findings.filter((f) => f.code === 'COMMENT_STRAY');
    assert.deepStrictEqual(faults.filter((f) => f.code === 'COMMENT_STRAY'), fromDoctor);
    return fromDoctor.map((f) => f.field);
  };

  it('is not reported: a field on the exclude list, one the note itself excludes, gm_aliases, a gm_only relationship', async () => {
    assert.deepStrictEqual(await strays('secrets: "takes a 50%% cut"\ngm_notes: "Baker <!-- spy"\n'), []);
    assert.deepStrictEqual(await strays('occupation: "takes a 50%% cut"\npublish_exclude_fields: [occupation]\n'), []);
    assert.deepStrictEqual(await strays('gm_aliases: ["Mr 50%% Man"]\n'), []);
    assert.deepStrictEqual(await strays('relationships:\n  - target: "[[Bo]]"\n    type: knows\n    gm_only: true\n    description: "owes 10%% more"\n  - target: "[[Cy]]"\n    type: knows\n'), []);
  });
  it('is not reported when the removed field was nothing but the comment', async () => {
    assert.deepStrictEqual(await strays('secrets: "%% all of it"\n'), []);
  });
  it('is still reported in a field the site prints, one that was nothing but the comment among them', async () => {
    assert.deepStrictEqual(await strays('occupation: "takes a 50%% cut"\n'), ['occupation']);
    assert.deepStrictEqual(await strays('occupation: "%% all of it"\n'), ['occupation']);
    assert.deepStrictEqual(await strays('relationships:\n  - target: "[[Bo]]"\n    type: knows\n    description: "owes 10%% more"\n'), ['relationships[0].description']);
  });
  it('is reported again when the vault takes the field off the exclude list', async () => {
    assert.deepStrictEqual(await strays('secrets: "takes a 50%% cut"\n', '  exclude_fields:\n    - gm_notes\n'), ['secrets']);
  });
});
