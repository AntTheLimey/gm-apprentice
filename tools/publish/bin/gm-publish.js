#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
gm-apprentice-publish - Static site generator for gm-apprentice campaign vaults

Usage:
  gm-apprentice-publish init [target-dir]    Scaffold a new site
  gm-apprentice-publish build [options]      Build the site
  gm-apprentice-publish inbox <cmd> [args]   Change-request queue (used by the loop)
  gm-apprentice-publish flush [options]      Write players' current KV live-state back into the vault sheets
  gm-apprentice-publish sheet show [options] Print one PC's sheet (--player-safe shows only what players see)
  gm-apprentice-publish update-pin [options] Repoint this site at the newest installed build tool
  gm-apprentice-publish manifest <cmd>       Compare the publish manifest with the vault, or update it
  gm-apprentice-publish deploy [options]     Build, deploy to the configured host, and verify the URL
  gm-apprentice-publish explain <path>       Say why one vault file does or does not publish
  gm-apprentice-publish doctor [options]     Preflight: check tools/auth (--site audits the vault)
  gm-apprentice-publish setup-status-bar     Enable the live status bar (KV + deploy)
  gm-apprentice-publish setup-inbox          Enable the change-request inbox (KV + deploy)
  gm-apprentice-publish --version            Show version
  gm-apprentice-publish --help               Show this help

Build options:
  --config <path>    Path to vault.config.json (default: ./vault.config.json)

Flush options:
  --config <path>    Path to vault.config.json (default: ./vault.config.json)
  --dry-run, -n      Report what would change in each sheet without writing

Every subcommand accepts --help / -h.
`);
}

// Per-subcommand usage. `gm-apprentice-publish <cmd> --help` prints the entry for
// <cmd> — never the top-level banner — so the CLI, not the skill prose, is the
// reference for what each command accepts.
const SUBCOMMAND_HELP = {
  init: `
gm-apprentice-publish init [target-dir]

Scaffolds a new site in target-dir (default: the current directory):
package.json pinned to this tool, vault.config.json, README.md,
css/overrides.css, .gitignore, wrangler.toml, and .nojekyll.
Refuses to overwrite — if any of those files already exists, nothing is
written. Follow with "build" to generate the site.

  --help, -h         Show this help
`,
  build: `
gm-apprentice-publish build [--config <path>]

Generates the static site from the vault named in vault.config.json. On a
site with a backend enabled, re-syncs the plugin-owned Cloudflare Functions
first so a site scaffolded by an older plugin picks up new API routes.

  --config <path>    Path to vault.config.json (default: ./vault.config.json)
  --help, -h         Show this help
`,
  inbox: `
gm-apprentice-publish inbox <open|code|pull|handled|flag|reply> [args]

Drives the at-table change-request queue (Cloudflare KV, via wrangler). Used
by the publish-site skill's checking loop; run it by hand to inspect the queue.

  inbox open <CODE>                          Publish CODE as the session code players enter
  inbox code                                 Print the current session code
  inbox pull                                 Print pending requests as JSON
  inbox handled <id> [<id>...]               Mark requests handled
  inbox flag <id> [<id>...]                  Mark requests flagged for the GM
  inbox reply <id> <applied|rejected|advice> "<text>"
                                             Store the reply the player sees
  --help, -h                                 Show this help
`,
  flush: `
gm-apprentice-publish flush [--config <path>] [--dry-run]

Writes each player's current KV live-state (HP, FP, conditions…) back into the
matching vault character sheet so the build-time seed stays fresh. Edits vault
source only — no rebuild, no deploy.

  --config <path>    Path to vault.config.json (default: ./vault.config.json)
  --dry-run, -n      Print the same per-PC "✓ Name — HP 10→13" lines, write nothing
  --help, -h         Show this help
`,
  sheet: `
gm-apprentice-publish sheet show --pc <name> [--player-safe] [--json] [--config <path>]

Prints one PC's character sheet from the vault. The default view is the raw
source file, exactly as it sits on disk. --player-safe prints the sheet with
everything the published site strips already gone — excluded sections (GM
Notes and friends), gm-only and spoiler blocks, HTML comments, excluded
callouts, gm_only relationship edges and excluded frontmatter fields — so it
is the sheet a player can see, not a reminder to look away.

  --pc <name>        Which PC: file name, title, or frontmatter name
  --player-safe      Print only what a player can see
  --json             Emit { pc, sourcePath, playerSafe, frontmatter, markdown }
  --config <path>    Path to vault.config.json (default: ./vault.config.json)
  --help, -h         Show this help
