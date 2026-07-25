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
`);
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
  let configPath = './vault.config.json';
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) { configPath = args[i + 1]; i++; }
  }
  const { runFlush } = require('../lib/flush-cli.js');
  runFlush({ configPath })
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
  let configPath = './vault.config.json';
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) { configPath = args[i + 1]; i++; }
  }
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
