'use strict';
// `relationships <verb>`: the relationship ontology made short (`words`) and every relationship rule as a
// check (`check`). Task 8 adds `fix`.
const fs = require('fs');
const path = require('path');
const { words, wordsData } = require('./words');
const { readVault } = require('./read');
const { check, render } = require('./check');
const { ontology } = require('../ontology');

const VERBS = ['words', 'check'];

async function runRelationships({ verb, vault, json, folder, files, newerThan }) {
  if (verb === 'check') {
    const root = path.resolve(vault || '.');
    let since;
    if (newerThan) {
      try {
        since = fs.statSync(path.join(root, newerThan)).mtimeMs / 1000;
      } catch {
        throw new Error(`--newer-than names no file in the vault: ${newerThan}`);
      }
    }
    const model = readVault(root, { folder, files: files && files.length ? files : undefined, newerThan: since });
    for (const fault of model.faults) console.error(`cannot read ${fault.rel}: ${fault.message}`);
    const findings = check(model, ontology, { vaultPath: root });
    console.log(json ? JSON.stringify(findings, null, 2) : render(findings));
    return 0;
  }
  if (verb === 'words') {
    if (json) console.log(JSON.stringify(wordsData({ vaultPath: vault }), null, 2));
    else console.log(words({ vaultPath: vault }));
    return 0;
  }
  throw new Error(`Unknown relationships command: ${verb}`);
}

module.exports = { runRelationships, VERBS };
