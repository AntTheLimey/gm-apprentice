'use strict';
// The vault's build steps (player_site.before_build, player_site.after_build): the tool runs them, in order, in the
// site folder, around a real build, and nowhere else.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runSteps, packageScripts } = require('../lib/settings/steps');
const { runDeploy } = require('../lib/deploy-cli');
const { build } = require('../lib/build');
const { createPreview } = require('../scripts/live-preview');
const { readSettings } = require('../lib/settings');
const { loadPublishConfig } = require('../lib/config');
const { writeNewConfig } = require('./helpers/settings-files');

const BIN = path.join(__dirname, '..', 'bin', 'gm-publish.js');
const APPEND = path.join(__dirname, 'fixtures', 'steps', 'append.js');
const FAIL = path.join(__dirname, 'fixtures', 'steps', 'fail.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'with-dnd-pc');

// A step command that appends `line` to `file` (relative to the site folder, where steps run).
const append = (line, file) => `node ${JSON.stringify(APPEND)} ${line} ${file}`;
const fail = () => `node ${JSON.stringify(FAIL)}`;
const quietly = async (fn) => {
  const log = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
};

// A vault (a copy of a fixture) and a site folder beside it. `settings` are the player_site settings of a vault on the
// new layout; `layout: 'legacy'` leaves the fixture's old settings file as it is.
function scratch({ settings = {}, layout = 'new', package: pkg = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-steps-'));
  const vault = path.join(root, 'vault');
  const site = path.join(root, 'site');
  fs.cpSync(FIXTURE, vault, { recursive: true });
  fs.mkdirSync(site);
  const folderMap = { 'Characters/PCs': 'characters/pcs', Creatures: 'creatures', Items: 'items' };
  let siteFile = { vaultPath: '../vault' };
  if (layout === 'new') {
    fs.rmSync(path.join(vault, '_meta', 'vault-config.md'));
    writeNewConfig(vault, { version: 1, vault: { system: 'dnd-5e-2024' }, player_site: { title: 'T', hide: { folders: ['_meta', '_Templates'] }, folder_map: folderMap, ...settings } });
  } else {
    siteFile = { vaultPath: '../vault', attachmentsDir: '_attachments', siteTitle: 'T', excludeDirs: ['_meta', '_Templates'], folderMap };
  }
  const configPath = path.join(site, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify(siteFile, null, 2));
  if (pkg) fs.writeFileSync(path.join(site, 'package.json'), JSON.stringify(pkg, null, 2));
  return { root, vault, site, configPath };
}
const cli = (s, ...args) => spawnSync(process.execPath, [BIN, ...args, '--config', s.configPath], { encoding: 'utf8', cwd: s.site });
const lines = (file) => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);

test('runSteps runs each command in order, says each, and stops at the first that fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-steps-'));
  const said = [];
  runSteps([append('one', 'out.txt'), append('two', 'out.txt')], { cwd: dir, label: 'after_build', log: (l) => said.push(l) });
  assert.deepEqual(lines(path.join(dir, 'out.txt')), ['one', 'two']);
  assert.deepEqual(said, [`Running after_build step 1 of 2: ${append('one', 'out.txt')}`, `Running after_build step 2 of 2: ${append('two', 'out.txt')}`]);

  const mark = path.join(dir, 'never.txt');
  assert.throws(
    () => runSteps([fail(), append('x', 'never.txt')], { cwd: dir, label: 'before_build', log: () => {} }),
    new Error(`The before_build step "${fail()}" failed (exit 1). Nothing was published.`),
  );
  assert.equal(fs.existsSync(mark), false, 'no later step runs');
  assert.throws(() => runSteps(['node -e "setTimeout(()=>{},5000)"'], { cwd: dir, label: 'after_build', log: () => {}, timeoutMs: 200 }), /failed \(it took longer than/);
});

test('build: the after steps run in order, once the pages are written, and the build says each', () => {
  const s = scratch({ settings: { after_build: [append('first', 'order.txt'), append('second', 'order.txt')] } });
  const r = cli(s, 'build');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(lines(path.join(s.site, 'order.txt')), ['first', 'second']);
  assert.match(r.stdout, /Running after_build step 2 of 2/);
  assert.ok(r.stdout.indexOf('Running after_build step 1') < r.stdout.indexOf('Done!'), 'before Done!');
  assert.ok(fs.existsSync(path.join(s.site, 'docs', 'index.html')), 'the step ran after the pages were written');
});

