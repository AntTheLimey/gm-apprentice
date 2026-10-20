'use strict';
// `relationships <verb>`: the relationship ontology made short (`words`) and every relationship rule as a
// check (`check`), the certain repairs (`fix`), and the tone listing and rewrite the tone tidy stands on
// (`list`, `fix --kind tone`).
const fs = require('fs');
const path = require('path');
const { words, wordsData } = require('./words');
const { readVault } = require('./read');
const { check, render } = require('./check');
const { planFix, applyFix, renderPlan, removeLeftovers } = require('./fix');
const { ontology } = require('../ontology');
const { listTones, planTones, parseSets, skipped } = require('./tones');

const { loadPublishList, writeAccepted } = require('../manifest');
const { acceptedTieKeys, tieText, TIE_NOTE, keyOf } = require('../accepted-ties');
const { TIE_FROM } = require('../settings/layout');
const { siteToolOlderThan, siteFileNamedBy } = require('../settings/move');

const VERBS = ['words', 'check', 'list', 'fix', 'accept'];

const publishList = (root) => loadPublishList(root, { warn: () => {} });

// `accept --at NOTE:LINE ...`: record each tie the GM reviewed and left. Without --write it says what it would record.
function acceptTies(root, { at, write, config }) {
  if (!at || !at.length) throw new Error('accept needs --at NOTE:LINE (a row of tones.py shown)');
  const rows = listTones(readVault(root));
  const picked = [];
  for (const where of at) {
    const cut = String(where).lastIndexOf(':');
    const rel = cut < 0 ? '' : String(where).slice(0, cut).replace(/\\/g, '/');
    const line = cut < 0 ? NaN : Number(String(where).slice(cut + 1));
    const row = rows.find((r) => r.rel.normalize('NFC') === rel.normalize('NFC') && r.line === line);
    if (!row) throw new Error(`${where} is not a relationship's tone line; relationships list shows the ties`);
    picked.push(row);
  }
  // The site whose tool must read the record: --config's, else the one the vault's settings name.
  const named = config ? null : siteFileNamedBy(root);
  const siteDir = config ? path.dirname(path.resolve(config)) : (named && named.exists ? named.dir : null);
  if (write && siteDir) {
    const old = siteToolOlderThan(siteDir, TIE_FROM);
    if (old) {
      throw new Error(`this site's publish tool is ${old.shown}, and accepting a tie needs ${TIE_FROM} or later (an older tool reads the record as an accepted leak finding no longer needed, and prune deletes it). Update the site first (gm-apprentice-publish update-pin --site ${siteDir}), then accept again.`);
    }
  }
  const list = publishList(root);
  const accepted = (list && list.accepted) || [];
  const have = acceptedTieKeys(list);
  const fresh = [];
  for (const row of picked) {
    const record = { page: row.rel, text: tieText(row), note: TIE_NOTE };
    const key = keyOf(record.page, record.text);
    if (have.has(key)) continue;
    have.add(key);
    fresh.push(record);
  }
  if (write && fresh.length) writeAccepted(root, [...accepted, ...fresh]);
  return { written: !!write && fresh.length > 0, recorded: fresh.length, already: picked.length - fresh.length, ties: picked.map((r) => ({ rel: r.rel, line: r.line, tone: r.tone, target: r.target })) };
}

async function runRelationships({ verb, vault, json, folder, files, newerThan, kinds, write, sets, skip, at, config }) {
  if (verb === 'accept') {
    const done = acceptTies(path.resolve(vault || '.'), { at, write, config });
    if (json) console.log(JSON.stringify(done, null, 2));
    else console.log(`${write ? 'Recorded' : 'Would record'} ${done.recorded} tie${done.recorded === 1 ? '' : 's'}${done.already ? ` (${done.already} already accepted)` : ''}`);
    return 0;
  }
  if (verb === 'check' || verb === 'fix' || verb === 'list') {
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
    if (verb === 'list') {
      const rows = listTones(model, { skip, accepted: acceptedTieKeys(publishList(root)) });
      // The notes whose frontmatter does not read: their tones are not in the list, and the caller says so.
      const unread = (model.faults || []).filter((f) => f.inScope && !skipped(f.rel, skip))
        .map((f) => ({ rel: f.rel, message: String(f.message).replace(/\s+/g, ' ').trim() }));
      if (json) console.log(JSON.stringify({ tones: rows, unread }, null, 2));
      else console.log([`# tones: ${rows.length}${unread.length ? `  not read: ${unread.length}` : ''}`, ...rows.map((r) => `${r.rel}:${r.line}\t${r.tone}\t${r.target}\t${r.description.split(/\s+/).filter(Boolean).join(' ')}`)].join('\n'));
      return 0;
    }
    if (verb === 'fix' && (kinds || []).includes('tone')) {
      if (kinds.length > 1) throw new Error('--kind tone is a repair of its own; it cannot be mixed with other kinds');
      if (!sets || !sets.length) throw new Error('--kind tone needs --set OLD=NEW');
      if (write) for (const left of removeLeftovers(root)) console.error(`removed a leftover temp file: ${left}`);
      const plan = planTones(model, { vaultPath: root, sets: parseSets(sets), skip });
      if (write) applyFix(root, plan);
      if (json) console.log(JSON.stringify({ written: !!write, changes: plan.changes, kept: plan.kept, notes: [...plan.texts.keys()] }, null, 2));
      else console.log(renderPlan(plan, !!write));
      return 0;
    }
    if (sets && sets.length) throw new Error('--set goes with fix --kind tone');
    if (verb === 'fix' && skip && skip.length) throw new Error('--skip goes with list and fix --kind tone');
    const findings = check(model, ontology, { vaultPath: root });
    if (verb === 'fix') {
      const FIXABLE = ['off-vocabulary', 'mirrored', 'bidirectional', 'place-missing-tie', 'place-missing-field', 'visit-duplicate'];
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
