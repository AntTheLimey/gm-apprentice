'use strict';
// A test that checks what the tool leaves in the system temp folder cannot read the shared folder: another test file,
// or another suite on the same machine, may have a folder of the same prefix there at that moment. inPrivateTmp runs
// `fn` with the temp folder (TMPDIR, TMP and TEMP, which os.tmpdir() reads at each call) pointed at a fresh folder
// of its own, then gives back what `fn` left there and removes it. A promise `fn` returns is awaited; the folder is
// the process's temp folder until it settles, so the test must not run beside others in its file (node:test runs a
// file's tests one at a time).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NAMES = ['TMPDIR', 'TMP', 'TEMP'];

// { result, left }: what `fn` returned, and the names it left in the private temp folder.
function inPrivateTmp(fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gm-private-tmp-')));
  const saved = NAMES.map((n) => [n, process.env[n]]);
  for (const n of NAMES) process.env[n] = dir;
  const finish = () => {
    for (const [n, v] of saved) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
    const left = fs.readdirSync(dir).sort();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    return left;
  };
  let result;
  try { result = fn(); } catch (e) { finish(); throw e; }
  if (result && typeof result.then === 'function') {
    return result.then((r) => ({ result: r, left: finish() }), (e) => { finish(); throw e; });
  }
  return { result, left: finish() };
}

module.exports = { inPrivateTmp };
