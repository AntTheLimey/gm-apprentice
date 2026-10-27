'use strict';
// `leaks list|check|accept|prune|settle`: the leak gate on the folder as it stands, without deploying. The publish-site skill
// uses these to walk the GM through each finding; the GM never edits the accepted list by hand.
const fs = require('fs');
const path = require('path');
const { loadVaultConfig, siteConfigFor, outputFolderOf, tomlOutputFolder } = require('./config');
const { loadPublishList, writeAccepted } = require('./manifest');
const { ACCEPTED_FROM, SETTLE_FROM } = require('./settings/layout');
const { siteToolOlderThan } = require('./settings/move');
const { runLeakGate, formatFindings, gateSummary, isPage } = require('./leak-gate');
const { wordsOf } = require('./leak-gate/text');
const { HEADING_NOTE, settledHeadingGone } = require('./settled-headings');
const { vaultSpelling } = require('./vault-reader');

// The folder deploy uploads: the one wrangler.toml names, when the site has one, else the output folder.
function gateFolderFor(configPath) {
  const resolved = path.resolve(configPath || './vault.config.json');
  const siteRoot = path.dirname(resolved);
  const config = siteConfigFor(loadVaultConfig(resolved), siteRoot);
  const toml = path.join(siteRoot, 'wrangler.toml');
  const named = fs.existsSync(toml) ? tomlOutputFolder(fs.readFileSync(toml, 'utf8'), siteRoot) : null;
  return named || path.resolve(siteRoot, outputFolderOf(config));
}

const sameLeak = (a, b) => a.note === b.note && a.text === b.text;

// The findings one accept covers: every one on a page (`allOnPage`), every one from a note (`note`), or the one named by
// page and id or sentence together with its copies in the site's data files (the same sentence from the same note in a
// file that is not a page: the previews, the search index). A never-show word has no note to tie its copies to, so
// it is accepted file by file.
function chosenFindings(findings, opts) {
  if (opts.allOnPage) return findings.filter((f) => f.page === String(opts.allOnPage).trim());
  if (opts.note) return findings.filter((f) => f.note === String(opts.note).trim());
  const page = String(opts.page || '').trim();
  const given = String(opts.text || '').trim();
  const wanted = /^[0-9a-f]{6}$/.test(given) ? null : wordsOf(given).join(' ');
  const one = findings.find((f) => f.page === page && (wanted === null ? f.id === given : f.text === wanted));
  if (!one) return [];
  return [one, ...(isPage(one.page) && one.code !== 'NEVER_SHOW' ? findings.filter((f) => f !== one && !isPage(f.page) && sameLeak(f, one)) : [])];
}

function notAFinding(opts) {
  if (opts.allOnPage) return `${opts.allOnPage} has no finding of the leak check; leaks list shows the current ones.`;
  if (opts.note) return `${opts.note} has no finding of the leak check; leaks list shows the current ones.`;
  return `"${opts.text}" on ${opts.page} is not a finding of the leak check; leaks list shows the current ones.`;
}

// The accept refusal for a site whose tool reads an accepted-only publish list as an empty publish list, and the settle
// refusal for one whose tool reads a settled heading as an accepted finding no longer needed (prune would delete it).
const ACCEPT = { from: ACCEPTED_FROM, words: ['accepted', 'accepting', 'accept'], why: 'reads the accepted list as an empty publish list' };
const SETTLE = { from: SETTLE_FROM, words: ['settled', 'settling', 'settle'], why: 'reads a settled heading as a finding no longer needed, and prune deletes it' };
function tooOldFor(configPath, { from, words: [done, doing, verb], why } = ACCEPT) {
  const old = siteToolOlderThan(path.dirname(configPath), from);
  if (!old) return null;
  return {
    line: `Not ${done}: this site's publish tool is ${old.shown}, and ${doing} needs ${from} or later `
      + `(an older tool ${why}). Update the site first `
      + `(gm-apprentice-publish update-pin --site ${path.dirname(configPath)}), then ${verb} again.`,
    shown: old.shown,
    needs: from,
  };
}

// `leaks settle <note> <heading>`: a Keeper-looking heading gm-leak flagged, which the GM means for players (#453).
// It needs no built site: gm-leak reads the vault.
function settleHeading(opts, configPath, out, err) {
  // A refusal under --json says why on stderr too: vault_check reads the last stderr line of a failed run.
  const print = (lines, payload, rc) => {
    if (opts.json) { out(JSON.stringify(payload, null, 2)); if (rc) lines.forEach((l) => err(l)); } else lines.forEach((l) => out(l));
    return rc;
  };
  const vaultPath = opts.vault ? path.resolve(opts.vault) : path.resolve(path.dirname(configPath), loadVaultConfig(configPath).vaultPath);
  const given = String(opts.page || '').trim().split(path.sep).join('/');
  const heading = String(opts.text || '').trim();
  const page = given.endsWith('.md') ? vaultSpelling(vaultPath, given) : null;
  if (!page) return print([`Not settled: there is no note ${given} in ${vaultPath}.`], { settled: false }, 1);
  if (!heading) return print(['Not settled: no heading was given.'], { settled: false }, 1);
  const record = { page, text: heading, note: HEADING_NOTE };
  if (settledHeadingGone(vaultPath, record)) return print([`Not settled: ${page} has no heading "${heading}".`], { settled: false }, 1);
  const old = tooOldFor(configPath, SETTLE);
  if (old) return print([old.line], { settled: false, siteTool: old.shown, needs: old.needs }, 1);
  const list = loadPublishList(vaultPath, { warn: () => {} });
  const accepted = (list && list.accepted) || [];
  if (!accepted.some((a) => a.note === HEADING_NOTE && a.page === page && a.text === heading)) {
    try { writeAccepted(vaultPath, [...accepted, record]); } catch (e) { return print([e.message], { settled: false }, 1); }
  }
  return print([`Settled: the heading "${heading}" in ${page} is for players. gm-leak asks again if the heading or the note's name changes.`],
    { settled: true, heading: record }, 0);
}

