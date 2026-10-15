'use strict';
// The secret-name checks of the build's note audit (note-faults.js), run over the finished folder: a gm_aliases name or
// a withheld note's name in any text file, or in a copied file's name; and a withheld note that publishes.
const { secretNamesOf, findSecretNames, publicWordsOf, foldQuotes } = require('../note-faults');
const { fileText, isToolFile } = require('./match');
const { wordsOf } = require('./text');

const REASON = { alias: 'a name kept secret in gm_aliases', withheld: 'the name of a note marked withheld' };
const CODE = { alias: 'ALIAS_IN_PROSE', withheld: 'WITHHELD_IN_PROSE' };

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
      n.re.lastIndex = 0;
      if (n.re.test(text)) { holders.push(text); break; }
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
  if (file.ext === '.html' || file.ext === '.htm') return file.raw;
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
      if (!secrets.mayHold(html)) continue;
      // A public name that holds a secret name is the public name (see holdersOf): taken out before the search.
      const looked = holders ? foldQuotes(html).replace(holders, ' ') : html;
      for (const hit of findSecretNames(looked, secrets.names, { publicWords })) add(file.rel, hit.kind, hit.alias, hit.owner, hit.context);
    }
  }
  // A copied file (a picture, a font) whose name holds a withheld name: the name is in its address. A page is not one
  // (its address is its note's public name), and nor is a script or style the tool ships.
  for (const rel of allFiles) {
    if (/\.html?$/i.test(rel) || isToolFile(rel)) continue;
    const address = foldQuotes(rel.replace(/\.[^./]+$/, ''));
    for (const n of secrets.names) {
      if (n.kind !== 'withheld') continue;
      n.re.lastIndex = 0;
      if (n.re.test(address)) add(rel, 'withheld', n.alias, n.owner, rel);
    }
  }
  for (const w of secrets.publishedWithheld) {
    const page = w.out || w.rel;
    const text = wordsOf(page).join(' ');
    found.push({ id: findingId(page, text), kind: 'name', code: 'WITHHELD_PUBLISHED', page, text, shown: page, note: w.rel, reason: 'a note marked withheld is published' });
  }
  return found;
}

module.exports = { nameFindings };