`,
  manifest: `
gm-apprentice-publish manifest <diff|apply> [options]

Compares the publish manifest (_meta/publish-manifest.md) with what is actually
in the vault, and edits it. "diff" classifies every vault file with the same
decision the build makes, so a file it calls "publish" is a file the build
publishes.

  manifest diff [--config <path>] [--json]
                     List files the manifest does not mention (with the bucket,
                     code and reason for each), entries whose file is gone, and
                     the per-section unchanged counts
  manifest apply [--publish <path>]... [--exclude "<path>=<reason>"]...
                 [--decide <path>]... [--prune] [--config <path>] [--json]
                     Move paths between the three sections and rewrite the file.
                     --prune drops entries with no file on disk. A path that
                     matches no vault file is an error and nothing is written.
  --help, -h         Show this help
`,
  explain: `
gm-apprentice-publish explain <vault-relative path> [--config <path>] [--json]

Prints the chain the build walks for one file — directory, type, publish mode,
auto-exclusion, canon status, manifest section — and then the build's own
verdict: where it publishes, or which rule stopped it. Follows with the H2
sections stripped on publish and how many gm-only blocks the file carries.

  gm-apprentice-publish explain "Sessions/Session 7.md"

  --config <path>    Path to vault.config.json (default: ./vault.config.json)
  --json             Emit the whole chain as an object
  --help, -h         Show this help
`,
  deploy: `
gm-apprentice-publish deploy [--config <path>] [--verify] [--no-build] [--dry-run] [--json]

