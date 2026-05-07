const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

function buildBacklinks(pages) {
  const backlinks = {};

  for (const page of pages) {
    const md = page.markdown || '';
    const seen = new Set();
    let match;
    WIKI_LINK_RE.lastIndex = 0;
    while ((match = WIKI_LINK_RE.exec(md)) !== null) {
      const target = match[1].trim();
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

  return backlinks;
}

module.exports = { buildBacklinks };
