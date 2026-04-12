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

  const { build } = require('../lib/build');
  try {
    build({ configPath });
  } catch (err) {
    console.error(`Build failed: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
printHelp();
process.exit(1);
