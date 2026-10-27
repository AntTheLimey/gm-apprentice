'use strict';
// `gm-publish props compare` and `props move-check`: compare.js's rows, printed. move-check builds the player site from
// the vault alone into a temp folder (no build steps run there, and no kept folder is in it: a fresh folder has none to
// keep) and compares the site's output folder, the pages it serves now, with it. The temp folder is always removed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compareSites, formatRows } = require('./compare');
const { outputFolder } = require('./pages-cli');

// Clean-up that outlives a lock held for a moment after a write (Windows).
const RM = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 };

function print(result, json) {
  if (json) console.log(JSON.stringify(result, null, 2));
  else for (const line of formatRows(result)) console.log(line);
  return result.blockers > 0 ? 1 : 0;
}

// Exit code: 1 on any blocker, or with an error line when the comparison cannot be made; else 0.
function runCompare({ oldDir, newDir, serves, listings = [], expectGone = [], json = false }) {
  let result;
  try {
    result = compareSites({ oldDir: path.resolve(oldDir), newDir: path.resolve(newDir), serves, listings, expectGone });
  } catch (e) {
    console.error(`Error: ${e.message}`);
    return 1;
  }
  return print(result, json);
}

// The build's own lines go to stderr while it runs, so stdout holds the rows (or the JSON) alone.
function toStderr(fn) {
  const saved = console.log;
  console.log = (...args) => console.error(...args);
  try { return fn(); } finally { console.log = saved; }
}

// `keepBuild`: a folder (not there, or empty) the build goes into and stays in, for the caller to read; else a temp
// folder, removed.
function runMoveCheck({ configPath, serves, listings = [], expectGone = [], json = false, keepBuild = null }) {
  let oldDir;
  try { oldDir = outputFolder(configPath); } catch (e) {
    console.error(`Error: ${e.message}`);
    return 1;
  }
  if (!fs.existsSync(oldDir)) {
    console.error(`Error: the site's output folder is not there: ${oldDir}. move-check compares the pages the site serves now; build or deploy it first.`);
    return 1;
  }
  let tmp;
  if (keepBuild) {
    tmp = path.resolve(keepBuild);
    let entries = null;
    try { entries = fs.readdirSync(tmp); } catch (e) { if (e.code !== 'ENOENT') entries = ['?']; }
    if (entries && entries.length) {
      console.error(`Error: --keep-build ${tmp} is not an empty folder; name a new one`);
      return 1;
    }
    fs.mkdirSync(tmp, { recursive: true });
  } else tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-move-check-'));
  try {
    const { build } = require('../build');
    try {
      toStderr(() => build({ configPath, site: 'player', outputDirOverride: tmp }));
    } catch (e) {
      console.error(`Error: the vault alone does not build: ${e.message}`);
      return 1;
    }
    let result;
    try {
      result = compareSites({ oldDir, newDir: tmp, serves, listings, expectGone });
    } catch (e) {
      console.error(`Error: ${e.message}`);
      return 1;
    }
    // The leak check on the new build, as deploy would run it (accepted findings apply). Whether a finding is the move's
    // is for the caller, who read the live site before the move (prop_move.py); a finding never changes the exit code.
    try {
      const { runLeakGate } = require('../leak-gate');
      const gate = toStderr(() => runLeakGate({ configPath, outputDir: tmp }));
      result.leaks = (gate.findings || []).map((f) => ({ code: f.code, page: f.page, text: f.text, note: f.note || null, reason: f.reason || null }));
    } catch (e) {
      console.error(`Error: the leak check could not run on the new build: ${e.message}`);
      return 1;
    }
    return print(result, json);
  } finally {
    if (!keepBuild) fs.rmSync(tmp, RM);
  }
}

module.exports = { runCompare, runMoveCheck };
