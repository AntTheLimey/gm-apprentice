const { describe, it } = require('node:test');
const assert = require('node:assert');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const os = require('os');
const fs = require('fs');

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');

// Empty temp cwd: no vault.config.json, so anything that falls through to
// execution fails on the missing config rather than passing by accident.
function runIn(args) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-help-smoke-'));
  return execFileAsync(process.execPath, [CLI, ...args], { cwd })
    .then((r) => ({ code: 0, ...r }))
    .catch((err) => ({ code: err.code, stdout: err.stdout || '', stderr: err.stderr || '' }));
}

// Every subcommand's --help must describe THAT subcommand, not fall back to the
// top-level usage (which used to be the case for everything except flush).
const CASES = {
  init: [/init \[target-dir\]/, /Refuses to overwrite/],
  build: [/build \[--config/, /--config <path>/],
  inbox: [/inbox <open\|code\|pull\|handled\|flag\|reply>/, /inbox reply <id>/],
  doctor: [/doctor \[--host/, /--set-cloudflare-creds/, /--json/],
  'setup-status-bar': [/setup-status-bar \[--config/, /--config <path>/],
  'setup-inbox': [/setup-inbox \[--config/, /--config <path>/],
  flush: [/flush \[--config/, /--dry-run/],
};

describe('CLI: gm-publish <cmd> --help is per-subcommand', () => {
  for (const [cmd, patterns] of Object.entries(CASES)) {
    it(`${cmd} --help prints ${cmd} usage and exits 0`, async () => {
      const r = await runIn([cmd, '--help']);
      assert.strictEqual(r.code, 0, `${cmd} --help exits 0`);
      for (const p of patterns) assert.match(r.stdout, p);
      // The top-level banner must NOT be what came back.
      assert.doesNotMatch(r.stdout, /Static site generator for gm-apprentice campaign vaults/);
    });
    it(`${cmd} -h behaves the same`, async () => {
      const r = await runIn([cmd, '-h']);
      assert.strictEqual(r.code, 0);
      assert.match(r.stdout, patterns[0]);
    });
  }

  it('top-level --help still prints the command list', async () => {
    const r = await runIn(['--help']);
    assert.strictEqual(r.code, 0);
    assert.match(r.stdout, /Usage:/);
    assert.match(r.stdout, /setup-inbox/);
  });

  it('a bad argument on setup-inbox prints setup-inbox usage, not the top-level banner', async () => {
    const r = await runIn(['setup-inbox', '--nope']);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /Unknown argument: --nope/);
    assert.match(r.stdout, /setup-inbox \[--config/);
    assert.doesNotMatch(r.stdout, /Static site generator/);
  });
});
