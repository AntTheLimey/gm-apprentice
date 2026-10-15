'use strict';
// The leak gate (#293): the finished player site, after every build step, read for hidden text and secret names.
// It writes nothing. deploy refuses on a finding; `leaks` lists, checks, accepts and prunes.
const fs = require('fs');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { loadPublishList } = require('../manifest');
const { collectHidden } = require('./collect');
const { createMatcher, readOutput, listFiles } = require('./match');
const { nameFindings } = require('./names');
const { wordsOf, nameSet, onlyNames } = require('./text');

const findingId = (page, text) => crypto.createHash('sha1').update(`${page}\n${text}`).digest('hex').slice(0, 6);
const keyOf = (page, text) => `${page}\n${text}`;
const byPageText = (a, b) => (a.page < b.page ? -1 : a.page > b.page ? 1 : a.text < b.text ? -1 : a.text > b.text ? 1 : 0);

function runLeakGate({ configPath, outputDir }) {
  const start = performance.now();
  const done = (r) => ({ skipped: null, missing: false, findings: [], unneeded: [], warnings: [], files: 0, ...r, seconds: (performance.now() - start) / 1000 });
  const hidden = collectHidden({ configPath });
  if (hidden.keptBy === 'player') {
    return done({ skipped: 'The leak check is skipped: this vault is kept by a player (vault.kept_by: player), so it holds nothing hidden.' });
  }
  if (!fs.existsSync(outputDir)) return done({ missing: true });

  // A hidden piece the player site's own text also says is not hidden (the GM wrote it in both places).
  // So is one that is only the site's public names (see onlyNames).
  const names = nameSet([...Object.keys(hidden.linkMap), ...hidden.published.map((p) => p.displayTitle || '')]);
  const pieces = hidden.pieces.filter((p) => !onlyNames(p.words, names));
  const all = createMatcher(pieces);
  const alsoVisible = new Set();
  for (const text of hidden.visible) for (const hit of all.scan(wordsOf(text))) alsoVisible.add(hit.piece);
  const matcher = createMatcher(pieces.filter((p) => !alsoVisible.has(p)));

  const files = readOutput(outputDir);
  const raw = new Map();
  for (const file of files) {
    for (const { piece } of matcher.scan(file.words)) {
      const key = keyOf(file.rel, piece.text);
      if (raw.has(key)) continue;
      raw.set(key, { id: findingId(file.rel, piece.text), kind: 'text', code: 'HIDDEN_TEXT', page: file.rel, text: piece.text, shown: piece.shown, note: piece.note, reason: piece.reason });
    }
  }
  // The name checks add theirs here, before the accepted list is applied.
  for (const f of nameFindings({ files, allFiles: listFiles(outputDir), hidden, findingId })) {
    const key = keyOf(f.page, f.text);
    if (!raw.has(key)) raw.set(key, f);
  }

  // The whole file, an accepted-only one included (loadManifest answers null for that: it is no publish list).
  const list = loadPublishList(hidden.vaultPath, { warn: () => {} });
  const accepted = (list && list.accepted) || [];
  const acceptedKeys = new Set(accepted.map((a) => keyOf(a.page, a.text)));
  const findings = [...raw.values()].filter((f) => !acceptedKeys.has(keyOf(f.page, f.text))).sort(byPageText);
  const unneeded = accepted.filter((a) => !raw.has(keyOf(a.page, a.text)));
  return done({ findings, unneeded, warnings: hidden.warnings || [], files: files.length });
}

// The lines a person reads: one block per leak (a sentence from one note), its first page, the sentence, the other files
// it is in, where it came from and why it is hidden. A page comes before a data file (the previews, the search index).
function formatFindings(result) {
  const lines = [];
  const groups = new Map();
  const pageFirst = (a, b) => Number(!/\.html?$/i.test(a.page)) - Number(!/\.html?$/i.test(b.page));
  for (const f of [...result.findings].sort(pageFirst)) {
    const key = `${f.note}\n${f.text}`;
    if (groups.has(key)) groups.get(key).push(f); else groups.set(key, [f]);
  }
  for (const [f, ...rest] of groups.values()) {
    lines.push(`  [${f.id}] ${f.page}: "${f.shown}"`);
    if (rest.length) lines.push(`         also in ${rest.map((r) => `${r.page} [${r.id}]`).join(', ')}`);
    lines.push(`         from ${f.note} (${f.reason})`);
  }
  for (const a of result.unneeded) lines.push(`  no longer needed: the accepted "${a.text}" on ${a.page} (leaks prune removes it)`);
  return lines;
}

function gateSummary(result) {
  return {
    checked: !result.skipped && !result.missing, skipped: result.skipped, missing: result.missing,
    files: result.files, seconds: Number(result.seconds.toFixed(2)), findings: result.findings, unneeded: result.unneeded,
    warnings: result.warnings || [],
  };
}

module.exports = { runLeakGate, findingId, formatFindings, gateSummary };
