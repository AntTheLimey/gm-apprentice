const os = require('os');
const path = require('path');
const { runChecks } = require('./doctor');
const { setPersistentEnv } = require('./shell-env');
const { runCommand: defaultRunCommand } = require('./run-command');

const FIXES = {
  node: 'Install Node 22 LTS from https://nodejs.org (choose the LTS build).',
  git: 'Install git (macOS: `xcode-select --install`; Linux: your package manager; Windows: https://git-scm.com).',
  gh: 'Install the GitHub CLI (https://cli.github.com), then run `gh auth login`.',
  // A function: the line names this tool by its full path (no `gm-publish` command is on anyone's PATH).
  wrangler: () => `Create a Cloudflare API token (Cloudflare Pages: Edit), then in your own terminal window run \`${ownTerminalLine()}\`: it asks for the token and hides it.`,
};

function parseArgs(argv) {
  const o = { json: false, host: 'cloudflare-pages', setCreds: false, site: false, configPath: './vault.config.json', vaultPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') o.json = true;
    else if (argv[i] === '--set-cloudflare-creds') o.setCreds = true;
    else if (argv[i] === '--site') o.site = true;
    else if (argv[i] === '--host' && argv[i + 1]) { o.host = argv[i + 1]; i++; }
    else if (argv[i] === '--config' && argv[i + 1]) { o.configPath = argv[i + 1]; i++; }
    else if (argv[i] === '--vault' && argv[i + 1]) { o.vaultPath = argv[i + 1]; i++; }
  }
  return o;
}

function humanReport(out, result) {
  const mark = (b) => (b ? '✓' : '✗');
  out(`Publish preflight (host: ${result.host})`);
  const row = (key, label, extra = '') => {
    const c = result[key];
    out(`  ${mark(c.ok)} ${label}${c.version ? ` (${c.version})` : ''}${extra}`);
    if (!c.ok && FIXES[key]) out(`      → ${typeof FIXES[key] === 'function' ? FIXES[key]() : FIXES[key]}`);
  };
  row('node', 'Node ≥ 22');
  row('git', 'git');
  if (result.host === 'github-pages') {
    row('gh', 'GitHub CLI', result.gh.ok ? (result.gh.authed ? ' — authenticated' : ' — NOT authenticated: run `gh auth login`') : '');
  } else {
    row('wrangler', 'wrangler', result.wrangler.ok ? (result.wrangler.authed ? ` — authenticated${result.wrangler.accountId ? `, account ${result.wrangler.accountId}` : ''}` : ` — NOT authenticated: in your own terminal window, run \`${ownTerminalLine()}\``) : '');
  }
  out(result.ok ? 'All required checks passed.' : 'Some required checks failed — see fixes above.');
}

