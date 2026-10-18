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

// The links in a text, found by what the pattern above needs and no more, so a long run of `[`
// costs time in step with its length (the pattern alone retries every `[[` along a run to its
// end; 50,000 of them took seconds). A link holds no `]` but its closing `]]`, so a `[[` can
// only start one when the first `]` after it is followed by a second. Where that holds the
// pattern runs from that spot, and a start that fails does so at once (an empty target), so
// no stretch of text is read twice. The same links, in the same order, as `wikilinkRe`.
// `withBang` takes a `!` right before the `[[` into the span, as `wikilinkRe('g', true)` does.
function wikilinkSpans(text, withBang = false, max = Infinity) {
  const n = text.length;
  const nextClose = new Int32Array(n + 3).fill(-1);
  for (let i = n - 1; i >= 0; i--) nextClose[i] = text[i] === ']' ? i : nextClose[i + 1];
  const sticky = new RegExp(WIKILINK_SOURCE, 'y');
  const spans = [];
  let from = 0;
  for (let p = text.indexOf('[[', from); p !== -1 && spans.length < max; p = text.indexOf('[[', from)) {
    const q = nextClose[p + 2];
    sticky.lastIndex = p;
    const m = q !== -1 && text[q + 1] === ']' ? sticky.exec(text) : null;
    if (!m) { from = p + 1; continue; }
    const bang = withBang && p - 1 >= from && text[p - 1] === '!';
    const end = p + m[0].length;
    spans.push({ index: bang ? p - 1 : p, end, body: m[1] });
    from = end;
  }
  return spans;
}

// `text.replace(wikilinkRe('g', withBang), fn)`, in time linear in the text. `fn(link, body)`.
function replaceWikilinks(text, fn, withBang = false) {
  const s = String(text);
  let out = '';
  let at = 0;
  for (const span of wikilinkSpans(s, withBang)) {
    out += s.slice(at, span.index) + fn(s.slice(span.index, span.end), span.body);
    at = span.end;
  }
  return out + s.slice(at);
}

// `text.replace(LOOSE_LABELLED_RE, (_, label) => fn(label))` in time linear in the text. The
// target runs to the first `|`, newline, `]]` or `[[` (and must end at a `|`), the label to the
// first `]]` after the pipe on the same line, so each is a lookup, never a rescan.
function replaceLooseLabelled(text, fn) {
  const s = String(text);
  const n = s.length;
  const nextPair = new Int32Array(n + 3).fill(-1);
  const nextNewline = new Int32Array(n + 3).fill(-1);
  for (let i = n - 1; i >= 0; i--) {
    nextPair[i] = s[i] === ']' && s[i + 1] === ']' ? i : nextPair[i + 1];
    nextNewline[i] = s[i] === '\n' ? i : nextNewline[i + 1];
  }
  let out = '';
  let at = 0;
  let from = 0;
  for (let p = s.indexOf('[[', from); p !== -1; p = s.indexOf('[[', from)) {
    let j = p + 2;
    while (j < n && s[j] !== '|' && s[j] !== '\n' && !(s[j] === ']' && s[j + 1] === ']') && !(s[j] === '[' && s[j + 1] === '[')) j++;
    const q = s[j] === '|' ? nextPair[j + 1] : -1;
    if (q === -1 || (nextNewline[j + 1] !== -1 && nextNewline[j + 1] < q)) { from = p + 1; continue; }
    out += s.slice(at, p) + fn(s.slice(j + 1, q));
    at = from = q + 2;
  }
  return out + s.slice(at);
}

