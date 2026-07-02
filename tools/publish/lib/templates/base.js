const { relativePath, escapeHtml } = require('../processor');

const DIR_LABELS = {
  'campaign': 'Campaign',
  'characters/pcs': 'Player Characters',
  'characters/npcs': 'NPCs',
  'factions': 'Factions & Organizations',
  'events': 'Events',
  'locations': 'Locations',
  'items': 'Items & Artifacts',
  'documents': 'Documents',
  'clues': 'Clues',
  'chapters': 'Chapters',
  'creatures': 'Creatures',
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
  return [root + 'js/nav.js', root + 'js/lightbox.js', root + 'js/search.js'];
}

function baseShell({ title, siteTitle, cssHref, navHtml, rootHref, content, footer, genrePreset, breadcrumbsHtml, scripts }) {
  const footerHtml = footer ? `<footer class="site-footer">${escapeHtml(footer)}</footer>` : '';
  const themeCssHref = cssHref.replace('style.css', 'theme.css');
  const genreCssHref = genrePreset
    ? cssHref.replace('style.css', `themes/${genrePreset}.css`)
    : '';
  const genreLinkTag = genreCssHref
    ? `\n  <link rel="stylesheet" href="${genreCssHref}">`
    : '';
  const breadcrumbs = breadcrumbsHtml || '';
  const scriptTags = scripts
    ? scripts.map(s => `<script src="${s}"></script>`).join('\n')
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — ${escapeHtml(siteTitle)}</title>
  <link rel="stylesheet" href="${cssHref}">${genreLinkTag}
  <link rel="stylesheet" href="${themeCssHref}">
</head>
<body>

${navHtml}

<main class="content">
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

function getConfidence(frontmatter) {
  // canon_status is canonical; source_confidence and confidence are legacy
  // names still honored at read time for vaults that haven't migrated (1.8.0)
  return frontmatter.canon_status || frontmatter.source_confidence || frontmatter.confidence || null;
}

function confidenceBadge(frontmatter) {
  const confidence = getConfidence(frontmatter);
  switch (confidence) {
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
  clue: ['clue_type', 'reliability', 'found_by'],
  document: ['document_type', 'author', 'classification', 'date_written'],
  session: ['session_number', 'play_date', 'status', 'stage'],
  scene: ['scene_type', 'status'],
  chapter: ['sort_order'],
};

const FIELD_FALLBACKS = { in_game_date: 'date', play_date: 'actual_date' };

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
    // Strip wiki-link brackets if present
    const value = String(raw).replace(/\[\[|\]\]/g, '').trim();
    if (!value) continue;
    badges.push(`<span class="metadata-badge">${escapeHtml(value)}</span>`);
  }

  if (badges.length === 0) return '';
  return `<div class="metadata-badges">${badges.join('\n')}</div>`;
}

function portraitImg(frontmatter, outputPath, imageMap, attachmentsDir) {
  const portrait = frontmatter.portrait;
  if (!portrait) return '';

  const prefix = (attachmentsDir || '_attachments') + '/';
  const portraitStr = String(portrait);
  const relPath = portraitStr.startsWith(prefix) ? portraitStr.slice(prefix.length) : portraitStr;
  const basename = relPath.split('/').pop();

  // Verify the image was actually discovered by the scanner
  if (!imageMap[basename]) return '';

  const currentDir = outputPath.substring(0, outputPath.lastIndexOf('/'));
  const imgPath = 'images/' + relPath;
  const relativeImgPath = relativePath(currentDir, imgPath);
  const alt = escapeHtml(frontmatter.aliases?.[0] || basename.replace(/\.[^.]+$/, ''));
  return `<img src="${relativeImgPath}" alt="${alt}" class="portrait">`;
}

module.exports = {
  DIR_LABELS,
  cssPath,
  rootPath,
  clientScripts,
  baseShell,
  getConfidence,
  confidenceBadge,
  TYPE_BADGE_FIELDS,
  metadataBadgesFor,
  portraitImg,
};
