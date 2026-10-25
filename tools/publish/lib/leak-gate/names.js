'use strict';
// The secret-name checks of the build's note audit (note-faults.js), run over the finished folder: a gm_aliases name or
// a withheld note's name in any text file, or in a copied file's name; and a withheld note that publishes.
const { secretNamesOf, findSecretNames, publicWordsOf, foldQuotes, nameMatcher, nameHits, hasName } = require('../note-faults');
const { fileText, pageExtras, isToolFile } = require('./match');
const { wordsOf } = require('./text');
const { canonicalNfc } = require('../unicode');
const { labelsForLinks } = require('../wikilink');

const REASON = { alias: 'a name kept secret in gm_aliases', withheld: 'the name of a note marked withheld' };
const CODE = { alias: 'ALIAS_IN_PROSE', withheld: 'WITHHELD_IN_PROSE' };
const NEVER_SHOW = { code: 'NEVER_SHOW', note: 'player_site.never_show', reason: 'a word the GM listed under player_site.never_show' };
const CONTEXT = 60;

const esc = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The public names of the site that hold a secret name as a part ("Zorn Manor" holds the withheld "Zorn"), as one
// pattern that finds them in a text. A page that prints such a name prints the public name, not the secret one; the
// pull-quote of a paragraph with a link in it is the usual place (the link is flattened to its label there).
function holdersOf(names, publicWords) {
  const holders = [];
  for (const w of publicWords) {
    if (!w) continue;
    const text = foldQuotes(w);
    for (const n of names) {
      if (hasName(n.re, text)) { holders.push(text); break; }
    }
  }
  if (holders.length === 0) return null;
  const parts = [...new Set(holders)].sort((a, b) => b.length - a.length)
    .map((h) => h.split(/[\s_\-\u2010\u2011]+/).filter(Boolean).map(esc).join('[\\s_\\-\\u2010\\u2011]+'));
  return new RegExp('(?<![\\p{L}\\p{N}])(?:' + parts.join('|') + ')(?![\\p{L}\\p{N}])', 'giu');
}

// What a file says for the name search. The search index holds the body as single terms (lunr), and a term is a word of
// some public page: a secret name that is one word of a public name ("Zorn" in "Zorn Manor") would match it for good.
// Its documents (titles, subtitles) are read, and the terms that sit in the aliases field, which no page prints; the
// body terms come from page text the pages already show.
function nameTextOf(file) {
  // A page's inline scripts and data attributes are sent too: added as text after the page (the name search reads a
  // page's text, not its scripts or attributes).
  if (file.ext === '.html' || file.ext === '.htm') {
    const extras = pageExtras(file.raw).join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return extras ? `${file.raw}\n<div>${extras}</div>` : file.raw;
  }
  if (file.ext === '.json') {
    try {
      const data = JSON.parse(file.raw);
      if (data && data.index && Array.isArray(data.index.invertedIndex) && data.documents) {
        const aliasTerms = data.index.invertedIndex.filter(([, posting]) => posting && posting.aliases && Object.keys(posting.aliases).length).map(([term]) => term);
        return [fileText(file.rel, JSON.stringify(data.documents)), ...aliasTerms].join('\n');
      }
    } catch (e) { /* not JSON: read as text below */ }
  }
  return fileText(file.rel, file.raw);
}

