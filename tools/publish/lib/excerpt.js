// Shared excerpt extraction for listing cards and pull-quotes.
// Accepts raw markdown OR rendered HTML. Excluded sections are cut
// BEFORE any other processing so an excerpt can never surface GM-only
// content, even on sparse entities whose only prose is secret.

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

function excerptFromMarkdown(source, opts = {}) {
  const excludeSections = (opts.excludeSections || []).map(s => String(s).toLowerCase());
  const limit = opts.limit || 200;

  const kept = [];
  for (const line of String(source || '').split('\n')) {
    const h = line.match(HEADING_RE);
    if (h && excludeSections.includes(h[2].trim().toLowerCase())) break;
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
