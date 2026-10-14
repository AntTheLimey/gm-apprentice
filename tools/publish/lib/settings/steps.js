'use strict';
// The vault's build steps (`player_site.before_build`, `player_site.after_build`): the only code that runs one,
// and the only reader of the site folder's package.json scripts they were.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { REGISTRY } = require('./registry');

const TEN_MINUTES = 10 * 60 * 1000;

// The environment a step runs in: this process's, with the site folder's `node_modules/.bin` first on the path, as
// `npm run` gives a script (a step naming an installed tool works). Windows may spell the variable `Path`.
function envFor(cwd) {
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  env[key] = [path.join(cwd, 'node_modules', '.bin'), env[key]].filter(Boolean).join(path.delimiter);
  return env;
}

// Runs each command in order, in `cwd`, printing it first; the first that fails stops the rest.
// `stdio` lets a caller whose stdout is a payload send the steps' output to stderr.
function runSteps(commands, { cwd, label, log = console.log, timeoutMs = TEN_MINUTES, stdio = 'inherit' } = {}) {
  const total = commands.length;
  commands.forEach((command, i) => {
    log(`Running ${label} step ${i + 1} of ${total}: ${command}`);
    const res = spawnSync(command, { cwd, shell: true, stdio, timeout: timeoutMs, env: envFor(cwd) });
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

// What a vault on the new settings should hear about a build step that package.json still holds. `scripts` is
// packageScripts(); `steps` is { before, after } from the vault's settings. { twice, only }, each text or null:
//   twice  the vault holds steps for that slot too: `npm run build` runs both, so the vault's run twice there
//   only   package.json alone holds it: it still runs under `npm run build` and `deploy` until the next update
const SLOT = { prebuild: ['before', 'before_build'], postbuild: ['after', 'after_build'] };
function packageNotes(scripts, steps) {
  const held = (n) => ((steps || {})[SLOT[n][0]] || []).length > 0;
  const list = (names) => names.map((n) => `\`${n}\``).join(' and ');
  const doubled = Object.keys(scripts).filter(held);
  const alone = Object.keys(scripts).filter((n) => !held(n));
  const plural = (names, one, many) => (names.length === 1 ? one : many);
  return {
    twice: doubled.length
      ? `${list(doubled)} in the site folder's package.json also run${plural(doubled, 's', '')} under \`npm run build\`, after the tool has run the vault's own ${doubled.map((n) => SLOT[n][1]).join(' and ')} steps, so those run twice there; \`deploy\` runs only the vault's. The next update moves ${plural(doubled, 'it', 'them')}.`
      : null,
    only: alone.length
      ? `${list(alone)} in the site folder's package.json still run${plural(alone, 's', '')} under \`npm run build\` and \`deploy\`, and move${plural(alone, 's', '')} into the vault at the next update.`
      : null,
  };
}

module.exports = { runSteps, packageScripts, packageNotes, SLOT };