test('build: a failing first step leaves the second unrun, the build exits 1, and nothing is written', () => {
  const s = scratch({ settings: { before_build: [fail(), append('late', 'late.txt')] } });
  const r = cli(s, 'build');
  assert.equal(r.status, 1);
  assert.equal(fs.existsSync(path.join(s.site, 'late.txt')), false);
  assert.match(r.stderr, new RegExp(`The before_build step .* failed \\(exit 1\\)\\. Nothing was published\\.`));
  assert.equal(fs.existsSync(path.join(s.site, 'docs')), false);
});

test('build: a failing after step fails the build', () => {
  const s = scratch({ settings: { after_build: [fail()] } });
  const r = cli(s, 'build');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /The after_build step .* failed/);
});

test('build: the before steps run before the vault is read, so a note they write is published', () => {
  const note = ['---', 'type: item', '---', '# Late Wand'].map((line) => append(JSON.stringify(line), '../vault/Items/Late_Wand.md'));
  const s = scratch({ settings: { before_build: note } });
  const r = cli(s, 'build');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(fs.existsSync(path.join(s.site, 'docs', 'items', 'late-wand.html')), 'the note written by the step was published');
});

test('build: an output folder inside the vault stops the build before any before step runs', () => {
  // The site folder sits inside the vault, so its output folder does too: the build must refuse it before a step touches anything.
  const s = scratch({ settings: { before_build: [append('ran', 'marker.txt')] } });
  const site = path.join(s.vault, 'site');
  fs.mkdirSync(site);
  fs.writeFileSync(path.join(site, 'vault.config.json'), JSON.stringify({ vaultPath: '..' }));
  const r = spawnSync(process.execPath, [BIN, 'build', '--config', path.join(site, 'vault.config.json')], { encoding: 'utf8', cwd: site });
  assert.equal(r.status, 1, r.stderr + r.stdout);
  assert.match(r.stderr, /Refusing to write the output folder/);
  assert.equal(fs.existsSync(path.join(site, 'marker.txt')), false, 'no before step ran');
});

test('the steps run nowhere but build and deploy: not in a dry build, explain, manifest, doctor --site, the sheet view, the preview, deploy --no-build', async () => {
  const s = scratch({ settings: { before_build: [append('b', 'marker.txt')], after_build: [append('a', 'marker.txt')] } });
  const marker = path.join(s.site, 'marker.txt');
  const ran = [];
  const check = (what) => { ran.push(what); assert.equal(fs.existsSync(marker), false, `${what} ran a step`); };

  await quietly(() => build({ configPath: s.configPath, inMemory: true }));
  check('a dry build');
  await quietly(() => build({ configPath: s.configPath }));
  check('a build asked for no steps');
  const out = path.join(s.root, 'preview-out');
  await quietly(() => build({ configPath: s.configPath, outputDirOverride: out }));
  check('a build into another folder');
  const preview = await quietly(() => createPreview({ configPath: s.configPath }));
  await new Promise((r) => preview.server.close(r));
  check('the live preview');

  for (const args of [
    ['explain', 'Items/Wand_of_Magic_Missiles.md'],
    ['manifest', 'diff'],
    ['doctor', '--site'],
    ['sheet', 'show', '--pc', 'Ilse Varn'],
    ['deploy', '--no-build', '--dry-run'],
  ]) {
    const r = cli(s, ...args);
    assert.notEqual(r.status, null, args.join(' '));
    check(args.join(' '));
  }
  assert.equal(ran.length, 9);
});

// ---- deploy --------------------------------------------------------------------------------

