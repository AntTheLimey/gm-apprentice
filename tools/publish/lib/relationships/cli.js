'use strict';
// `relationships <verb>`: the relationship ontology made short (`words`) and every relationship rule as a
// check (`check`). Task 8 adds `fix`.
const fs = require('fs');
const path = require('path');
const { words, wordsData } = require('./words');
const { readVault } = require('./read');
const { check, render } = require('./check');
const { planFix, applyFix, renderPlan, removeLeftovers } = require('./fix');
const { ontology } = require('../ontology');

const VERBS = ['words', 'check', 'fix'];

async function runRelationships({ verb, vault, json, folder, files, newerThan, kinds, write }) {
  if (verb === 'check' || verb === 'fix') {
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
    if (verb === 'fix') {
      const FIXABLE = ['off-vocabulary', 'mirrored', 'bidirectional', 'place-missing-tie', 'place-missing-field'];
      for (const k of kinds || []) if (!FIXABLE.includes(k)) throw new Error(`--kind ${k} has no certain repair; the kinds are ${FIXABLE.join(', ')}`);
      if (write) for (const left of removeLeftovers(root)) console.error(`removed a leftover temp file: ${left}`);
      const plan = planFix(model, findings, { vaultPath: root, kinds: kinds && kinds.length ? kinds : undefined, ontology });
      if (write) applyFix(root, plan);
      if (json) {
        console.log(JSON.stringify({ written: !!write, changes: plan.changes, kept: plan.kept, notes: [...plan.texts.keys()] }, null, 2));
      } else console.log(renderPlan(plan, !!write));
      return 0;
    }
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
