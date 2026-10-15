'use strict';
// `leaks list|check|accept|prune`: the leak gate on the folder as it stands, without deploying. The publish-site skill
// uses these to walk the GM through each finding; the GM never edits the accepted list by hand.
const fs = require('fs');
const path = require('path');
const { loadVaultConfig, siteConfigFor, outputFolderOf } = require('./config');
const { loadPublishList, writeAccepted } = require('./manifest');
const { runLeakGate, formatFindings, gateSummary } = require('./leak-gate');
const { wordsOf } = require('./leak-gate/text');

// The folder deploy uploads: the one wrangler.toml names, when the site has one, else the output folder.
function gateFolderFor(configPath) {
  const resolved = path.resolve(configPath || './vault.config.json');
  const siteRoot = path.dirname(resolved);
  const config = siteConfigFor(loadVaultConfig(resolved), siteRoot);
  const toml = path.join(siteRoot, 'wrangler.toml');
  if (fs.existsSync(toml)) {
    const m = /^\s*pages_build_output_dir\s*=\s*["']([^"'\n]+)["']/m.exec(fs.readFileSync(toml, 'utf8'));
    if (m) return path.resolve(siteRoot, m[1]);
  }
  return path.resolve(siteRoot, outputFolderOf(config));
}

async function runLeaks(options, deps) {
  const opts = options || {};
  const out = (deps && deps.out) || console.log;
  const configPath = path.resolve(opts.configPath || './vault.config.json');
  const outputDir = gateFolderFor(configPath);
  const result = runLeakGate({ configPath, outputDir });
  const vaultPath = path.resolve(path.dirname(configPath), loadVaultConfig(configPath).vaultPath);
  const print = (lines, payload, rc) => { if (opts.json) out(JSON.stringify(payload, null, 2)); else lines.forEach((l) => out(l)); return rc; };

  if (result.skipped) return print([result.skipped], gateSummary(result), 0);
  if (result.missing) return print([`There is no built site in ${outputDir} to check. Build it first (gm-apprentice-publish build).`], gateSummary(result), 2);

  if (opts.verb === 'list' || opts.verb === 'check') {
    const n = result.findings.length;
    const head = n === 0 ? `No hidden text or secret name on the player site (${result.files} files read).`
      : `${n} finding${n === 1 ? '' : 's'}: hidden text or a secret name on the player site.`;
    const rc = opts.verb === 'check' && n > 0 ? 1 : 0;
    return print([head, ...formatFindings(opts.verb === 'list' ? { ...result, unneeded: [] } : result)], gateSummary(result), rc);
  }

  if (opts.verb === 'accept') {
    const page = String(opts.page || '').trim();
    const given = String(opts.text || '');
    const wanted = /^[0-9a-f]{6}$/.test(given.trim()) ? null : wordsOf(given).join(' ');
    const finding = result.findings.find((f) => f.page === page && (wanted === null ? f.id === given.trim() : f.text === wanted));
    if (!finding) return print([`"${given}" on ${page} is not a finding of the leak check; leaks list shows the current ones.`], { accepted: false }, 1);
    // A vault with no publish list can accept too: writeAccepted creates a file holding only `accepted:`, which is not
    // a publish list for page decisions (amendment 7a).
    const list = loadPublishList(vaultPath, { warn: () => {} });
    try {
      writeAccepted(vaultPath, [...((list && list.accepted) || []), { page: finding.page, text: finding.text, note: finding.note }]);
    } catch (e) { return print([e.message], { accepted: false }, 1); }
    return print([`Accepted: "${finding.shown}" on ${finding.page}. The leak check will not ask about it again while the sentence and the page stay the same.`], { accepted: true, finding }, 0);
  }

  if (opts.verb === 'prune') {
    const list = loadPublishList(vaultPath, { warn: () => {} });
    const stale = new Set(result.unneeded.map((a) => `${a.page}\n${a.text}`));
    if (!list || stale.size === 0) return print(['Nothing to prune.'], { pruned: 0 }, 0);
    const kept = (list.accepted || []).filter((a) => !stale.has(`${a.page}\n${a.text}`));
    try { writeAccepted(vaultPath, kept); } catch (e) { return print([e.message], { pruned: 0 }, 1); }
    return print([`Pruned ${stale.size} accepted finding${stale.size === 1 ? '' : 's'} no longer needed.`], { pruned: stale.size }, 0);
  }
  out(`Unknown leaks command: ${opts.verb}`);
  return 1;
}

module.exports = { runLeaks, gateFolderFor };