// Everything the runner can touch is recorded; the vault and site folder are real, only the commands are fake.
function deployHarness(s, { pkg = null } = {}) {
  const out = [];
  const commands = [];
  const files = pkg ? { [path.join(s.site, 'package.json')]: JSON.stringify(pkg) } : {};
  const deps = {
    out: (l) => out.push(String(l)),
    readFile: (p) => {
      if (p in files) return files[p];
      return fs.readFileSync(p, 'utf8');
    },
    exists: (p) => p in files || fs.existsSync(p),
    runCommand: (cmd, args) => { commands.push([cmd, ...args].join(' ')); return { code: 0, stdout: '', stderr: '' }; },
    runWrangler: () => ({ code: 0, stdout: '', stderr: '' }),
    build: async () => {},
    assertNoStopsFor: () => {},
    siteOffFor: () => null,
    fetchStatus: async () => 200,
    sleep: async () => {},
  };
  return { deps, out, commands };
}

const HOOKS = { scripts: { prebuild: 'node pre.js', postbuild: 'node post.js' } };

test('deploy: a package.json hook is skipped only for the slot the settings hold steps for', async () => {
  const s = scratch({ settings: { after_build: [append('x', 'x.txt')] }, package: HOOKS });
  const h = deployHarness(s, { pkg: HOOKS });
  await runDeploy({ configPath: s.configPath }, h.deps);
  assert.deepEqual(h.commands.filter((c) => c.startsWith('npm')), ['npm run prebuild'], 'prebuild has no steps of its own, so it still runs; postbuild is the vault\'s now');
  const dry = deployHarness(s, { pkg: HOOKS });
  await runDeploy({ configPath: s.configPath, dryRun: true }, dry.deps);
  assert.ok(dry.out.some((l) => l.includes(append('x', 'x.txt'))), 'a dry run lists the vault\'s own steps');
  assert.ok(dry.out.some((l) => /npm run prebuild/.test(l)));
  assert.ok(!dry.out.some((l) => /npm run postbuild/.test(l)));
});

test('deploy: the new layout with no steps of its own runs the package.json hooks exactly as before', async () => {
  const s = scratch({ package: HOOKS });
  const h = deployHarness(s, { pkg: HOOKS });
  await runDeploy({ configPath: s.configPath }, h.deps);
  assert.deepEqual(h.commands.filter((c) => c.startsWith('npm')), ['npm run prebuild', 'npm run postbuild']);
  const dry = deployHarness(s, { pkg: HOOKS });
  await runDeploy({ configPath: s.configPath, dryRun: true }, dry.deps);
  assert.ok(dry.out.some((l) => /npm run postbuild/.test(l)), 'a dry run lists it');
});

test('deploy: on the old layout it keeps running the package.json steps, as before', async () => {
  const s = scratch({ layout: 'legacy', package: HOOKS });
  const h = deployHarness(s, { pkg: HOOKS });
  await runDeploy({ configPath: s.configPath }, h.deps);
  assert.deepEqual(h.commands.filter((c) => c.startsWith('npm')), ['npm run prebuild', 'npm run postbuild']);
});

// ---- the second run of a step ------------------------------------------------------------

test('a package.json that still holds a step on the new layout: the build warns it runs twice, and runs nothing for it', () => {
  const s = scratch({ settings: { after_build: [append('own', 'own.txt')] }, package: { scripts: { postbuild: append('npm', 'npm.txt') } } });
  const r = cli(s, 'build');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /`postbuild` in the site folder's package\.json also runs under `npm run build`, after the tool has run the vault's own after_build steps, so those run twice there/);
  assert.deepEqual(lines(path.join(s.site, 'own.txt')), ['own']);
  assert.equal(fs.existsSync(path.join(s.site, 'npm.txt')), false, 'the tool ran nothing from package.json');
  const doctor = cli(s, 'doctor', '--site');
  assert.match(doctor.stdout + doctor.stderr, /BUILD_STEPS_TWICE/);
});

test('a package.json step with no steps in the vault for that slot is not a double run: one plain line, no warning, not in doctor', () => {
  for (const settings of [{}, { before_build: [append('own', 'own.txt')] }]) {
    const s = scratch({ settings, package: { scripts: { postbuild: append('npm', 'npm.txt') } } });
    const r = cli(s, 'build');
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /twice|WARNING.*postbuild/);
    assert.match(r.stdout, /`postbuild` in the site folder's package\.json still runs under `npm run build` and `deploy`, and moves into the vault at the next update/);
    const doctor = cli(s, 'doctor', '--site', '--json');
    assert.doesNotMatch(doctor.stdout, /BUILD_STEPS_TWICE|run twice|runs? under `npm run build`, after the tool/);
  }
});

