'use strict';
// Tests leave nothing behind (#565): the temp folders a test process makes are removed when it exits
// (test/helpers/temp-cleanup.js, loaded by `npm test`), and a Chrome left running on a profile folder is ended
// (lib/chrome.js stopChrome), including one whose test process died holding the browser lock.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { stopChrome } = require('../lib/chrome');
const { withChromeLock, PROFILE_PREFIX } = require('./helpers/browser');

const PRELOAD = path.join(__dirname, 'helpers', 'temp-cleanup.js');

test('every temp folder a test process makes, by each of the three calls, is gone when it exits', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-root-'));
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-fixture-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const script = `
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const out = [];
    out.push(fs.mkdtempSync(path.join(os.tmpdir(), 'sync-')));
    fs.writeFileSync(path.join(out[0], 'inside.txt'), 'x');
    out.push(fs.mkdtempSync(path.join(${JSON.stringify(fixture)}, 'in-fixture-')));
    fs.mkdtemp(path.join(os.tmpdir(), 'cb-'), (err, dir) => {
      if (err) throw err;
      out.push(dir);
      fs.promises.mkdtemp(path.join(os.tmpdir(), 'promise-')).then((d) => { out.push(d); console.log(JSON.stringify(out)); });
    });`;
  const env = { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp };
  const run = spawnSync(process.execPath, ['--require', PRELOAD, '-e', script], { encoding: 'utf8', env });
  assert.equal(run.status, 0, run.stderr);
  const [sync, inFixture, cb, promise] = JSON.parse(run.stdout);
  for (const dir of [sync, cb, promise]) assert.equal(fs.existsSync(dir), false, `${dir} was left behind`);
  assert.deepEqual(fs.readdirSync(tmp), [], 'the temp folder is left empty');
  assert.equal(fs.existsSync(inFixture), true, 'a folder made inside a fixture outside the temp folder is the test\'s own');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// A stand-in for a Chrome process: it runs until stopped, with the profile flag on its command line.
function fakeChrome(profile) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${profile}`], { stdio: 'ignore' });
  return child;
}
const exited = (child) => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) resolve();
  else child.once('exit', resolve);
});
const running = (child) => child.exitCode === null && child.signalCode === null;
const until = async (check, ms = 5000) => { const end = Date.now() + ms; while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };

test('stopChrome ends the processes on its profile folder, and leaves one on a longer name alone', async (t) => {
  const profile = path.join(os.tmpdir(), `gm-test-chrome-${process.pid}-a`);
  const mine = fakeChrome(profile);
  const other = fakeChrome(`${profile}b`);
  t.after(() => { other.kill('SIGKILL'); mine.kill('SIGKILL'); });
  await new Promise((r) => setTimeout(r, 300));   // both have started
  assert.equal(stopChrome(profile), 1);
  await Promise.race([exited(mine), new Promise((r) => setTimeout(r, 5000))]);
  assert.equal(running(mine), false, 'the process on the profile folder was ended');
  assert.equal(running(other), true, 'the process on another profile folder runs on');
  assert.equal(stopChrome(profile), 0, 'nothing left to end');
  assert.equal(stopChrome(''), 0);
});

test('a lock whose holder died is cleared with the Chrome it left running and that Chrome\'s profile', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-reap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const lock = path.join(root, 'lock');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  fs.mkdirSync(lock);
  const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
  fs.writeFileSync(path.join(lock, 'pid'), dead.stdout.trim());
  fs.writeFileSync(path.join(lock, 'profile'), profile);
  const orphan = fakeChrome(profile);
  t.after(() => orphan.kill('SIGKILL'));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(withChromeLock(() => 'ran', { dir: lock, waitMs: 10000 }), 'ran');
  await until(() => !running(orphan));
  assert.equal(running(orphan), false, 'the orphaned Chrome was ended');
  assert.equal(fs.existsSync(profile), false, 'its profile folder was removed');
});

test('a stale lock naming a folder that is not a launch profile leaves that folder and its processes alone', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-planted-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const lock = path.join(root, 'lock');
  const planted = path.join(root, 'someone-elses-folder');
  fs.mkdirSync(lock);
  fs.mkdirSync(planted);
  const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
  fs.writeFileSync(path.join(lock, 'pid'), dead.stdout.trim());
  fs.writeFileSync(path.join(lock, 'profile'), planted);
  const bystander = fakeChrome(planted);
  t.after(() => bystander.kill('SIGKILL'));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(withChromeLock(() => 'ran', { dir: lock, waitMs: 10000 }), 'ran');
  assert.equal(fs.existsSync(planted), true, 'the folder named is not removed');
  assert.equal(running(bystander), true, 'the process on it runs on');
});

test('the Chrome temp files that appear during a launch are removed after it, and earlier ones stay', (t) => {
  const { chromeTempNow, removeNewChromeTemp } = require('../lib/chrome');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-temp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, '.com.google.Chrome.before'), 'x');
  const before = chromeTempNow(dir);
  fs.writeFileSync(path.join(dir, '.com.google.Chrome.during'), 'x');
  fs.mkdirSync(path.join(dir, '.com.google.Chrome.dir'));
  fs.mkdirSync(path.join(dir, 'com.google.Chrome.chrome_chrome_url_fetcher_.abc123'));
  fs.writeFileSync(path.join(dir, 'not-chrome'), 'x');
  removeNewChromeTemp(before, dir);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['.com.google.Chrome.before', 'not-chrome']);
});
