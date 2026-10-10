'use strict';

// The ONE way the publish tool reads a heading's title when it compares it with a name
// the GM wrote (`exclude_sections`, `publish_include_sections`, the PC keep-list, the
// handout rule). A heading's dressing does not change which section it is, so none of it
// may be the way a hidden section reaches the site:
//
//   emphasis        **GM Notes**  _GM Notes_  ~~GM Notes~~  ==GM Notes==  `GM Notes`
//   link brackets   [[GM Notes]]  [[Target|GM Notes]]  [GM Notes](page)
//   trailing marks  {#id} / {.class} block, ^block-id, closing #s, one colon (full-width too)
//   entities        &nbsp; &hairsp; &ZeroWidthSpace; &#8203; … every character reference the
//                   Markdown renderer decodes, named or numeric
//   spaces          every Unicode space (no-break, thin, hair, ideographic, a tab …) is a space
//   invisible       every character that prints nothing (zero-width, soft hyphen, BOM, word
//                   joiner, direction marks, control characters …) is dropped
//   spacing, case   GM  Notes   gm notes
//
// An invisible character may also stand where a space belongs (`GM<ZWSP>Notes`), in a word
// (`G<ZWSP>M Notes`), or both at once. For HIDING, a title that carries one is therefore also
// read with each of them as a space, and compared with the name with all spacing ignored.
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
// primary reading in Python; test/fixtures/heading-key-vectors.json pins both, and the two
// character classes below.
const MarkdownIt = require('markdown-it');
const { parseWikilink } = require('./wikilink');
const { decodeEntities } = require('./templates/gurps/tables');

// The renderer's own decoding of one character reference.
const { unescapeAll } = new MarkdownIt().utils;

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
      .replace(/[:\uff1a]\s*$/, '')                   // one trailing colon, full-width too
      .trim();
    for (const pair of PAIRS) s = s.replace(pair, '$2');
    s = s.replace(EDGE_MARKS, '');
    if (s === before) break;
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Code points, as hex ranges. SPACE is Unicode's White_Space and the blank Braille cell;
// INVISIBLE is Default_Ignorable_Code_Point, the control characters that are not spaces,
// and the interlinear annotation marks. Written out so that Python reads the same list
// whatever Unicode version either runtime carries (heading-key.test.js checks the lists
// against Unicode).
const SPACE_RANGES = '9-d 20 85 a0 1680 2000-200a 2028-2029 202f 205f 2800 3000';
const INVISIBLE_RANGES = '0-8 e-1f 7f-84 86-9f ad 34f 61c 115f-1160 17b4-17b5 180b-180f 200b-200f 202a-202e 2060-206f 3164 fe00-fe0f feff ffa0 fff0-fffb 1bca0-1bca3 1d173-1d17a e0000-e0fff';
const classOf = (ranges, flags) => new RegExp('[' + ranges.split(' ')
  .map((r) => r.split('-').map((cp) => `\\u{${cp}}`).join('-')).join('') + ']', flags);
const SPACES = classOf(SPACE_RANGES, 'gu');
const INVISIBLE = classOf(INVISIBLE_RANGES, 'gu');
const HAS_INVISIBLE = classOf(INVISIBLE_RANGES, 'u');

// Every character reference the Markdown renderer decodes, named (`&hairsp;`, `&Tab;`) or
// numeric (`&#8203;`). A name the renderer does not know as typed is tried in small letters
// (`&NBSP;`); anything else stays as written.
function decodeReferences(text) {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body) => {
    if (body[0] === '#') return decodeEntities(whole);
    const exact = unescapeAll(whole);
    if (exact !== whole) return exact;
    const lower = whole.toLowerCase();
    const folded = unescapeAll(lower);
    return folded !== lower ? folded : whole;
  });
}

// The readings of one pre-normalised `text`: the label first, then the wikilink target.
function readings(text) {
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
  return keys;
}

// The note-faults audit renders a page a second time with an invisible mark in the label of
// some links (note-faults.js). A heading that holds such a link must name the same section
// it does unmarked, so while that render runs the mark is taken out before a title is read.
// Never set outside it: in every other reading these characters are the GM's own.
let auditMark = null;
function ignoringMark(pattern, fn) {
  const was = auditMark;
  auditMark = pattern;
  try { return fn(); } finally { auditMark = was; }
}

// `title` with its character references decoded, in NFC.
function decoded(title) {
  const text = String(title == null ? '' : title);
  return decodeReferences(auditMark ? text.replace(auditMark, '') : text).normalize('NFC');
}

// Every reading of `title`, the label reading first, without duplicates or empties.
// A build reads the same few titles (each heading of each note, each excluded name) many
// times over, so the readings of a title are kept. They depend on the title alone, bar the
// audit's mark (ignoringMark), under which nothing is kept or reused.
const kept = new Map();
const KEPT_MOST = 20000;
function headingKeys(title) {
  if (auditMark) return readKeys(title);
  const text = String(title == null ? '' : title);
  let keys = kept.get(text);
  if (keys === undefined) {
    if (kept.size >= KEPT_MOST) kept.clear();
    keys = Object.freeze(readKeys(text));
    kept.set(text, keys);
  }
  return keys;
}

function readKeys(title) {
  // A pasted heading can carry what the eye does not see: entities (`GM&nbsp;Notes`),
  // zero-width characters and soft hyphens, a BOM. All are removed or read as the space
  // they stand for. Other characters the GM typed (a period, a footnote mark) are words.
  const text = decoded(title);
  const keys = readings(text.replace(SPACES, ' ').replace(INVISIBLE, ''));
  // An invisible character may stand in for the space between two words (`GM<ZWSP>Notes`).
  // For hiding, that reading counts too; the label reading above stays the one that keeps.
  if (HAS_INVISIBLE.test(text)) keys.push(...readings(text.replace(INVISIBLE, ' ').replace(SPACES, ' ')));
  return [...new Set(keys)].filter(k => k !== '');
}

// For hiding only: the readings of a title that carries an invisible character, with all
// spacing taken out, to compare with a name treated the same way. Such a character may sit
// inside a word and where a space belongs in one title (`G<ZWSP>M<ZWSP>Notes`), and no
// single choice of "a space" or "nothing" for all of them reads that as the name. Empty for
// a title with no invisible character, so `GMNotes` stays a different word from `GM Notes`.
function squashedKeys(title) {
  if (!HAS_INVISIBLE.test(decoded(title))) return [];
  return [...new Set(headingKeys(title).map(squash))].filter(k => k !== '');
}
const squash = (key) => key.replace(/ /g, '');

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
  if (headingKeys(title).some(k => wanted.has(k))) return true;
  const loose = squashedKeys(title);
  if (loose.length === 0) return false;
  const squashed = new Set([...wanted].map(squash));
  return loose.some(k => squashed.has(k));
}

module.exports = { headingKey, headingKeys, squashedKeys, titleNamedIn, SPACE_RANGES, INVISIBLE_RANGES, ignoringMark };
