'use strict';
// The vault's build steps (`player_site.before_build`, `player_site.after_build`): the only code that runs one,
// and the only reader of the site folder's package.json scripts they were.
const fs = require('node:fs');
const path = require('node:path');
const { REGISTRY } = require('./registry');

const TEN_MINUTES = 10 * 60 * 1000;

// The environment a step runs in: this process's, with the site folder's `node_modules/.bin` first on the path, as
// `npm run` gives a script (a step naming an installed tool works). Windows may spell the variable `Path`.
// `extraEnv` is laid over it: the build says which site the step runs for and where that site is built.
function envFor(cwd, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  env[key] = [path.join(cwd, 'node_modules', '.bin'), env[key]].filter(Boolean).join(path.delimiter);
  return env;
}

// Runs each command in order, in `cwd`, printing it first; the first that fails stops the rest.
// `stdio` lets a caller whose stdout is a payload send the steps' output to stderr.
function runSteps(commands, { cwd, label, log = console.log, timeoutMs = TEN_MINUTES, stdio = 'inherit', extraEnv } = {}) {
  // Loaded here, not with the module: a caller that only splits a script should not load child_process (#535).
  const { spawnSync } = require('node:child_process');
  const total = commands.length;
  commands.forEach((command, i) => {
    log(`Running ${label} step ${i + 1} of ${total}: ${command}`);
    const res = spawnSync(command, { cwd, shell: true, stdio, timeout: timeoutMs, env: envFor(cwd, extraEnv) });
    let why = null;
    if (res.error && res.error.code === 'ETIMEDOUT') why = `it took longer than ${Math.round(timeoutMs / 60000)} minutes`;
    else if (res.error) why = String(res.error.message || res.error);
    else if (res.signal) why = `it was stopped by ${res.signal}`;
    else if (res.status !== 0) why = `exit ${res.status}`;
    // A before step fails before anything is written; an after step fails once the pages are in the output folder.
    if (why) throw new Error(`The ${label} step "${command}" failed (${why}). ${label === 'after_build' ? 'The pages were built but not published.' : 'Nothing was published.'}`);
  });
}

// The scripts of a site folder's package.json that were build steps: { prebuild?, postbuild? }, each only when it holds
// text. Never run since plugin 1.11.0: present, they stop the build by name (config.js). Empty when there is no package.json or it cannot be read as JSON. A byte-order mark is ignored, as npm does.
function packageScripts(siteDir) {
  let scripts;
  try {
    scripts = (JSON.parse(fs.readFileSync(path.join(siteDir, 'package.json'), 'utf8').replace(/^﻿/, '')) || {}).scripts;
  } catch {
    return {};
  }
  const out = {};
  for (const e of REGISTRY) {
    if (e.stepsFrom && scripts && typeof scripts[e.stepsFrom] === 'string' && scripts[e.stepsFrom].trim() !== '') out[e.stepsFrom] = scripts[e.stepsFrom];
  }
  return out;
}

// Why the site folder's package.json cannot be read as JSON, or null (no file, or it parses).
function packageJsonProblem(siteDir) {
  let text;
  // A file that is not there is no problem; one that is there and cannot be read is (the scripts in it cannot be checked).
  try { text = fs.readFileSync(path.join(siteDir, 'package.json'), 'utf8'); } catch (e) {
    return e && e.code === 'ENOENT' ? null : `it cannot be read: ${e && e.code ? e.code : String(e.message).split('\n')[0]}`;
  }
  try { JSON.parse(text.replace(/^﻿/, '')); return null; } catch (e) { return String(e.message).split('\n')[0]; }
}

module.exports = { runSteps, packageScripts, packageJsonProblem };
