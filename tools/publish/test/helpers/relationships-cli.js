'use strict';
// `relationships <verb>` run in this process instead of a new one: the same function the command calls, its printed
// lines caught. Flag checking (a flag the verb does not take, an unknown verb) lives in bin/gm-publish.js, so tests of
// that spawn the real command; everything else is cheaper here. Returns { status, stdout, stderr } like spawnSync.
const { runRelationships } = require('../../lib/relationships/cli');

const VALUE = { '--vault': 'vault', '--folder': 'folder', '--newer-than': 'newerThan', '--config': 'config' };
const REPEATED = { '--file': 'files', '--kind': 'kinds', '--set': 'sets', '--skip': 'skip', '--at': 'at' };
const SWITCH = { '--json': 'json', '--write': 'write' };

function parse(argv) {
  const [verb, ...rest] = argv;
  const o = { verb };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (SWITCH[a]) o[SWITCH[a]] = true;
    else if (VALUE[a]) o[VALUE[a]] = rest[++i];
    else if (REPEATED[a]) (o[REPEATED[a]] = o[REPEATED[a]] || []).push(rest[++i]);
    else throw new Error(`relationships-cli helper does not know ${a}`);
  }
  return o;
}

async function relCli(dir, ...argv) {
  const opts = parse([...argv, '--vault', dir]);
  const out = [];
  const err = [];
  const saved = { log: console.log, error: console.error };
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  let status = 0;
  try {
    status = await runRelationships({ ...opts, json: !!opts.json, write: !!opts.write });
  } catch (e) {
    err.push(e.message);
    status = 1;
  } finally {
    console.log = saved.log;
    console.error = saved.error;
  }
  const text = (lines) => lines.map((l) => `${l}\n`).join('');
  return { status, stdout: text(out), stderr: text(err) };
}

module.exports = { relCli };