async function runDoctor(argv, deps = {}) {
  const out = deps.out || console.log;
  const runCommand = deps.runCommand || defaultRunCommand;
  const env = deps.env || process.env;
  const platform = deps.platform || process.platform;
  const homedir = deps.homedir || os.homedir();
  const opts = parseArgs(argv);

  // Two audits behind one command. Without --site this is the machine preflight it
  // has always been; with --site it is the vault's own health, which is a different
  // question with different fixes.
  if (opts.site) {
    const { runSiteDoctor } = require('./site-doctor');
    return runSiteDoctor({ configPath: opts.configPath, vaultPath: opts.vaultPath, json: opts.json }, deps);
  }

  if (opts.setCreds) {
    // In a terminal it asks for the token, hidden as it is pasted or typed: the one way in that works the same on
    // macOS, Linux and Windows, and keeps the token out of a chat (#877). Piped in, it reads it from stdin (scripts).
    const tty = deps.stdinIsTTY !== undefined ? deps.stdinIsTTY : (!deps.readStdin && Boolean(process.stdin.isTTY));
    const token = String(await (tty ? (deps.promptToken || promptHidden)(TOKEN_PROMPT) : (deps.readStdin || defaultReadStdin)())).trim();
    if (!token) {
      if (tty) { out('No token entered. Nothing written.'); return 1; }
      // Run where no one can type (an assistant's shell): say the line to run in a terminal of the GM's own.
      out('No token received. Nothing written. To save it, run this in your own terminal window; it asks for the token and hides it as you paste:');
      out(`  ${ownTerminalLine()}`);
      return 1;
    }
    // A Cloudflare API token is [A-Za-z0-9_-]. Reject anything else BEFORE it can
    // reach the shell-sourced env file. Never echo the token in the error.
    if (!/^[A-Za-z0-9_-]+$/.test(token)) {
      out('The token has unexpected characters — a Cloudflare API token is letters, digits, underscores, and hyphens only. Nothing written.');
      return 1;
    }
    env.CLOUDFLARE_API_TOKEN = token;
    const who = runCommand('npx', ['wrangler@4', 'whoami']);
    const verified = who.code === 0;
    const { parseAccountId } = require('./doctor');
    const accountId = verified ? parseAccountId(who.stdout) : null;
    const tgt = setPersistentEnv('CLOUDFLARE_API_TOKEN', token, { platform, env, homedir, runCommand });
    if (accountId) setPersistentEnv('CLOUDFLARE_ACCOUNT_ID', accountId, { platform, env, homedir, runCommand });
    const where = tgt.kind === 'setx' ? 'your Windows user environment' : tgt.path;
    out(`Cloudflare token saved to ${where}${accountId ? ` (account ${accountId})` : ''}.`);
    out(verified ? 'Verified with wrangler whoami.' : 'Warning: could not verify with wrangler whoami — re-open your terminal and run `npx wrangler@4 whoami`.');
    // setx saves for programs started from now on: one already open (the assistant's app, a terminal) still lacks it.
    if (tgt.kind === 'setx') out(WINDOWS_RESTART);
    return verified ? 0 : 1;
  }

  const result = runChecks({ runCommand, host: opts.host, nodeVersion: deps.nodeVersion });
  if (opts.json) out(JSON.stringify(result));
  else humanReport(out, result);
  return result.ok ? 0 : 1;
}

const TOKEN_PROMPT = 'Paste your Cloudflare API token (it will not show), then press Enter: ';
const WINDOWS_RESTART = 'On Windows, close and reopen the app your assistant runs in, and any terminal windows, before you publish: programs that were already open do not see the saved token until they start again.';

// The line a GM runs in a terminal of their own: this tool by its full path, under node (which publishing needs
// anyway, on every OS, where python3 may not be a command).
function ownTerminalLine() {
  return `node "${path.resolve(__dirname, '..', 'bin', 'gm-publish.js')}" doctor --set-cloudflare-creds`;
}

// Ask for one line with nothing echoed: the prompt shows, what is typed or pasted does not. Ctrl-C or the end of
// input answers ''.
function promptHidden(prompt, { input = process.stdin, output = process.stdout } = {}) {
  const readline = require('readline');
  const { Writable } = require('stream');
  return new Promise((resolve) => {
    let muted = false;
    const sink = new Writable({ write(chunk, encoding, cb) { if (!muted) output.write(chunk, encoding); cb(); } });
    const rl = readline.createInterface({ input, output: sink, terminal: true });
    let done = false;
    const finish = (answer) => {
      if (done) return;
      done = true;
      rl.close();
      output.write('\n');
      resolve(answer);
    };
    rl.on('SIGINT', () => finish(''));
    rl.on('close', () => finish(''));
    rl.question(prompt, finish);
    muted = true;
  });
}

// Piped input, to its end. A pipe left open with nothing in it (a shell that never closes stdin) answers '' after a
// moment rather than waiting forever, so the line for the GM's own terminal still prints.
function defaultReadStdin(stdin = process.stdin, idleMs = 2000) {
  return new Promise((resolve) => {
    let data = '';
    let settled = false;
    const settle = (v) => { if (settled) return; settled = true; clearTimeout(idle); stdin.pause(); resolve(v); };
    const idle = setTimeout(() => { if (!data) settle(''); }, idleMs);
    stdin.setEncoding('utf8');
    stdin.on('data', (c) => { data += c; });
    stdin.on('end', () => settle(data));
  });
}

module.exports = { runDoctor, parseArgs, promptHidden, ownTerminalLine, defaultReadStdin, WINDOWS_RESTART };
