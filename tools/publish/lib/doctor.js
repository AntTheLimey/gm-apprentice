// A Cloudflare Account ID is 32 lowercase hex chars. whoami prints it in the
// "Account ID" column; grab the first such token.
function parseAccountId(whoamiText) {
  const m = String(whoamiText).match(/\b([0-9a-f]{32})\b/);
  return m ? m[1] : null;
}

function checkCommand(runCommand, cmd, args) {
  const res = runCommand(cmd, args);
  const ok = res.code === 0;
  const version = ok ? ((res.stdout || '').split('\n')[0].trim() || null) : null;
  return { ok, version };
}

const wrangler = (runCommand, sub) => runCommand('npx', ['wrangler@4', ...sub]);

function runChecks({ runCommand, host, nodeVersion }) {
  const nodeV = nodeVersion || process.version;
  const nodeMajor = parseInt(String(nodeV).replace(/^v/, '').split('.')[0], 10);
  const node = { ok: nodeMajor >= 22, version: nodeV };

  const git = checkCommand(runCommand, 'git', ['--version']);

  const h = host === 'github-pages' ? 'github-pages' : 'cloudflare-pages';

  // Only check the deploy tool the selected host actually uses. Spawning the
  // other one is wasted work — for github-pages users it triggers a slow cold
  // `npx wrangler@4` download from the npm registry for a tool they never use.
  let gh = { ok: false, version: null, authed: false };
  let wrang = { ok: false, version: null, authed: false, accountId: null };

  if (h === 'github-pages') {
    const ghVer = checkCommand(runCommand, 'gh', ['--version']);
    gh = { ok: ghVer.ok, version: ghVer.version, authed: runCommand('gh', ['auth', 'status']).code === 0 };
  } else {
    const wVer = wrangler(runCommand, ['--version']);
    const wOk = wVer.code === 0;
    const who = wOk ? wrangler(runCommand, ['whoami']) : { code: 1, stdout: '', stderr: '' };
    wrang = {
      ok: wOk,
      version: wOk ? ((wVer.stdout || '').split('\n')[0].trim() || null) : null,
      authed: who.code === 0,
      accountId: who.code === 0 ? parseAccountId(who.stdout) : null,
    };
  }

  const required = h === 'github-pages' ? ['node', 'git', 'gh'] : ['node', 'git', 'wrangler'];
  const byKey = { node, git, gh, wrangler: wrang };
  // Overall ok: every required tool present, and the host's deploy tool authed.
  const deployTool = h === 'github-pages' ? gh : wrang;
  const ok = required.every((k) => byKey[k].ok) && deployTool.authed;

  return { node, git, gh, wrangler: wrang, host: h, required, ok };
}

module.exports = { parseAccountId, checkCommand, runChecks };
