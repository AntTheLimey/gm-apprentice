const { publishedSource } = require('./processor');
const { canonicalNfc, nfcLookupTable } = require('./unicode');
const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

function buildBacklinks(pages) {
  const backlinks = Object.create(null);

  for (const page of pages) {
    // Prefer the published view (gm-only blocks + excluded sections stripped) so a mention
    // that only appears in non-published content never creates a public backlink (B6).
    const md = publishedSource(page);
    const seen = new Set();
    let match;
    WIKI_LINK_RE.lastIndex = 0;
    while ((match = WIKI_LINK_RE.exec(md)) !== null) {
      // Keyed in NFC (#139): the key is the mention as typed inside a note, but every read is
      // `_backlinks[page.title]` — the scanned filename. Two authors, two normal forms, and a
      // mismatch silently drops the entity's whole "Mentioned in" sidebar.
      const target = canonicalNfc(match[1].trim());
      if (!target) continue;
      if (seen.has(target)) continue;
      seen.add(target);

      if (!backlinks[target]) backlinks[target] = [];
      backlinks[target].push({
        title: page.title,
        displayTitle: page.displayTitle,
        outputPath: page.outputPath,
        type: (page.frontmatter || {}).type,
      });
    }
  }

  return nfcLookupTable(backlinks);
}

module.exports = { buildBacklinks };
