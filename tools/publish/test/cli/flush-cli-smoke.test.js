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
  it('an unknown flag on flush is rejected with usage, not executed', async () => {
    for (const bad of ['--nope', '--pcs', 'Six']) {
      const r = await runIn(['flush', bad]);
      assert.strictEqual(r.code, 1, `${bad} must exit 1`);
      assert.match(r.stderr, new RegExp(`Unknown argument: ${bad.replace(/[-]/g, '\\-')}`));
      assert.doesNotMatch(r.stderr, /Could not read live state/);
    }
  });

  it('--config refuses an option token as its value', async () => {
    const r = await runIn(['flush', '--config', '--dry-run']);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /--config needs a path/);
  });
});
