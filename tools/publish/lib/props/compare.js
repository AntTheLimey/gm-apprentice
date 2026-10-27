'use strict';
// `gm-publish props compare` (and `props move-check`, compare-cli.js): the live site's served pages beside what another
// build of the site holds, page by page, before props kept by hand or by site scripts move into the vault. A served page
// (under one of the `serves` folders) must still be there and must not lose a word; a listing (an old index page the move
// replaces) must keep every link into the served folders; every other page must keep its links into them. What a page
// says is the leak gate's reading of it (fileText, wordsOf): one answer to "what does this page say".
const fs = require('fs');
const path = require('path');
const { diffArrays } = require('diff');
const { fileText, listFiles } = require('../leak-gate/match');
const { wordsOf } = require('../leak-gate/text');
const { withoutPropBar } = require('../templates/prop-bar');
const { canonicalNfc } = require('../unicode');
const { decodeEntities } = require('../templates/gurps/tables');

const BLOCKS = new Set(['missing', 'words-differ', 'listing-lost', 'link-lost']);
const isPage = (rel) => /\.html?$/i.test(rel);
// A served picture the new site drops blocks even when no new page names it: a page's script may (a shelf's state file
// names its covers), and a lost picture is lost from the reader's view. Stylesheets and scripts do not block.
const isPicture = (rel) => /\.(?:png|jpe?g|gif|webp|svg|avif)$/i.test(rel);
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
// A run of words named in a row: at most this many words of it, and at most this many runs.
const RUN_WORDS = 20;
const RUNS_SHOWN = 5;

// The words a page says, as the leak gate reads a page, without the bar the tool adds to a prop page (it is the tool's
// way back to the note, not the page's words).
function pageWords(rel, raw) {
  return wordsOf(fileText(rel, withoutPropBar(raw)));
}

