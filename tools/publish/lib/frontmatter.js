// tools/publish/lib/frontmatter.js
const matter = require('gray-matter');

// The one way this tool splits a note into frontmatter and body.
//
// gray-matter called with no options caches by the note's exact text, and caches before
// it parses. A note whose YAML throws is therefore cached half-read: the next note with
// the same text (or the same note on a second scan in one process) comes back a silent
// "success" with empty data, and reads as a note with no `type:` instead of a broken
// one (#287). The cache also hands two identical notes the same `data` object. Passing
// options turns the cache off.
function parseNote(text) {
  return matter(text, {});
}

// A `%%` comment in a frontmatter value is cut the way the body's is (processor.js
// obsidianComments): a `%%` opens it, the next `%%` closes it, one never closed hides the
// rest of the value. Only strings are read, at any depth; a value that was nothing but a
// comment goes, and the space left where a comment sat is closed up. Run on the parsed
// data of a note the site is built from, so no output can print the marker or its words.
function cutValueComments(value) {
  if (typeof value === 'string') {
    if (!value.includes('%%')) return value;
    let out = '';
    for (let i = 0; i < value.length;) {
      const open = value.indexOf('%%', i);
      if (open === -1) { out += value.slice(i); break; }
      out += value.slice(i, open);
      const close = value.indexOf('%%', open + 2);
      if (close === -1) break;
      i = close + 2;
    }
    return out.replace(/ {2,}/g, ' ').trim();
  }
  if (Array.isArray(value)) {
    return value.map(cutValueComments).filter((v, i) => v !== '' || value[i] === '');
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      const cut = cutValueComments(v);
      if (cut !== '' || v === '') out[key] = cut;
    }
    return out;
  }
  return value;
}

module.exports = { parseNote, cutValueComments };
