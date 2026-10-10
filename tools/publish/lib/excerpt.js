// Shared excerpt extraction for listing cards and pull-quotes.
// Accepts raw markdown OR rendered HTML. Excluded sections are cut
// BEFORE any other processing so an excerpt can never surface GM-only
// content, even on sparse entities whose only prose is secret.

// Leading whitespace is intentionally unbounded (not just CommonMark's 3-space
// limit) so tab-indented headings from pasted text are still recognized as
// headings and stripped from the excerpt, never leaked as literal "##" prose.
const HEADING_RE = /^\s*(#{1,6})\s+(.+?)\s*$/;
const { wikilinkRe, parseWikilink } = require('./wikilink');

// Normalizes a captured heading's text before comparing it against
// excludeSections, so decorations that don't change the heading's identity
// (closing-hash, {#anchor}, emphasis markers, trailing colon/dashes) can't defeat
// the exclusion match. Strips iteratively to handle composed decorations in any order.
function normalizeHeadingText(text) {
  let normalized = text;
  let changed = true;
  let iterations = 0;
  const maxIterations = 10;

  while (changed && iterations < maxIterations) {
    const before = normalized;
    normalized = normalized
      .replace(/\s*\{#[^}]*\}\s*$/, '')   // heading-id anchor, e.g. {#gm-notes}
      .replace(/\s*#+\s*$/, '')           // closing-hash decoration, e.g. "## Title ##"
      .replace(/[:–—-]\s*$/, '')          // trailing colon, en-dash, em-dash, or hyphen
      .replace(/[*_`]+/g, '')             // emphasis / code markers
      .trim();
    changed = before !== normalized;
    iterations++;
  }

  return normalized.toLowerCase();
}

// Elements whose text is structure, not prose, and must never reach a pull-quote:
// section headings, callout titles, tables, and figure captions.
const HTML_BLOCKS_TO_DROP = [
  /<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi,
  /<div[^>]*class="[^"]*callout-title[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
  /<table[\s\S]*?<\/table>/gi,
  /<figcaption[\s\S]*?<\/figcaption>/gi,
];

// Tags that end a block of prose. Turning them into newlines (rather than letting the
// generic tag strip below eat them) keeps "…load.</p><p>More…" from fusing into one word,
// while inline tags close up cleanly so `<a>Magellan</a>'s` stays "Magellan's".
const BLOCK_BOUNDARY_RE = /<\/(p|div|li|ul|ol|blockquote|h[1-6]|tr|td|th|section|article)\s*>|<br\s*\/?>/gi;

// Lines of a PC's body that are sheet, not prose (opts.skipSheetLines): a label line
// ("**Playbook:** Cutter", "**Stress**: 3", "**ST** 12", a bare "**Insight**"), a
// tick-box ("- [ ] Major Wound"), and a list marker left with nothing after it. A
// template placeholder nobody filled in ("{Appearance and manner}") goes too, wherever
// it sits and however many lines it runs to.
const SHEET_LINE_RE = /^\*\*[^*]+\*\*:?$|^\*\*[^*]+:\*\*|^\*\*[^*]+\*\*:|^\*\*[^*]+\*\*\s+[-+]?\d[\d.,/+-]*%?$|^[-*+] \[[ xX]\]|^[-*+]$/;
const PLACEHOLDER_RE = /(?:^[ \t]*[-*+][ \t]+)?\{[^{}]{0,400}\}/gm;

// A full stop after one of these is not the end of a sentence.
const ABBREVIATION_RE = /\b(?:Mr|Mrs|Ms|Mx|Dr|St|Sr|Jr|Lt|Col|Capt|Sgt|Maj|Gen|Cmdr|Prof|Rev|Hon|Mme|Mlle|Msgr)\.$/;

function stripHtml(text) {
  let out = text;
  for (const re of HTML_BLOCKS_TO_DROP) out = out.replace(re, '\n');
  out = out.replace(/<img[^>]*>/gi, '');
  out = out.replace(BLOCK_BOUNDARY_RE, '\n');
  out = out.replace(/<[^>]+>/g, '');
  return out;
}

const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// Whether line `i` is a row of a markdown table: a row that starts with a pipe, a separator
// row, or a row with a pipe in it that sits in a block holding a separator row.
function isTableLine(lines, i) {
  const line = lines[i];
  if (/^\s*\|/.test(line)) return true;
  if (!line.includes('|')) return false;
  if (TABLE_SEPARATOR_RE.test(line) && line.includes('-')) return true;
  let up = i;
  while (up > 0 && lines[up - 1].trim() && lines[up - 1].includes('|')) up--;
  for (let j = up; j < lines.length && lines[j].trim() && lines[j].includes('|'); j++) {
    if (j !== i && TABLE_SEPARATOR_RE.test(lines[j]) && lines[j].includes('-')) return true;
  }
  return false;
}

// What the page's typographer turns plain text into (markdown-it's `typographer`), so the
// card's text is the text the page shows.
function typographic(text) {
  return text
    .replace(/\.{3,}/g, '…')
    .replace(/(^|[^-\s])---(?=[^-\s]|$)/gm, '$1\u2014')
    .replace(/(^|\s)--(?=\s|$)/gm, '$1\u2013')
    .replace(/(^|[^-\s])--(?=[^-\s]|$)/gm, '$1\u2013');
}

// opts.prose: the text as a reader sees it on the page, for a link preview card. Links read as
// their text, list markers, strikethrough and footnote marks go, entities are decoded, and the
// excerpt stops at the first block that is not prose (a heading, a table, a rule, a callout
// title) once it has any prose, so it never joins two blocks the page shows apart.
function excerptFromMarkdown(source, opts = {}) {
  const excludeSections = (opts.excludeSections || []).map(s => String(s).trim().toLowerCase());
  const limit = opts.limit || 200;

  // Comments carry private authoring notes, and the length cap can truncate one mid-marker.
  // Drop them first — in raw and already-escaped form, closed or running to end of input —
  // before anything else looks at the text.
  let working = String(source || '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/&lt;!--[\s\S]*?(?:--&gt;|$)/g, '');

  // Fenced code (including ```dataview) is never prose.
  working = working.replace(/^[ \t]*(```|~~~)[\s\S]*?(?:^[ \t]*\1[ \t]*$|$)/gm, '');
  if (opts.prose) working = working.replace(/<(https?:\/\/[^>\s]+)>/g, '$1');
  working = stripHtml(working);

  const kept = [];
  // A reader sees a quoted table as a table, so for the prose the quote marks are dropped
  // before any line is judged (a quoted heading, rule or table row is then one of those).
  const sourceLines = working.split('\n').map(l => (opts.prose ? l.replace(/^\s*(?:>[ \t]?)+/, '') : l));
  // A block that is not prose: skipped before any prose, the end of the excerpt after it.
  const endsProse = () => opts.prose && kept.some(l => l.trim());
  for (let i = 0; i < sourceLines.length; i++) {
    const line = sourceLines[i];
    const h = line.match(HEADING_RE);
    if (h && excludeSections.includes(normalizeHeadingText(h[2]))) break;
    if (h) { if (endsProse()) break; continue; }       // drop heading lines
    const t = line.trim();
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { if (endsProse()) break; continue; }    // horizontal rules
    if (t.startsWith('|') || (opts.prose && isTableLine(sourceLines, i))) {         // table rows
      if (endsProse()) break;
      continue;
    }
    // For a PC's epithet a blockquote line is never the quote: the templates write their
    // instructions to the GM ("Omit this section if...") as blockquotes, and a quoted
    // speech or letter is no description of the character. The line is skipped, not the
    // rest of the note, so prose written after it still supplies the first sentence.
    if (opts.skipSheetLines && /^\s*>/.test(line)) continue;
    let cleaned = line.replace(/^\s*>\s?/, '');        // blockquote marker
    // A callout marker line is metadata, never prose — drop the whole line, title included.
    // The type pattern must match markdown.js CALLOUT_RE, which allows hyphens.
    if (opts.prose && /^\s*\[![A-Za-z][\w-]*\][-+]?/.test(cleaned) && endsProse()) break;
    cleaned = cleaned.replace(/^\s*\[![A-Za-z][\w-]*\][-+]?.*$/, '');
    if (opts.prose) cleaned = cleaned.replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/, '');   // list marker
    kept.push(cleaned);
  }

  let text = kept.join('\n');
  // Only now, on what survived the excluded-section cut: a placeholder stripped any
  // earlier could swallow an excluded heading and let what follows it through. Sheet
  // lines go after it, so a label whose placeholder ran over two lines goes whole.
  if (opts.skipSheetLines) {
    text = text.replace(PLACEHOLDER_RE, '')
      .split('\n').filter(line => !SHEET_LINE_RE.test(line.trim())).join('\n');
  }
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');    // image markdown
  text = text.replace(/!\[\[[^\]]*\]\]/g, '');         // unresolved Obsidian image embed
  text = text.replace(wikilinkRe(), (_, body) => {
    const w = parseWikilink(body);
    return w.display || w.raw.replace(/_/g, ' ');
  });
  text = text.replace(/\[\[([^\]]+)\]\]/g, (_, t) => t.replace(/_/g, ' '));  // e.g. an empty target
  if (opts.prose) {
    text = text.replace(/\[\^[^\]]*\]/g, '')                       // footnote mark
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')                    // inline link: its text
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')                  // reference link: its text
      .replace(/~~/g, '')
      .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
      .replace(/&([a-z]+);/gi, (m, n) => (ENTITIES[n.toLowerCase()] !== undefined ? ENTITIES[n.toLowerCase()] : m));
    text = typographic(text);
  }
  // opts.wordUnderscores: an underscore between letters or digits is part of the word (the
  // page prints it), so only emphasis underscores at a word edge go.
  text = opts.wordUnderscores
    ? text.replace(/[*`]+/g, '').replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, '')
    : text.replace(/[*_`]+/g, '');
  text = text.replace(/\s+/g, ' ').trim();

  // The first sentence (or the first `opts.sentences`): up to a stop that is not a title's
  // ("Mr. Bennet"). A run that would pass `limit` falls back to the sentences before it.
  const wanted = opts.sentences || 1;
  const stop = /[.!?](?=\s)/g;
  let found = 0;
  let best = '';
  for (let m = stop.exec(text); m; m = stop.exec(text)) {
    const sentence = text.slice(0, m.index + 1);
    if (m.index === 0 || ABBREVIATION_RE.test(sentence)) continue;
    found++;
    if (wanted === 1) return sentence;
    if (sentence.length > limit) break;
    best = sentence;
    if (found === wanted) return best;
  }
  // The last sentence's stop ends the text, so the loop (which wants a space after) never
  // counted it; a text that fits whole is all of its sentences.
  if (wanted > 1 && text.length <= limit) return text;
  if (best) return best;
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

module.exports = { excerptFromMarkdown };
