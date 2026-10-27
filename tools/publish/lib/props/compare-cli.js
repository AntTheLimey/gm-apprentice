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

function runMoveCheck({ configPath, serves, listings = [], expectGone = [], json = false }) {
  let oldDir;
  try { oldDir = outputFolder(configPath); } catch (e) {
    console.error(`Error: ${e.message}`);
    return 1;
  }
  if (!fs.existsSync(oldDir)) {
    console.error(`Error: the site's output folder is not there: ${oldDir}. move-check compares the pages the site serves now; build or deploy it first.`);
    return 1;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-move-check-'));
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
    return print(result, json);
  } finally {
    fs.rmSync(tmp, RM);
  }
}

module.exports = { runCompare, runMoveCheck };
