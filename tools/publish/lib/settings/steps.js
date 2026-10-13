'use strict';
// The vault's build steps (`player_site.before_build`, `player_site.after_build`): the only code that runs one,
// and the only reader of the site folder's package.json scripts they were.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { REGISTRY } = require('./registry');

const TEN_MINUTES = 10 * 60 * 1000;

// Runs each command in order, in `cwd`, printing it first; the first that fails stops the rest.
// `stdio` lets a caller whose stdout is a payload send the steps' output to stderr.
function runSteps(commands, { cwd, label, log = console.log, timeoutMs = TEN_MINUTES, stdio = 'inherit' } = {}) {
  const total = commands.length;
  commands.forEach((command, i) => {
    log(`Running ${label} step ${i + 1} of ${total}: ${command}`);
    const res = spawnSync(command, { cwd, shell: true, stdio, timeout: timeoutMs });
    let why = null;
    if (res.error && res.error.code === 'ETIMEDOUT') why = `it took longer than ${Math.round(timeoutMs / 60000)} minutes`;
    else if (res.error) why = String(res.error.message || res.error);
    else if (res.signal) why = `it was stopped by ${res.signal}`;
    else if (res.status !== 0) why = `exit ${res.status}`;
    if (why) throw new Error(`The ${label} step "${command}" failed (${why}). Nothing was published.`);
  });
}

// The scripts of a site folder's package.json that were build steps: { prebuild?, postbuild? }, each only when it holds
// text. Empty when there is no package.json or it cannot be read as JSON. A byte-order mark is ignored, as npm does.
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

// The warning for a vault on the new settings whose package.json still holds a step, or null.
function twiceWarning(scripts) {
  const names = Object.keys(scripts);
  if (!names.length) return null;
  const which = names.map((n) => `\`${n}\``).join(' and ');
  return `${which} in the site folder's package.json also run${names.length === 1 ? 's' : ''} under \`npm run build\`, after the tool has run the vault's own steps; the next update moves ${names.length === 1 ? 'it' : 'them'}. Nothing is run on ${names.length === 1 ? 'its' : 'their'} account.`;
}

module.exports = { runSteps, packageScripts, twiceWarning };
