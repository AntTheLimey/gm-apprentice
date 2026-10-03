'use strict';

// The one wikilink pattern and parser the publish tool uses.
//
// Obsidian writes a link inside a markdown table with its alias pipe escaped:
// `[[Emma_Wentworth\|Emma]]`. The backslash belongs to the pipe, not to the target, so a
// pattern that stops at `|` alone captures `Emma_Wentworth\` and every link-map lookup misses.
// Every reader goes through this file so `[[X\|Y]]` behaves exactly like `[[X|Y]]`.

// A backslash is part of the target only when no pipe follows it.
const TARGET_SOURCE = String.raw`(?:[^\]|\\]|\\(?!\|))+`;

// `[[` body `]]`, with the whole body in group 1: the target (with any `#heading` or `^block`),
// then an optional `|alias` or `\|alias`. Hand group 1 to parseWikilink. The leading `!` of an
// embed is not part of it (see `wikilinkRe`).
const WIKILINK_SOURCE = String.raw`\[\[(${TARGET_SOURCE}(?:\\?\|[^\]]+)?)\]\]`;

// A fresh RegExp each call, so no caller shares `lastIndex` with another. `withBang` also
// matches a leading `!` (an embed or transclusion), which lands outside group 1.
function wikilinkRe(flags = 'g', withBang = false) {
  return new RegExp((withBang ? '!?' : '') + WIKILINK_SOURCE, flags);
}

// The target of a value that merely starts with a link (`[[Name|x]]`, closing brackets
// optional), for frontmatter values. Returns the raw target or null.
function leadingWikilinkTarget(value) {
  const m = new RegExp(String.raw`\[\[(${TARGET_SOURCE})`).exec(String(value));
  return m ? m[1] : null;
}

// Split a wikilink body (the text between the brackets) into its parts.
//   raw         everything before the alias, backslash-of-the-pipe removed (`Note#H`)
//   target      `raw` up to the first `#` or `^`
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
  return {
    raw,
    target: frag === -1 ? raw : raw.slice(0, frag),
    heading: frag === -1 ? '' : raw.slice(frag + 1),
    display,
    escapedPipe,
  };
}

module.exports = { WIKILINK_SOURCE, wikilinkRe, parseWikilink, leadingWikilinkTarget };