Builds the site and publishes it to the host named in vault.config.json:
"cloudflare-pages" runs wrangler (checking authentication first, and aligning
wrangler.toml's project name), "github-pages" commits docs/ and pushes.

  --verify           After deploying, fetch the site URL up to 3 times, 20s
                     apart. A site still propagating is reported, not failed.
  --no-build         Deploy whatever is already in the output directory
  --dry-run, -n      Print the commands that would run; run none of them
  --config <path>    Path to vault.config.json (default: ./vault.config.json)
  --json             Emit { host, built, deployed, url, verified, status,
                     attempts, commands }
  --help, -h         Show this help
`,
  'update-pin': `
gm-apprentice-publish update-pin [--site <dir>] [--check] [--json]

Repoints this site's gm-apprentice-publish dependency at the newest version in
the plugin cache and runs npm install. A "/plugin update" installs a new version
alongside the old one but never touches the site's pin, so the site keeps
building with the old renderer until this runs. Pair it with "deploy".

  --site <dir>       The site directory holding package.json (default: the
                     directory of --config, i.e. the current directory)
  --config <path>    Path to vault.config.json — names the site directory
  --check            Report the drift and exit 1; change nothing
  --json             Emit { pinnedBefore, pinnedAfter, installedBefore,
                     installedAfter, desired, changed, ok }
  --help, -h         Show this help
`,
  doctor: `
gm-apprentice-publish doctor [--host <host>] [--json] [--set-cloudflare-creds]
gm-apprentice-publish doctor --site [--config <path>] [--json]

Preflight for publishing: checks Node, git, and the host CLI (wrangler for
Cloudflare Pages, gh for GitHub Pages) with its authentication, and prints a
fix for each failing row.

--site audits the vault instead of the machine: the stale build-tool pin,
folders missing from folderMap, files with no type:, portraits pointing at
absent images, wikilinks that match no published page, manifest entries whose
file is gone, and played sessions in no manifest section. Each finding names
the edit that fixes it. Exits 1 only on an error, not on a warning.

  --host <host>              cloudflare-pages (default) or github-pages
  --site                     Audit the vault named by --config
  --config <path>            Path to vault.config.json, with --site
  --json                     Machine-readable report instead of the checklist
  --set-cloudflare-creds     Read a Cloudflare API token from stdin, verify it,
                             and save it (plus the account id) to your shell env
  --help, -h                 Show this help
`,
  'setup-status-bar': `
gm-apprentice-publish setup-status-bar [--config <path>]

Enables the live status bar: creates the KV namespace, records its id in
wrangler.toml, flips the backend flag in vault.config.json, then rebuilds
and deploys the site. Requires wrangler auth ("doctor" checks it).

  --config <path>    Path to vault.config.json (default: ./vault.config.json)
  --help, -h         Show this help
`,
  'setup-inbox': `
gm-apprentice-publish setup-inbox [--config <path>]

Enables the change-request inbox: creates the KV namespace, records its id
in wrangler.toml, flips the backend flag in vault.config.json, then rebuilds
and deploys the site. Requires wrangler auth ("doctor" checks it).

  --config <path>    Path to vault.config.json (default: ./vault.config.json)
  --help, -h         Show this help
`,
};

function printSubcommandHelp(cmd) {
  console.log(SUBCOMMAND_HELP[cmd]);
}

// Parse `--config <path>` plus an allowlist of flags, rejecting anything else.
// A mutating command must never let an unrecognised argument fall through to
// execution: `flush --help` used to perform the flush (#178). Returns
// { configPath, flags } or { error }.
// `valueFlags` maps a flag that takes a value (`--pc Jane`) to its key, the
// same way `allowedFlags` maps a bare switch. Value flags reject a following
// option token for the same reason `--config` does: `--pc --json` is a typo,
// not a PC called "--json".
// `repeatedFlags` are value flags a caller may give more than once
// (`--publish A.md --publish B.md`); their key collects an array, empty when the
// flag never appears.
function parseSubcommandArgs(rest, allowedFlags, valueFlags = {}, repeatedFlags = {}) {
  let configPath = './vault.config.json';
  const flags = {};
  for (const key of Object.values(repeatedFlags)) flags[key] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--config') {
      if (!rest[i + 1] || rest[i + 1].startsWith('-')) return { error: '--config needs a path' };
      configPath = rest[i + 1]; i++;
    } else if (Object.prototype.hasOwnProperty.call(repeatedFlags, a)) {
      if (!rest[i + 1] || rest[i + 1].startsWith('-')) return { error: `${a} needs a value` };
      flags[repeatedFlags[a]].push(rest[i + 1]); i++;
    } else if (Object.prototype.hasOwnProperty.call(valueFlags, a)) {
      if (!rest[i + 1] || rest[i + 1].startsWith('-')) return { error: `${a} needs a value` };
      flags[valueFlags[a]] = rest[i + 1]; i++;
    } else if (Object.prototype.hasOwnProperty.call(allowedFlags, a)) {
      flags[allowedFlags[a]] = true;
    } else {
      return { error: `Unknown argument: ${a}` };
    }
  }
  return { configPath, flags };
}

function printVersion() {
  const pkg = require('../package.json');
  console.log(pkg.version);
}

// The tool ships its deps vendored under node_modules/; if that copy didn't make it
// (e.g. a broken install), surface the cause instead of a raw "Cannot find module" trace.
function missingDepsMessage(detail) {
  const toolDir = path.join(__dirname, '..');
  return (
    `Error: gm-apprentice-publish is missing runtime dependencies${detail ? `: ${detail}` : ''}.\n` +
    `This usually means the plugin install is incomplete. Reinstall/update the\n` +
    `gm-apprentice plugin (/plugin), then ask the publish-site skill to "update my site",\n` +
    `or run "npm install" inside ${toolDir}.`
  );
}

// Fast, friendly preflight on the declared (direct) dependencies.
function assertRuntimeDeps() {
  const pkg = require('../package.json');
  const toolDir = path.join(__dirname, '..');
  const missing = [];
  for (const dep of Object.keys(pkg.dependencies || {})) {
    try {
      require.resolve(dep, { paths: [toolDir] });
    } catch {
      missing.push(dep);
    }
  }
  if (missing.length > 0) {
    console.error(missingDepsMessage(missing.join(', ')));
    process.exit(1);
  }
}

// Load lib/build, converting a missing transitive dependency (which assertRuntimeDeps
// can't see) from a raw stack trace into the same actionable message.
function loadBuild() {
  try {
    return require('../lib/build');
  } catch (err) {
    // MODULE_NOT_FOUND also fires for a broken relative/absolute import inside the tool
    // (a real code bug). Only a missing *package* (a bare specifier) means absent deps —
    // rewrite those to the friendly message and let everything else surface as itself.
    if (err && err.code === 'MODULE_NOT_FOUND') {
      const m = /Cannot find module '([^']+)'/.exec(err.message || '');
      const name = m && m[1];
      const isBareSpecifier = name && !name.startsWith('.') && !path.isAbsolute(name);
      if (isBareSpecifier) {
        console.error(missingDepsMessage(`'${name}'`));
        process.exit(1);
      }
    }
    throw err;
  }
}

// Warn (non-fatal) if a newer build tool is installed than the one this site is pinned to.
function warnIfVersionDrift() {
  try {
    const { detectVersionDrift } = require('../lib/version-check');
    const result = detectVersionDrift();
    if (result && result.drift) {
      console.error(`\n${result.message}\n`);
    }
  } catch {
    // Version checking is best-effort; never block a build on it.
  }
}

if (command === '--help' || command === '-h' || !command) {
  printHelp();
  process.exit(0);
}

if (command === '--version' || command === '-v') {
  printVersion();
  process.exit(0);
}

// `--help` on any subcommand prints usage and exits 0 with no side effects (#178).
const wantsHelp = args.slice(1).some((a) => a === '--help' || a === '-h');
if (wantsHelp) {
  if (Object.prototype.hasOwnProperty.call(SUBCOMMAND_HELP, command)) printSubcommandHelp(command); else printHelp();
  process.exit(0);
}


if (command === 'init') {
  const targetDir = args[1] || '.';
  const { init } = require('../lib/init');
  init(targetDir, { verbose: true }).then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error(`Init failed: ${err.message}`);
    process.exit(1);
  });
  return;
}

if (command === 'build') {
  let configPath = './vault.config.json';
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      configPath = args[i + 1];
      break;
    }
  }

  if (!fs.existsSync(configPath)) {
    console.error(`Error: Config file not found: ${configPath}`);
    process.exit(1);
  }

  // Surface a stale version pin and missing deps before doing any work.
  warnIfVersionDrift();
  assertRuntimeDeps();

  // Bring plugin-owned Cloudflare Functions up to date on every build so API routes
  // added or fixed in a newer plugin version reach flagged sites scaffolded before they
  // existed. A Tier-1 (static) site has no backend, so it gets no Functions re-added.
  try {
    const { syncScaffoldFunctions, shouldSyncFunctions } = require('../lib/sync-functions');
    const siteRoot = path.dirname(path.resolve(configPath));
    let backendExplicit;
    try {
      backendExplicit = JSON.parse(fs.readFileSync(configPath, 'utf8')).backend;
    } catch {
      // Unreadable/absent config → leave undefined so resolveBackendFlags falls back to detection.
    }
    if (shouldSyncFunctions(siteRoot, backendExplicit)) {
      const { created, updated } = syncScaffoldFunctions(siteRoot);
      for (const f of created) console.log(`  synced (new) functions/${f}`);
      for (const f of updated) console.log(`  synced (updated) functions/${f}`);
    }
  } catch (err) {
    console.warn(`⚠️  Could not sync scaffold Functions: ${err.message}`);
  }

  const { build } = loadBuild();
  try {
    build({ configPath });
  } catch (err) {
    console.error(`Build failed: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (command === 'inbox') {
  const { runInbox } = require('../lib/inbox-cli.js');
  runInbox(args.slice(1))
    .then((rc) => process.exit(rc))
    .catch((err) => { console.error(err.message); process.exit(1); });
  return;
}

if (command === 'flush') {
  const parsed = parseSubcommandArgs(args.slice(1), { '--dry-run': 'dryRun', '-n': 'dryRun' });
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    printSubcommandHelp('flush');
    process.exit(1);
  }
  const { runFlush } = require('../lib/flush-cli.js');
  runFlush({ configPath: parsed.configPath, dryRun: !!parsed.flags.dryRun })
    .then((rc) => process.exit(rc))
    .catch((err) => { console.error(err.message); process.exit(1); });
  return;
}

