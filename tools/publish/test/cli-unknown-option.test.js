'use strict';
// An option a command does not know stops it with a message before anything runs: `build --dry-run` used to be
// accepted and run a real build, build steps included.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { writeNewConfig } = require('./helpers/settings-files');

const BIN = path.join(__dirname, '..', 'bin', 'gm-publish.js');
const made = [];
process.on('exit', () => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

function site() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unknown-option-'));
  made.push(root);
  const vault = path.join(root, 'vault');
  const dir = path.join(root, 'site');
  fs.mkdirSync(dir);
  writeNewConfig(vault, { version: 1, vault: { system: 'coc' }, player_site: { before_build: ['node -e "require(\'fs\').writeFileSync(\'ran.txt\', \'x\')"'] } });
  fs.writeFileSync(path.join(dir, 'vault.config.json'), JSON.stringify({ vaultPath: '../vault' }));
  return dir;
}
const run = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd });

test('build --dry-run stops with a message naming the option and build --help, and runs no step and writes nothing', () => {
  const dir = site();
  const r = run(dir, 'build', '--dry-run');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Unknown option: --dry-run/);
  assert.match(r.stderr, /build has no dry run/);
  assert.match(r.stderr, /gm-apprentice-publish build --help/);
  assert.equal(fs.existsSync(path.join(dir, 'ran.txt')), false, 'no build step ran');
  assert.deepEqual(fs.readdirSync(dir), ['vault.config.json']);
});

test('build with any other unknown option, or a stray word, stops the same way; --config still works', () => {
  const dir = site();
  for (const bad of [['--frobnicate'], ['-n'], ['somewhere']]) {
    const r = run(dir, 'build', ...bad);
    assert.notEqual(r.status, 0, bad.join(' '));
    assert.match(r.stderr, new RegExp(`Unknown (option|argument): ${bad[0]}`));
    assert.match(r.stderr, /build --help/);
    assert.equal(fs.existsSync(path.join(dir, 'ran.txt')), false);
  }
  const r = run(dir, 'build', '--config');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--config needs a path/);
  assert.equal(fs.existsSync(path.join(dir, 'ran.txt')), false);
});

test('build --watch, which older scaffolds put in package.json, builds once and says build has no watch mode', () => {
  const dir = site();
  const r = run(dir, 'build', '--watch');
  assert.equal(r.status, 0, r.stderr);
  const said = (r.stdout + r.stderr).split('\n').filter((l) => /no watch mode/.test(l));
  assert.equal(said.length, 1, 'one line says there is no watch mode');
  assert.match(said[0], /built once/);
  assert.equal(fs.readFileSync(path.join(dir, 'ran.txt'), 'utf8'), 'x', 'the build ran');
});

test('the scaffold package.json no longer carries a watch script', () => {
  const tmpl = fs.readFileSync(path.join(__dirname, '..', 'templates-scaffold', 'package.json.tmpl'), 'utf8');
  assert.equal(/watch/.test(tmpl), false);
});

test('init with an unknown option writes nothing, instead of taking it for the folder to scaffold in', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unknown-init-'));
  made.push(dir);
  const r = run(dir, 'init', '--dry-run');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Unknown option: --dry-run/);
  assert.match(r.stderr, /init --help/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('the other commands that run steps or write files already refuse an unknown option', () => {
  const dir = site();
  for (const cmd of [['deploy'], ['setup-inbox'], ['setup-status-bar'], ['settings', 'move']]) {
    const r = run(dir, ...cmd, '--frobnicate');
    assert.notEqual(r.status, 0, cmd.join(' '));
    assert.match(r.stderr, /Unknown argument: --frobnicate/, cmd.join(' '));
  }
});
