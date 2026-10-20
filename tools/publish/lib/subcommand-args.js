'use strict';

// The words after a command, read one way for bin/gm-publish.js and for the `lines`
// command's `command` op, which runs `settings` and `explain --all` without a new process.

// Parse `--config <path>` plus an allowlist of flags, rejecting anything else.
// A mutating command must never let an unrecognised argument fall through to
// execution: `flush --help` used to perform the flush (#178). Returns
// { configPath, flags } or { error }.
// `valueFlags` maps a flag that takes a value (`--pc Jane`) to its key, the
// same way `allowedFlags` maps a bare switch. Value flags reject a following
// option token for the same reason `--config` does: `--pc --json` is a typo,
// not a PC called "--json".
// `repeatedFlags` are value flags a caller may give more than once
// (`--publish A.md --publish B.md`); their key collects an array, empty when the
// flag never appears.
function parseSubcommandArgs(rest, allowedFlags, valueFlags = {}, repeatedFlags = {}) {
  let configPath = './vault.config.json';
  let configGiven = false;
  const flags = {};
  for (const key of Object.values(repeatedFlags)) flags[key] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--config') {
      if (!rest[i + 1] || rest[i + 1].startsWith('-')) return { error: '--config needs a path' };
      configPath = rest[i + 1]; configGiven = true; i++;
    } else if (Object.prototype.hasOwnProperty.call(repeatedFlags, a)) {
      // A `--set` pair may start with a dash: the word before the `=` is a tone as written.
      if (!rest[i + 1] || (rest[i + 1].startsWith('-') && a !== '--set')) return { error: `${a} needs a value` };
      flags[repeatedFlags[a]].push(rest[i + 1]); i++;
    } else if (Object.prototype.hasOwnProperty.call(valueFlags, a)) {
      if (!rest[i + 1] || rest[i + 1].startsWith('-')) return { error: `${a} needs a value` };
      flags[valueFlags[a]] = rest[i + 1]; i++;
    } else if (Object.prototype.hasOwnProperty.call(allowedFlags, a)) {
      flags[allowedFlags[a]] = true;
    } else {
      return { error: `Unknown argument: ${a}` };
    }
  }
  return { configPath, configGiven, flags };
}

module.exports = { parseSubcommandArgs };
