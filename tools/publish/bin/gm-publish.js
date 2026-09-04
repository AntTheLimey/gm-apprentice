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
  gm-apprentice-publish doctor [options]     Preflight: check tools/auth, save Cloudflare creds
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
  doctor: `
gm-apprentice-publish doctor [--host <host>] [--json] [--set-cloudflare-creds]

Preflight for publishing: checks Node, git, and the host CLI (wrangler for
Cloudflare Pages, gh for GitHub Pages) with its authentication, and prints a
fix for each failing row.

  --host <host>              cloudflare-pages (default) or github-pages
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
function parseSubcommandArgs(rest, allowedFlags) {
  let configPath = './vault.config.json';
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--config') {
      if (!rest[i + 1] || rest[i + 1].startsWith('-')) return { error: '--config needs a path' };
      configPath = rest[i + 1]; i++;
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
