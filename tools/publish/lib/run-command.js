const { spawnSync } = require('child_process');

// Shared default subprocess runner. Mirrors inbox-cli's defaultRunWrangler but
// generalized to any command, so doctor/shell-env can inject a fake in tests.
// A timeout guards against a stalled child (e.g. a hung `wrangler whoami`)
// freezing the preflight; a timed-out or un-spawnable child yields code 1 with
// the underlying error code surfaced in `error`.
// Every wrangler entry point (inbox poll, flush, backend setup) shares this
// bound. 60s rather than the 30s default because a cold `npx wrangler@4` may
// have to fetch the package before it does any work.
const WRANGLER_TIMEOUT_MS = 60000;

function runCommand(cmd, args, { timeoutMs = 30000, cwd } = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs, ...(cwd ? { cwd } : {}) });
  return {
    code: res.status == null ? 1 : res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    error: res.error ? (res.error.code || res.error.message) : null,
  };
}

// Best available description of a failed run, for a message a human will read.
//
// spawnSync reports a timeout or an un-spawnable command through `error`, leaving
// stdout and stderr empty — so a diagnostic assembled from those two alone renders
// blank, which reads exactly like a silent success. That makes the timeouts above
// worse than useless: the call stops hanging but says nothing about why. Prefer real
// output, fall back to the process error, then to the exit code.
function failureDetail(res) {
  return (res.stderr || '').trim()
    || (res.stdout || '').trim()
    || (res.error ? String(res.error) : '')
    || ('exit ' + res.code);
}

module.exports = { runCommand, WRANGLER_TIMEOUT_MS, failureDetail };
