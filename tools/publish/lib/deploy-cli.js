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
const { failureDetail, WRANGLER_DEPLOY_TIMEOUT_MS } = require('./run-command');
const { alignProjectName } = require('./setup-backend');
const { loadVaultConfig, siteConfigFor, outputFolderOf, tomlOutputFolder, loadPublishConfig } = require('./config');
const { buildHooks, HOOK_TIMEOUT_MS } = require('./settings/legacy');
const { nameIn } = require('./settings');
const { gmEvidence } = require('./gm-site');
const leakGateLib = require('./leak-gate');

const VERIFY_ATTEMPTS = 3;
const VERIFY_WAIT_MS = 20000;
// Once the deployment answers, the site's own address gets about 30 seconds to serve the same page.
const SAME_PAGE_ATTEMPTS = 4;
const SAME_PAGE_WAIT_MS = 10000;
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

// GET the URL, following redirects, and hand back {status, body}. Resolves {status: null, body: null} on any
// transport failure or timeout — "the host did not answer" is a legitimate answer during propagation, not an
// error to throw. The body is read only when asked for, and capped.
const MAX_BODY_BYTES = 5 * 1024 * 1024;
function fetchGet(url, wantBody, depth = 0) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const none = { status: null, body: null };
    let request;
    try {
      const target = new URL(url);
      const client = target.protocol === 'https:' ? require('https') : require('http');
      request = client.get(target, { timeout: FETCH_TIMEOUT_MS }, (res) => {
        const status = res.statusCode;
        const location = res.headers && res.headers.location;
        if (location && status >= 300 && status < 400 && depth < MAX_REDIRECTS) {
          res.resume();
          finish(fetchGet(new URL(location, target).toString(), wantBody, depth + 1));
          return;
        }
        if (!wantBody) {
          res.resume();
          finish({ status, body: null });
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) { request.destroy(); finish(none); return; }
          chunks.push(chunk);
        });
        res.on('end', () => finish({ status, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', () => finish(none));
      });
    } catch {
      finish(none);
      return;
    }
    request.on('timeout', () => { request.destroy(); finish(none); });
    request.on('error', () => finish(none));
  });
}

const defaultFetchStatus = async (url) => (await fetchGet(url, false)).status;
// The page at the address, or null when it did not answer with a 2xx.
const defaultFetchBody = async (url) => {
  const got = await fetchGet(url, true);
  return got.status >= 200 && got.status < 300 ? got.body : null;
};

// The address wrangler prints for the deployment it just made (https://<8 hex>.<project>.pages.dev), the one
// thing that tells this build apart from the previous one still answering at the site's own address (#350).
// Wrangler's line is "Take a peek over at <address>"; failing that, the first address of that shape.
function deploymentUrlFrom(text) {
  const plain = String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
  const peek = plain.match(/peek over at\s+(https:\/\/[0-9a-f]{8}\.[a-z0-9-]+\.pages\.dev)/i);
  const any = plain.match(/https:\/\/[0-9a-f]{8}\.[a-z0-9-]+\.pages\.dev/i);
  return peek ? peek[1] : any ? any[0] : null;
}

// wrangler prints "Deployment alias URL: <address>" after the deployment address. A production deployment's alias is
// the project's own address (<project>.pages.dev); a preview's carries the branch in front (<branch>.<project>.pages.dev).
function aliasUrlFrom(text) {
  const plain = String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
  const m = plain.match(/Deployment alias URL:\s*(https:\/\/[a-z0-9.-]+\.pages\.dev)/i);
  return m ? m[1] : null;
}