// The address a link on the page at `rel` goes to: relative to the page (or the site's root, from a leading /), without
// its query or anchor, a folder as its index.html. null for a link off the site, or above its root.
function linkTarget(rel, href) {
  let v = decodeEntities(href).trim();
  if (!v || v.startsWith('#') || EXTERNAL.test(v)) return null;
  v = v.replace(/[?#].*$/, '');
  try { v = decodeURIComponent(v); } catch (e) { /* as written */ }
  let joined = v.startsWith('/') ? path.posix.normalize(v.slice(1) || '.') : path.posix.join(path.posix.dirname(rel), v || path.posix.basename(rel));
  if (joined === '..' || joined.startsWith('../')) return null;
  if (joined === '.' || v.endsWith('/') || joined.endsWith('/')) joined = path.posix.join(joined === '.' ? '' : joined, 'index.html');
  return canonicalNfc(joined);
}

// The tag pattern of props/links.js (a quoted attribute value may hold a '>').
const TAG = /<([a-zA-Z][\w:-]*)((?:\s(?:"[^"]*"|'[^']*'|[^>"'])*)?)>/g;
const ATTR = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
// The markup a reader's browser reads as tags: without scripts, styles, templates and comments, as the tool's page text
// (note-faults pageText) reads a page; a comment that never closes runs to the end, as a browser reads it.
function liveMarkup(raw) {
  const s = String(raw).replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, '\n').replace(/<!--[\s\S]*?-->/g, '');
  const open = s.indexOf('<!--');
  return open === -1 ? s : s.slice(0, open);
}

// The addresses a page links a reader to (`<a href>`, `<area href>`; `anchors`), or every address it names (any href,
// src or xlink:href: a stylesheet, a picture, a script, a link). `asFolder(target)`: a target that names a folder
// without its slash (href="gazetteer"; the hosts send it on to gazetteer/), as that folder's index.html.
function targetsOf(rel, raw, { anchors, asFolder = (t) => t }) {
  const out = new Set();
  for (const tag of liveMarkup(raw).matchAll(TAG)) {
    const name = tag[1].toLowerCase();
    if (anchors && name !== 'a' && name !== 'area') continue;
    for (const a of tag[2].matchAll(ATTR)) {
      const attr = a[1].toLowerCase();
      if (attr !== 'href' && (anchors || (attr !== 'src' && attr !== 'xlink:href'))) continue;
      const target = linkTarget(rel, a[2] ?? a[3] ?? a[4]);
      if (target) out.add(asFolder(target));
    }
  }
  return out;
}

const runText = (words) => (words.length > RUN_WORDS ? `${words.slice(0, RUN_WORDS).join(' ')} …` : words.join(' '));
const runsText = (label, runs) => {
  if (!runs.length) return '';
  const shown = runs.slice(0, RUNS_SHOWN).map((r) => `"${runText(r)}"`).join(', ');
  return `${label}: ${shown}${runs.length > RUNS_SHOWN ? ` and ${runs.length - RUNS_SHOWN} more` : ''}`;
};

// Whether a removed run is nothing but expected-gone phrases, one after another (a crumb and a footer the old page
// carried, side by side once the words between them are matched).
function onlyExpected(words, phrases) {
  if (!phrases.length) return false;
  const ok = [true];
  for (let i = 1; i <= words.length; i++) {
    ok[i] = phrases.some((p) => p.length <= i && ok[i - p.length] && p.every((w, k) => words[i - p.length + k] === w));
  }
  return ok[words.length];
}

// The old page's words beside the new page's: { removed, added } runs of words.
function wordRuns(oldWords, newWords) {
  const removed = [];
  const added = [];
  for (const part of diffArrays(oldWords, newWords)) {
    if (part.removed) removed.push(part.value);
    else if (part.added) added.push(part.value);
  }
  return { removed, added };
}

function servedPageRow(address, oldRaw, newRaw, expected) {
  if (oldRaw.equals(newRaw)) return { kind: 'same', address, detail: '' };
  const { removed, added } = wordRuns(pageWords(address, oldRaw.toString('utf8')), pageWords(address, newRaw.toString('utf8')));
  const addedText = runsText('added', added);
  if (!removed.length) return { kind: 'same-words', address, detail: addedText || 'other markup, the same words' };
  if (removed.every((run) => onlyExpected(run, expected))) {
    return { kind: 'same-words', address, detail: [runsText('expected gone', removed), addedText].filter(Boolean).join('; ') };
  }
  return { kind: 'words-differ', address, detail: [runsText('removed', removed), addedText].filter(Boolean).join('; ') };
}

function listingRow(address, oldRaw, newRaw, isServed, asFolder) {
  const wanted = [...targetsOf(address, oldRaw.toString('utf8'), { anchors: true, asFolder })].filter(isServed).sort();
  const have = newRaw ? targetsOf(address, newRaw.toString('utf8'), { anchors: true, asFolder }) : new Set();
  const lost = wanted.filter((t) => !have.has(t));
  if (lost.length) return { kind: 'listing-lost', address, detail: `${newRaw ? 'links lost' : 'the page is gone; links lost'}: ${lost.join(', ')}` };
  if (!newRaw) return { kind: 'listing-ok', address, detail: 'the page is gone; it linked nothing in the served folders' };
  const { removed, added } = wordRuns(pageWords(address, oldRaw.toString('utf8')), pageWords(address, newRaw.toString('utf8')));
  const words = removed.length || added.length ? `; words: ${removed.reduce((n, r) => n + r.length, 0)} removed, ${added.reduce((n, r) => n + r.length, 0)} added` : '';
  return { kind: 'listing-ok', address, detail: `${wanted.length} link${wanted.length === 1 ? '' : 's'} kept${words}` };
}

// A site address, as typed (`x/` is its index page), in the form every address here is kept in.
const addressOf = (a) => {
  const s = canonicalNfc(String(a).replace(/\\/g, '/').replace(/^\.?\//, ''));
  return s === '' || s.endsWith('/') ? `${s}index.html` : s;
};
const prefixOf = (p) => {
  const s = canonicalNfc(String(p).replace(/\\/g, '/').replace(/^\.?\//, ''));
  return s.endsWith('/') ? s : `${s}/`;
};

// { rows, blockers, served, pages, same }. `served`: the served files of the old site; `pages`: those that are pages;
// `same`: served pages (listings aside) whose words are all there.
function compareSites({ oldDir, newDir, serves, listings = [], expectGone = [] }) {
  if (!serves || !serves.length) throw new Error('compare needs at least one served folder');
  for (const [dir, what] of [[oldDir, 'old'], [newDir, 'new']]) {
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`the ${what} site folder is not there: ${dir}`);
  }
  const prefixes = serves.map(prefixOf);
  const isServed = (address) => prefixes.some((p) => address.startsWith(p));
  const listingSet = new Set(listings.map(addressOf));
  const expected = expectGone.map((p) => wordsOf(p)).filter((w) => w.length);
  // Each site's files by their address in one Unicode form.
  const filesOf = (dir) => new Map(listFiles(dir).map((rel) => [canonicalNfc(rel), path.join(dir, ...rel.split('/'))]));
  const oldFiles = filesOf(oldDir);
  const newFiles = filesOf(newDir);
  const read = (files, address) => (files.has(address) ? fs.readFileSync(files.get(address)) : null);
  // A folder or a listing the old site does not have: the gate would compare nothing there and call it safe.
  for (const [given, prefix] of serves.map((p, i) => [p, prefixes[i]])) {
    if (![...oldFiles.keys()].some((a) => a.startsWith(prefix))) throw new Error(`--serves ${given} matches nothing in the old site (${oldDir})`);
  }
  for (const [given, address] of listings.map((a) => [a, addressOf(a)])) {
    if (!oldFiles.has(address)) throw new Error(`--listing ${given} is not in the old site (${address} under ${oldDir})`);
  }
  // Every folder of the old site and every served folder, by its address without the slash.
  const folders = new Set(prefixes.map((p) => p.slice(0, -1)));
  for (const a of oldFiles.keys()) for (let i = a.indexOf('/'); i !== -1; i = a.indexOf('/', i + 1)) folders.add(a.slice(0, i));
  const asFolder = (t) => (folders.has(t) && !oldFiles.has(t) ? `${t}/index.html` : t);

  // Every address a page of the new site names, and the pages that name it: a file the move drops that a new page still
  // links is a broken page.
  let namedBy = null;
  const linkersOf = (address) => {
    if (!namedBy) {
      namedBy = new Map();
      for (const [rel, file] of newFiles) {
        if (!isPage(rel)) continue;
        for (const t of targetsOf(rel, fs.readFileSync(file, 'utf8'), { anchors: false, asFolder })) {
          if (!namedBy.has(t)) namedBy.set(t, []);
          namedBy.get(t).push(rel);
        }
      }
    }
    return namedBy.get(address) || [];
  };

  const rows = [];
  let served = 0;
  let pages = 0;
  let same = 0;
  const addresses = [...oldFiles.keys()].sort();
  for (const address of addresses) {
    const listing = listingSet.has(address);
    if (!isServed(address) && !listing) continue;
    if (isServed(address)) served++;
    const oldRaw = read(oldFiles, address);
    const newRaw = read(newFiles, address);
    if (isPage(address)) {
      if (isServed(address)) pages++;
      if (listing) { rows.push(listingRow(address, oldRaw, newRaw, isServed, asFolder)); continue; }
      const row = newRaw ? servedPageRow(address, oldRaw, newRaw, expected) : { kind: 'missing', address, detail: 'not in the new site' };
      if (row.kind === 'same' || row.kind === 'same-words') same++;
      rows.push(row);
    } else if (!newRaw) {
      const linkers = linkersOf(address);
      rows.push(linkers.length
        ? { kind: 'file-dropped', address, detail: `not in the new site, and still linked from ${linkers.slice(0, RUNS_SHOWN).join(', ')}${linkers.length > RUNS_SHOWN ? ` and ${linkers.length - RUNS_SHOWN} more` : ''}`, blocker: true }
        : isPicture(address)
          ? { kind: 'file-dropped', address, detail: 'a picture not in the new site (no new page links it, but a script may show it)', blocker: true }
          : { kind: 'file-dropped', address, detail: 'not in the new site; no new page links it' });
    } else {
      rows.push(oldRaw.equals(newRaw) ? { kind: 'same', address, detail: '' } : { kind: 'file-differs', address, detail: 'its bytes differ' });
    }
  }
  // Every other page's links into the served folders.
  for (const address of addresses) {
    if (!isPage(address) || isServed(address) || listingSet.has(address)) continue;
    const newRaw = read(newFiles, address);
    if (!newRaw) { rows.push({ kind: 'file-dropped', address, detail: 'a page outside the served folders, not in the new site' }); continue; }
    const wanted = [...targetsOf(address, read(oldFiles, address).toString('utf8'), { anchors: true, asFolder })].filter(isServed).sort();
    if (!wanted.length) continue;
    const have = targetsOf(address, newRaw.toString('utf8'), { anchors: true, asFolder });
    for (const target of wanted) if (!have.has(target)) rows.push({ kind: 'link-lost', address, detail: `its link to ${target} is gone` });
  }
  for (const row of rows) if (row.blocker === undefined) row.blocker = BLOCKS.has(row.kind);
  return { rows, blockers: rows.filter((r) => r.blocker).length, served, pages, same };
}

// The lines `props compare` prints: one per row, KIND, address and detail apart by tabs, then the counts.
function formatRows(result) {
  return [
    ...result.rows.map((r) => `${r.kind.toUpperCase()}\t${r.address}\t${r.detail}`),
    `# served: ${result.served} pages: ${result.pages} same: ${result.same} blockers: ${result.blockers}`,
  ];
}

module.exports = { compareSites, pageWords, formatRows, linkTarget };
