'use strict';
// Removes every temp folder a test process made (#565). `npm test` loads this into each test file's process with
// `--require`, so no test has to remember its own clean-up: each folder `fs.mkdtemp`, `fs.mkdtempSync` or
// `fs.promises.mkdtemp` creates under the system temp folder is noted, and removed when the process exits. Without
// it, a few weeks of runs left over a million folders (about 199 GB) in the temp folder.
// A test that needs a folder gone sooner still removes it itself; removing it twice is harmless.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const made = new Set();
const roots = [...new Set([os.tmpdir(), safeRealpath(os.tmpdir())])].map((r) => r + path.sep);

function safeRealpath(p) { try { return fs.realpathSync(p); } catch (_) { return p; } }

// Only folders inside the temp folder are noted: a test that makes one inside its own fixture leaves it to that.
function note(dir) {
  if (typeof dir === 'string' && roots.some((r) => path.resolve(dir).startsWith(r))) made.add(dir);
  return dir;
}

const { mkdtempSync, mkdtemp } = fs;
const promisesMkdtemp = fs.promises.mkdtemp;
fs.mkdtempSync = function mkdtempSyncNoted(...args) { return note(mkdtempSync.apply(this, args)); };
fs.mkdtemp = function mkdtempNoted(...args) {
  const cb = args[args.length - 1];
  if (typeof cb !== 'function') return mkdtemp.apply(this, args);
  args[args.length - 1] = (err, dir) => cb(err, err ? dir : note(dir));
  return mkdtemp.apply(this, args);
};
fs.promises.mkdtemp = async function promisesMkdtempNoted(...args) { return note(await promisesMkdtemp.apply(this, args)); };

// `exit` handlers run synchronously, which rmSync is. A folder something still holds open (Windows) is retried a
// few times, then left: a clean-up that fails must never fail the test run.
process.on('exit', () => {
  for (const dir of made) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch (_) { /* left behind */ }
  }
});

module.exports = { madeSoFar: () => [...made] };
