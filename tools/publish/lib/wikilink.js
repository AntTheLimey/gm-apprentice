'use strict';

const { canonicalNfc } = require('./unicode');

// The one wikilink pattern and parser the publish tool uses.
//
// Obsidian writes a link inside a markdown table with its alias pipe escaped:
// `[[Emma_Wentworth\|Emma]]`. The backslash belongs to the pipe, not to the target, so a
// pattern that stops at `|` alone captures `Emma_Wentworth\` and every link-map lookup misses.
// Every reader goes through this file so `[[X\|Y]]` behaves exactly like `[[X|Y]]`.

// A backslash is part of the target only when no pipe follows it.
const TARGET_SOURCE = String.raw`(?:[^\]|\\]|\\(?!\|))+`;

// `[[` body `]]`, with the whole body in group 1: the target (with any `#heading` or `^block`),
// then an optional `|alias` or `\|alias` (an empty alias is allowed and means none). Hand group 1 to parseWikilink. The leading `!` of an
// embed is not part of it (see `wikilinkRe`).
const WIKILINK_SOURCE = String.raw`\[\[(${TARGET_SOURCE}(?:\\?\|[^\]]*)?)\]\]`;

// A fresh RegExp each call, so no caller shares `lastIndex` with another. `withBang` also
// matches a leading `!` (an embed or transclusion), which lands outside group 1.
function wikilinkRe(flags = 'g', withBang = false) {
  return new RegExp((withBang ? '!?' : '') + WIKILINK_SOURCE, flags);
}

// The target of the first link in a value (`[[Name|x]]`, closing brackets optional), for
// frontmatter values. Returns the raw target or null.
function firstWikilinkTarget(value) {
  const m = new RegExp(String.raw`\[\[(${TARGET_SOURCE})`).exec(String(value));
  return m ? m[1] : null;
}

// Split a wikilink body (the text between the brackets) into its parts.
//   raw         everything before the alias, backslash-of-the-pipe removed (`Note#H`)
//   target      `raw` up to the first `#` or `^`
//   name        `target` without a trailing `.md`: what the site's link map is asked
//   heading     the text after a `#` (or `^`), '' when there is none
//   display     the alias, '' when there is none (`![[img.png\|300]]` gives '300')
//   escapedPipe true when the source wrote the pipe as `\|`
function parseWikilink(body) {
  const text = String(body == null ? '' : body);
  const pipe = text.indexOf('|');
  let raw = pipe === -1 ? text : text.slice(0, pipe);
  const display = pipe === -1 ? '' : text.slice(pipe + 1);
  let escapedPipe = false;
  if (pipe !== -1 && raw.endsWith('\\')) {
    raw = raw.slice(0, -1);
    escapedPipe = true;
  }
  const frag = raw.search(/[#^]/);
  const target = frag === -1 ? raw : raw.slice(0, frag);
  return {
    raw,
    target,
    name: target.replace(/\.md$/i, ''),
    heading: frag === -1 ? '' : raw.slice(frag + 1),
    display,
    escapedPipe,
  };
}

// The target a frontmatter reference names, whether written `Name`, `[[Name]]` or
// `[[Name|Shown]]` (or `\|` in a table): brackets and alias gone, `#heading` kept, NFC (a
// ref typed in one editor is compared with a filename from another, #139).
function refTarget(value) {
  return canonicalNfc(parseWikilink(String(value == null ? '' : value).replace(/\[\[|\]\]/g, '')).raw.trim());
}

// A frontmatter value that names a note (`location`, `first_appearance`, a relationship's
// `target`), read for a page that prints it outside the note's own page: an index card, the
// landing page, the timeline, Connections. The ONE reader for those, so each
// prints what the note's own page prints for the link (processor.js referenceOf):
//
//   words     what to print. A link with a label prints its label; one without prints its
//             target as written; text around links stays. `humanize` reads `_` as a space
//             in everything but a label.
//   key       the name to look a page up by: the target of a value that is one labelled
//             link, else `words` un-humanized (the value with its brackets off).
//   labelled  the value is one link with a label.
//
// `[[Vesper_Hale|the stranger]]` is looked up as Vesper_Hale and printed as "the stranger".
// A GM writes the label to keep the name off the site, so the target of a labelled link
// is never printed, beside the label or in place of it.
function linkText(value, { humanize = false } = {}) {
  const text = String(value == null ? '' : value);
  const spaced = (s) => (humanize ? s.replace(/_/g, ' ') : s);
  const whole = wikilinkRe('').exec(text.trim());
  const only = whole && whole.index === 0 && whole[0].length === text.trim().length ? parseWikilink(whole[1]) : null;
  const labelled = !!only && only.display.trim() !== '';
  // The value with its brackets off, as these readers always took it: the key of a value
  // with no label, and the words of one.
  const bare = text.replace(/\[\[|\]\]/g, '');
  const words = text.replace(wikilinkRe('g'), (link, body) => {
    const w = parseWikilink(body);
    const label = w.display.trim();
    return label ? `\u0000${label}\u0000` : body;
  }).replace(/\[\[|\]\]/g, '').split('\u0000').map((part, n) => (n % 2 ? part : spaced(part))).join('');
  return { words, key: labelled ? only.name.trim() : bare, labelled };
}

// `text` with every labelled link in it turned into its label. For text that goes to the
// site as it stands (a title, a field printed whole, a search entry): a link the GM gave a
// label must never print its target, whatever prints the value. A link with no label is
// left as written.
function labelsForLinks(text) {
  const s = String(text == null ? '' : text);
  if (!s.includes('[[') || !s.includes('|')) return s;
  return s.replace(wikilinkRe('g'), (whole, body) => parseWikilink(body).display.trim() || whole);
}

// `labelsForLinks` applied until the text stops changing, so a link nested in a label
// (`[[A|[[B|c]]]]`) comes down to `c` and no target is left standing. Each pass that changes
// the text makes it shorter, so the loop ends within its length; if that bound were ever
// reached the links still standing are cut out whole, never printed. For the Connections
// model and island, which hold only what a page shows.
function labelsForLinksFully(text) {
  let s = String(text == null ? '' : text);
  const bound = s.length + 1;
  for (let i = 0; i <= bound; i++) {
    const next = labelsForLinks(s);
    if (next === s) return s;
    s = next;
  }
  return s.replace(wikilinkRe('g'), '');
}

// Split a markdown table row on its cell pipes, not on the pipe inside a `[[link|alias]]` or
// after a backslash (`\|`). Like `line.split('|')`: the pieces join back to the line with `|`,
// the first is what sits before the first pipe.
function splitTableRow(line) {
  const text = String(line);
  const out = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '[' && text[i + 1] === '[') { depth++; i++; continue; }
    if (c === ']' && text[i + 1] === ']' && depth > 0) { depth--; i++; continue; }
    if (c === '|' && depth === 0 && text[i - 1] !== '\\') { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}

module.exports = { splitTableRow, WIKILINK_SOURCE, wikilinkRe, parseWikilink, firstWikilinkTarget, refTarget, linkText, labelsForLinks, labelsForLinksFully };
