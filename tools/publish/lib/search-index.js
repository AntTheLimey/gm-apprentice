const lunr = require('lunr');

function stripMarkdown(md) {
  return (md || '')
    .replace(/^#+\s+.*/gm, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, d) => d || t)
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~`#>]/g, '')
    .replace(/\n+/g, ' ')
    .trim();
}

function getSubtitle(fm) {
  return fm.occupation || fm.location_type || fm.faction_type || fm.event_type || fm.type || '';
}

function buildSearchIndex(pages) {
  const documents = {};

  for (const page of pages) {
    const fm = page.frontmatter || {};

    documents[page.outputPath] = {
      title: page.displayTitle || '',
      type: fm.type || '',
      subtitle: getSubtitle(fm),
      href: page.outputPath,
    };
  }

  const idx = lunr(function() {
    this.ref('id');
    this.field('title', { boost: 10 });
    this.field('aliases', { boost: 5 });
    this.field('type', { boost: 2 });
    this.field('body');

    for (const page of pages) {
      const fm = page.frontmatter;
      this.add({
        id: page.outputPath,
        title: page.displayTitle,
        aliases: Array.isArray(fm.aliases) ? fm.aliases.join(' ') : '',
        type: fm.type || '',
        body: stripMarkdown(page.markdown).slice(0, 500),
      });
    }
  });

  return {
    index: idx.toJSON(),
    documents,
  };
}

module.exports = { buildSearchIndex };
