const fs = require('fs');

// Which persistent-env mechanism this OS/shell uses. Windows persists via setx;
// zsh reads ~/.zshenv for EVERY shell (interactive or not — the reason creds go
// there, not ~/.zshrc); bash and everything else fall back to ~/.bashrc.
function resolveShellTarget({ platform, env, homedir }) {
  if (platform === 'win32') return { kind: 'setx' };
  const shell = (env && env.SHELL) || '';
  if (shell.includes('zsh')) return { kind: 'file', path: `${homedir}/.zshenv` };
  return { kind: 'file', path: `${homedir}/.bashrc` };
}

// Pure: return fileContent with `export <name>="<value>"` present exactly once.
// Assumes a simple env var name ([A-Za-z0-9_]); value is written verbatim (a function
// replacer avoids $-sequence interpolation).
function upsertEnvExport(fileContent, name, value) {
  const line = `export ${name}="${value}"`;
  const re = new RegExp(`^export ${name}=.*$`, 'm');
  if (re.test(fileContent)) return fileContent.replace(re, () => line);
  if (fileContent === '') return line + '\n';
  const sep = fileContent.endsWith('\n') ? '' : '\n';
  return fileContent + sep + line + '\n';
}

// Perform the write. Returns the resolved target so the caller can report WHICH
// file was touched — never the value. Never logs/echoes the value.
function setPersistentEnv(name, value, { platform, env, homedir, runCommand } = {}) {
  const target = resolveShellTarget({ platform, env, homedir });
  if (target.kind === 'setx') {
    const run = runCommand || require('./run-command').runCommand;
    run('setx', [name, value]);
    return target;
  }
  const existing = fs.existsSync(target.path) ? fs.readFileSync(target.path, 'utf8') : '';
  fs.writeFileSync(target.path, upsertEnvExport(existing, name, value));
  return target;
}

module.exports = { resolveShellTarget, upsertEnvExport, setPersistentEnv };
