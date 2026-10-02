// tools/publish/test/integration/build-retired-fields.test.js
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { build } = require('../../lib/build');

const KV_TOML = '[[kv_namespaces]]\nbinding = "INBOX"\nid = "abc123def456"\n';
const roots = [];
after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

// A one-PC site whose vault file carries `publish`; returns the PC page HTML and
// every line the build warned.
function buildPc(system, fm, publish = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-retired-'));
  roots.push(root);
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, 'Characters', 'PCs'), { recursive: true });
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'),
    `---\npublish:\n  mode: player\n  system: ${system}\n${publish}---\n`);
  fs.writeFileSync(path.join(vault, 'Characters', 'PCs', 'Hero.md'),
    `---\ntype: pc\nplayer_name: T\n${fm}---\n\n## Background\n\nA sailor.\n`);
  fs.writeFileSync(path.join(root, 'wrangler.toml'), KV_TOML);
  fs.mkdirSync(path.join(root, 'functions', 'api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'functions', 'api', 'request.js'), '// fn');
  fs.writeFileSync(path.join(root, 'functions', 'api', 'loadout.js'), '// fn');
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    vaultPath: vault, outputDir: path.join(root, 'docs'), siteTitle: 'Test', excludeDirs: ['_meta'],
    folderMap: { 'Characters/PCs': 'characters/pcs' },
  }));
  const lines = [];
  const real = console.warn;
  console.warn = (...a) => lines.push(a.join(' '));
  try { build({ configPath }); } finally { console.warn = real; }
  return { html: fs.readFileSync(path.join(root, 'docs', 'characters', 'pcs', 'hero.html'), 'utf8'), lines };
}

const GURPS_FM = 'attributes: { ST: 7701 }\nskills:\n  - { name: SENTINELSKILL, level: 7702, points: 4 }\n'
  + 'loadouts:\n  - { name: SENTINELKIT, items: [{ name: SENTINELITEM, qty: 1 }] }\n';
const stem = /WARNING: Characters\/PCs\/Hero\.md: frontmatter field\(s\) attributes, skills, loadouts are no longer read for the character sheet — move the values into the note's ## Stat Sheet sections/;

describe('build and retired frontmatter sheet fields', () => {
  it('a GURPS PC with frontmatter-only stats shows none of them, has no live island, and the build says so', () => {
    const { html, lines } = buildPc('gurps-4e', GURPS_FM, '  live_stats: true\n');
    for (const s of ['7701', '7702', 'SENTINELSKILL', 'SENTINELKIT', 'SENTINELITEM']) assert.ok(!html.includes(s), s);
    assert.ok(!html.includes('gurps-live-data'), 'no live-data island');
    assert.strictEqual(lines.filter((l) => stem.test(l)).length, 1, lines.join('\n'));
  });

  it('names only the fields this system read: a GURPS-only name on a D&D or CoC PC is not reported', () => {
    for (const system of ['dnd-5e-2024', 'coc-7e', 'generic']) {
      const { lines } = buildPc(system, GURPS_FM);
      assert.ok(!lines.some((l) => l.includes('no longer read for the character sheet')), `${system}\n${lines.join('\n')}`);
    }
  });

  it('a D&D PC is told about a D&D field', () => {
    const { lines } = buildPc('dnd-5e-2024', 'ability_scores: { STR: 16 }\n');
    assert.ok(lines.some((l) => l.includes('Characters/PCs/Hero.md: frontmatter field(s) ability_scores are no longer read')), lines.join('\n'));
  });

  it('is silent when character sheets are off', () => {
    const { lines } = buildPc('gurps-4e', GURPS_FM, '  character_sheets: false\n');
    assert.ok(!lines.some((l) => l.includes('no longer read for the character sheet')), lines.join('\n'));
  });
});
