const { relativePath, escapeHtml, encodeImageUrl, plainMetaValue } = require('../processor');
const { typeLabelText } = require('../kind-label');

const DIR_LABELS = {
  'campaign': 'Campaign',
  // Aggregate index over PCs + NPCs. The landing page's "Characters" card targets it, and
  // the two sub-indexes below still get their own pages.
  'characters': 'Characters',
  'characters/pcs': 'Player Characters',
  'characters/npcs': 'NPCs',
  'factions': 'Factions & Organizations',
  'events': 'Events',
  'locations': 'Locations',
  'items': 'Items & Artifacts',
  'documents': 'Documents',
  'clues': 'Clues',
  'chapters': 'Chapters',
  // The nav's Story group has always linked Sessions at sessions/index.html (nav.js's
  // NAV_GROUPS), but nothing generated that page — a 404 on any build where a folderMap
  // entry routes a folder to "sessions" output (#214). Added here so it's built the same
  // way every other section index is.
  'sessions': 'Sessions',
  'creatures': 'Creatures',
  'heritages': 'Heritages',
  'world': 'World',
};

function cssPath(outputPath) {
  const depth = outputPath.split('/').length - 1;
  return '../'.repeat(depth) + 'css/style.css';
}

function rootPath(outputPath) {
  const depth = outputPath.split('/').length - 1;
  return '../'.repeat(depth) || './';
}

function clientScripts(outputPath) {
  const root = rootPath(outputPath);
  const scripts = [root + 'js/nav.js', root + 'js/lightbox.js', root + 'js/search.js'];
  if (linkPreviews !== 'off') scripts.push(root + 'js/previews.js');
  return scripts;
}

// The link-previews mode for this build ('on', 'desktop' or 'off'), set once by
// configureLinkPreviews before any page renders. Module state for the reason
// colorModeHead is: build() is synchronous.
let linkPreviews = 'off';
function configureLinkPreviews(mode) { linkPreviews = mode === 'on' || mode === 'desktop' ? mode : 'off'; }
// The attribute the page script reads off <main>; empty when previews are off.
function linkPreviewsOn() { return linkPreviews !== 'off'; }
// Marks a listing container (a card grid, a list of rows) whose links get no preview card; empty when
// previews are off so an off build stays byte-identical.
function noPreviewAttr() { return linkPreviewsOn() ? ' data-no-preview' : ''; }
function previewsAttr() { return linkPreviews !== 'off' ? ` data-previews="${linkPreviews}"` : ''; }

// The color-mode <head> script (#260), set once per build by configureColorMode. It
// goes first in <head> so data-theme is set before any stylesheet paints.
// Module state, not a parameter threaded through every template: safe because build()
// is synchronous and sets it before rendering any page. Pass it explicitly instead if
// builds ever run concurrently in one process.
let colorModeHead = '';
function configureColorMode(head) { colorModeHead = head || ''; }
function colorModeHeadHtml() { return colorModeHead ? `\n  ${colorModeHead}` : ''; }
function colorModeEnabled() { return Boolean(colorModeHead); }

function baseShell({ title, siteTitle, cssHref, navHtml, rootHref, content, footer, genrePreset, overridesCss, breadcrumbsHtml, scripts, mainAttrs, extraCss }) {
  const footerHtml = footer ? `<footer class="site-footer">${escapeHtml(footer)}</footer>` : '';
  const themeCssHref = cssHref.replace('style.css', 'theme.css');
  const genreCssHref = genrePreset
    ? cssHref.replace('style.css', `themes/${genrePreset}.css`)
    : '';
  const genreLinkTag = genreCssHref
    ? `\n  <link rel="stylesheet" href="${genreCssHref}">`
    : '';
  // Linked last so a site's own rules win the cascade against style.css, the genre overlay,
  // and the generated theme.css. Only emitted when the build actually copied one, so a site
  // that never scaffolded css/overrides.css doesn't 404 on every page.
  const overridesLinkTag = overridesCss
    ? `\n  <link rel="stylesheet" href="${cssHref.replace('style.css', 'overrides.css')}">`
    : '';
  const extraLinks = (extraCss || []).map(h => `\n  <link rel="stylesheet" href="${h}">`).join('');
  const breadcrumbs = breadcrumbsHtml || '';
  const scriptTags = scripts
    ? scripts.map(s => `<script src="${s}"></script>`).join('\n')
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">${colorModeHeadHtml()}
  <title>${escapeHtml(title)} — ${escapeHtml(siteTitle)}</title>
  <link rel="stylesheet" href="${cssHref}">${genreLinkTag}
  <link rel="stylesheet" href="${themeCssHref}">${extraLinks}${overridesLinkTag}
</head>
<body>

${navHtml}

<main class="content"${mainAttrs || ''}${previewsAttr()}>
${breadcrumbs}
${content}
</main>

${footerHtml}

<button class="back-to-top" onclick="window.scrollTo({top:0})" aria-label="Back to top">&#8593;</button>

${scriptTags}
<script>
(function() {
  var btn = document.querySelector('.back-to-top');
  if (btn) window.addEventListener('scroll', function() {
    btn.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });
})();
document.querySelectorAll('.nav-group-toggle').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var group = btn.parentElement;
    var isOpen = group.classList.contains('open');
    document.querySelectorAll('.nav-group').forEach(function(g) { g.classList.remove('open'); });
    if (!isOpen) group.classList.add('open');
  });
});
document.addEventListener('click', function(e) {
  if (!e.target.closest('.nav-group')) {
    document.querySelectorAll('.nav-group').forEach(function(g) { g.classList.remove('open'); });
  }
});
</script>