// `text` with every `![[...]]` taken out (an embed: no `]` inside), in linear time.
function removeEmbeds(text) {
  const s = String(text);
  const n = s.length;
  const nextClose = new Int32Array(n + 4).fill(-1);
  for (let i = n - 1; i >= 0; i--) nextClose[i] = s[i] === ']' ? i : nextClose[i + 1];
  let out = '';
  let at = 0;
  let from = 0;
  for (let p = s.indexOf('![[', from); p !== -1; p = s.indexOf('![[', from)) {
    const q = nextClose[p + 3];
    if (q === -1 || s[q + 1] !== ']') { from = p + 1; continue; }
    out += s.slice(at, p);
    at = from = q + 2;
  }
  return out + s.slice(at);
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
  const only = onlyLink(text.trim());
  const labelled = !!only && only.display.trim() !== '';
  // The value with its brackets off, as these readers always took it: the key of a value
  // with no label, and the words of one.
  const bare = text.replace(/\[\[|\]\]/g, '');
  // Each label is kept between two marks while links are read to a fixed point, so a
  // link nested in a label, or a label holding a `]`, comes down to the label it shows
  // and only the words outside a label are humanized.
  let depth = 0;
  let words = '';
  for (const part of markLabels(text).split(/([\u0001\u0002])/)) {
    if (part === MARK_OPEN) depth++;
    else if (part === MARK_CLOSE) depth = Math.max(0, depth - 1);
    else if (part) words += depth ? part.replace(/\[\[|\]\]/g, '') : spaced(part.replace(/\[\[|\]\]/g, ''));
  }
  return { words, key: labelled ? only.name.trim() : bare, labelled };
}

// The one link a value is made of, read loosely: `[[target|label]]` where the label may hold
// a `]` or a whole link. Strict first; then the outer brackets are taken off and the rest is
// the link if its own brackets pair up (so `[[A|x]] and [[B|y]]` is not one link).
function onlyLink(text) {
  const [strict] = wikilinkSpans(text, false, 1);
  if (strict && strict.index === 0 && strict.end === text.length) return parseWikilink(strict.body);
  if (!text.startsWith('[[') || !text.endsWith(']]') || text.length < 5) return null;
  const inner = text.slice(2, -2);
  let open = 0;
  for (const token of inner.match(/\[\[|\]\]/g) || []) {
    open += token === '[[' ? 1 : -1;
    if (open < 0) return null;
  }
  const link = parseWikilink(inner);
  return open === 0 && !/[[\]]/.test(link.raw) ? link : null;
}

const MARK_OPEN = '\u0001';
const MARK_CLOSE = '\u0002';
// `text` with every labelled link replaced by its label between marks, applied until the text
// stops changing (each pass that changes it makes it shorter). A link with no label stays as
// written. If the bound were ever reached the links still standing are cut out whole.
function markLabels(text) {
  let s = String(text).replace(/[\u0001\u0002]/g, '');
  const bound = s.length + 1;
  const mark = (label) => MARK_OPEN + label + MARK_CLOSE;
  for (let i = 0; i <= bound; i++) {
    const next = replaceLooseLabelled(replaceWikilinks(s, (link, body) => {
      const label = parseWikilink(body).display.trim();
      return label ? mark(label) : body;
    }), (label) => mark(label.trim()));
    if (next === s) return s;
    s = next;
  }
  return replaceWikilinks(s, () => '');
}

// `text` with every labelled link in it turned into its label. For text that goes to the
// site as it stands (a title, a field printed whole, a search entry): a link the GM gave a
// label must never print its target, whatever prints the value. A link with no label is
// left as written.
function labelsForLinks(text) {
  const s = String(text == null ? '' : text);
  if (!s.includes('[[') || !s.includes('|')) return s;
  // An embed with a pipe (`![[map.png|300]]`: the pipe is a size, not a label) prints
  // nothing, never its target and never the stray `!300`. A link left unread by the pattern
  // above because `]` stands inside it is read loosely, up to the first `]]`: the label is
  // everything after the pipe, so its target still does not print.
  return replaceLooseLabelled(replaceWikilinks(s, (whole, body) => {
    const label = parseWikilink(body).display.trim();
    if (whole[0] === '!') return label || body.includes('|') ? '' : whole;
    return label || whole;
  }, true), (label) => label.trim());
}
// `[[target|label]]` where target or label holds a lone `]`: a target stops at the first `|`
// and may hold no `[[` or `]]`; the label runs to the first `]]`. Read by replaceLooseLabelled.

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
  return replaceWikilinks(s, () => '');
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

module.exports = { splitTableRow, WIKILINK_SOURCE, wikilinkRe, wikilinkSpans, replaceWikilinks, replaceLooseLabelled, removeEmbeds, parseWikilink, firstWikilinkTarget, refTarget, linkText, labelsForLinks, labelsForLinksFully };
