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

function baseShell({ title, siteTitle, cssHref, navHtml, rootHref, content, footer }) {
  const footerHtml = footer ? `<footer class="site-footer">${escapeHtml(footer)}</footer>` : '';
  const themeCssHref = cssHref.replace('style.css', 'theme.css');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — ${escapeHtml(siteTitle)}</title>
  <link rel="stylesheet" href="${cssHref}">
  <link rel="stylesheet" href="${themeCssHref}">
</head>
<body>

<header class="site-header">
  <button class="menu-toggle" onclick="document.getElementById('nav').classList.add('open')" aria-label="Menu">&#9776;</button>
  <h1><a href="${rootHref}index.html">${escapeHtml(siteTitle)}</a></h1>
</header>

<nav id="nav" class="site-nav">
  <button class="nav-close" onclick="document.getElementById('nav').classList.remove('open')" aria-label="Close">&times;</button>
  ${navHtml}
</nav>

<main class="content">
${content}
</main>

${footerHtml}

<button class="back-to-top" onclick="window.scrollTo({top:0})" aria-label="Back to top">&#8593;</button>

<script>
document.querySelectorAll('.site-nav a').forEach(a => {
  a.addEventListener('click', () => document.getElementById('nav').classList.remove('open'));
});
(function() {
  var btn = document.querySelector('.back-to-top');
  if (btn) window.addEventListener('scroll', function() {
    btn.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });
})();
</script>

</body>
</html>`;
}

function getConfidence(frontmatter) {
  return frontmatter.source_confidence || frontmatter.canon_status || null;
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
  event: ['event_type', 'date', 'location'],
  item: ['item_type', 'tl', 'origin'],
  creature: ['creature_type', 'location'],
  clue: ['clue_type', 'reliability', 'found_by'],
  document: ['document_type', 'author', 'classification', 'date_written'],
  session: ['session_number', 'actual_date', 'status', 'stage'],
  scene: ['scene_type', 'status'],
  chapter: ['sort_order'],
};

function metadataBadgesFor(frontmatter) {
  const fields = TYPE_BADGE_FIELDS[frontmatter.type];
  if (!fields) return '';

  const badges = [];
  for (const field of fields) {
    const raw = frontmatter[field];
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
  baseShell,
  getConfidence,
  confidenceBadge,
  TYPE_BADGE_FIELDS,
  metadataBadgesFor,
  portraitImg,
};
