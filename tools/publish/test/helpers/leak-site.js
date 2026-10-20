'use strict';
// A small vault and its player site for the leak gate's tests. `files` is { 'Folder/Note.md': text }.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildBoth, allFiles } = require('./gm-build');
const { indexTextPath } = require('../../lib/leak-gate/index-text');

function leakSite(files, settings = {}) {
  const site = buildBoth(files, { ...settings, sites: ['player'] });
  return { ...site, outputDir: site.player.dir };
}

// What a broken hiding rule would have done: the sentence left on the page, inside <main>.
function leakInto(dir, page, sentence) {
  const file = path.join(dir, ...page.split('/'));
  const html = fs.readFileSync(file, 'utf8');
  const at = html.lastIndexOf('</main>');
  if (at < 0) throw new Error(`no </main> in ${page}`);
  fs.writeFileSync(file, `${html.slice(0, at)}<p>${sentence}</p>${html.slice(at)}`);
}

// What a hiding rule broken for the search index alone would do: the sentence in the text the build kept for the entry
// of `href` (index-text.js), which its page does not print.
function leakIntoIndex(site, href, sentence) {
  const file = indexTextPath(path.dirname(site.configPath));
  const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entry = kept.entries.find((e) => e.href === href);
  if (!entry) throw new Error(`no index entry for ${href}`);
  entry.texts.push(sentence);
  fs.writeFileSync(file, JSON.stringify(kept));
}

// One hash over every file's path and bytes: the gate must leave it as it was.
function hashTree(dir) {
  const h = crypto.createHash('sha256');
  for (const f of allFiles(dir).sort()) h.update(path.relative(dir, f)).update('\0').update(fs.readFileSync(f));
  return h.digest('hex');
}

module.exports = { leakSite, leakInto, leakIntoIndex, hashTree };