if (command === 'sheet') {
  const verb = args[1];
  if (verb !== 'show') {
    console.error(verb ? `Error: Unknown sheet command: ${verb}` : 'Error: sheet needs a command (show)');
    printSubcommandHelp('sheet');
    process.exit(1);
  }
  const parsed = parseSubcommandArgs(
    args.slice(2),
    { '--player-safe': 'playerSafe', '--json': 'json' },
    { '--pc': 'pc' },
  );
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    printSubcommandHelp('sheet');
    process.exit(1);
  }
  if (!parsed.flags.pc) {
    console.error('Error: sheet show needs --pc <name>');
    printSubcommandHelp('sheet');
    process.exit(1);
  }
  const { runSheetShow } = require('../lib/sheet-cli.js');
  runSheetShow({
    configPath: parsed.configPath,
    pc: parsed.flags.pc,
    playerSafe: !!parsed.flags.playerSafe,
    json: !!parsed.flags.json,
  })
    .then((rc) => process.exit(rc))
    .catch((err) => { console.error(err.message); process.exit(1); });
  return;
}

if (command === 'explain') {
  const target = args[1];
  if (!target || target.startsWith('-')) {
    console.error('Error: explain needs a vault-relative path');
    printSubcommandHelp('explain');
    process.exit(1);
  }
  const parsed = parseSubcommandArgs(args.slice(2), { '--json': 'json' });
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    printSubcommandHelp('explain');
    process.exit(1);
  }
  const { runExplain } = require('../lib/explain-cli.js');
  runExplain({ configPath: parsed.configPath, target, json: !!parsed.flags.json })
    .then((rc) => process.exit(rc))
    .catch((err) => { console.error(err.message); process.exit(1); });
  return;
}

