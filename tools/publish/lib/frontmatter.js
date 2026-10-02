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

module.exports = { parseNote };
