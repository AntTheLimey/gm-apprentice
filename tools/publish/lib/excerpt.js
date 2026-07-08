// Shared excerpt extraction for listing cards and pull-quotes.
// Accepts raw markdown OR rendered HTML. Excluded sections are cut
// BEFORE any other processing so an excerpt can never surface GM-only
// content, even on sparse entities whose only prose is secret.

// Leading whitespace is intentionally unbounded (not just CommonMark's 3-space
// limit) so tab-indented headings from pasted text are still recognized as
// headings and stripped from the excerpt, never leaked as literal "##" prose.
const HEADING_RE = /^\s*(#{1,6})\s+(.+?)\s*$/;

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

function excerptFromMarkdown(source, opts = {}) {
  const excludeSections = (opts.excludeSections || []).map(s => String(s).trim().toLowerCase());
  const limit = opts.limit || 200;

  const kept = [];
  for (const line of String(source || '').split('\n')) {
    const h = line.match(HEADING_RE);
    if (h && excludeSections.includes(normalizeHeadingText(h[2]))) break;
    if (h) continue;                                   // drop heading lines
    const t = line.trim();
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) continue;    // horizontal rules
    if (t.startsWith('|')) continue;                   // table rows
    let cleaned = line.replace(/^\s*>\s?/, '');        // blockquote marker
    cleaned = cleaned.replace(/^\s*\[!\w+\][-+]?\s*$/, ''); // bare callout tag
    kept.push(cleaned);
  }

  let text = kept.join('\n');
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  text = text.replace(/\[\[([^\]]+)\]\]/g, (_, t) => t.replace(/_/g, ' '));
  text = text.replace(/[*_`]+/g, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  const match = text.match(/^(.+?[.!?])\s/);
  if (match) return match[1];
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

module.exports = { excerptFromMarkdown };
