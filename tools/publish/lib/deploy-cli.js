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
const { loadVaultConfig, siteConfigFor, outputFolderOf, loadPublishConfig } = require('./config');
const { buildHooks, HOOK_TIMEOUT_MS } = require('./settings/legacy');
const { nameIn } = require('./settings');
const { isGmOutput, gmEvidence } = require('./gm-site');

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
  return outputFolderOf(config) + '/';
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
  // The default build runs the function step first, as `gm-publish build` does, so a deploy
  // ships (and no longer ships) the functions the switches say.
  const build = d.build || (async (o) => {
    require('./sync-functions').syncSiteFunctionsOrWarn(o.configPath);
    await require('./fonts').prefetchForConfig(o.configPath);
    // Under --json stdout is the payload, so the vault's steps talk on stderr.
    return require('./build').build({ ...o, runSteps: true, ...(opts.json ? { stepsStdio: ['ignore', 2, 2], stepsLog: console.error } : {}) });
  });
  const fetchStatus = d.fetchStatus || defaultFetchStatus;
  const sleep = d.sleep || defaultSleep;
  const now = d.now || (() => new Date());

  const configPath = path.resolve(opts.configPath || './vault.config.json');
  const siteRoot = path.dirname(configPath);
  // With --json the payload is the whole of stdout, so progress and failure lines
  // are collected into it rather than printed alongside it.
  const messages = [];
  const say = (line) => { messages.push(line); if (!opts.json) out(line); };

  // The host, address, project name and output folder are the vault's settings, not the site file's.
  const rawConfig = loadVaultConfig(configPath, d);
  const vaultPath = rawConfig.vaultPath ? path.resolve(siteRoot, rawConfig.vaultPath) : null;
  const config = siteConfigFor(rawConfig, siteRoot, (m) => say(`WARNING: ${m}`));
  const host = config.host;
  const projectName = projectNameFor(config, siteRoot);
  const isCloudflare = host === 'cloudflare-pages';
  const outDir = outputDirArg(config);
  const tomlPath = path.join(siteRoot, 'wrangler.toml');
  const hasToml = exists(tomlPath);

  // The GM site never goes online: a player output folder that holds a GM build (the marker file, or a page with the
  // GM build tag) is refused before anything runs or is printed, whatever the flags.
  const outputFolder = path.join(siteRoot, outputFolderOf(config));
  if ((d.isGmOutput || isGmOutput)(outputFolder)) {
    const found = gmEvidence(outputFolder) || 'gm-build.json, or a page with the GM build tag';
    const line = `deploy refused: ${outputFolder} is a GM site folder (${found}). The GM site never goes online.`;
    if (opts.json) out(JSON.stringify({ host, built: false, deployed: false, url: null, verified: false, status: null, attempts: 0, commands: [], refused: true, messages: [line] }, null, 2));
    else out(line);
    return 1;
  }

  const commands = [];
  const wranglerDeployArgs = hasToml
    ? ['pages', 'deploy']
    : ['pages', 'deploy', outDir, `--project-name=${projectName}`, '--branch=main', '--commit-dirty=true'];

  // The vault's own steps run inside the build. A package.json hook is skipped only for a slot the settings hold steps
  // for (`before` stands in for prebuild, `after` for postbuild); any other runs here exactly as it always did.
  let vaultSteps = { before: [], after: [] };
  try {
    if (vaultPath) vaultSteps = loadPublishConfig(vaultPath, rawConfig, () => {}, { siteDir: siteRoot }).steps;
  } catch { /* a vault that cannot be read is reported by the build */ }
  const hookInfo = opts.noBuild ? { hooks: [], warning: null } : buildHooks(siteRoot, readFile);
  const hooks = hookInfo.hooks.filter((h) => !(h === 'prebuild' ? vaultSteps.before : vaultSteps.after).length);
  // A hook left out because the vault holds steps for that slot is said, so the two ways of publishing are not a surprise.
  for (const h of hookInfo.hooks.filter((x) => !hooks.includes(x))) {
    say(`\`${h}\` in package.json is not run by deploy: the vault holds ${h === 'prebuild' ? 'before_build' : 'after_build'} steps for that slot, and the tool runs those.`);
  }
  const platform = d.platform || process.platform;

  // A hiding-side settings fault stops the deploy, a dry run included, --no-build included (it throws; the CLI prints it once).
  (d.assertNoStopsFor || require('./config').assertNoStopsFor)(configPath, 'deploy');

  if (opts.dryRun) {
    if (hooks.includes('prebuild')) commands.push('npm run prebuild');
    if (!opts.noBuild) commands.push(...vaultSteps.before, `gm-publish build --config ${configPath}`, ...vaultSteps.after);
    if (hooks.includes('postbuild')) commands.push('npm run postbuild');
    if (isCloudflare) {
      commands.push('npx wrangler@4 whoami', `npx wrangler@4 ${wranglerDeployArgs.join(' ')}`);
    } else {
      commands.push(`git add ${outDir}`, `git commit -m "Rebuild site" --only -- ${outDir}`);
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

  if (hookInfo.warning) say(hookInfo.warning);
  let built = false;
  const buildFailed = (line) => {
    say(line);
    if (opts.json) out(JSON.stringify({ host, built: false, deployed: false, url: null, verified: false, status: null, attempts: 0, commands, messages }, null, 2));
    return 1;
  };
  // A site the GM turned off is neither built nor uploaded, --no-build included.
  const off = (d.siteOffFor || require('./config').siteOffFor)(configPath);
  if (off) return buildFailed(off);
  const runHook = (hook) => {
    commands.push(`npm run ${hook}`);
    // Output streams as it happens (a big image step runs for minutes); under --json it
    // goes to stderr so stdout stays the JSON payload. A shell on Windows, where npm is
    // npm.cmd and can't be spawned directly.
    const res = runCommand('npm', ['run', hook], {
      cwd: siteRoot, timeoutMs: HOOK_TIMEOUT_MS,
      stdio: opts.json ? ['ignore', 2, 2] : 'inherit',
      shell: platform === 'win32',
    });
    return res.code === 0 ? null : `${hook} failed: ${failureDetail(res)}`;
  };
  if (!opts.noBuild) {
    if (hookInfo.error) return buildFailed(hookInfo.error);
    if (hooks.includes('prebuild')) {
      const failed = runHook('prebuild');
      if (failed) return buildFailed(failed);
    }
    try {
      await build({ configPath, site: 'player' });
    } catch (err) {
      return buildFailed(`Build failed: ${err.message}`);
    }
    if (hooks.includes('postbuild')) {
      // A failed postbuild must not ship: the output is half-processed.
      const failed = runHook('postbuild');
      if (failed) return buildFailed(failed);
    }
    built = true;
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
    const add = git(['add', outDir]);
    if (add.code !== 0) {
      say(`Deploy failed: ${failureDetail(add)}`);
      return finish({}, 1);
    }
    const status = git(['status', '--porcelain', outDir]);
    if (status.code !== 0) {
      say(`Deploy failed: ${failureDetail(status)}`);
      return finish({}, 1);
    }
    if (String(status.stdout || '').trim() === '') {
      // Still push: the build may be unchanged while an earlier commit is unpushed.
      say(`nothing to commit — ${outDir} unchanged`);
    } else {
      const commit = git(['commit', '-m', 'Rebuild site', '--only', '--', outDir]);
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
    say(`no ${nameIn(vaultPath, 'player_site.url')} set — cannot verify; check the site by hand`);
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
