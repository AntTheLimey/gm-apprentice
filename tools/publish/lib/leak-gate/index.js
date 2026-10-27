'use strict';
// The leak gate (#293): the finished player site, after every build step, read for hidden text and secret names.
// It writes nothing. deploy refuses on a finding; `leaks` lists, checks, accepts and prunes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { loadPublishList } = require('../manifest');
const { collectHidden, HELD_TITLE } = require('./collect');
const { foldQuotes } = require('../note-faults');
const { createMatcher, readOutput, listFiles, stateFileText, TEXT_EXT } = require('./match');
const { nameFindings, neverShowFindings } = require('./names');
const { wordsOf, nameSet, onlyNames } = require('./text');
const { isSettledHeading, settledHeadingGone } = require('../settled-headings');
const { isAcceptedTie } = require('../accepted-ties');
const { indexTexts } = require('./index-text');
const { addressKey } = require('../props/address');
const { canonicalNfc } = require('../unicode');
const { decodeEntities } = require('../templates/gurps/tables');

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

// A file of a prop the site does not publish: one at the prop's address (unless a shipping prop or the site itself has
// it), or any other file that is not text and has the prop file's bytes (a PDF or picture copied by hand). A text prop
// file is found by its text. And a page or SVG that links that address, or the page its note would have (an old listing
// left in a kept folder, however short the prop's title): no page the site builds links either.
const UNREVEALED = 'the prop file of a note the site does not publish';
const LINK_ATTR = /\s(?:href|src|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
// The site addresses a page or SVG at `rel` links: each href or src, read relative to the file, without its query or anchor.
function linkedAddresses(rel, raw) {
  const out = [];
  for (const m of raw.matchAll(LINK_ATTR)) {
    let v = decodeEntities(m[1] ?? m[2] ?? m[3]).trim().replace(/[?#].*$/, '');
    if (!v || EXTERNAL.test(v)) continue;
    try { v = decodeURIComponent(v); } catch (e) { /* as written */ }
    const joined = v.startsWith('/') ? path.posix.normalize(v.slice(1)) : path.posix.join(path.posix.dirname(rel), v);
    if (joined && !joined.startsWith('..')) out.push(joined);
  }
  return out;
}
function propUnrevealed({ outputDir, hidden, files }) {
  const found = [];
  if (!hidden.heldProps.length && !hidden.heldNotePages.length) return found;
  const shipped = new Set([...hidden.propFiles, ...hidden.madeFiles].map(addressKey));
  const atAddress = new Map();
  for (const h of hidden.heldProps) {
    if (h.address && !shipped.has(addressKey(h.address)) && !hidden.siteTakes(h.address) && !atAddress.has(addressKey(h.address))) atAddress.set(addressKey(h.address), h);
  }
  // The page an unpublished prop note would have: the build never links a page it does not publish, so a link there
  // (an old listing's row of a plain prop) is its prop shown. Only a link: a file there is read by its text.
  const linkedOnly = new Map(atAddress);
  for (const h of hidden.heldNotePages) {
    const key = addressKey(h.address);
    if (!shipped.has(key) && !hidden.siteTakes(h.address) && !linkedOnly.has(key)) linkedOnly.set(key, h);
  }
  const bySize = new Map();
  for (const h of hidden.heldProps) {
    // A page the tool would make has no bytes to know it by (hash null): only its address is watched.
    if (h.hash === null || TEXT_EXT.has(path.extname(h.address || '').toLowerCase())) continue;
    if (!bySize.has(h.size)) bySize.set(h.size, []);
    bySize.get(h.size).push(h);
  }
  const add = (page, h) => {
    const text = wordsOf(h.rel).join(' ');
    found.push({ id: findingId(page, text), kind: 'name', code: 'PROP_UNREVEALED', page, text, shown: page, note: h.rel, reason: UNREVEALED });
  };
  if (linkedOnly.size) {
    for (const file of files) {
      if (!['.html', '.htm', '.svg'].includes(file.ext)) continue;
      for (const address of linkedAddresses(file.rel, file.raw)) {
        const at = linkedOnly.get(addressKey(address));
        if (at) add(file.rel, at);
      }
    }
  }
  for (const rel of listFiles(outputDir)) {
    if (hidden.propFiles.has(canonicalNfc(rel))) continue;
    const at = atAddress.get(addressKey(rel));
    if (at) { add(rel, at); continue; }
    if (TEXT_EXT.has(path.extname(rel).toLowerCase())) continue;
    const full = path.join(outputDir, ...rel.split('/'));
    let size;
    try { size = fs.statSync(full).size; } catch (e) { continue; }
    const same = bySize.get(size);
    if (!same) continue;
    const hash = crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex');
    const h = same.find((x) => x.hash === hash);
    if (h) add(rel, h);
  }
  return found;
}

// An unpublished prop's title in a kept folder (an old listing the build no longer cleans): looked for as a whole phrase,
// as written, so a title of two or three words, too short to be hidden text, still counts there. One word is not looked
// for (too common to tell). A listing's own sealed title stays allowed (sealedOn). A title the player site's own text
// already says is no secret, by the rule a hidden piece is (`visible`, as words), and a page this build writes (a prop's
// file, a page it makes, the props page) is not read here: the GM cannot clear a finding there by editing it.
const NOT_WORD = '(?<![\\p{L}\\p{N}])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}])';
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function heldTitleFindings({ files, hidden }) {
  const found = [];
  if (!hidden.heldTitles.length) return found;
  const shown = hidden.visible.map((text) => ` ${wordsOf(text).join(' ')} `);
  const titles = hidden.heldTitles.map((h) => ({
    ...h,
    text: wordsOf(h.title).join(' '),
    re: new RegExp(NOT_WORD + foldQuotes(h.title).trim().split(/\s+/).map(escapeRe).join('\\s+') + NOT_WORD_AFTER, 'u'),
  })).filter((t) => !shown.some((run) => run.includes(` ${t.text} `)));
  if (!titles.length) return found;
  const built = (rel) => {
    const key = canonicalNfc(rel);
    return hidden.madeFiles.has(key) || hidden.propFiles.has(key) || (hidden.collectionAddress !== null && addressKey(key) === addressKey(hidden.collectionAddress));
  };
  for (const file of files) {
    if (!hidden.keeps(file.rel) || built(file.rel)) continue;
    const sealed = hidden.sealedOn.get(canonicalNfc(file.rel));
    const text = foldQuotes(file.text || '');
    for (const t of titles) {
      if (sealed && sealed.has(t.text)) continue;
      const m = t.re.exec(text);
      if (!m) continue;
      found.push({ id: findingId(file.rel, t.text), kind: 'text', code: 'HIDDEN_TEXT', page: file.rel, text: t.text, shown: m[0].replace(/\s+/g, ' '), note: t.note, reason: HELD_TITLE });
    }
  }
  return found;
}

function runLeakGate({ configPath, outputDir }) {
  const start = performance.now();
  const done = (r) => ({ skipped: null, missing: false, findings: [], unneeded: [], warnings: [], files: 0, ...r, seconds: (performance.now() - start) / 1000 });
  const hidden = collectHidden({ configPath, outputDir });
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
  // A container's state file is read as the data it holds (match.js stateFileText).
  for (const file of files) {
    if (!hidden.stateFiles.has(canonicalNfc(file.rel))) continue;
    file.text = stateFileText(file.raw);
    file.words = wordsOf(file.text);
  }
  const raw = new Map();
  for (const file of files) {
    // A shipping prop's own file is its note's published form: another note's hidden text there is the prop's (a letter
    // a scene quotes), its own note's hidden text is a leak as anywhere.
    const owners = hidden.propOwner.get(canonicalNfc(file.rel));
    // A listing (a container's page, the props page) prints the title of an item the players have not found: those
    // words, and any hidden piece whose words run wholly inside them, are no finding there. Titles and pieces are both
    // words joined by single spaces, so a padded `includes` matches whole words in order, never part of a word.
    const titles = hidden.sealedOn.get(canonicalNfc(file.rel));
    const sealed = titles && [...titles].map((t) => ` ${t} `);
    for (const { piece } of matcher.scan(file.words)) {
      if (owners !== undefined && !owners.has(piece.note)) continue;
      if (sealed && sealed.some((t) => t.includes(` ${piece.text} `))) continue;
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
  for (const f of propUnrevealed({ outputDir, hidden, files })) {
    const key = keyOf(f.page, f.text);
    if (!raw.has(key)) raw.set(key, f);
  }
  // A page already found for a prop (its link, or its title as hidden text) is told once.
  const toldFor = new Set([...raw.values()].map((f) => `${f.page}\n${f.note}`));
  for (const f of heldTitleFindings({ files, hidden })) {
    const key = keyOf(f.page, f.text);
    if (!raw.has(key) && !toldFor.has(`${f.page}\n${f.note}`)) raw.set(key, f);
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
  // A sentence accepted on a page also covers its copy in that page's search index entry
  // ("search-index.json#npcs/ada.html"), so an accept written before the index was read still stands.
  const entryPage = (f) => (f.code !== 'NEVER_SHOW' && f.page.includes('#') ? f.page.slice(f.page.indexOf('#') + 1) : null);
  const coveredByPage = (f) => entryPage(f) !== null && acceptedKeys.has(keyOf(entryPage(f), f.text));
  const inEntries = new Set([...raw.values()].filter((f) => entryPage(f) !== null).map((f) => keyOf(entryPage(f), f.text)));
  const findings = [...raw.values()].filter((f) => !acceptedKeys.has(findingKey(f)) && !coveredByPage(f)).sort(byPageText);
  const unneeded = [...accepted.filter((a) => !raw.has(acceptedKey(a)) && !(a.note !== NEVER_NOTE && inEntries.has(keyOf(a.page, a.text)))),
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
