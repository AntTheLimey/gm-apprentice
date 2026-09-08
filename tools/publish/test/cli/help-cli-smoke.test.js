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
  doctor: [/doctor \[--host/, /--set-cloudflare-creds/, /--json/, /doctor --site/],
  'setup-status-bar': [/setup-status-bar \[--config/, /--config <path>/],
  'setup-inbox': [/setup-inbox \[--config/, /--config <path>/],
  flush: [/flush \[--config/, /--dry-run/],
  sheet: [/sheet show --pc <name>/, /--player-safe/, /--json/],
  'update-pin': [/update-pin \[--site <dir>\]/, /--check/],
  manifest: [/manifest <diff\|apply>/, /--prune/],
  deploy: [/deploy \[--config <path>\] \[--verify\]/, /--dry-run/, /--no-build/],
  explain: [/explain <vault-relative path>/, /gm-only blocks/],
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

  it('sheet show --help prints the sheet usage and exits 0', async () => {
    const r = await runIn(['sheet', 'show', '--help']);
    assert.strictEqual(r.code, 0);
    assert.match(r.stdout, /sheet show --pc <name>/);
    assert.doesNotMatch(r.stdout, /Static site generator/);
  });

  it('sheet with an unknown verb prints the sheet usage and exits 1', async () => {
    const r = await runIn(['sheet', 'summon', '--pc', 'Jane']);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /Unknown sheet command: summon/);
    assert.match(r.stdout, /sheet show --pc <name>/);
  });

  it('sheet show without --pc prints the sheet usage and exits 1', async () => {
    const r = await runIn(['sheet', 'show']);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /--pc/);
    assert.match(r.stdout, /sheet show --pc <name>/);
    assert.doesNotMatch(r.stderr, /Cannot find module|ENOENT/);
  });

  it('an unknown flag on sheet show is rejected with usage, not executed', async () => {
    const r = await runIn(['sheet', 'show', '--pc', 'Jane', '--nope']);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /Unknown argument: --nope/);
    assert.match(r.stdout, /sheet show --pc <name>/);
  });

  it('manifest with an unknown verb prints the manifest usage and exits 1', async () => {
    const r = await runIn(['manifest', 'rebuild']);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /Unknown manifest command: rebuild/);
    assert.match(r.stdout, /manifest <diff\|apply>/);
  });

  it('a repeated --publish collects both paths rather than overwriting', async () => {
    // Reaching execution means the parser accepted both; the missing config is
    // what stops it, and that is a different error from "Unknown argument".
    const r = await runIn(['manifest', 'apply', '--publish', 'A.md', '--publish', 'B.md']);
    assert.doesNotMatch(r.stderr, /Unknown argument/);
  });

  // M8: --publish/--exclude/--decide move an entry between manifest sections —
  // only "apply" does that. Registering them for "diff" too meant the flag was
  // silently accepted and ignored rather than rejected as a typo.
  it('manifest diff rejects --publish/--exclude/--decide as unknown arguments', async () => {
    const publish = await runIn(['manifest', 'diff', '--publish', 'A.md']);
    assert.strictEqual(publish.code, 1);
    assert.match(publish.stderr, /Unknown argument: --publish/);
    assert.match(publish.stdout, /manifest <diff\|apply>/);

    const exclude = await runIn(['manifest', 'diff', '--exclude', 'A.md=reason']);
    assert.strictEqual(exclude.code, 1);
    assert.match(exclude.stderr, /Unknown argument: --exclude/);

    const decide = await runIn(['manifest', 'diff', '--decide', 'A.md']);
    assert.strictEqual(decide.code, 1);
    assert.match(decide.stderr, /Unknown argument: --decide/);
  });

  // P3: the verb forms of --help must print manifest's own usage, not fall through
  // to the top-level banner — the bug bare `manifest --help` never had.
  it('manifest diff --help and manifest apply --help print the manifest usage', async () => {
    for (const verb of ['diff', 'apply']) {
      const r = await runIn(['manifest', verb, '--help']);
      assert.strictEqual(r.code, 0);
      assert.match(r.stdout, /manifest <diff\|apply>/);
      assert.doesNotMatch(r.stdout, /Static site generator for gm-apprentice campaign vaults/);
    }
  });

  it('explain without a path prints the explain usage and exits 1', async () => {
    const r = await runIn(['explain']);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /explain needs a vault-relative path/);
    assert.match(r.stdout, /explain <vault-relative path>/);
  });

  it('a bad argument on setup-inbox prints setup-inbox usage, not the top-level banner', async () => {
    const r = await runIn(['setup-inbox', '--nope']);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /Unknown argument: --nope/);
    assert.match(r.stdout, /setup-inbox \[--config/);
    assert.doesNotMatch(r.stdout, /Static site generator/);
  });
});
