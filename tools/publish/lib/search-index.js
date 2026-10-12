const { publishedSource } = require('./processor');
const { canonicalNfc } = require('./unicode');
const lunr = require('lunr');
const { wikilinkRe, parseWikilink, labelsForLinks } = require('./wikilink');
const { stripTags } = require('./strip-tags');
const { getsNoPage } = require('./previews');

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
  const value = fm.occupation || fm.location_type || fm.faction_type || fm.factionType || fm.event_type || fm.type || '';
  // A search result prints this as it stands: a labelled link in it prints its label.
  return reduced(value);
}

// A value with every string in it (however deep, a sub-key or a list) reduced the same way.
function reduced(value) {
  if (typeof value === 'string') return labelsForLinks(value);
  if (Array.isArray(value)) return value.map(reduced);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, reduced(v)]));
  }
  return value;
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

const aliasesIndexed = (fm) => (Array.isArray(fm.aliases) ? canonicalNfc(fm.aliases.map((a) => labelsForLinks(a)).join(' ')) : '');
const bodyIndexed = (page) => canonicalNfc(stripMarkdown(publishedText(page)));

// The words the index takes from a page besides its title: its aliases and its whole body.
// The note-faults audit reads them for a withheld name.
function indexedTextOf(page) {
  return `${aliasesIndexed(page.frontmatter || {})}\n${bodyIndexed(page)}`;
}

function buildSearchIndex(allPages) {
  // A note the build writes no page for has no search entry: a result would open a page
  // that is not there, and its words would be findable. previews.js has the one
  // predicate, the render loop and the cards ask it too.
  const pages = allPages.filter(page => !getsNoPage(page));
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
        aliases: aliasesIndexed(fm),
        type: fm.type || '',
        // Whole published body (#267). It used to be cut at 500 characters, which hid every
        // name mentioned in the second half of a recap. Results show only title/type/subtitle
        // (documents above), so there is no separate snippet to keep short. NFC first (#139) so
        // two spellings of one vault index the same terms.
        body: bodyIndexed(page),
      });
    });
  });

  return {
    index: idx.toJSON(),
    documents,
  };
}

module.exports = { subtitleOf: getSubtitle, buildSearchIndex, indexedTextOf };