if (command === 'deploy') {
  const parsed = parseSubcommandArgs(args.slice(1), {
    '--verify': 'verify',
    '--no-build': 'noBuild',
    '--dry-run': 'dryRun',
    '-n': 'dryRun',
    '--json': 'json',
  });
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    printSubcommandHelp('deploy');
    process.exit(1);
  }
  const { runDeploy } = require('../lib/deploy-cli.js');
  runDeploy({
    configPath: parsed.configPath,
    verify: !!parsed.flags.verify,
    noBuild: !!parsed.flags.noBuild,
    dryRun: !!parsed.flags.dryRun,
    json: !!parsed.flags.json,
  })
    .then((rc) => process.exit(rc))
    .catch((err) => { console.error(err.message); process.exit(1); });
  return;
}

if (command === 'manifest') {
  const verb = args[1];
  if (verb !== 'diff' && verb !== 'apply') {
    console.error(verb ? `Error: Unknown manifest command: ${verb}` : 'Error: manifest needs a command (diff or apply)');
    printSubcommandHelp('manifest');
    process.exit(1);
  }
  // --publish/--exclude/--decide move an entry between manifest sections, which
  // only "apply" does — registering them for "diff" too meant `manifest diff
  // --publish X` was accepted and silently did nothing (#M8).
  const parsed = parseSubcommandArgs(
    args.slice(2),
    { '--prune': 'prune', '--json': 'json' },
    {},
    verb === 'apply' ? { '--publish': 'publish', '--exclude': 'exclude', '--decide': 'decide' } : {},
  );
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    printSubcommandHelp('manifest');
    process.exit(1);
  }
  const { runManifest } = require('../lib/manifest-cli.js');
  runManifest({
    verb,
    configPath: parsed.configPath,
    publish: parsed.flags.publish,
    exclude: parsed.flags.exclude,
    decide: parsed.flags.decide,
    prune: !!parsed.flags.prune,
    json: !!parsed.flags.json,
  })
    .then((rc) => process.exit(rc))
    .catch((err) => { console.error(err.message); process.exit(1); });
  return;
}

if (command === 'update-pin') {
  const parsed = parseSubcommandArgs(
    args.slice(1),
    { '--check': 'check', '--json': 'json' },
    { '--site': 'site' },
  );
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    printSubcommandHelp('update-pin');
    process.exit(1);
  }
  const siteDir = parsed.flags.site || path.dirname(path.resolve(parsed.configPath));
  const { runUpdatePin } = require('../lib/update-pin.js');
  runUpdatePin({ siteDir, check: !!parsed.flags.check, json: !!parsed.flags.json })
    .then((rc) => process.exit(rc))
    .catch((err) => { console.error(err.message); process.exit(1); });
  return;
}

if (command === 'doctor') {
  const { runDoctor } = require('../lib/doctor-cli.js');
  runDoctor(args.slice(1))
    .then((rc) => process.exit(rc))
    .catch((err) => { console.error(err.message); process.exit(1); });
  return;
}

if (command === 'setup-status-bar' || command === 'setup-inbox') {
  // Also mutating (KV namespace + deploy): reject unknown arguments (#178).
  const parsed = parseSubcommandArgs(args.slice(1), {});
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    printSubcommandHelp(command);
    process.exit(1);
  }
  const configPath = parsed.configPath;
  const feature = command === 'setup-status-bar' ? 'status-bar' : 'inbox';
  const { runSetupBackend } = require('../lib/setup-backend.js');
  runSetupBackend(feature, { configPath })
    .then((rc) => process.exit(rc))
    .catch((err) => { console.error(err.message); process.exit(1); });
  return;
}

console.error(`Unknown command: ${command}`);
printHelp();
process.exit(1);
