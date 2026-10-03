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

module.exports = { splitTableRow, WIKILINK_SOURCE, wikilinkRe, parseWikilink, firstWikilinkTarget, refTarget };
