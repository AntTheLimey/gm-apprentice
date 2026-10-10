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
const { buildRelationshipGraph } = require('../lib/relationship-graph');

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

describe('the connections graph: one node for a page, however it is named', () => {
  const page = (title, extra = {}) => ({ title, displayTitle: title, outputPath: `${title}.html`, frontmatter: Object.assign({ type: 'npc' }, extra) });
  it('a target written as an alias of the page and one written as its name are the same node, under its title', () => {
    const rels = [{ target: '[[Alternate|the contact]]', type: 'knows' }, { target: '[[B|the contact]]', type: 'fears' }, { target: '[[Alternate]]', type: 'owes' }];
    const graph = buildRelationshipGraph('A', [page('A', { relationships: rels }), page('B', { aliases: ['Alternate'] })], {});
    assert.deepStrictEqual(graph.nodes.map((n) => [n.id, n.displayTitle, n.outputPath]), [['A', 'A', 'A.html'], ['B', 'B', 'B.html']]);
    assert.deepStrictEqual(graph.edges.map((e) => [e.from, e.to]), [['A', 'B'], ['A', 'B'], ['A', 'B']]);
  });
  it('and the page\'s own relationships are followed from that one node', () => {
    const graph = buildRelationshipGraph('A', [
      page('A', { relationships: [{ target: '[[Alternate]]', type: 'knows' }] }),
      page('B', { aliases: ['Alternate'], relationships: [{ target: '[[C]]', type: 'knows' }] }),
      page('C'),
    ], {});
    assert.deepStrictEqual(graph.nodes.map((n) => [n.id, n.hop]), [['A', 0], ['B', 1], ['C', 2]]);
  });
});
