const { spawnSync } = require('child_process');

// Shared default subprocess runner. Mirrors inbox-cli's defaultRunWrangler but
// generalized to any command, so doctor/shell-env can inject a fake in tests.
// A timeout guards against a stalled child (e.g. a hung `wrangler whoami`)
// freezing the preflight; a timed-out or un-spawnable child yields code 1 with
// the underlying error code surfaced in `error`.
function runCommand(cmd, args, { timeoutMs = 30000 } = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs });
  return {
    code: res.status == null ? 1 : res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    error: res.error ? (res.error.code || res.error.message) : null,
  };
}

module.exports = { runCommand };
