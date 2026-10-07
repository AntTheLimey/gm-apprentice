const { describe, it, before, after } = require('node:test');
require('../helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');
const { buildWithFonts } = require('../../lib/fonts');
const { skinsInVault } = require('../../lib/skins');
const { resolveConfig, loadVaultConfig, scanConfigFor } = require('../../lib/config');

const fixturesDir = path.join(__dirname, '..', 'fixtures');
const tmpRoots = [];

// Copy a fixture, let `edit(vaultDir)` change it, and write the site config for it.
function setUpFixture(fixture, edit) {
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
  return { out: path.join(root, 'docs'), vault, configPath };
}

// Build a fixture and return the output dir and whatever the build wrote through console.warn.
function buildFixture(fixture, edit) {
  const site = setUpFixture(fixture, edit);
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => { warnings.push(a.join(' ')); };
  try { build({ configPath: site.configPath }); } finally { console.warn = realWarn; }
  return Object.assign(site, { warnings });
}

// The same build with the typeface prefetch the CLI runs first, on a stubbed network.
async function buildFixtureWithFonts(fixture, edit, fetchImpl) {
  const site = setUpFixture(fixture, edit);
  const warnings = [];
  const realWarn = console.warn;
  const realLog = console.log;
  console.warn = (...a) => { warnings.push(a.join(' ')); };
  console.log = () => {};
  try {
    await buildWithFonts({ configPath: site.configPath }, { fetch: fetchImpl, log: () => {}, warn: (m) => warnings.push(m) });
  } finally { console.warn = realWarn; console.log = realLog; }
  return Object.assign(site, { warnings });
}

const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.from('fake-font-bytes')]);
// Answers Google's stylesheet request and the font download; records every URL asked for.
function stubFetch(calls) {
  return async (url) => {
    calls.push(String(url));
    const u = new URL(url);
    if (u.hostname === 'fonts.googleapis.com') {
      const family = u.searchParams.get('family').split(':')[0];
      const slug = family.replace(/ /g, '');
      return new Response(`@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: 400;\n  font-display: swap;\n  src: url(https://fonts.gstatic.com/s/${slug}/n400.woff2) format('woff2');\n  unicode-range: U+0000-00FF;\n}`, { status: 200 });
    }
    return new Response(WOFF2, { status: 200 });
  };
}

// Remove every sheet_* line from the vault's config and PC notes.
function stripSheetLines(vault) {
  const files = [path.join(vault, '_meta', 'vault-config.md')];
  const pcs = path.join(vault, 'Characters', 'PCs');
  for (const f of fs.readdirSync(pcs)) files.push(path.join(pcs, f));
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    const eol = s.includes('\r\n') ? '\r\n' : '\n';
    fs.writeFileSync(f, s.split(/\r?\n/).filter((l) => !/^\s*sheet_(skin|frame):/.test(l)).join(eol));
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

const siteTouches = (out) => walk(out).filter((f) => /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(fs.readFileSync(f)));
const pcSkinsOf = (out) => {
  const set = new Set();
  for (const f of fs.readdirSync(path.join(out, 'characters/pcs'))) {
    const m = fs.readFileSync(path.join(out, 'characters/pcs', f), 'utf8').match(/<main class="content" data-skin="([a-z-]+)"/);
    if (m && m[1] !== 'plain') set.add(m[1]);
  }
  return [...set].sort();
};

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

  it('serves skin typefaces from the site and never links to Google', async () => {
    const calls = [];
    const { out, warnings } = await buildFixtureWithFonts('with-skins', null, stubFetch(calls));
    const css = fs.readFileSync(path.join(out, 'css/skins.css'), 'utf8');
    assert.match(css, /^@font-face \{/);
    assert.match(css, /@font-face \{\s*font-family: 'Alegreya'/);
    assert.match(css, /url\('\.\.\/fonts\/alegreya\//);
    assert.match(css, /font-family: 'Chakra Petch'/);
    assert.match(css, /font-family: 'Spectral SC'/);
    assert.doesNotMatch(css, /Special Elite/); // case-file is not in use
    assert.deepStrictEqual(siteTouches(out), []);
    assert.ok(fs.readdirSync(path.join(out, 'fonts/alegreya')).length > 0);
    // every url() in skins.css names a file the build copied
    for (const m of css.matchAll(/url\('\.\.\/(fonts\/[^']+)'\)/g)) assert.ok(fs.existsSync(path.join(out, m[1])), m[1]);
    assert.strictEqual(warnings.filter((w) => /typefaces for the sheet skins/.test(w)).length, 0);
  });

  it('keeps the skin faces on the site when the theme itself loads fonts from Google', async () => {
    const { out } = await buildFixtureWithFonts('with-skins', (v) => addPublishKey(v, 'theme:\n    fonts:\n      heading: Cinzel'), stubFetch([]));
    const skins = fs.readFileSync(path.join(out, 'css/skins.css'), 'utf8');
    assert.match(skins, /url\('\.\.\/fonts\/alegreya\//);
    // Google appears only where the GM's own theme asked for it, never in skins.css or a page
    const touching = siteTouches(out).map((f) => path.relative(out, f));
    assert.deepStrictEqual(touching, ['css/theme.css']);
  });

  it('warns once and falls back when the faces cannot be fetched', async () => {
    const offline = async () => { throw new Error('offline'); };
    const { out, warnings } = await buildFixtureWithFonts('with-skins', null, offline);
    const css = fs.readFileSync(path.join(out, 'css/skins.css'), 'utf8');
    assert.doesNotMatch(css, /@font-face/);
    assert.match(css, /Georgia, serif/);
    assert.deepStrictEqual(siteTouches(out), []);
    assert.strictEqual(warnings.filter((w) => /typefaces for the sheet skins/.test(w)).length, 1);
    assert.strictEqual(warnings.filter((w) => /could not download font/.test(w)).length, 0);
  });

  it('fetches no skin typeface for a site with no skin', async () => {
    const calls = [];
    const { out } = await buildFixtureWithFonts('with-skins', stripSheetLines, stubFetch(calls));
    assert.deepStrictEqual(calls, []);
    assert.ok(!fs.existsSync(path.join(out, 'fonts')));
  });

  it('finds the same skins before the build as the build dresses', () => {
    for (const edit of [null, (v) => addPublishKey(v, 'character_sheets: false'), stripSheetLines]) {
      const { out, vault, configPath } = buildFixture('with-skins', edit);
      const config = loadVaultConfig(configPath);
      const { publishConfig } = resolveConfig(config, vault, () => {});
      const found = skinsInVault(scanConfigFor(Object.assign({}, config, { vaultPath: vault }), publishConfig), publishConfig.sheetLook);
      assert.deepStrictEqual([...found].sort(), pcSkinsOf(out));
    }
  });

  it('prints a page-slug collision once, with and without skins, through the prefetch', async () => {
    const collide = (v) => {
      fs.writeFileSync(path.join(v, 'Characters/PCs/Foo Bar.md'), '---\ntype: pc\n---\n\n# Foo Bar\n');
      fs.writeFileSync(path.join(v, 'Characters/PCs/foo-bar.md'), '---\ntype: pc\n---\n\n# foo-bar\n');
    };
    for (const edit of [collide, (v) => { stripSheetLines(v); collide(v); }]) {
      const { warnings } = await buildFixtureWithFonts('with-skins', edit, stubFetch([]));
      assert.strictEqual(warnings.filter((w) => /page slug collision/.test(w)).length, 1);
    }
  });
});
