'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { build } = require('../../lib/build');
const { runExplain, runExplainAll } = require('../../lib/explain-cli');
const { runManifest } = require('../../lib/manifest-cli');
const { runSheetShow } = require('../../lib/sheet-cli');
const { runDeploy } = require('../../lib/deploy-cli');
const { createPreview } = require('../../scripts/live-preview');

const CLI = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');
const STOP_YAML = '  exclude_sectoins: [GM Notes]\n';
const WARN_YAML = '  link_preview: off\n';
const HEAD = /^(\w[\w .-]*) stopped: the settings have a fault that could show players more than you meant\.\n/;
const FIX = /\nFix it, or ask the apprentice to run the Settings check\.$/;
const STOP_LINE = '  publish.exclude_sectoins is not a setting. Did you mean publish.exclude_sections?';

const roots = [];
test.after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

function writeVaultConfig(vault, yaml) {
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'),
    `---\ntype: meta\npublish:\n  mode: player\n  folder_map:\n    NPCs: npcs\n    Characters/PCs: characters/pcs\n${yaml}---\n`);
}

function site(yaml, siteExtra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-faults-'));
  roots.push(root);
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'NPCs'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'Characters', 'PCs'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'NPCs', 'Vex.md'), '---\ntype: npc\n---\n# Vex\n\n## GM Notes\n\nSecret.\n');
  fs.writeFileSync(path.join(vault, 'Characters', 'PCs', 'Karl.md'), '---\ntype: pc\n---\n# Karl\n\nA fighter.\n');
  writeVaultConfig(vault, yaml);
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments', siteTitle: 'T', ...siteExtra }));
  return { root, vault, configPath, outputDir: path.join(root, 'docs'), setYaml: (y) => writeVaultConfig(vault, y) };
}

// Every file under dir with its bytes and mtime, to compare before and after.
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { out[`${path.relative(dir, full)}/`] = true; walk(full); } else {
        out[path.relative(dir, full)] = `${fs.statSync(full).mtimeMs}:${fs.readFileSync(full).toString('base64')}`;
      }
    }
  };
  walk(dir);
  return out;
}

// Runs fn with the console captured; returns what it printed.
async function capturing(fn) {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const lines = [];
  console.log = console.warn = console.error = (...a) => lines.push(a.join(' '));
  try { return { result: await fn(), lines }; } catch (err) { err.lines = lines; throw err; } finally { Object.assign(console, saved); }
}

function assertStopMessage(err, command) {
  assert.ok(err instanceof Error, 'an Error');
  const m = HEAD.exec(err.message);
  assert.ok(m, err.message);
  assert.equal(m[1], command);
  assert.match(err.message, FIX);
  assert.ok(err.message.includes(STOP_LINE), err.message);
  assert.equal(err.message.split('exclude_sectoins is not a setting').length - 1, 1, 'each stop listed once');
  return true;
}

test('a misspelt hiding setting stops the build and writes nothing', async () => {
  const s = site(STOP_YAML);
  const before = snapshot(s.root);
  await assert.rejects(capturing(() => build({ configPath: s.configPath })), (err) => assertStopMessage(err, 'build'));
  assert.equal(fs.existsSync(s.outputDir), false);
  assert.deepEqual(snapshot(s.root), before);
});

test('a stopped build shows each stop once, in the message and not as a warning line', async () => {
  const s = site(STOP_YAML);
  await assert.rejects(capturing(() => build({ configPath: s.configPath })), (err) => {
    assert.equal(err.lines.filter((l) => l.includes('exclude_sectoins')).length, 0, err.lines.join('\n'));
    return true;
  });
});

test('a misspelt look setting warns and the build runs', async () => {
  const s = site(WARN_YAML);
  const { lines } = await capturing(() => build({ configPath: s.configPath }));
  assert.ok(lines.some((w) => /publish\.link_preview is not a setting\. Did you mean publish\.link_previews\?/.test(w)), lines.join('\n'));
  assert.equal(fs.existsSync(path.join(s.outputDir, 'index.html')), true);
});

test('a stop leaves a previous build exactly as it was', async () => {
  const s = site('');
  await capturing(() => build({ configPath: s.configPath }));
  assert.equal(fs.existsSync(path.join(s.outputDir, 'index.html')), true);
  s.setYaml(STOP_YAML);
  const docs = snapshot(s.outputDir);
  const rootBefore = Object.keys(snapshot(s.root)).sort();
  await assert.rejects(capturing(() => build({ configPath: s.configPath })), (err) => assertStopMessage(err, 'build'));
  assert.deepEqual(snapshot(s.outputDir), docs);
  assert.deepEqual(Object.keys(snapshot(s.root)).sort(), rootBefore);
});

