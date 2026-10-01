// tools/publish/test/integration/build-pf2e-fitd.test.js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { build } = require('../../lib/build');
const { druidBody, cutterBody } = require('../helpers/pc-template');

// #272: a PF2e or FitD PC written to its template's body structure got no sheet.
// The vault is made here from the real template, not kept as a fixture.
function buildPc(system, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `gm-publish-${system}-`));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, 'Characters', 'PCs'), { recursive: true });
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), `---\npublish:\n  mode: player\n  system: ${system}\n---\n`);
  fs.writeFileSync(path.join(vault, 'Characters', 'PCs', 'Test_Hero.md'),
    `---\ntype: pc\ncanon_status: AUTHORITATIVE\nplayer_name: "Test Player"\nstatus: alive\nrelationships: []\n---\n${body.replace('{Keeper-only notes. Protected — skills never modify.}', 'GM-SECRET')}`);
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments',
    siteTitle: 'Test', system, excludeDirs: ['_meta', '_Templates'], excludeSections: ['GM Notes'],
    folderMap: { 'Characters/PCs': 'characters/pcs' },
  }));
  build({ configPath });
  return { root, html: fs.readFileSync(path.join(root, 'docs', 'characters', 'pcs', 'test-hero.html'), 'utf-8') };
}

const accordionTitles = html => [...html.matchAll(/<button class="accordion-header"[^>]*>([^<]*)</g)].map(m => m[1]);

describe('build integration — PF2e PC', () => {
  let out;
  before(() => { out = buildPc('pf2e', druidBody()); });
  after(() => fs.rmSync(out.root, { recursive: true, force: true }));

  it('renders the structured sheet', () => {
    assert.ok(out.html.includes('pf2e-sheet'));
    assert.match(out.html, /<span>Level 2<\/span><span>Druid \(Leaf\)<\/span>/);
    assert.match(out.html, /<span class="stat-label">HP<\/span><span class="stat-value">20 \/ 26</);
    assert.match(out.html, /<span class="stat-label">Rank 1<\/span><span class="stat-value">2 \/ 3</);
  });
  it('does not repeat consumed sections as accordions', () => {
    const titles = accordionTitles(out.html);
    for (const t of ['Stat Sheet', 'Skills', 'Spellcasting', 'Proficiencies']) assert.ok(!titles.includes(t), t);
    assert.ok(titles.includes('Class Feats'));
  });
  it('withholds GM Notes', () => assert.ok(!out.html.includes('GM-SECRET')));
});

describe('build integration — FitD PC', () => {
  let out;
  before(() => { out = buildPc('fitd', cutterBody()); });
  after(() => fs.rmSync(out.root, { recursive: true, force: true }));

  it('renders the structured sheet', () => {
    assert.ok(out.html.includes('class="fitd-sheet"'));
    assert.ok(out.html.includes('<span>Cutter</span>'));
    assert.strictEqual((out.html.match(/class="fitd-action-row"/g) || []).length, 12);
    assert.ok(out.html.includes('4 / 9'));
  });
  it('does not repeat consumed sections as accordions', () => {
    const titles = accordionTitles(out.html);
    for (const t of ['Stat Sheet', 'Special Abilities', 'Stash &amp; Coin']) assert.ok(!titles.includes(t), t);
    assert.ok(titles.includes('Long-Term Projects'));
  });
  it('withholds GM Notes', () => assert.ok(!out.html.includes('GM-SECRET')));
});
