'use strict';

// `deploy` command: build the site, push it to whichever host the config names,
// and then actually look at the URL.
//
// The rebuild path used to be prose the model followed — branch on host, remember
// which wrangler form this site needs, remember to align wrangler.toml's project
// name, remember to curl the site afterwards. Each of those has been got wrong.
// The routine pair is now `update-pin` then `deploy --verify`.
//
// Verification is advisory: a deploy that succeeded but has not propagated yet is
// not a failed deploy, so a 404 on the third try still exits 0 and says why.
const fs = require('fs');
const path = require('path');
const { failureDetail } = require('./run-command');
const { alignProjectName } = require('./setup-backend');

const VERIFY_ATTEMPTS = 3;
const VERIFY_WAIT_MS = 20000;
const FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;

const CLOUDFLARE_AUTH_FIX =
  'Cloudflare credentials are not set up. Run `gm-publish doctor --set-cloudflare-creds` and paste ' +
  'an API token with the Account · Cloudflare Pages · Edit permission, then re-run deploy.';

// A Cloudflare Pages project name is lowercase alphanumerics and hyphens.
function projectNameFor(config, siteRoot) {
  return config.cloudflarePagesProject
    || path.basename(siteRoot).toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

// The build's output directory as wrangler wants it: a trailing-slash relative path.
function outputDirArg(config) {
  const raw = String(config.outputDir || './docs').replace(/^\.\//, '').replace(/\/+$/, '');
  return (raw || 'docs') + '/';
}

// GET the URL and hand back the status, following redirects. Resolves null on any
// transport failure or timeout — "the host did not answer" is a legitimate answer
// during propagation, not an error to throw.
function defaultFetchStatus(url, depth = 0) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    let request;
    try {
      const target = new URL(url);
      const client = target.protocol === 'https:' ? require('https') : require('http');
      request = client.get(target, { timeout: FETCH_TIMEOUT_MS }, (res) => {
        const status = res.statusCode;
        const location = res.headers && res.headers.location;
        res.resume();
        if (location && status >= 300 && status < 400 && depth < MAX_REDIRECTS) {
          finish(defaultFetchStatus(new URL(location, target).toString(), depth + 1));
          return;
        }
        finish(status);
      });
    } catch {
      finish(null);
      return;
    }
    request.on('timeout', () => { request.destroy(); finish(null); });
    request.on('error', () => finish(null));
  });
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runDeploy(options, deps) {
  const opts = options || {};
  const d = deps || {};
  const out = d.out || console.log;
  const readFile = d.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const writeFile = d.writeFile || ((p, c) => fs.writeFileSync(p, c));
  const exists = d.exists || ((p) => fs.existsSync(p));
  const runCommand = d.runCommand || require('./run-command').runCommand;
  const runWrangler = d.runWrangler || require('./setup-backend').defaultRunWrangler;
  const build = d.build || ((o) => require('./build').build(o));
  const fetchStatus = d.fetchStatus || defaultFetchStatus;
  const sleep = d.sleep || defaultSleep;
  const now = d.now || (() => new Date());

  const configPath = path.resolve(opts.configPath || './vault.config.json');
  const siteRoot = path.dirname(configPath);
  const config = d.config || require(configPath);
  const host = config.host || 'github-pages';
  const projectName = projectNameFor(config, siteRoot);
  const isCloudflare = host === 'cloudflare-pages';
  const outDir = outputDirArg(config);
  const tomlPath = path.join(siteRoot, 'wrangler.toml');
  const hasToml = exists(tomlPath);

  // With --json the payload is the whole of stdout, so progress and failure lines
  // are collected into it rather than printed alongside it.
  const messages = [];
  const say = (line) => { messages.push(line); if (!opts.json) out(line); };

  const commands = [];
  const wranglerDeployArgs = hasToml
    ? ['pages', 'deploy']
    : ['pages', 'deploy', outDir, `--project-name=${projectName}`, '--branch=main', '--commit-dirty=true'];

  if (opts.dryRun) {
    if (!opts.noBuild) commands.push(`gm-publish build --config ${configPath}`);
    if (isCloudflare) {
      commands.push('npx wrangler@4 whoami', `npx wrangler@4 ${wranglerDeployArgs.join(' ')}`);
    } else {
      commands.push(`git add ${outDir}`, 'git commit -m "Rebuild site"');
      // Whether the push needs -u depends on the branch's upstream, which a dry run
      // can only learn by asking git — a read-only rev-parse, so running it here
      // doesn't violate "nothing will run".
      const upstream = runCommand('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: siteRoot });
      commands.push(upstream.code === 0 ? 'git push' : 'git push -u origin HEAD');
    }
    if (opts.json) {
      out(JSON.stringify({
        host, built: false, deployed: false, url: config.siteUrl || (isCloudflare ? `https://${projectName}.pages.dev` : null),
        verified: false, status: null, attempts: 0, commands, dryRun: true,
      }, null, 2));
      return 0;
    }
    out('DRY RUN — nothing will run.');
    for (const command of commands) out(`  ${command}`);
    return 0;
  }

  let built = false;
  if (!opts.noBuild) {
    try {
      build({ configPath });
      built = true;
    } catch (err) {
      say(`Build failed: ${err.message}`);
      if (opts.json) out(JSON.stringify({ host, built: false, deployed: false, url: null, verified: false, status: null, attempts: 0, commands, messages }, null, 2));
      return 1;
    }
  }

  const finish = (payload, rc) => {
    if (opts.json) {
      out(JSON.stringify(Object.assign({
        host, built, deployed: false, url: null, verified: false, status: null,
        attempts: 0, commands, messages, deployedAt: now().toISOString(),
      }, payload), null, 2));
    }
    return rc;
  };

  if (isCloudflare) {
    const who = runWrangler(['whoami'], { cwd: siteRoot });
    if (who.code !== 0) {
      say(CLOUDFLARE_AUTH_FIX);
      return finish({}, 1);
    }
    if (hasToml) {
      // A bare `pages deploy` publishes to whatever project wrangler.toml names.
      const toml = readFile(tomlPath);
      const aligned = alignProjectName(toml, projectName);
      if (aligned !== toml) {
        writeFile(tomlPath, aligned);
        say(`wrangler.toml project name aligned to "${projectName}"`);
      }
    }
    commands.push(`npx wrangler@4 ${wranglerDeployArgs.join(' ')}`);
    const deployed = runWrangler(wranglerDeployArgs, { cwd: siteRoot });
    if (deployed.code !== 0) {
      say(`Deploy failed: ${failureDetail(deployed)}`);
      return finish({}, 1);
    }
  } else {
    const git = (args) => {
      commands.push(`git ${args.join(' ')}`);
      return runCommand('git', args, { cwd: siteRoot });
    };
    git(['add', outDir]);
    const status = git(['status', '--porcelain', outDir]);
    if (String(status.stdout || '').trim() === '') {
      // Still push: the build may be unchanged while an earlier commit is unpushed.
      say(`nothing to commit — ${outDir} unchanged`);
    } else {
      const commit = git(['commit', '-m', 'Rebuild site']);
      if (commit.code !== 0) {
        say(`Commit failed: ${failureDetail(commit)}`);
        return finish({}, 1);
      }
    }
    // A brand-new repo's current branch has no upstream yet, so a bare `git push`
    // fails with "no upstream branch" — exactly the first-deploy case the setup
    // wizard walks a user through. Check first and set the upstream on that push;
    // once it's set, every later push keeps using the bare form.
    const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    const hasUpstream = upstream.code === 0;
    if (!hasUpstream) say('no upstream branch yet — pushing with -u origin HEAD');
    const push = git(hasUpstream ? ['push'] : ['push', '-u', 'origin', 'HEAD']);
    if (push.code !== 0) {
      say(`Push failed: ${failureDetail(push)}`);
      return finish({}, 1);
    }
  }

  const url = config.siteUrl || (isCloudflare ? `https://${projectName}.pages.dev` : null);
  if (!opts.verify) {
    say(url ? `Deployed. ${url}` : 'Deployed.');
    return finish({ deployed: true, url }, 0);
  }

  if (!url) {
    say('no siteUrl in vault.config.json — cannot verify; check the site by hand');
    return finish({ deployed: true, url: null }, 0);
  }

  let status = null;
  let attempts = 0;
  for (let i = 0; i < VERIFY_ATTEMPTS; i++) {
    if (i > 0) await sleep(VERIFY_WAIT_MS);
    attempts++;
    status = await fetchStatus(url);
    if (status >= 200 && status < 300) {
      say(`live at ${url}`);
      return finish({ deployed: true, url, verified: true, status, attempts }, 0);
    }
  }

  // The deploy itself succeeded; propagation is the host's business, not a failure
  // to report as one.
  say(`deployed, but ${url} returned ${status == null ? 'no response' : status} after ${VERIFY_ATTEMPTS} tries — the host is still propagating; check it in a minute`);
  return finish({ deployed: true, url, verified: false, status, attempts }, 0);
}

module.exports = { runDeploy, defaultFetchStatus, projectNameFor, outputDirArg };
