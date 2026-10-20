'use strict';
// The text the search index is made from, kept by the build for the leak gate (#408). search-index.json holds each
// entry's text as lunr terms, one each, in no order, so a hidden sentence cannot be read back out of it. The build keeps
// every entry's texts as they were handed to lunr, beside the site (never in it), with a hash of the index it made from
// them; the gate reads those texts as it reads a page, sentence by sentence, when the hash is the index's on the site.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CACHE_FOLDER } = require('../image-optimize');

const FILE = 'search-index-text.json';
const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex');

// Where the build keeps the index's text: the site folder's own folder, beside the image cache (the build keeps nothing
// when imageCacheDir says that folder would be published or in the vault).
const indexTextPath = (siteDir) => path.join(siteDir, CACHE_FOLDER, FILE);

/**
 * Keep the text an index was made from.
 * @param {string} file        indexTextPath()
 * @param {string} json        the index file's text, as written
 * @param {{page: object, record: object}[]} records  buildSearchIndex().records
 */
function writeIndexText(file, json, records) {
  const entries = records.map(({ page, record }) => ({
    href: page.outputPath,
    texts: Object.entries(record).filter(([k, v]) => k !== 'id' && typeof v === 'string' && v.trim()).map(([, v]) => v),
  }));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ index: hashOf(json), entries }));
}

const isIndex = (file) => file.ext === '.json' && file.raw.includes('"invertedIndex"');

/**
 * The entries of each search index on the site, with the texts it was made from: `{ file, entries }`. An index whose
 * text the build did not keep (or kept for another index) is said in `warnings`, and is not read.
 */
function indexTexts({ files, siteDir, warnings }) {
  const indexes = files.filter(isIndex);
  if (!indexes.length) return [];
  let kept = null;
  try { kept = JSON.parse(fs.readFileSync(indexTextPath(siteDir), 'utf8')); } catch (e) { /* none kept */ }
  const out = [];
  for (const file of indexes) {
    if (kept && kept.index === hashOf(file.raw) && Array.isArray(kept.entries)) out.push({ file, entries: kept.entries });
    else warnings.push(`Leak check: the text ${file.rel} was made from is not on hand (the last build did not make this index), so its entries were not read for hidden sentences. Build the site again, then check again.`);
  }
  return out;
}

module.exports = { indexTextPath, writeIndexText, indexTexts };
