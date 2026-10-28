'use strict';
// The vault's build steps (`player_site.before_build`, `player_site.after_build`): the only code that runs one,
// and the only reader of the site folder's package.json scripts they were.
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
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
  // Loaded here, not with the module: the settings move reads this module's script splitter, and a host that embeds
  // the move should not load child_process for it (#535).
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

// A package.json script as a list of commands: one entry per `&&` only when the text holds nothing a shell reads
// differently (a quote, a pipe, a `;`, a bracket, a redirect, a line end, a lone `&`) and no part sets shell state for
// the next (`cd`, `export`, `NAME=value` ...); otherwise it is one entry, whole.
function splitScript(text) {
  const whole = [text.trim()];
  if (/["'`|;()<>\n\r]/.test(text) || text.replace(/&&/g, '').includes('&')) return whole;
  const parts = text.split('&&').map((x) => x.trim());
  // Each step is its own shell, so a part that sets shell state for the next (a folder, a variable) cannot be split off.
  const setsState = (x) => /^(cd|pushd|popd|export|set|unset|umask|trap|alias|unalias|ulimit|shopt|source|eval|exec)(\s|$)/.test(x) || /^\.(\s|$)/.test(x) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(x);
  return parts.some((x) => x === '' || setsState(x)) ? whole : parts;
}

// What a vault on the new settings should hear about a build step that package.json still holds. `scripts` is
// packageScripts(); `steps` is { before, after } from the vault's settings. { twice, only }, each text or null, as the
// update treats each case (move.js):
//   twice  the vault holds steps for that slot too: `npm run build` runs both. If package.json holds the same steps the
//          vault's run twice there and the update removes it; if it differs the update leaves it, and the GM chooses
//   only   package.json alone holds it: it still runs under `npm run build` and `deploy` until the next update
// `fix` is what the GM can do about `twice`: nothing when the update takes care of all of it.
const SLOT = { prebuild: ['before', 'before_build'], postbuild: ['after', 'after_build'] };
function packageNotes(scripts, steps) {
  const held = (n) => ((steps || {})[SLOT[n][0]] || []).length > 0;
  const list = (names) => names.map((n) => `\`${n}\``).join(' and ');
  const both = Object.keys(scripts).filter(held);
  const same = both.filter((n) => isDeepStrictEqual(splitScript(scripts[n]), steps[SLOT[n][0]]));
  const differ = both.filter((n) => !same.includes(n));
  const alone = Object.keys(scripts).filter((n) => !held(n));
  const plural = (names, one, many) => (names.length === 1 ? one : many);
  const doubled = [
    same.length
      ? `${list(same)} in the site folder's package.json also run${plural(same, 's', '')} under \`npm run build\`, after the tool has run the vault's own ${same.map((n) => SLOT[n][1]).join(' and ')} steps, so those run twice there; \`deploy\` runs only the vault's. The next update removes ${plural(same, 'it', 'them')} from package.json.`
      : null,
    differ.length
      ? `${list(differ)} in the site folder's package.json differ${plural(differ, 's', '')} from the vault's ${differ.map((n) => SLOT[n][1]).join(' and ')} steps. Both run under \`npm run build\` (the vault's first); \`deploy\` runs only the vault's. The next update leaves ${plural(differ, 'it', 'them')} where ${plural(differ, 'it is', 'they are')}: to stop the double run, make them the same, or take the script out of package.json.`
      : null,
  ].filter(Boolean);
  return {
    twice: doubled.length ? doubled.join(' ') : null,
    fix: differ.length ? 'make the package.json script the same as the vault\'s steps, or take it out of package.json' : 'nothing to do: the vault update removes it',
    only: alone.length
      ? `${list(alone)} in the site folder's package.json still run${plural(alone, 's', '')} under \`npm run build\` and \`deploy\`, and move${plural(alone, 's', '')} into the vault at the next update.`
      : null,
  };
}

module.exports = { runSteps, packageScripts, packageNotes, splitScript, SLOT };
