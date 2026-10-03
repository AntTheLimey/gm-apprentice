const { publishedSource } = require('./processor');
const { canonicalNfc, nfcLookupTable } = require('./unicode');
const { wikilinkRe, parseWikilink } = require('./wikilink');

// With the link map, keyed by the output path a link actually resolves to, so two pages
// sharing a title (an NPC and a PC) do not share each other's mentions. Without one, by the
// name as written. Read with `backlinksOf`.
function buildBacklinks(pages, linkMap) {
  const backlinks = Object.create(null);

  for (const page of pages) {
    // Prefer the published view (gm-only blocks + excluded sections stripped) so a mention
    // that only appears in non-published content never creates a public backlink (B6).
    const md = publishedSource(page);
    const seen = new Set();
    for (const match of md.matchAll(wikilinkRe())) {
      // Keyed in NFC (#139): the key is the mention as typed inside a note, but every read is
      // `_backlinks[page.title]` — the scanned filename. Two authors, two normal forms, and a
      // mismatch silently drops the entity's whole "Mentioned in" sidebar.
      const target = canonicalNfc(parseWikilink(match[1]).raw.trim());
      if (!target) continue;
      const key = linkMap ? linkMap[target] : target;
      if (!key || seen.has(key)) continue;
      seen.add(key);

      if (!backlinks[key]) backlinks[key] = [];
      backlinks[key].push({
        title: page.title,
        displayTitle: page.displayTitle,
        outputPath: page.outputPath,
        type: (page.frontmatter || {}).type,
      });
    }
  }

  return nfcLookupTable(backlinks);
}

// The mentions of `page`: under its output path, else (a table built without a link map)
// under its title.
function backlinksOf(backlinks, page) {
  const table = backlinks || {};
  return table[page.outputPath] || table[page.title] || [];
}

module.exports = { buildBacklinks, backlinksOf };
