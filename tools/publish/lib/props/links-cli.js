'use strict';
// `gm-publish props links FILE...`: the local files a page or stylesheet names, as the build reads them when it copies a
// hand-made prop (links.js: a picture in a data- attribute among them, a link to another page not). prop_move.py asks
// this rather than keep its own copy of the rule (#521). A file is read as a stylesheet when it ends .css, else as HTML.
const fs = require('node:fs');
const path = require('node:path');
const links = require('./links');

// A file that cannot be read: the one error said as a line; any other is the tool's own fault and is thrown.
class UnreadableFile extends Error {}

// [{ file, refs, rooted }]: each file as given, the addresses it names as written (refs: relative; rooted: from /).
function linksOf(files) {
  return files.map((file) => {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
      if (!e.code) throw e;
      throw new UnreadableFile(`${file} could not be read (${e.code})`);
    }
    const { refs, rooted } = links.localRefs(text, path.extname(file).toLowerCase());
    return { file, refs: refs.map((r) => r.raw), rooted };
  });
}

// --json prints the list; else "file<TAB>address", one a line. Exit 1 with an error line when a file cannot be read.
function runLinks({ files, json }) {
  let found;
  try { found = linksOf(files); } catch (e) {
    if (!(e instanceof UnreadableFile)) throw e;
    console.error(`Error: ${e.message}`);
    return 1;
  }
  if (json) console.log(JSON.stringify(found, null, 2));
  else for (const f of found) for (const ref of [...f.refs, ...f.rooted]) console.log(`${f.file}\t${ref}`);
  return 0;
}

module.exports = { linksOf, runLinks };
