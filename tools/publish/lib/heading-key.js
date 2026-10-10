'use strict';

// The ONE way the publish tool reads a heading's title when it compares it with a name
// the GM wrote (`exclude_sections`, `publish_include_sections`, the PC keep-list, the
// handout rule). A heading's dressing does not change which section it is, so none of it
// may be the way a hidden section reaches the site:
//
//   emphasis        **GM Notes**  _GM Notes_  ~~GM Notes~~  ==GM Notes==  `GM Notes`
//   link brackets   [[GM Notes]]  [[Target|GM Notes]]  [GM Notes](page)
//   trailing marks  {#id} / {.class} block, ^block-id, closing #s, one colon
//   spacing, case   GM  Notes   gm notes
//
// What is NOT dressing: a different word (`GM Notes on travel`), a trailing dash or
// emoji. Those are other sections and stay in view.
//
// `headingKeys` returns every reading of the title, the label first. A wikilink with a
// label (`[[Target|label]]`) reads as the label and as the target: for hiding, either
// one naming a hidden section hides it. `headingKey` is the label reading alone, for
// the callers that KEEP things (the stub keep-list, the PC keep-list), where reading more
// ways would publish more.
//
// skills/shared/scripts/vault_check.py `_bare_section_title` is this function's
// primary reading in Python; test/fixtures/heading-key-vectors.json pins both.
const { parseWikilink } = require('./wikilink');

const WIKILINK_RE = /\[\[((?:[^\]|\\]|\\(?!\|))+(?:\\?\|[^\]]*)?)\]\]/g;
const PAIRS = [
  /(\*\*|__|~~|==)(.+?)\1/g,                    // **x**  __x__  ~~x~~  ==x==
  /(?<![\w*])(\*)(?=\S)(.+?)(?<=\S)\1(?![\w*])/g,   // *x*
  /(?<![\w_])(_)(?=\S)(.+?)(?<=\S)\1(?![\w_])/g,    // _x_ (not snake_case)
  /(`+)([^`]+?)\1/g,                            // `x`
];
const EDGE_MARKS = /^[*_~=`\s]+|[*_~=`\s]+$/g;

function clean(text) {
  let s = text
    .replace(/<[^>]*>/g, '')                          // <b>x</b>
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');       // [x](page)  ![x](img)
  for (let round = 0; round < 12; round++) {
    const before = s;
    s = s
      .replace(/\s*\{[#.][^}]*\}\s*$/, '')            // {#id} {.class}
      .replace(/\s+\^[\w-]+\s*$/, '')                 // ^block-id
      .replace(/(^|\s+)#+\s*$/, '')                   // closing ##
      .replace(/:\s*$/, '')                           // one trailing colon
      .trim();
    for (const pair of PAIRS) s = s.replace(pair, '$2');
    s = s.replace(EDGE_MARKS, '');
    if (s === before) break;
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Every reading of `title`, the label reading first, without duplicates or empties.
function headingKeys(title) {
  const text = String(title == null ? '' : title).normalize('NFC').replace(/[  -   　]/g, ' ');
  const asLabel = text.replace(WIKILINK_RE, (_, body) => {
    const w = parseWikilink(body);
    return (w.display || w.name || w.raw).trim();
  });
  const keys = [clean(asLabel)];
  if (WIKILINK_RE.test(text)) {
    WIKILINK_RE.lastIndex = 0;
    keys.push(clean(text.replace(WIKILINK_RE, (_, body) => parseWikilink(body).name.trim())));
  }
  WIKILINK_RE.lastIndex = 0;
  return [...new Set(keys)].filter(k => k !== '');
}

// The label reading alone ('' when the title is nothing but dressing).
function headingKey(title) {
  return headingKeys(title)[0] || '';
}

// Whether any reading of `title` is one of `names` (the GM's own spellings, read the
// same way). For hiding.
function titleNamedIn(title, names) {
  const wanted = new Set();
  for (const name of names || []) wanted.add(headingKey(name));
  wanted.delete('');
  return headingKeys(title).some(k => wanted.has(k));
}

module.exports = { headingKey, headingKeys, titleNamedIn };
