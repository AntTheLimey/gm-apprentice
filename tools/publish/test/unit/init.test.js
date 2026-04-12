const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
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

    it('vault.config.json is valid JSON with siteTitle and siteUrl', async () => {
      const content = await fs.readFile(path.join(tmpDir, 'vault.config.json'), 'utf8');
      const cfg = JSON.parse(content);
      assert.ok(typeof cfg.siteTitle === 'string', 'siteTitle missing');
      assert.ok(typeof cfg.siteUrl === 'string', 'siteUrl missing');
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
  });
});
