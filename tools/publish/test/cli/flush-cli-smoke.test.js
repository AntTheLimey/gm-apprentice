const { describe, it } = require('node:test');
const assert = require('node:assert');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const os = require('os');
const fs = require('fs');

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');

// Run the bin in an empty temp dir: no vault.config.json, no wrangler.toml. If an
// argument ever falls through to execution, the run fails on the missing config
// instead of the usage path, so the assertions below cannot pass by accident.
function runIn(args) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-flush-smoke-'));
  return execFileAsync(process.execPath, [CLI, ...args], { cwd })
    .then((r) => ({ code: 0, ...r }))
    .catch((err) => ({ code: err.code, stdout: err.stdout || '', stderr: err.stderr || '' }));
}

describe('CLI: gm-publish flush argument handling (issue #178)', () => {
  it('flush --help prints usage and exits 0 without running the flush', async () => {
    const r = await runIn(['flush', '--help']);
    assert.strictEqual(r.code, 0);
    assert.match(r.stdout, /--dry-run/);
    assert.doesNotMatch(r.stderr, /Could not read live state|wrangler|ENOENT/);
  });

  it('flush -h behaves the same', async () => {
    const r = await runIn(['flush', '-h']);
    assert.strictEqual(r.code, 0);
    assert.match(r.stdout, /flush \[--config/);
  });

  it('an unknown flag on flush is rejected with usage, not executed', async () => {
    for (const bad of ['--nope', '--pcs', 'Six']) {
      const r = await runIn(['flush', bad]);
      assert.strictEqual(r.code, 1, `${bad} must exit 1`);
      assert.match(r.stderr, new RegExp(`Unknown argument: ${bad.replace(/[-]/g, '\\-')}`));
      assert.doesNotMatch(r.stderr, /Could not read live state/);
    }
  });

  it('an unknown flag on setup-inbox is rejected too', async () => {
    const r = await runIn(['setup-inbox', '--dry-run']);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /Unknown argument: --dry-run/);
  });

  it('--help on any subcommand is safe', async () => {
    for (const cmd of ['build', 'inbox', 'setup-inbox', 'doctor', 'init']) {
      const r = await runIn([cmd, '--help']);
      assert.strictEqual(r.code, 0, `${cmd} --help exits 0`);
      assert.match(r.stdout, /Usage:/);
    }
  });
});
