const { describe, it } = require('node:test');
const assert = require('node:assert');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const os = require('os');

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');

describe('CLI: gm-publish doctor', () => {
  it('--help lists the doctor command', async () => {
    const { stdout } = await execFileAsync(process.execPath, [CLI, '--help']);
    assert.ok(stdout.includes('doctor'), 'help mentions doctor');
  });

  it('doctor --json emits parseable JSON with the expected keys', async () => {
    // Real subprocess exercises the bin -> runDoctor -> JSON dispatch wiring. We
    // point the child's PATH at a directory that does not exist so its internal
    // spawnSync('npx'|'git'|'gh', ...) calls fail fast with ENOENT instead of
    // resolving real tools — no network, and crucially no `npx wrangler@4`
    // downloading wrangler + workerd from the registry on a cold CI runner.
    // node.ok is derived from process.version (no subprocess), so it still holds;
    // git/gh/wrangler report ok:false quickly. process.execPath is absolute, so
    // the parent still finds node despite the broken PATH the child inherits.
    const badDir = path.join(os.tmpdir(), 'gm-nonexistent-bin-dir-xyz');
    let stdout;
    try {
      ({ stdout } = await execFileAsync(process.execPath, [CLI, 'doctor', '--json'], {
        env: { ...process.env, PATH: badDir },
      }));
    } catch (err) {
      // doctor exits non-zero when optional tools are missing; JSON is still on stdout.
      stdout = err.stdout;
    }
    const parsed = JSON.parse(stdout.trim().split('\n').pop());
    for (const k of ['node', 'git', 'wrangler', 'host', 'required', 'ok']) {
      assert.ok(k in parsed, `json has ${k}`);
    }
    assert.strictEqual(parsed.node.ok, true); // CI Node is ≥22
  });
});
