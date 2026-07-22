const os = require('os');
const { runChecks } = require('./doctor');
const { setPersistentEnv } = require('./shell-env');
const { runCommand: defaultRunCommand } = require('./run-command');

const FIXES = {
  node: 'Install Node 22 LTS from https://nodejs.org (choose the LTS build).',
  git: 'Install git (macOS: `xcode-select --install`; Linux: your package manager; Windows: https://git-scm.com).',
  gh: 'Install the GitHub CLI (https://cli.github.com), then run `gh auth login`.',
  wrangler: 'Create a Cloudflare API token (Account · Cloudflare Pages · Edit), then run `gm-publish doctor --set-cloudflare-creds` and paste it.',
};

function parseArgs(argv) {
  const o = { json: false, host: 'cloudflare-pages', setCreds: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') o.json = true;
    else if (argv[i] === '--set-cloudflare-creds') o.setCreds = true;
    else if (argv[i] === '--host' && argv[i + 1]) { o.host = argv[i + 1]; i++; }
  }
  return o;
}

function humanReport(out, result) {
  const mark = (b) => (b ? '✓' : '✗');
  out(`Publish preflight (host: ${result.host})`);
  const row = (key, label, extra = '') => {
    const c = result[key];
    out(`  ${mark(c.ok)} ${label}${c.version ? ` (${c.version})` : ''}${extra}`);
    if (!c.ok && FIXES[key]) out(`      → ${FIXES[key]}`);
  };
  row('node', 'Node ≥ 22');
  row('git', 'git');
  if (result.host === 'github-pages') {
    row('gh', 'GitHub CLI', result.gh.ok ? (result.gh.authed ? ' — authenticated' : ' — NOT authenticated: run `gh auth login`') : '');
  } else {
    row('wrangler', 'wrangler', result.wrangler.ok ? (result.wrangler.authed ? ` — authenticated${result.wrangler.accountId ? `, account ${result.wrangler.accountId}` : ''}` : ' — NOT authenticated: `gm-publish doctor --set-cloudflare-creds`') : '');
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

  if (opts.setCreds) {
    const readStdin = deps.readStdin || defaultReadStdin;
    const token = String(await readStdin()).trim();
    if (!token) { out('No token received on stdin. Nothing written.'); return 1; }
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
    return verified ? 0 : 1;
  }

  const result = runChecks({ runCommand, host: opts.host, nodeVersion: deps.nodeVersion });
  if (opts.json) out(JSON.stringify(result));
  else humanReport(out, result);
  return result.ok ? 0 : 1;
}

function defaultReadStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    if (process.stdin.isTTY) resolve(''); // no piped input
  });
}

module.exports = { runDoctor, parseArgs };