async function runLeaks(options, deps) {
  const opts = options || {};
  const out = (deps && deps.out) || console.log;
  const configPath = path.resolve(opts.configPath || './vault.config.json');
  if (opts.verb === 'settle') return settleHeading(opts, configPath, out, (deps && deps.err) || console.error);
  const outputDir = gateFolderFor(configPath);
  // A hiding-side settings fault (a never_show that is not a list) stops here too: the check would look for nothing.
  require('./config').assertNoStopsFor(configPath, 'leaks');
  const result = runLeakGate({ configPath, outputDir });
  const vaultPath = path.resolve(path.dirname(configPath), loadVaultConfig(configPath).vaultPath);
  const print = (lines, payload, rc) => { if (opts.json) out(JSON.stringify(payload, null, 2)); else lines.forEach((l) => out(l)); return rc; };

  if (result.skipped) return print([result.skipped], gateSummary(result), 0);
  if (result.missing) return print([`There is no built site in ${outputDir} to check. Build it first (gm-apprentice-publish build).`], gateSummary(result), 2);

  if (opts.verb === 'list' || opts.verb === 'check') {
    const n = result.findings.length;
    const head = n === 0 ? `No hidden text, secret name or never-show word on the player site (${result.files} files read).`
      : `${n} finding${n === 1 ? '' : 's'}: hidden text, a secret name or a never-show word on the player site.`;
    const rc = opts.verb === 'check' && n > 0 ? 1 : 0;
    return print([...(result.warnings || []), head, ...formatFindings(opts.verb === 'list' ? { ...result, unneeded: [] } : result)], gateSummary(result), rc);
  }

  if (opts.verb === 'accept') {
    const chosen = chosenFindings(result.findings, opts);
    if (chosen.length === 0) return print([notAFinding(opts)], { accepted: false }, 1);
    // An older tool reads a publish list holding accepted findings only as an empty publish list: nothing is written
    // until the site's tool reads them.
    const old = tooOldFor(configPath, ACCEPT);
    if (old) return print([old.line], { accepted: false, siteTool: old.shown, needs: old.needs }, 1);
    // A vault with no publish list can accept too: writeAccepted creates a file holding only `accepted:`, which is not
    // a publish list for page decisions (amendment 7a).
    const list = loadPublishList(vaultPath, { warn: () => {} });
    const records = chosen.map((f) => ({ page: f.page, text: f.text, note: f.note }));
    try {
      writeAccepted(vaultPath, [...((list && list.accepted) || []), ...records]);
    } catch (e) { return print([e.message], { accepted: false }, 1); }
    const lines = chosen.length === 1
      ? [`Accepted: "${chosen[0].shown}" on ${chosen[0].page}.`]
      : [`Accepted ${chosen.length} findings:`, ...chosen.map((f) => `  "${f.shown}" on ${f.page}`)];
    lines.push('The leak check will not ask about these again while each sentence and its page stay the same.');
    return print(lines, { accepted: true, finding: chosen[0], findings: chosen }, 0);
  }

  if (opts.verb === 'prune') {
    const list = loadPublishList(vaultPath, { warn: () => {} });
    // By page, text and note: a never-show acceptance and another rule's on the same page and text are two.
    const keyOf = (a) => `${a.page}\n${a.text}\n${a.note || ''}`;
    let stale = new Set(result.unneeded.map(keyOf));
    // --also: other built folders of this site (the move's checked build); an accept any of them still needs stays.
    for (const dir of opts.also || []) {
      const other = runLeakGate({ configPath, outputDir: path.resolve(dir) });
      if (other.missing) return print([`There is no built site in ${path.resolve(dir)} to check; nothing pruned.`], { pruned: 0 }, 2);
      const unneeded = new Set(other.unneeded.map(keyOf));
      stale = new Set([...stale].filter((k) => unneeded.has(k)));
    }
    if (!list || stale.size === 0) return print(['Nothing to prune.'], { pruned: 0 }, 0);
    const kept = (list.accepted || []).filter((a) => !stale.has(keyOf(a)));
    try { writeAccepted(vaultPath, kept); } catch (e) { return print([e.message], { pruned: 0 }, 1); }
    return print([`Pruned ${stale.size} accepted finding${stale.size === 1 ? '' : 's'} no longer needed.`], { pruned: stale.size }, 0);
  }
  out(`Unknown leaks command: ${opts.verb}`);
  return 1;
}

module.exports = { runLeaks, gateFolderFor };
