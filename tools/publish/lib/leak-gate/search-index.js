'use strict';
// The search index read for hidden sentences (#408). search-index.json holds each page's text as lunr terms: each word
// once, in no order, without the common words lunr drops. A sentence cannot be matched in it as a sentence, and nothing
// in the file says what order the words came in. What the index tells a visitor is which words each page's entry holds,
// so that is what is checked: a hidden piece is a finding on the index when every one of its terms is in one entry's
// body, and at least one of them is a word that entry's own page does not print. A piece whose words the page prints
// anyway tells a visitor nothing the page does not (its sentence, if it were there, is not recoverable from the index).
const { indexTerms } = require('../search-index');
const { wordsOf } = require('./text');

// The fewest different terms a piece must keep once the common words are dropped. The index has no word order, so one
// or two words an entry happens to share with a hidden piece ("baker") say nothing about the piece; three of its own
// words, all in one entry and one of them not printed on that entry's page, is the shortest overlap read as the piece.
const MIN_TERMS = 3;

// The index files among the site's text files, parsed: { file, data }.
function indexesOf(files) {
  const out = [];
  for (const file of files) {
    if (file.ext !== '.json' || !file.raw.includes('"invertedIndex"')) continue;
    let data;
    try { data = JSON.parse(file.raw); } catch (e) { continue; }
    if (data && data.index && Array.isArray(data.index.invertedIndex) && data.documents && typeof data.documents === 'object') out.push({ file, data });
  }
  return out;
}

// A text's terms as the build stored them (the build's own steps: lunr's trimmer and stop-word filter, no stemmer, from
// lib/search-index.js), each read as the gate reads words (quotes, dashes and case folded). The steps saved in the index
// file are its search steps, not the ones its texts went through, so they are not what is read here.
function termReader() {
  const read = (text) => indexTerms(text).flatMap((t) => wordsOf(t));
  // A piece's words are read one at a time, each once (the tokenizer parts at spaces and hyphens, which a word holds
  // only as a hyphen, so a word read alone gives the terms it gives in its sentence).
  const known = new Map();
  read.words = (words) => words.flatMap((w) => { if (!known.has(w)) known.set(w, read(w)); return known.get(w); });
  return read;
}

/**
 * The hidden pieces a search index holds, entry by entry.
 * @param {object} input
 * @param {object[]} input.files   readOutput(): the site's text files
 * @param {object[]} input.pieces  the hidden pieces still to look for ({ words, text, shown, note, reason })
 * @returns {{ file: object, piece: object, href: string }[]}
 */
function indexHits({ files, pieces }) {
  const hits = [];
  const byRel = new Map(files.map((f) => [f.rel, f]));
  for (const { file, data } of indexesOf(files)) {
    const termsOf = termReader();
    // Each entry's body terms.
    const body = new Map();
    for (const entry of data.index.invertedIndex) {
      const [term, posting] = Array.isArray(entry) ? entry : [];
      if (typeof term !== 'string' || !posting || !posting.body) continue;
      const words = wordsOf(term);
      for (const ref of Object.keys(posting.body)) {
        if (!body.has(ref)) body.set(ref, new Set());
        for (const w of words) body.get(ref).add(w);
      }
    }
    // How many entries hold each term: each piece is filed under its rarest one, and a piece with a term no entry holds
    // is in none.
    const entries = new Map();
    for (const terms of body.values()) for (const t of terms) entries.set(t, (entries.get(t) || 0) + 1);
    const filed = new Map();
    for (const piece of pieces) {
      const terms = [...new Set(termsOf.words(piece.words))];
      if (terms.length < MIN_TERMS || terms.some((t) => !entries.has(t))) continue;
      const rarest = terms.reduce((a, b) => (entries.get(b) < entries.get(a) ? b : a));
      if (!filed.has(rarest)) filed.set(rarest, []);
      filed.get(rarest).push({ piece, terms });
    }
    for (const [ref, terms] of body) {
      let printed = null;
      for (const t of terms) {
        for (const { piece, terms: wanted } of filed.get(t) || []) {
          if (!wanted.every((w) => terms.has(w))) continue;
          // The words the entry's own page prints (its page missing: none, so every word is the index's alone).
          const doc = data.documents[ref] || {};
          const href = typeof doc.href === 'string' ? doc.href : '';
          if (printed === null) printed = new Set(byRel.has(href) ? termsOf(byRel.get(href).text) : []);
          if (wanted.some((w) => !printed.has(w))) hits.push({ file, piece, href });
        }
      }
    }
  }
  return hits;
}

module.exports = { indexHits };