test('allowFaults runs the build past a stop and returns the faults', async () => {
  const s = site(STOP_YAML);
  const { result, lines } = await capturing(() => build({ configPath: s.configPath, allowFaults: true }));
  assert.equal(fs.existsSync(path.join(s.outputDir, 'index.html')), true);
  assert.ok(result.faults.some((f) => f.name === 'publish.exclude_sectoins' && f.level === 'stop'));
  assert.ok(lines.some((l) => l.includes('exclude_sectoins')), 'with the stop allowed, it is shown as a warning');
});

test('the command line build exits non-zero with the message once on stderr and writes nothing', () => {
  const s = site(STOP_YAML);
  const before = snapshot(s.root);
  const r = spawnSync(process.execPath, [CLI, 'build', '--config', s.configPath], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /(^|\n)build stopped: the settings have a fault/);
  assert.equal(r.stderr.split('exclude_sectoins is not a setting').length - 1, 1, r.stderr);
  assert.ok(!/\n\s+at /.test(r.stderr), 'no stack trace');
  assert.ok(!/Build failed/.test(r.stderr));
  assert.deepEqual(snapshot(s.root), before);
});

test('explain, both forms: a stop exits non-zero in the CLI, a warning does not', async () => {
  const s = site(STOP_YAML);
  const lines = [];
  await assert.rejects(runExplain({ configPath: s.configPath, target: 'NPCs/Vex.md' }, { out: (l) => lines.push(l) }), (err) => assertStopMessage(err, 'explain'));
  await assert.rejects(runExplainAll({ configPath: s.configPath }, { out: (l) => lines.push(l) }), (err) => assertStopMessage(err, 'explain'));
  assert.deepEqual(lines, []);
  for (const argv of [['explain', 'NPCs/Vex.md'], ['explain', '--all', '--json']]) {
    const r = spawnSync(process.execPath, [CLI, ...argv, '--config', s.configPath], { encoding: 'utf8' });
    assert.equal(r.status, 1, argv.join(' '));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^explain stopped: /);
    assert.ok(!/\n\s+at /.test(r.stderr));
  }
  const ok = site(WARN_YAML);
  const out = [];
  const { result: rcs } = await capturing(async () => [
    await runExplain({ configPath: ok.configPath, target: 'NPCs/Vex.md' }, { out: (l) => out.push(l) }),
    await runExplainAll({ configPath: ok.configPath, json: true }, { out: (l) => out.push(l) }),
  ]);
  assert.deepEqual(rcs, [0, 0]);
});

test('manifest: a stop throws before anything is read or written, a warning passes', async () => {
  const s = site(STOP_YAML);
  const before = snapshot(s.root);
  for (const verb of ['diff', 'apply', 'publish-played']) {
    await assert.rejects(runManifest({ configPath: s.configPath, verb }, { out: () => {} }), (err) => assertStopMessage(err, 'manifest'), verb);
  }
  assert.deepEqual(snapshot(s.root), before);
  const r = spawnSync(process.execPath, [CLI, 'manifest', 'diff', '--config', s.configPath], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^manifest stopped: /);
  const ok = site(WARN_YAML);
  const { result: rc } = await capturing(() => runManifest({ configPath: ok.configPath, verb: 'diff' }, { out: () => {} }));
  assert.equal(rc, 0);
});

test('sheet show --player-safe: a stop throws, a warning and the raw view pass', async () => {
  const s = site(STOP_YAML);
  const out = [];
  const deps = { configPath: s.configPath, pc: 'Karl', out: (l) => out.push(l), err: () => {} };
  await assert.rejects(runSheetShow({ ...deps, playerSafe: true }), (err) => assertStopMessage(err, 'sheet show --player-safe'));
  assert.deepEqual(out, []);
  const { result: raw } = await capturing(() => runSheetShow({ ...deps, playerSafe: false }));
  assert.equal(raw, 0, 'the raw view is for the GM and does not decide what is published');
  const ok = site(WARN_YAML);
  const { result: rc } = await capturing(() => runSheetShow({ ...deps, configPath: ok.configPath, playerSafe: true }));
  assert.equal(rc, 0);
  const r = spawnSync(process.execPath, [CLI, 'sheet', 'show', '--pc', 'Karl', '--player-safe', '--config', s.configPath], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^sheet show --player-safe stopped: /);
});

