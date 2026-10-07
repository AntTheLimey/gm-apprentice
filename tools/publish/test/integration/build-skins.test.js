const { describe, it, before, after } = require('node:test');
require('../helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');

const fixturesDir = path.join(__dirname, '..', 'fixtures');
const tmpRoots = [];

// Copy a fixture, let `edit(vaultDir)` change it, build it, and return the output dir and
// whatever the build wrote through console.warn.
function buildFixture(fixture, edit) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-skins-'));
  tmpRoots.push(root);
  const vault = path.join(root, 'vault');
  fs.cpSync(path.join(fixturesDir, fixture), vault, { recursive: true });
  if (edit) edit(vault);
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    vaultPath: vault,
    outputDir: path.join(root, 'docs'),
    attachmentsDir: '_attachments',
    siteTitle: 'Skin Test',
    excludeDirs: ['_meta', '_Templates'],
    excludeSections: [],
    folderMap: { 'Characters/PCs': 'characters/pcs' },
  }, null, 2));
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => { warnings.push(a.join(' ')); };
  try { build({ configPath }); } finally { console.warn = realWarn; }
  return { out: path.join(root, 'docs'), warnings };
}

// Remove every sheet_* line from the vault's config and PC notes.
function stripSheetLines(vault) {
  const files = [path.join(vault, '_meta', 'vault-config.md')];
  const pcs = path.join(vault, 'Characters', 'PCs');
  for (const f of fs.readdirSync(pcs)) files.push(path.join(pcs, f));
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    fs.writeFileSync(f, s.split(/\r?\n/).filter((l) => !/^\s*sheet_(skin|frame):/.test(l)).join('\n'));
  }
}

function addToNote(vault, rel, line) {
  const f = path.join(vault, rel);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/type: pc\r?\n/, (m) => m + line + '\n'));
}

function addPublishKey(vault, line) {
  const f = path.join(vault, '_meta', 'vault-config.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/(publish:\r?\n)/, (m) => m + '  ' + line + '\n'));
}

const pageIn = (out, slug) => fs.readFileSync(path.join(out, 'characters/pcs', slug + '.html'), 'utf8');
const lookIn = (out, slug) => {
  const p = pageIn(out, slug);
  return [(p.match(/<main class="content" data-skin="([a-z-]+)"/) || [])[1], (p.match(/data-frame="([a-z]+)"/) || [])[1]];
};
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

describe('build integration: sheet skins and frames', () => {
  let main, plain, siteNoSkin, sheetsOff;
  before(() => {
    main = buildFixture('with-skins');
    plain = buildFixture('with-skins', stripSheetLines);
    siteNoSkin = buildFixture('with-skins', (v) => {
      stripSheetLines(v);
      addToNote(v, 'Characters/PCs/Tamsin_Reed.md', 'sheet_frame: thorns');
    });
    sheetsOff = buildFixture('with-skins', (v) => addPublishKey(v, 'character_sheets: false'));
  });
  after(() => { for (const r of tmpRoots) fs.rmSync(r, { recursive: true, force: true }); });

  it('dresses each PC by its own and the campaign setting', () => {
    assert.deepStrictEqual(lookIn(main.out, 'brannoch-vale'), ['parchment', 'laurel']);
    assert.deepStrictEqual(lookIn(main.out, 'ilse-varn'), ['console', 'hex']);
    assert.deepStrictEqual(lookIn(main.out, 'tamsin-reed'), ['parchment', 'thorns']);
    assert.deepStrictEqual(lookIn(main.out, 'oriel-thackeray'), ['parchment', 'laurel']);
    assert.deepStrictEqual(lookIn(main.out, 'dov-ashgrove'), ['ledger', 'gilt']);
  });

  it('leaves a PC set to plain and none exactly as an unskinned build writes it', () => {
    assert.strictEqual(pageIn(main.out, 'perrin-lowe'), pageIn(plain.out, 'perrin-lowe'));
  });

  it('links skins.css only on dressed pages, and writes only the skins in use', () => {
    assert.match(pageIn(main.out, 'brannoch-vale'), /css\/skins\.css/);
    assert.doesNotMatch(pageIn(main.out, 'perrin-lowe'), /skins\.css/);
    const css = fs.readFileSync(path.join(main.out, 'css/skins.css'), 'utf8');
    for (const id of ['parchment', 'console', 'ledger']) assert.match(css, new RegExp(`data-skin="${id}"`));
    assert.doesNotMatch(css, /data-skin="case-file"/);
  });

  it('warns once about the unknown skin, naming the note and the value', () => {
    const hits = main.warnings.filter((w) => /vellum/.test(w));
    assert.strictEqual(hits.length, 1);
    assert.match(hits[0], /Oriel_Thackeray/);
  });

  it('writes no skins.css and no skin attribute when nothing is set', () => {
    assert.ok(!fs.existsSync(path.join(plain.out, 'css/skins.css')));
    for (const f of walk(plain.out)) {
      if (!/\.(html|css|js)$/.test(f)) continue;
      assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /data-skin|sk-portrait|skins\.css/, f);
    }
  });

  it('frames a PC on a site with no skin, linking skins.css on that page only', () => {
    assert.deepStrictEqual(lookIn(siteNoSkin.out, 'tamsin-reed'), ['plain', 'thorns']);
    assert.doesNotMatch(pageIn(siteNoSkin.out, 'brannoch-vale'), /skins\.css/);
  });

  it('dresses the hero and tabs with character sheets off, with no sheet content', () => {
    assert.match(pageIn(sheetsOff.out, 'brannoch-vale'), /data-skin="parchment"/);
    assert.doesNotMatch(pageIn(sheetsOff.out, 'brannoch-vale'), /dnd5e-vitals/);
  });

  it('prints each campaign-level problem once, not once per PC', () => {
    const bad = buildFixture('with-skins', (v) => { stripSheetLines(v); addPublishKey(v, 'sheet_skin: vellum'); });
    assert.strictEqual(bad.warnings.filter((w) => /publish\.sheet_skin/.test(w)).length, 1);
  });

  it('adds no skin, frame or stylesheet to the untouched system fixtures', () => {
    for (const fx of ['with-dnd-pc', 'with-gurps-pc', 'with-coc-pc']) {
      const { out } = buildFixture(fx);
      assert.ok(!fs.existsSync(path.join(out, 'css/skins.css')), fx);
      for (const f of walk(out)) {
        if (!/\.(html|css|js)$/.test(f)) continue;
        assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /data-skin|sk-portrait|skins\.css/, fx + ': ' + f);
      }
    }
  });
});
