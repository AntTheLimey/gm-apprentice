const { spawnSync } = require('child_process');

// Shared default subprocess runner. Mirrors inbox-cli's defaultRunWrangler but
// generalized to any command, so doctor/shell-env can inject a fake in tests.
function runCommand(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  return { code: res.status == null ? 1 : res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

module.exports = { runCommand };
