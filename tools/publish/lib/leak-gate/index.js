'use strict';
// The leak gate (#293): the finished player site, after every build step, read for hidden text and secret names.
// It writes nothing. deploy refuses on a finding; `leaks` lists, checks, accepts and prunes.
const fs = require('fs');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { loadPublishList } = require('../manifest');
const { collectHidden } = require('./collect');
const { createMatcher, readOutput, listFiles } = require('./match');
const { nameFindings, neverShowFindings } = require('./names');
const { wordsOf, nameSet, onlyNames } = require('./text');
const { isSettledHeading, settledHeadingGone } = require('../settled-headings');
const { isAcceptedTie } = require('../accepted-ties');
const { indexTexts } = require('./index-text');

const findingId = (page, text) => crypto.createHash('sha1').update(`${page}\n${text}`).digest('hex').slice(0, 6);
const keyOf = (page, text) => `${page}\n${text}`;
// A file a visitor opens as a page. A search index entry is named after its index file and its page's address
// ("search-index.json#npcs/ada.html"): a data file, as the index is.
const isPage = (rel) => /\.html?$/i.test(rel) && !rel.includes('#');
// A never-show word is its own rule: a finding of it, and an acceptance of it, never stand for another rule's on the
// same page and text (an older accepted withheld name must not let a newly listed word through).
const NEVER_NOTE = 'player_site.never_show';
const findingKey = (f) => (f.code === 'NEVER_SHOW' ? `never\n${keyOf(f.page, f.text)}` : keyOf(f.page, f.text));
const acceptedKey = (a) => (a.note === NEVER_NOTE ? `never\n${keyOf(a.page, a.text)}` : keyOf(a.page, a.text));
const byPageText = (a, b) => (a.page < b.page ? -1 : a.page > b.page ? 1 : a.text < b.text ? -1 : a.text > b.text ? 1 : 0);

function runLeakGate({ configPath, outputDir }) {
  const start = performance.now();
  const done = (r) => ({ skipped: null, missing: false, findings: [], unneeded: [], warnings: [], files: 0, ...r, seconds: (performance.now() - start) / 1000 });
  const hidden = collectHidden({ configPath });
  if (hidden.keptBy === 'player' && hidden.neverShow.length === 0) {
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
  const looked = pieces.filter((p) => !alsoVisible.has(p));
  const matcher = createMatcher(looked);

  const files = readOutput(outputDir);
  const raw = new Map();
  for (const file of files) {
    for (const { piece } of matcher.scan(file.words)) {
      const key = keyOf(file.rel, piece.text);
      if (raw.has(key)) continue;
      raw.set(key, { id: findingId(file.rel, piece.text), kind: 'text', code: 'HIDDEN_TEXT', page: file.rel, text: piece.text, shown: piece.shown, note: piece.note, reason: piece.reason });
    }
  }
  // The search index holds its entries' text as single terms, in no order: read as the build kept it, sentence by sentence,
  // entry by entry, each text of an entry on its own (index-text.js).
  const warnings = [...(hidden.warnings || [])];
  for (const { file, entries } of indexTexts({ files, siteDir: hidden.siteDir, warnings })) {
    for (const { href, texts } of entries) {
      const page = `${file.rel}#${href}`;
      for (const text of texts) {
        for (const { piece } of matcher.scan(wordsOf(text))) {
          const key = keyOf(page, piece.text);
          if (raw.has(key)) continue;
          raw.set(key, { id: findingId(page, piece.text), kind: 'text', code: 'HIDDEN_TEXT', page, text: piece.text, shown: piece.shown, note: piece.note, reason: piece.reason });
        }
      }
    }
  }
  // The name checks add theirs here, before the accepted list is applied.
  for (const f of nameFindings({ files, allFiles: listFiles(outputDir), hidden, findingId })) {
    const key = keyOf(f.page, f.text);
    if (!raw.has(key)) raw.set(key, f);
  }
  for (const f of neverShowFindings({ files, allFiles: listFiles(outputDir), words: hidden.neverShow, findingId, published: hidden.published })) {
    const key = findingKey(f);
    if (!raw.has(key)) raw.set(key, f);
  }

  // The whole file, an accepted-only one included (loadManifest answers null for that: it is no publish list).
  const list = loadPublishList(hidden.vaultPath, { warn: () => {} });
  // A heading gm-leak's settled for players is no finding of this gate (settled-headings.js): it is no longer needed
  // only when its note is gone or no longer has that heading.
  const everyAccepted = (list && list.accepted) || [];
  // A hostile tie the GM left (accepted-ties.js) is no finding of this gate either, and is never pruned here.
  const accepted = everyAccepted.filter((a) => !isSettledHeading(a) && !isAcceptedTie(a));
  const acceptedKeys = new Set(accepted.map(acceptedKey));
  const findings = [...raw.values()].filter((f) => !acceptedKeys.has(findingKey(f))).sort(byPageText);
  const unneeded = [...accepted.filter((a) => !raw.has(acceptedKey(a))),
    ...everyAccepted.filter((a) => isSettledHeading(a) && settledHeadingGone(hidden.vaultPath, a))];
  return done({ findings, unneeded, warnings, files: files.length });
}

// The lines a person reads: one block per leak (a sentence from one note), its first page, the sentence, the other files
// it is in, where it came from and why it is hidden. A page comes before a data file (the previews, the search index).
function formatFindings(result) {
  const lines = [];
  const groups = new Map();
  const pageFirst = (a, b) => Number(!isPage(a.page)) - Number(!isPage(b.page));
  for (const f of [...result.findings].sort(pageFirst)) {
    // A never-show word has no note of its own, and is accepted page by page: one block per page.
    const key = f.code === 'NEVER_SHOW' ? `${f.note}\n${f.text}\n${f.page}` : `${f.note}\n${f.text}`;
    if (groups.has(key)) groups.get(key).push(f); else groups.set(key, [f]);
  }
  for (const [f, ...rest] of groups.values()) {
    lines.push(`  [${f.id}] ${f.page}: "${f.shown}"`);
    if (rest.length) lines.push(`         also in ${rest.map((r) => `${r.page} [${r.id}]`).join(', ')}`);
    lines.push(`         from ${f.note} (${f.reason})`);
  }
  for (const a of result.unneeded) {
    lines.push(isSettledHeading(a)
      ? `  no longer needed: the settled heading "${a.text}" in ${a.page}, which the note no longer has (leaks prune removes it)`
      : `  no longer needed: the accepted "${a.text}" on ${a.page} (leaks prune removes it)`);
  }
  return lines;
}

function gateSummary(result) {
  return {
    checked: !result.skipped && !result.missing, skipped: result.skipped, missing: result.missing,
    files: result.files, seconds: Number(result.seconds.toFixed(2)), findings: result.findings, unneeded: result.unneeded,
    warnings: result.warnings || [],
  };
}

module.exports = { runLeakGate, findingId, formatFindings, gateSummary, isPage };