function deployHarness(s) {
  const out = [];
  const commands = [];
  const builds = [];
  const writes = [];
  return {
    out, commands, builds, writes,
    deps: {
      out: (l) => out.push(String(l)),
      runCommand: (cmd, args) => { commands.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' }; },
      runWrangler: () => ({ code: 0, stdout: '', stderr: '' }),
      build: async (o) => { builds.push(o); },
      writeFile: (p, c) => writes.push(p),
      fetchStatus: async () => ({ status: 200 }),
      sleep: async () => {},
    },
  };
}

test('deploy: a stop throws before any hook, build or upload, a warning passes', async () => {
  const s = site(STOP_YAML);
  const h = deployHarness(s);
  await assert.rejects(runDeploy({ configPath: s.configPath }, h.deps), (err) => assertStopMessage(err, 'deploy'));
  await assert.rejects(runDeploy({ configPath: s.configPath, noBuild: true }, h.deps), (err) => assertStopMessage(err, 'deploy'));
  assert.deepEqual(h.commands, []);
  assert.deepEqual(h.builds, []);
  assert.deepEqual(h.writes, []);
  const r = spawnSync(process.execPath, [CLI, 'deploy', '--config', s.configPath], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^deploy stopped: /);
  assert.equal(r.stderr.split('exclude_sectoins is not a setting').length - 1, 1);
  const ok = site(WARN_YAML);
  const h2 = deployHarness(ok);
  await capturing(() => runDeploy({ configPath: ok.configPath }, h2.deps));
  assert.equal(h2.builds.length, 1, 'the build step ran');
});

test('the local preview is a player build: a stop throws and leaves no temp folder behind', async () => {
  const s = site(STOP_YAML);
  const tmp = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('gm-publish-preview-site-')).sort();
  const before = tmp();
  await assert.rejects(createPreview({ configPath: s.configPath }), (err) => assertStopMessage(err, 'build'));
  assert.deepEqual(tmp(), before);
});

test('a site-file hiding list that is not a list, beside the vault file\'s own list, warns once and the vault list applies', async () => {
  const s = site('  exclude_sections: [GM Notes]\n', { excludeSections: 'oops' });
  const { lines } = await capturing(() => build({ configPath: s.configPath }));
  const said = lines.filter((l) => l.includes('excludeSections in vault.config.json is not a list and is ignored'));
  assert.equal(said.length, 1, lines.join('\n'));
  const page = fs.readFileSync(path.join(s.outputDir, 'npcs', 'vex.html'), 'utf8');
  assert.ok(!page.includes('Secret.'), 'the vault list hid GM Notes');
});

test('a site-file hiding list that is not a list, with no vault list, stops the build', async () => {
  const s = site('', { excludeSections: 'oops' });
  await assert.rejects(capturing(() => build({ configPath: s.configPath })), (err) => HEAD.test(err.message) && err.message.includes('publish.exclude_sections'));
});

test('commands that only warn print the fault text alone, one plain line each, with no object', () => {
  const cases = [
    ['a warn fault', 'publish.zebra is not a setting.', '  zebra: 1\n'],
    ['a stop fault', STOP_LINE.trim(), STOP_YAML],
  ];
  for (const [label, text, yaml] of cases) {
    const s = site(yaml);
    const runs = [
      ['flush', ['flush', '--dry-run', '--config', s.configPath]],
      ['sheet show', ['sheet', 'show', '--pc', 'Karl', '--config', s.configPath]],
    ];
    for (const [name, argv] of runs) {
      const r = spawnSync(process.execPath, [CLI, ...argv], { encoding: 'utf8' });
      const faultLines = r.stderr.split('\n').filter((l) => l.includes(text.split(' ')[0]));
      assert.equal(faultLines.length, 1, `${name}, ${label}: ${r.stderr}`);
      assert.equal(faultLines[0].trim().replace(/^WARNING: /, ''), text, `${name}, ${label}`);
      assert.ok(!r.stderr.includes('{'), `${name}, ${label}: ${r.stderr}`);
    }
  }
});

test('deploy --dry-run refuses on a stop the same way, and lists its commands on a warning', async () => {
  const s = site(STOP_YAML);
  const h = deployHarness(s);
  await assert.rejects(runDeploy({ configPath: s.configPath, dryRun: true }, h.deps), (err) => assertStopMessage(err, 'deploy'));
  assert.deepEqual(h.out, []);
  const r = spawnSync(process.execPath, [CLI, 'deploy', '--dry-run', '--config', s.configPath], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^deploy stopped: /);
  const ok = site(WARN_YAML);
  const h2 = deployHarness(ok);
  const { result: dryRc } = await capturing(() => runDeploy({ configPath: ok.configPath, dryRun: true }, h2.deps));
  assert.equal(dryRc, 0);
  assert.match(h2.out.join('\n'), /DRY RUN/);
});