function isPreviewAlias(alias) {
  if (!alias) return false;
  return alias.replace(/^https:\/\//, '').split('.').length > 3;
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
  const fetchBody = d.fetchBody || defaultFetchBody;
  const sleep = d.sleep || defaultSleep;
  const now = d.now || (() => new Date());
  const { formatFindings, gateSummary } = leakGateLib;
  const leakGate = d.leakGate || leakGateLib.runLeakGate;

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
  // With a wrangler.toml, wrangler uploads the folder the toml names, so that folder is checked too.
  const outputFolder = path.resolve(siteRoot, outputFolderOf(config));
  const readTomlSafely = () => { try { return readFile(tomlPath); } catch { return ''; } };
  const tomlFolder = hasToml ? tomlOutputFolder(readTomlSafely(), siteRoot) : null;
  const evidenceOf = d.gmEvidence || gmEvidence;
  const gmFolder = [outputFolder, tomlFolder].filter(Boolean).find((f) => evidenceOf(f));
  if (gmFolder) {
    const found = evidenceOf(gmFolder);
    const line = `deploy refused: ${gmFolder} is a GM site folder (${found}). The GM site never goes online.`;
    if (opts.json) out(JSON.stringify({ host, built: false, deployed: false, url: null, verified: false, status: null, attempts: 0, commands: [], refused: true, messages: [line] }, null, 2));
    else out(line);
    return 1;
  }

  const commands = [];
  const wranglerDeployArgs = hasToml
    ? ['pages', 'deploy', '--branch=main', '--commit-dirty=true']
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

  // The leak gate (#293): the folder that would be uploaded, after the build, its steps and any postbuild script.
  // It reads and never writes; a gate that cannot run stops the deploy (it fails closed). --ignore-leaks deploys past a
  // finding, or a gate that cannot run, on purpose: every finding is still printed, and the payload says so.
  const ignoreLeaks = !!opts.ignoreLeaks;
  const IGNORED = 'Deploying anyway: --ignore-leaks was given, so these go online as they are.';
  const gateFolder = tomlFolder || outputFolder;
  const checkLeaks = () => {
    try { return { result: leakGate({ configPath, outputDir: gateFolder }) }; } catch (err) {
      return { result: null, line: `The leak check could not run: ${err.message}. Nothing was uploaded.` };
    }
  };
  let gateResult = null;

  let built = false;
  const buildFailed = (line) => {
    say(line);
    if (opts.json) out(JSON.stringify({ host, built: false, deployed: false, url: null, verified: false, status: null, attempts: 0, commands, messages }, null, 2));
    return 1;
  };
  // A site the GM turned off is neither built nor uploaded, --no-build and --dry-run included.
  const off = (d.siteOffFor || require('./config').siteOffFor)(configPath);
  if (off) return buildFailed(off);

  if (hookInfo.warning && !opts.dryRun) say(hookInfo.warning);
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
    // The gate reads the folder as it stands; it writes nothing, so a dry run may run it.
    const gate = checkLeaks();
    const leakLines = gate.result ? [...(gate.result.warnings || [])] : [];
    const leaky = !gate.result || gate.result.findings.length > 0;
    const refuse = leaky && !ignoreLeaks;
    if (!gate.result) leakLines.push(gate.line.replace(' Nothing was uploaded.', '') + (ignoreLeaks ? ' Deploy would go ahead anyway (--ignore-leaks).' : ''));
    else if (gate.result.missing) leakLines.push(`Leak check: there is no built site in ${gateFolder} yet, so nothing to check.`);
    else if (gate.result.skipped) leakLines.push(gate.result.skipped);
    else if (leaky) {
      const n = gate.result.findings.length;
      leakLines.push(ignoreLeaks ? `Leak check: ${n} finding${n === 1 ? '' : 's'}; deploy would go ahead anyway (--ignore-leaks).`
        : `Leak check: deploy would stop: ${n} finding${n === 1 ? '' : 's'}.`, ...formatFindings(gate.result));
    } else leakLines.push(`Leak check: nothing hidden on the player site (${gate.result.files} files).`);
    if (opts.json) {
      out(JSON.stringify({
        host, built: false, deployed: false, url: config.siteUrl || (isCloudflare ? `https://${projectName}.pages.dev` : null),
        verified: false, status: null, attempts: 0, commands, dryRun: true,
        ...(gate.result ? { leaks: gateSummary(gate.result) } : {}),
        ...(refuse ? { wouldRefuse: true } : {}),
        ...(leaky && ignoreLeaks ? { leaksIgnored: true } : {}),
        ...(gate.result ? {} : { messages: leakLines }),
      }, null, 2));
      return refuse ? 1 : 0;
    }
    out('DRY RUN — nothing will run.');
    for (const command of commands) out(`  ${command}`);
    for (const line of leakLines) out(line);
    return refuse ? 1 : 0;
  }

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
        ...(gateResult ? { leaks: gateSummary(gateResult) } : {}),
        ...(leaksIgnored ? { leaksIgnored: true } : {}),
      }, payload), null, 2));
    }
    return rc;
  };

  const gate = checkLeaks();
  gateResult = gate.result;
  let leaksIgnored = false;
  if (!gateResult && ignoreLeaks && !exists(gateFolder)) {
    say(gate.line);
    say(`deploy stopped: there is no built site in ${gateFolder} to upload.`);
    return finish({ refused: true }, 1);
  } else if (!gateResult && ignoreLeaks) {
    say(gate.line.replace(' Nothing was uploaded.', ''));
    say(IGNORED);
    leaksIgnored = true;
  } else if (!gateResult) { say(gate.line); return finish({ refused: true }, 1); }
  if (gateResult) for (const line of gateResult.warnings || []) say(line);
  if (gateResult && gateResult.skipped) say(gateResult.skipped);
  if (gateResult && gateResult.missing) {
    say(`deploy stopped: there is no built site in ${gateFolder} to check. Nothing was uploaded.`);
    return finish({ refused: true }, 1);
  }
  if (gateResult && gateResult.findings.length && ignoreLeaks) {
    const n = gateResult.findings.length;
    say(`Leak check: hidden text, a secret name or a never-show word is on the player site (${n} finding${n === 1 ? '' : 's'}).`);
    for (const line of formatFindings(gateResult)) say(line);
    say(IGNORED);
    leaksIgnored = true;
  } else if (gateResult && gateResult.findings.length) {
    const n = gateResult.findings.length;
    say(`deploy stopped: hidden text, a secret name or a never-show word is on the player site (${n} finding${n === 1 ? '' : 's'}). Nothing was uploaded.`);
    for (const line of formatFindings(gateResult)) say(line);
    say('Fix each note, or accept a finding with gm-apprentice-publish leaks accept <page> <id>. leaks list shows them again.');
    return finish({ refused: true }, 1);
  } else if (gateResult && !gateResult.skipped) say(`Leak check: nothing hidden on the player site (${gateResult.files} files, ${gateResult.seconds.toFixed(1)} s).`);

  let deploymentUrl = null;
  let aliasUrl = null;
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
    const deployed = runWrangler(wranglerDeployArgs, { cwd: siteRoot, timeoutMs: WRANGLER_DEPLOY_TIMEOUT_MS });
    // A killed upload can come back with a zero exit status; a set error or signal is a failure all the same.
    if (deployed.code !== 0 || deployed.error || deployed.signal) {
      say(deployed.error === 'ETIMEDOUT'
        ? `Deploy failed: the upload did not finish within ${WRANGLER_DEPLOY_TIMEOUT_MS / 60000} minutes, so it may not have been deployed. \`npx wrangler@4 pages deployment list\` shows whether it was. Run deploy again.`
        : `Deploy failed: ${failureDetail(deployed)}`);
      return finish({}, 1);
    }
    const wranglerText = `${deployed.stdout || ''}\n${deployed.stderr || ''}`;
    deploymentUrl = deploymentUrlFrom(wranglerText);
    aliasUrl = aliasUrlFrom(wranglerText);
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

  // On Cloudflare the site's own address is still answered by the previous deployment until this one is promoted, so a
  // 200 there proves nothing: check the address wrangler gave this deployment. Without one, say so and fail.
  if (isCloudflare && !deploymentUrl) {
    say(`deployed, but could not confirm which build is served: wrangler printed no address for this deployment. Run \`npx wrangler@4 pages deployment list\` to see whether it exists.`);
    return finish({ deployed: true, url, verified: false }, 1);
  }
  if (isCloudflare && isPreviewAlias(aliasUrl)) {
    say(`deployed as a preview, not to the site's address: wrangler gave it ${aliasUrl}, so ${url} still serves the earlier build. Most likely the Cloudflare project's production branch is not \`main\`, and this deploy sends to \`main\`. To fix it, set the project's production branch to \`main\` in the Cloudflare dashboard (Workers & Pages, the project, Settings, Branch control), then deploy again.`);
    return finish({ deployed: true, url, verified: false, preview: true, deploymentUrl, aliasUrl }, 1);
  }
  const target = isCloudflare ? deploymentUrl : url;

  let status = null;
  let attempts = 0;
  for (let i = 0; i < VERIFY_ATTEMPTS; i++) {
    if (i > 0) await sleep(VERIFY_WAIT_MS);
    attempts++;
    status = await fetchStatus(target);
    if (status >= 200 && status < 300) {
      if (isCloudflare) {
        // The deployment's own address answering does not prove the site's address serves it: compare one
        // file from each. The search index is JSON, which a custom domain's Cloudflare features (e-mail
        // obfuscation, Rocket Loader) never rewrite as they can a page; a site without search compares `/`.
        const at = (address, file) => `${address.replace(/\/+$/, '')}/${file}`;
        const file = (await fetchBody(at(deploymentUrl, 'search-index.json'))) != null ? 'search-index.json' : '';
        let same = false;
        for (let k = 0; k < SAME_PAGE_ATTEMPTS && !same; k++) {
          if (k > 0) await sleep(SAME_PAGE_WAIT_MS);
          const [onSite, onDeployment] = await Promise.all([fetchBody(at(url, file)), fetchBody(at(deploymentUrl, file))]);
          same = onSite != null && onSite === onDeployment;
        }
        if (!same) {
          say(`the deployment is up at ${deploymentUrl}, but ${url} still serves an earlier build`);
          return finish({ deployed: true, url, verified: false, status, attempts, deploymentUrl, siteServesDeployment: false }, 1);
        }
        say(`live at ${url}`);
        return finish({ deployed: true, url, verified: true, status, attempts, deploymentUrl, siteServesDeployment: true }, 0);
      }
      say(`live at ${target}`);
      return finish({ deployed: true, url, verified: true, status, attempts, ...(isCloudflare ? { deploymentUrl } : {}) }, 0);
    }
  }

  // The deploy itself succeeded; propagation is the host's business, not a failure
  // to report as one.
  say(`deployed, but ${target} returned ${status == null ? 'no response' : status} after ${VERIFY_ATTEMPTS} tries — the host is still propagating; check it in a minute`);
  return finish({ deployed: true, url, verified: false, status, attempts, ...(isCloudflare ? { deploymentUrl } : {}) }, 0);
}

module.exports = { runDeploy, deploymentUrlFrom, aliasUrlFrom, defaultFetchStatus, defaultFetchBody, projectNameFor, outputDirArg };
