const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gm-publish-cli-init-'));
}

async function removeTmpDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

describe('CLI: gm-publish init', () => {
  describe('init <target-dir>', () => {
    let tmpDir;

    before(async () => {
      tmpDir = await makeTmpDir();
      // Run: node bin/gm-publish.js init <tmpDir>
      await execFileAsync(process.execPath, [CLI, 'init', tmpDir]);
    });

    after(async () => {
      await removeTmpDir(tmpDir);
    });

    it('creates package.json in target dir', async () => {
      await assert.doesNotReject(fs.access(path.join(tmpDir, 'package.json')));
    });

    it('creates vault.config.json in target dir', async () => {
      await assert.doesNotReject(fs.access(path.join(tmpDir, 'vault.config.json')));
    });

    it('creates README.md in target dir', async () => {
      await assert.doesNotReject(fs.access(path.join(tmpDir, 'README.md')));
    });

    it('creates css/overrides.css in target dir', async () => {
      await assert.doesNotReject(fs.access(path.join(tmpDir, 'css', 'overrides.css')));
    });

    it('creates .gitignore in target dir', async () => {
      await assert.doesNotReject(fs.access(path.join(tmpDir, '.gitignore')));
    });

    it('creates .nojekyll in target dir', async () => {
      await assert.doesNotReject(fs.access(path.join(tmpDir, '.nojekyll')));
    });
  });

  describe('init with no args uses cwd', () => {
    let tmpDir;

    before(async () => {
      tmpDir = await makeTmpDir();
      // Run: node bin/gm-publish.js init  (no target-dir arg) with cwd=tmpDir
      await execFileAsync(process.execPath, [CLI, 'init'], { cwd: tmpDir });
    });

    after(async () => {
      await removeTmpDir(tmpDir);
    });

    it('creates package.json in cwd', async () => {
      await assert.doesNotReject(fs.access(path.join(tmpDir, 'package.json')));
    });

    it('creates vault.config.json in cwd', async () => {
      await assert.doesNotReject(fs.access(path.join(tmpDir, 'vault.config.json')));
    });

    it('creates .nojekyll in cwd', async () => {
      await assert.doesNotReject(fs.access(path.join(tmpDir, '.nojekyll')));
    });
  });

  describe('init into directory with existing files exits non-zero', () => {
    let tmpDir;

    before(async () => {
      tmpDir = await makeTmpDir();
      await fs.writeFile(path.join(tmpDir, 'package.json'), '{}');
    });

    after(async () => {
      await removeTmpDir(tmpDir);
    });

    it('exits with non-zero code when file already exists', async () => {
      let code = 0;
      try {
        await execFileAsync(process.execPath, [CLI, 'init', tmpDir]);
      } catch (err) {
        code = err.code || (err.exitCode !== undefined ? err.exitCode : 1);
      }
      assert.notStrictEqual(code, 0, 'expected non-zero exit code');
    });
  });
});
