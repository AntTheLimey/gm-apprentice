const { describe, it } = require('node:test');
const assert = require('node:assert');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');

describe('CLI: gm-publish doctor', () => {
  it('--help lists the doctor command', async () => {
    const { stdout } = await execFileAsync(process.execPath, [CLI, '--help']);
    assert.ok(stdout.includes('doctor'), 'help mentions doctor');
  });

  it('doctor --json emits parseable JSON with the expected keys', async () => {
    // Real subprocess: git is present in CI; wrangler/gh may not be, so assert on
    // structure (keys exist), not on ok=true.
    let stdout;
    try {
      ({ stdout } = await execFileAsync(process.execPath, [CLI, 'doctor', '--json']));
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
