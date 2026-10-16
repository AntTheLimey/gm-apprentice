'use strict';
// `relationships <verb>`: the relationship ontology made short. Tasks 7 and 8 add `check` and `fix`.
const { words, wordsData } = require('./words');

const VERBS = ['words'];

async function runRelationships({ verb, vault, json }) {
  if (verb === 'words') {
    if (json) console.log(JSON.stringify(wordsData({ vaultPath: vault }), null, 2));
    else console.log(words({ vaultPath: vault }));
    return 0;
  }
  throw new Error(`Unknown relationships command: ${verb}`);
}

module.exports = { runRelationships, VERBS };
