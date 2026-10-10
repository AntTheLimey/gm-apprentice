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
  working = stripHtml(working);

  const kept = [];
  for (const line of working.split('\n')) {
    const h = line.match(HEADING_RE);
    if (h && excludeSections.includes(normalizeHeadingText(h[2]))) break;
    if (h) continue;                                   // drop heading lines
    const t = line.trim();
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) continue;    // horizontal rules
    if (t.startsWith('|')) continue;                   // table rows
    // For a PC's epithet a blockquote line is never the quote: the templates write their
    // instructions to the GM ("Omit this section if...") as blockquotes, and a quoted
    // speech or letter is no description of the character. The line is skipped, not the
    // rest of the note, so prose written after it still supplies the first sentence.
    if (opts.skipSheetLines && /^\s*>/.test(line)) continue;
    let cleaned = line.replace(/^\s*>\s?/, '');        // blockquote marker
    // A callout marker line is metadata, never prose — drop the whole line, title included.
    // The type pattern must match markdown.js CALLOUT_RE, which allows hyphens.
    cleaned = cleaned.replace(/^\s*\[![A-Za-z][\w-]*\][-+]?.*$/, '');
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
  text = text.replace(/[*_`]+/g, '');
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
  if (best) return best;
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

module.exports = { excerptFromMarkdown };
