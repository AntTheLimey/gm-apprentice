const { publishedSource } = require('./processor');
const { canonicalNfc } = require('./unicode');
const lunr = require('lunr');
const { wikilinkRe, parseWikilink } = require('./wikilink');
const { stripTags } = require('./strip-tags');

function stripMarkdown(md) {
  return stripTags(md)  // tags typed in a body are markup, not searchable prose
    .replace(/^#+\s+.*/gm, '')
    .replace(wikilinkRe(), (_, body) => { const w = parseWikilink(body); return w.display || w.raw; })
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~`#>]/g, '')
    .replace(/\n+/g, ' ')
    .trim();
}

function getSubtitle(fm) {
  return fm.occupation || fm.location_type || fm.faction_type || fm.factionType || fm.event_type || fm.type || '';
}

// Search results must reflect only what readers can see, so prefer each page's published
// view (gm-only + spoiler content stripped) over its raw markdown when available.
const publishedText = publishedSource;

// Short lunr ref for the page at position `i`. The ref is repeated in every posting of the
// serialized index, so using the (40-odd character) output path made the index roughly 3x
// larger once bodies were no longer capped (#267). documents is keyed by the same id and each
// entry carries the real path in `href`.
function refFor(i) {
  return i.toString(36);
}

function buildSearchIndex(pages) {
  const documents = {};

  pages.forEach((page, i) => {
    const fm = page.frontmatter || {};

    documents[refFor(i)] = {
      title: page.displayTitle || '',
      type: fm.type || '',
      subtitle: getSubtitle(fm),
      href: page.outputPath,
    };
  });

  const idx = lunr(function() {
    // No stemmer (#267). This is a wiki of proper names, and the English stemmer mangles them
    // ("Alderic" is indexed as "alder"), which puts a one-letter typo two edits away from the
    // stored term so fuzzy matching cannot reach it. Exact and prefix matching cover the
    // plural/inflection cases a stemmer would have caught. The pipeline names are serialized
    // into the index, so the browser's loaded index skips the stemmer at query time too.
    this.pipeline.remove(lunr.stemmer);
    this.searchPipeline.remove(lunr.stemmer);
    this.ref('id');
    this.field('title', { boost: 10 });
    this.field('aliases', { boost: 5 });
    this.field('type', { boost: 2 });
    this.field('body');

    pages.forEach((page, i) => {
      const fm = page.frontmatter;
      this.add({
        id: refFor(i),
        title: canonicalNfc(page.displayTitle),
        aliases: Array.isArray(fm.aliases) ? canonicalNfc(fm.aliases.join(' ')) : '',
        type: fm.type || '',
        // Whole published body (#267). It used to be cut at 500 characters, which hid every
        // name mentioned in the second half of a recap. Results show only title/type/subtitle
        // (documents above), so there is no separate snippet to keep short. NFC first (#139) so
        // two spellings of one vault index the same terms.
        body: canonicalNfc(stripMarkdown(publishedText(page))),
      });
    });
  });

  return {
    index: idx.toJSON(),
    documents,
  };
}

module.exports = { buildSearchIndex };