test('deploy says so when it skips a package.json hook because the vault holds different steps for that slot', async () => {
  const s = scratch({ settings: { after_build: [append('x', 'x.txt')] }, package: HOOKS });
  const h = deployHarness(s, { pkg: HOOKS });
  await runDeploy({ configPath: s.configPath }, h.deps);
  assert.ok(h.out.some((l) => /`postbuild` in package\.json is not run by deploy: the vault holds after_build steps for that slot/.test(l)), h.out.join('\n'));
  assert.ok(!h.out.some((l) => /`prebuild` in package\.json is not run/.test(l)));
});

test('a package.json with no steps, or on the old layout, gives no such warning', () => {
  const none = scratch({ package: { scripts: { start: 'x' } } });
  assert.doesNotMatch(cli(none, 'build').stderr, /npm run build/);
  const legacy = scratch({ layout: 'legacy', package: HOOKS });
  assert.doesNotMatch(cli(legacy, 'build').stderr, /npm run build/);
  assert.deepEqual(packageScripts(legacy.site), { prebuild: 'node pre.js', postbuild: 'node post.js' });
});

// ---- the settings ----------------------------------------------------------------------------

test('the steps are listed settings that default to nothing and come out in publishConfig.steps', () => {
  const s = scratch({ settings: { before_build: ['a', 'b'], after_build: ['c'] } });
  const r = readSettings({ vaultPath: s.vault, siteConfig: {}, siteDir: s.site });
  assert.deepEqual(r.values.player_site.before_build, ['a', 'b']);
  assert.deepEqual(r.values.player_site.after_build, ['c']);
  assert.deepEqual(loadPublishConfig(s.vault, {}, () => {}, { siteDir: s.site }).steps, { before: ['a', 'b'], after: ['c'] });
  const bare = scratch();
  assert.deepEqual(loadPublishConfig(bare.vault, {}, () => {}, { siteDir: bare.site }).steps, { before: [], after: [] });
});

// ---- Fix round 1 ----------------------------------------------------------------------------

const RECORD_PATH = path.join(__dirname, 'fixtures', 'steps', 'record-path.js');

test('a step sees the site folder\'s node_modules/.bin first on its PATH, as npm run gives it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-steps-path-'));
  runSteps([`node ${JSON.stringify(RECORD_PATH)} seen.txt`], { cwd: dir, label: 'after_build', log: () => {} });
  const first = fs.readFileSync(path.join(dir, 'seen.txt'), 'utf8').trim();
  assert.equal(first, path.join(dir, 'node_modules', '.bin'));
});

test('a blank entry in a steps list is a warning and is skipped, never run', () => {
  const s = scratch({ settings: { before_build: ['', '   ', append('real', 'real.txt')], after_build: ['  '] } });
  const faults = loadPublishConfig(s.vault, {}, () => {}, { siteDir: s.site });
  assert.deepEqual(faults.steps, { before: [append('real', 'real.txt')], after: [] });
  const warn = faults.faults.filter((f) => f.setting === 'player_site.before_build' && f.level === 'warn');
  assert.equal(warn.length, 1);
  const r = cli(s, 'build');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(lines(path.join(s.site, 'real.txt')), ['real']);
});

test('under deploy --json a step\'s output goes to stderr, not stdout', () => {
  const s = scratch({ settings: { before_build: [`node ${JSON.stringify(RECORD_PATH)} seen.txt && node -e "console.log('STEPOUT')"`] } });
  const r = spawnSync(process.execPath, [BIN, 'deploy', '--json', '--config', s.configPath], { encoding: 'utf8', cwd: s.site });
  assert.ok(fs.existsSync(path.join(s.site, 'seen.txt')), 'the step ran: ' + r.stderr);
  assert.ok(!r.stdout.includes('STEPOUT') && !r.stdout.includes('Running before_build'), r.stdout);
  assert.ok(r.stderr.includes('STEPOUT') && r.stderr.includes('Running before_build'), r.stderr);
});