</body>
</html>`;
}

function getCanonStatus(frontmatter) {
  // canon_status is canonical; source_confidence and confidence are legacy
  // names still honored at read time for vaults that haven't migrated (1.8.0)
  return frontmatter.canon_status || frontmatter.source_confidence || frontmatter.confidence || null;
}

function canonStatusBadge(frontmatter) {
  const canonStatus = getCanonStatus(frontmatter);
  switch (canonStatus) {
    case 'STUB':
      return ' <span class="badge badge-stub">Stub</span>';
    case 'DRAFT':
      return ' <span class="badge badge-draft">Draft</span>';
    case 'SUPERSEDED':
      return ' <span class="badge badge-superseded">Superseded</span>';
    default:
      return '';
  }
}

// Maps entity types to frontmatter fields that should render as metadata badges.
// Wiki-link values like `[[Foo]]` are stripped to `Foo` for display.
const TYPE_BADGE_FIELDS = {
  organization: ['faction_type'],
  faction: ['faction_type'],
  event: ['event_type', 'in_game_date', 'location'],
  item: ['item_type', 'tl', 'origin'],
  creature: ['creature_type', 'location'],
  // Not `reliability`: a planted false clue would publish as "misleading".
  clue: ['clue_type', 'found_by'],
  document: ['document_type', 'author', 'classification', 'date_written'],
  session: ['session_number', 'play_date', 'status', 'stage'],
  scene: ['scene_type', 'status'],
  chapter: ['sort_order'],
};

// The seeded Document template writes `doc_type` and `date` (entity-schema.md).
const FIELD_FALLBACKS = { in_game_date: 'date', play_date: 'actual_date', document_type: 'doc_type', date_written: 'date' };

// A header value as the reader sees it: a wikilink as its label, a Date as the date written,
// a snake_case type label as words. The one definition for every badge the page headers
// print and for the matching facts on the link preview cards.
function headerValueText(field, raw) {
  const text = plainMetaValue(raw).trim();
  return /(?:^|_)type$/.test(String(field)) ? typeLabelText(text) : text;
}

function metadataBadgesFor(frontmatter) {
  const fields = TYPE_BADGE_FIELDS[frontmatter.type];
  if (!fields) return '';

  const badges = [];
  for (const field of fields) {
    let raw = frontmatter[field];
    if ((raw === undefined || raw === null || raw === '') && FIELD_FALLBACKS[field]) {
      raw = frontmatter[FIELD_FALLBACKS[field]];
    }
    if (raw === undefined || raw === null || raw === '') continue;
    const value = headerValueText(field, raw);
    if (!value) continue;
    badges.push(`<span class="metadata-badge">${escapeHtml(value)}</span>`);
  }

  if (badges.length === 0) return '';
  return `<div class="metadata-badges">${badges.join('\n')}</div>`;
}

function portraitImg(frontmatter, outputPath, imageMap) {
  const portrait = frontmatter.portrait;
  if (!portrait) return '';

  // The scanner keys imageMap by bare basename, so however a `portrait:` spells its path —
  // `_attachments/characters/Rock.png`, `characters/Rock.png`, or `Rock.png` — the lookup is
  // the last segment. Stripping the attachments prefix first never changed that.
  const basename = String(portrait).split('/').pop();

  // Verify the image was actually discovered by the scanner
  const entry = imageMap[basename];
  if (!entry) return '';

  const currentDir = outputPath.substring(0, outputPath.lastIndexOf('/'));
  // The scanner's relPath, not the frontmatter's: it is where copyImages actually writes the
  // file, so a `portrait:` that omits the subdirectory still resolves — and an image the
  // build re-encoded carries its new extension here.
  const imgPath = 'images/' + entry.relPath;
  // Attachment filenames routinely carry spaces and non-ASCII ("Vita Ó Taidhg.png"), which
  // are not valid in a URL. Templates that lift this src back out of the tag (hero banners)
  // inherit the encoding.
  const relativeImgPath = encodeImageUrl(relativePath(currentDir, imgPath));
  const alt = escapeHtml(frontmatter.aliases?.[0] || basename.replace(/\.[^.]+$/, ''));
  return `<img src="${relativeImgPath}" alt="${alt}" class="portrait">`;
}

module.exports = {
  DIR_LABELS,
  cssPath,
  rootPath,
  clientScripts,
  configureLinkPreviews,
  linkPreviewsOn,
  noPreviewAttr,
  previewsAttr,
  baseShell,
  getCanonStatus,
  canonStatusBadge,
  TYPE_BADGE_FIELDS,
  headerValueText,
  metadataBadgesFor,
  portraitImg,
  configureColorMode,
  colorModeHeadHtml,
  colorModeEnabled,
};