function nameFindings({ files, allFiles, hidden, findingId }) {
  const secrets = secretNamesOf({ notes: hidden.notes, publishedRels: hidden.publishedRels, outOf: hidden.outOf, linkMap: hidden.linkMap });
  const found = [];
  const add = (page, kind, alias, owner, context) => {
    const text = wordsOf(alias).join(' ');
    found.push({ id: findingId(page, text), kind: 'name', code: CODE[kind], page, text, shown: context, note: owner, reason: REASON[kind] });
  };
  if (secrets.probe) {
    const publicWords = publicWordsOf(hidden.linkMap, hidden.published);
    const holders = holdersOf(secrets.names, publicWords);
    for (const file of files) {
      const html = nameTextOf(file);
      // The quick test on the file as sent and as read (a name split by tags is whole in the read text).
      if (!secrets.mayHold(html) && !(file.text && secrets.mayHold(file.text))) continue;
      // A public name that holds a secret name is the public name (see holdersOf): taken out before the search.
      const looked = holders ? foldQuotes(html).replace(holders, ' ') : html;
      for (const hit of findSecretNames(looked, secrets.names, { publicWords })) add(file.rel, hit.kind, hit.alias, hit.owner, hit.context);
    }
  }
  // A copied file (a picture, a font) whose name holds a withheld name: the name is in its address. A page is not one
  // (its address is its note's public name), and nor is a script or style the tool ships. A prop's page is: its address
  // is the GM's own (prop_address) or its note's.
  for (const rel of allFiles) {
    if ((/\.html?$/i.test(rel) && !hidden.propFiles.has(canonicalNfc(rel))) || isToolFile(rel)) continue;
    const address = foldQuotes(rel.replace(/\.[^./]+$/, ''));
    for (const n of secrets.names) {
      if (n.kind !== 'withheld') continue;
      if (hasName(n.re, address)) add(rel, 'withheld', n.alias, n.rel, rel);
    }
  }
  // Once for each file the note puts on the site: its page and its prop's files.
  for (const w of secrets.publishedWithheld) {
    const outs = [].concat(w.out || []);
    for (const page of outs.length ? outs : [w.rel]) {
      const text = wordsOf(page).join(' ');
      found.push({ id: findingId(page, text), kind: 'name', code: 'WITHHELD_PUBLISHED', page, text, shown: page, note: w.rel, reason: 'a note marked withheld is published' });
    }
  }
  return found;
}

// The GM's never-show words (player_site.never_show): each found in any case as a whole word, with a space, an
// underscore or a hyphen between its words, in what a file sends and in any file's own name. Unlike a secret name, a
// public name that holds one is no excuse: the GM said never.
function neverShowFindings({ files, allFiles, words, findingId, published = [] }) {
  const found = [];
  const seen = new Set();
  const list = [...new Set(words.map((w) => w.trim()).filter(Boolean))].map((w) => ({
    word: w,
    re: nameMatcher(w),
  }));
  const add = (page, w, shown) => {
    const text = wordsOf(w.word).join(' ');
    const key = `${page}\n${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ id: findingId(page, text), kind: 'name', code: NEVER_SHOW.code, page, text, shown, note: NEVER_SHOW.note, reason: NEVER_SHOW.reason });
  };
  for (const file of files) {
    const text = foldQuotes(file.text || '');
    for (const w of list) {
      const [m] = nameHits(w.re, text);
      if (!m) continue;
      const start = Math.max(text.lastIndexOf('\n', m.index) + 1, m.index - CONTEXT);
      const end = text.indexOf('\n', m.index + m[0].length);
      const stop = Math.min(end === -1 ? text.length : end, m.index + m[0].length + CONTEXT);
      add(file.rel, w, text.slice(start, stop).replace(/\s+/g, ' ').trim());
    }
  }
  // A search index holds a public note's aliases only as single terms, which no phrase matches: each published note's
  // aliases are read as the index was made from them, and a phrase in one is a finding on each index file.
  const indexes = files.filter((f) => f.ext === '.json' && /"invertedIndex"/.test(f.raw) && /"aliases"/.test(f.raw));
  if (indexes.length) {
    for (const page of published) {
      const aliases = (page.frontmatter && Array.isArray(page.frontmatter.aliases)) ? page.frontmatter.aliases : [];
      const text = foldQuotes(canonicalNfc(aliases.map((a) => labelsForLinks(String(a))).join(', ')));
      for (const w of list) {
        if (!hasName(w.re, text)) continue;
        for (const f of indexes) add(f.rel, w, `aliases of ${page.displayTitle || 'a published note'}: ${text}`);
      }
    }
  }
  for (const rel of allFiles) {
    if (isToolFile(rel)) continue;
    const address = foldQuotes(rel.replace(/\.[^./]+$/, ''));
    for (const w of list) if (hasName(w.re, address)) add(rel, w, rel);
  }
  return found;
}

module.exports = { nameFindings, neverShowFindings };
