const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('fs');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { init } = require('../../lib/init');

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gm-publish-init-'));
}

async function removeTmpDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

describe('init', () => {
  // Most tests scaffold with no vault beside the site, which init says so on stderr.
  const realWarn = console.warn;
  before(() => { console.warn = () => {}; });
  after(() => { console.warn = realWarn; });

  describe('creates expected files', () => {
    let tmpDir;
    let result;

    before(async () => {
      tmpDir = await makeTmpDir();
      result = await init(tmpDir);
    });

    after(async () => {
      await removeTmpDir(tmpDir);
    });

    it('returns success: true', () => {
      assert.strictEqual(result.success, true);
    });

    it('returns a files array', () => {
      assert.ok(Array.isArray(result.files));
      assert.ok(result.files.length > 0);
    });

    it('creates package.json', async () => {
      const p = path.join(tmpDir, 'package.json');
      await assert.doesNotReject(fs.access(p));
    });

    it('package.json contains build script', async () => {
      const content = await fs.readFile(path.join(tmpDir, 'package.json'), 'utf8');
      const pkg = JSON.parse(content);
      assert.ok(pkg.scripts && pkg.scripts.build, 'build script missing');
    });

    it('creates vault.config.json', async () => {
      const p = path.join(tmpDir, 'vault.config.json');
      await assert.doesNotReject(fs.access(p));
    });

    it('vault.config.json holds exactly the four scaffold keys', async () => {
      const content = await fs.readFile(path.join(tmpDir, 'vault.config.json'), 'utf8');
      assert.deepStrictEqual(JSON.parse(content), {
        host: 'github-pages',
        siteUrl: 'https://example.github.io/my-campaign',
        vaultPath: './vault',
        outputDir: './docs',
      });
    });

    it('creates README.md', async () => {
      const p = path.join(tmpDir, 'README.md');
      await assert.doesNotReject(fs.access(p));
    });

    it('creates css/overrides.css', async () => {
      const p = path.join(tmpDir, 'css', 'overrides.css');
      await assert.doesNotReject(fs.access(p));
    });

    it('creates .gitignore', async () => {
      const p = path.join(tmpDir, '.gitignore');
      await assert.doesNotReject(fs.access(p));
    });

    it('creates .nojekyll', async () => {
      const p = path.join(tmpDir, '.nojekyll');
      await assert.doesNotReject(fs.access(p));
    });

    it('.nojekyll is empty', async () => {
      const content = await fs.readFile(path.join(tmpDir, '.nojekyll'), 'utf8');
      assert.strictEqual(content, '');
    });

    it('files list includes .nojekyll', () => {
      assert.ok(result.files.includes('.nojekyll'));
    });
  });

  describe('does not overwrite existing files', () => {
    let tmpDir;

    before(async () => {
      tmpDir = await makeTmpDir();
      // Pre-create one of the scaffold files
      await fs.writeFile(path.join(tmpDir, 'package.json'), '{"existing": true}');
    });

    after(async () => {
      await removeTmpDir(tmpDir);
    });

    it('throws when a file already exists', async () => {
      await assert.rejects(
        () => init(tmpDir),
        (err) => {
          assert.ok(err.message.includes('already exists'), `expected "already exists" in: ${err.message}`);
          return true;
        }
      );
    });

    it('leaves pre-existing file unchanged', async () => {
      try { await init(tmpDir); } catch (_) { /* expected */ }
      const content = await fs.readFile(path.join(tmpDir, 'package.json'), 'utf8');
      assert.strictEqual(content, '{"existing": true}');
    });
  });

  describe('creates subdirectories', () => {
    let tmpDir;

    before(async () => {
      tmpDir = await makeTmpDir();
      // Run init into a non-existent subdirectory
      await init(path.join(tmpDir, 'nested', 'site'));
    });

    after(async () => {
      await removeTmpDir(tmpDir);
    });

    it('creates the nested target directory', async () => {
      await assert.doesNotReject(fs.access(path.join(tmpDir, 'nested', 'site')));
    });

    it('creates css/ subdirectory inside nested target', async () => {
      await assert.doesNotReject(fs.access(path.join(tmpDir, 'nested', 'site', 'css')));
    });

    it('creates css/overrides.css inside nested target', async () => {
      await assert.doesNotReject(fs.access(path.join(tmpDir, 'nested', 'site', 'css', 'overrides.css')));
    });
  });

  describe('placeholder substitution', () => {
    let tmpDir;

    before(async () => {
      tmpDir = await makeTmpDir();
      await init(tmpDir);
    });

    after(async () => {
      await removeTmpDir(tmpDir);
    });

    it('replaces {{SITE_TITLE}} in package.json', async () => {
      const content = await fs.readFile(path.join(tmpDir, 'package.json'), 'utf8');
      assert.ok(!content.includes('{{SITE_TITLE}}'), 'raw placeholder left in package.json');
    });

    it('replaces {{SITE_URL}} in vault.config.json', async () => {
      const content = await fs.readFile(path.join(tmpDir, 'vault.config.json'), 'utf8');
      assert.ok(!content.includes('{{SITE_URL}}'), 'raw placeholder left in vault.config.json');
    });

    it('auto-pins the build tool to its own location, not the npm registry', async () => {
      const content = await fs.readFile(path.join(tmpDir, 'package.json'), 'utf8');
      const pkg = JSON.parse(content);
      const dep = pkg.dependencies['gm-apprentice-publish'];
      assert.ok(!content.includes('{{TOOL_DEP}}'), 'raw placeholder left in package.json');
      assert.notStrictEqual(dep, 'latest', 'must not fall back to the npm registry');
      assert.match(dep, /^file:/, 'should be a file: pin into the running tool');
      // The pinned path is the directory that ships lib/init.js (the tool root).
      const toolRoot = path.resolve(__dirname, '..', '..').split(path.sep).join('/');
      assert.strictEqual(dep, `file:${toolRoot}`);
    });

    it('honors an explicit toolDep override', async () => {
      const dir = await makeTmpDir();
      try {
        await init(dir, { toolDep: 'file:/some/cache/1.2.3/tools/publish' });
        const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
        assert.strictEqual(
          pkg.dependencies['gm-apprentice-publish'],
          'file:/some/cache/1.2.3/tools/publish',
        );
      } finally {
        await removeTmpDir(dir);
      }
    });
  });

  describe('custom siteTitle', () => {
    let tmpDir;
    let result;

    before(async () => {
      tmpDir = await makeTmpDir();
      result = await init(tmpDir, { siteTitle: 'Canticle of the End' });
    });

    after(async () => {
      await removeTmpDir(tmpDir);
    });

    it('slugifies siteTitle into package.json name', async () => {
      const content = await fs.readFile(path.join(tmpDir, 'package.json'), 'utf8');
      const pkg = JSON.parse(content);
      assert.strictEqual(pkg.name, 'canticle-of-the-end');
    });

    it('keeps the title out of vault.config.json', async () => {
      const cfg = JSON.parse(await fs.readFile(path.join(tmpDir, 'vault.config.json'), 'utf8'));
      assert.strictEqual(cfg.siteTitle, undefined);
    });
  });

  describe('slugify edge cases', () => {
    let tmpDir;

    before(async () => {
      tmpDir = await makeTmpDir();
    });

    after(async () => {
      await removeTmpDir(tmpDir);
    });

    it('falls back to my-campaign for non-alphanumeric titles', async () => {
      const dir = path.join(tmpDir, 'edge');
      await init(dir, { siteTitle: '!!!' });
      const content = await fs.readFile(path.join(dir, 'package.json'), 'utf8');
      const pkg = JSON.parse(content);
      assert.strictEqual(pkg.name, 'my-campaign');
    });
  });

  describe('campaign settings go to the vault file', () => {
    const { parseNote } = require('../../lib/frontmatter');
    const { build } = require('../../lib/build');
    const publishOf = (vault) => parseNote(readFileSync(path.join(vault, '_meta', 'vault-config.md'), 'utf8')).data.publish;

    it('a fresh init writes the block, and init + build prints no WARNING at all', async () => {
      const tmpDir = await makeTmpDir();
      const lines = [];
      const real = { log: console.log, warn: console.warn, error: console.error };
      try {
        const site = path.join(tmpDir, 'site');
        const vault = path.join(tmpDir, 'vault');
        await fs.mkdir(vault);
        await fs.writeFile(path.join(vault, 'Home.md'), '---\ntype: note\n---\n# Home\n');
        const result = await init(site, { siteTitle: 'Dead Light', vaultPath: vault });
        assert.deepStrictEqual(Object.keys(JSON.parse(readFileSync(path.join(site, 'vault.config.json'), 'utf8'))).sort(),
          ['host', 'outputDir', 'siteUrl', 'vaultPath']);
        assert.deepStrictEqual(result.vaultSettings.written,
          ['site_title', 'folder_map', 'attachments_dir', 'exclude_dirs', 'exclude_callouts']);
        const pub = publishOf(vault);
        assert.strictEqual(pub.site_title, 'Dead Light');
        assert.strictEqual(pub.folder_map['Chapters'], 'chapters');
        assert.strictEqual(pub.attachments_dir, '_attachments');
        assert.deepStrictEqual(pub.exclude_dirs, ['_meta', '_Templates', '_resources']);
        assert.strictEqual(pub.exclude_callouts, true);
        for (const k of Object.keys(real)) console[k] = (...a) => lines.push(a.join(' '));
        const configPath = path.join(site, 'vault.config.json');
        delete require.cache[require.resolve(configPath)];
        build({ configPath });
        await assert.doesNotReject(fs.access(path.join(site, 'docs', 'index.html')));
      } finally {
        Object.assign(console, real);
        await removeTmpDir(tmpDir);
      }
      assert.deepStrictEqual(lines.filter((l) => /WARNING/.test(l)), []);
    });

    it('leaves a key the vault file already sets, and keeps the rest of the theme', async () => {
      const tmpDir = await makeTmpDir();
      try {
        const vault = path.join(tmpDir, 'vault');
        await fs.mkdir(path.join(vault, '_meta'), { recursive: true });
        const original = '---\ntype: meta\npublish:\n  site_title: Mine\n  theme:\n    tagline: Hello\n---\n';
        await fs.writeFile(path.join(vault, '_meta', 'vault-config.md'), original);
        const result = await init(path.join(tmpDir, 'site'), { siteTitle: 'Other', vaultPath: vault });
        const pub = publishOf(vault);
        assert.strictEqual(pub.site_title, 'Mine');
        assert.deepStrictEqual(pub.theme, { tagline: 'Hello' });
        assert.deepStrictEqual(result.vaultSettings.kept, ['site_title']);
        assert.strictEqual(pub.folder_map['Chapters'], 'chapters');
      } finally {
        await removeTmpDir(tmpDir);
      }
    });

    it('a vault that is not there yet is not created; the site is still scaffolded', async () => {
      const tmpDir = await makeTmpDir();
      const real = console.warn;
      const warned = [];
      console.warn = (m) => warned.push(m);
      try {
        const site = path.join(tmpDir, 'site');
        const result = await init(site);
        assert.strictEqual(result.success, true);
        assert.ok(result.vaultSettings.skipped);
        await assert.rejects(fs.access(path.join(site, 'vault')));
        assert.match(warned.join('\n'), /site_title.*folder_map/);
      } finally {
        console.warn = real;
        await removeTmpDir(tmpDir);
      }
    });

    it('a vault file the editor refuses is left alone and the reason is shown', async () => {
      const tmpDir = await makeTmpDir();
      const real = console.warn;
      const warned = [];
      console.warn = (m) => warned.push(m);
      try {
        const vault = path.join(tmpDir, 'vault');
        await fs.mkdir(path.join(vault, '_meta'), { recursive: true });
        const original = '---\ntype: meta\npublish: {site_title: X}\n---\n';
        await fs.writeFile(path.join(vault, '_meta', 'vault-config.md'), original);
        const result = await init(path.join(tmpDir, 'site'), { vaultPath: vault });
        assert.strictEqual(result.success, true);
        assert.ok(result.vaultSettings.skipped);
        assert.strictEqual(readFileSync(path.join(vault, '_meta', 'vault-config.md'), 'utf8'), original);
        assert.match(warned.join('\n'), /Campaign settings were not written/);
      } finally {
        console.warn = real;
        await removeTmpDir(tmpDir);
      }
    });
  });

  describe('vault.config.json.tmpl', () => {
    it('is exactly the four scaffold keys, with no backend flags or campaign settings', () => {
      const tmplPath = path.join(__dirname, '..', '..', 'templates-scaffold', 'vault.config.json.tmpl');
      const config = JSON.parse(readFileSync(tmplPath, 'utf-8').replace(/\{\{\w+\}\}/g, 'x'));
      assert.deepStrictEqual(Object.keys(config).sort(), ['host', 'outputDir', 'siteUrl', 'vaultPath']);
    });
  });
});
