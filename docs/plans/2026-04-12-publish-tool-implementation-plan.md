# gm-apprentice-publish v1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the gurps-special-forces vault-to-static-site generator into a reusable npm package (`gm-apprentice-publish`) with a companion Claude skill (`skills/publish-site/`).

**Architecture:** Two-layer design — npm package handles build logic, skill handles UX. Package uses `gray-matter` + `markdown-it` as runtime deps, Node 22+ built-in test runner for tests. Cross-platform (Windows/macOS/Linux).

**Tech Stack:** Node.js 22+, gray-matter, markdown-it, node:test, node:assert

**Source:** Design spec at `docs/plans/2026-04-12-publish-tool-extraction-design.md`

---

## Phase 0: Migration Prep

### Task 0.1: Scaffold Directory Structure

**Files:**
- Create: `tools/publish/package.json`
- Create: `tools/publish/lib/scanner.js`
- Create: `tools/publish/lib/processor.js`
- Create: `tools/publish/lib/templates.js`
- Create: `tools/publish/lib/build.js`
- Create: `tools/publish/lib/index.js`
- Create: `tools/publish/css/style.css`

- [ ] **Step 1: Create tools/publish directory and package.json**

```json
{
  "name": "gm-apprentice-publish",
  "version": "0.1.0",
  "description": "Static site generator for gm-apprentice campaign vaults",
  "main": "lib/index.js",
  "bin": {
    "gm-apprentice-publish": "./bin/gm-publish.js"
  },
  "scripts": {
    "test": "node --test test/",
    "build": "node lib/build.js"
  },
  "engines": {
    "node": ">=22"
  },
  "keywords": ["ttrpg", "campaign", "static-site", "obsidian", "markdown"],
  "author": "",
  "license": "MIT",
  "dependencies": {
    "gray-matter": "^4.0.3",
    "markdown-it": "^14.1.0"
  }
}
```

- [ ] **Step 2: Copy scanner.js from prototype**

Copy `/Users/antonypegg/PROJECTS/gurps-special-forces/lib/scanner.js` to `tools/publish/lib/scanner.js` unchanged.

- [ ] **Step 3: Copy processor.js from prototype**

Copy `/Users/antonypegg/PROJECTS/gurps-special-forces/lib/processor.js` to `tools/publish/lib/processor.js` unchanged.

- [ ] **Step 4: Copy templates.js from prototype**

Copy `/Users/antonypegg/PROJECTS/gurps-special-forces/lib/templates.js` to `tools/publish/lib/templates.js` unchanged.

- [ ] **Step 5: Copy build.js and adapt paths**

Copy `/Users/antonypegg/PROJECTS/gurps-special-forces/build.js` to `tools/publish/lib/build.js`.

Change the config require to accept a path parameter:

```javascript
// Change from:
const config = require(path.join(__dirname, 'vault.config.json'));

// To:
function loadConfig(configPath) {
  const resolved = path.resolve(configPath || './vault.config.json');
  return require(resolved);
}
```

- [ ] **Step 6: Copy style.css**

Copy `/Users/antonypegg/PROJECTS/gurps-special-forces/css/style.css` to `tools/publish/css/style.css` unchanged.

- [ ] **Step 7: Create lib/index.js (public API)**

```javascript
const { scanVault, buildLinkMap, scanAttachments, slugify, mapFolder } = require('./scanner');
const { processContent, extractSections, resolveWikiLinks, filterSections, stripDataview, stripLeadingH1, renderRelationships, relativePath, escapeHtml, resolveImageEmbeds } = require('./processor');
const templates = require('./templates');
const { build } = require('./build');

module.exports = {
  // High-level
  build,
  // Scanner
  scanVault,
  buildLinkMap,
  scanAttachments,
  slugify,
  mapFolder,
  // Processor
  processContent,
  extractSections,
  resolveWikiLinks,
  filterSections,
  stripDataview,
  stripLeadingH1,
  renderRelationships,
  relativePath,
  escapeHtml,
  resolveImageEmbeds,
  // Templates
  templates,
};
```

- [ ] **Step 8: Run npm install**

```bash
cd tools/publish && npm install
```

Expected: `node_modules/` created with gray-matter and markdown-it.

- [ ] **Step 9: Commit scaffold**

```bash
git add tools/publish/
git commit -m "Scaffold tools/publish with prototype code"
```

### Task 0.2: Verify Build Against GSF Vault

**Files:**
- Modify: `tools/publish/lib/build.js`

- [ ] **Step 1: Create a temporary test config**

Create `tools/publish/test-gsf.config.json`:

```json
{
  "vaultPath": "/Users/antonypegg/Documents/specialforces_vault",
  "outputDir": "./test-output",
  "attachmentsDir": "_attachments",
  "siteTitle": "GURPS Special Forces",
  "siteUrl": "https://antthelimey.github.io/gurps-special-forces",
  "excludeDirs": ["_meta", "_Templates", "_resources", ".obsidian", ".smart-env", "node_modules", "GURPS Special Forces"],
  "excludeSections": ["Player Notes", "Source References", "Relationships"],
  "folderMap": {
    "_Campaign": "campaign",
    "Characters/PCs": "characters/pcs",
    "Characters/NPCs": "characters/npcs",
    "Factions & Organizations": "factions",
    "Events": "events",
    "Locations": "locations",
    "Items & Artifacts": "items",
    "Documents": "documents",
    "Clues": "clues",
    "Chapters": "chapters"
  }
}
```

- [ ] **Step 2: Update build.js to accept config path**

Modify `tools/publish/lib/build.js` to export a `build(options)` function:

```javascript
const fs = require('fs');
const path = require('path');
const { scanVault, buildLinkMap, scanAttachments } = require('./scanner');
const { processContent, extractSections, filterSections, stripDataview } = require('./processor');
const { generateNav, pcTemplate, npcTemplate, locationTemplate, wikiTemplate, indexTemplate, landingTemplate, DIR_LABELS } = require('./templates');

function build(options = {}) {
  const configPath = options.configPath || './vault.config.json';
  const config = require(path.resolve(configPath));
  const outputDir = path.resolve(path.dirname(configPath), config.outputDir);

  // ... rest of main() logic, replacing __dirname references with outputDir
}

module.exports = { build };
```

- [ ] **Step 3: Run test build**

```bash
cd tools/publish && node -e "require('./lib/build').build({ configPath: './test-gsf.config.json' })"
```

Expected: `test-output/` created with HTML files, CSS, images.

- [ ] **Step 4: Verify output structure**

```bash
ls -la tools/publish/test-output/
ls -la tools/publish/test-output/characters/pcs/
```

Expected: index.html, css/, images/, character HTML files.

- [ ] **Step 5: Clean up test output and config**

```bash
rm -rf tools/publish/test-output
rm tools/publish/test-gsf.config.json
```

- [ ] **Step 6: Commit build.js changes**

```bash
git add tools/publish/lib/build.js
git commit -m "Add configPath option to build function"
```

---

## Phase 1: Decouple from GSF Specifics

### Task 1.1: Extract Hardcoded Content to Config

**Files:**
- Modify: `tools/publish/lib/templates.js:303-349` (landingTemplate)
- Modify: `tools/publish/lib/templates.js:53-90` (baseShell)

- [ ] **Step 1: Update landingTemplate to use config fields**

In `tools/publish/lib/templates.js`, modify `landingTemplate`:

```javascript
function landingTemplate(pages, navFor, config) {
  const outputPath = 'index.html';

  const sectionOrder = [
    'characters/pcs',
    'characters/npcs',
    'campaign',
    'factions',
    'events',
    'locations',
    'items',
    'documents',
    'clues',
    'chapters',
  ];
  const sectionLabels = Object.fromEntries(sectionOrder.map(k => [k, DIR_LABELS[k]]));

  const navCards = Object.entries(sectionLabels).map(([dir, label]) => {
    const dirPages = pages.filter(p => p.outputDir === dir);
    const links = dirPages.map(p => `<li><a href="${p.outputPath}">${escapeHtml(p.title)}</a></li>`).join('\n');
    return `
<div class="nav-card">
  <h3><a href="${dir}/index.html">${escapeHtml(label)}</a></h3>
  <ul>${links || '<li>No entries yet</li>'}</ul>
</div>`;
  }).join('\n');

  // Use config fields with sensible defaults
  const tagline = config.landingTagline || 'Welcome to the campaign.';
  const params = config.landingParams || '';

  const content = `
<div class="hero">
  <h1>${escapeHtml(config.siteTitle)}</h1>
  <p class="tagline">${escapeHtml(tagline)}</p>
  ${params ? `<p class="params">${escapeHtml(params)}</p>` : ''}
</div>

<div class="nav-grid">
${navCards}
</div>`;

  return baseShell({
    title: 'Home',
    siteTitle: config.siteTitle,
    cssHref: 'css/style.css',
    navHtml: navFor(outputPath),
    rootHref: './',
    content,
  });
}
```

- [ ] **Step 2: Update baseShell to accept footer from config**

Modify `baseShell` to accept a `footer` parameter:

```javascript
function baseShell({ title, siteTitle, cssHref, navHtml, rootHref, content, footer }) {
  const footerText = footer || '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — ${escapeHtml(siteTitle)}</title>
  <link rel="stylesheet" href="${cssHref}">
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

${footerText ? `<footer class="site-footer">${escapeHtml(footerText)}</footer>` : ''}

<script>
document.querySelectorAll('.site-nav a').forEach(a => {
  a.addEventListener('click', () => document.getElementById('nav').classList.remove('open'));
});
</script>

</body>
</html>`;
}
```

- [ ] **Step 3: Thread config.footer through all template calls**

Update each template function to pass `footer: config.footer` to baseShell:

```javascript
// In pcTemplate:
return baseShell({
  title: page.title,
  siteTitle: config.siteTitle,
  cssHref: cssPath(page.outputPath),
  navHtml: navFor(page.outputPath),
  rootHref: rootPath(page.outputPath),
  content,
  footer: config.footer,
});

// Repeat for npcTemplate, locationTemplate, wikiTemplate, indexTemplate, landingTemplate
```

- [ ] **Step 4: Run manual test**

Create a test config with custom tagline/params/footer and verify they render:

```bash
cd tools/publish
cat > test.config.json << 'EOF'
{
  "vaultPath": "/Users/antonypegg/Documents/specialforces_vault",
  "outputDir": "./test-output",
  "attachmentsDir": "_attachments",
  "siteTitle": "Test Site",
  "landingTagline": "Custom tagline here",
  "landingParams": "Custom params here",
  "footer": "Custom footer text",
  "excludeDirs": ["_meta", "_Templates", "_resources", ".obsidian", ".smart-env", "node_modules"],
  "excludeSections": ["Player Notes", "Source References", "Relationships"],
  "folderMap": {
    "_Campaign": "campaign",
    "Characters/PCs": "characters/pcs",
    "Characters/NPCs": "characters/npcs",
    "Factions & Organizations": "factions",
    "Events": "events",
    "Locations": "locations",
    "Items & Artifacts": "items",
    "Documents": "documents",
    "Clues": "clues",
    "Chapters": "chapters"
  }
}
EOF
node -e "require('./lib/build').build({ configPath: './test.config.json' })"
grep "Custom tagline" test-output/index.html && echo "PASS: tagline found"
grep "Custom footer" test-output/characters/pcs/*.html | head -1 && echo "PASS: footer found"
rm -rf test-output test.config.json
```

- [ ] **Step 5: Commit**

```bash
git add tools/publish/lib/templates.js
git commit -m "Extract hardcoded GSF content to config fields"
```

---

## Phase 2: Split Templates

### Task 2.1: Split templates.js into Individual Files

**Files:**
- Create: `tools/publish/lib/templates/base.js`
- Create: `tools/publish/lib/templates/nav.js`
- Create: `tools/publish/lib/templates/pc.js`
- Create: `tools/publish/lib/templates/npc.js`
- Create: `tools/publish/lib/templates/location.js`
- Create: `tools/publish/lib/templates/wiki.js`
- Create: `tools/publish/lib/templates/index-page.js`
- Create: `tools/publish/lib/templates/landing.js`
- Create: `tools/publish/lib/templates/index.js`
- Delete: `tools/publish/lib/templates.js`
- Modify: `tools/publish/lib/build.js`
- Modify: `tools/publish/lib/index.js`

- [ ] **Step 1: Create templates/base.js**

```javascript
const { escapeHtml } = require('../processor');

const DIR_LABELS = {
  'campaign': 'Campaign',
  'characters/pcs': 'Player Characters',
  'characters/npcs': 'NPCs',
  'factions': 'Factions & Organizations',
  'events': 'Events',
  'locations': 'Locations',
  'items': 'Items & Artifacts',
  'creatures': 'Creatures',
  'documents': 'Documents',
  'clues': 'Clues',
  'chapters': 'Chapters',
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
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — ${escapeHtml(siteTitle)}</title>
  <link rel="stylesheet" href="${cssHref}">
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

<script>
document.querySelectorAll('.site-nav a').forEach(a => {
  a.addEventListener('click', () => document.getElementById('nav').classList.remove('open'));
});
</script>

</body>
</html>`;
}

function stubBadge(frontmatter) {
  if (frontmatter.canon_status === 'STUB') {
    return ' <span class="stub-badge">Stub</span>';
  }
  return '';
}

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
    const value = String(raw).replace(/\[\[|\]\]/g, '').trim();
    if (!value) continue;
    badges.push(`<span class="metadata-badge">${escapeHtml(value)}</span>`);
  }

  if (badges.length === 0) return '';
  return `<div class="metadata-badges">${badges.join('\n')}</div>`;
}

const { relativePath } = require('../processor');

function portraitImg(frontmatter, outputPath, imageMap) {
  const portrait = frontmatter.portrait;
  if (!portrait) return '';

  const relPath = String(portrait).replace(/^_attachments\//, '');
  const basename = relPath.split('/').pop();

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
  stubBadge,
  TYPE_BADGE_FIELDS,
  metadataBadgesFor,
  portraitImg,
};
```

- [ ] **Step 2: Create templates/nav.js**

```javascript
const { escapeHtml, relativePath } = require('../processor');
const { DIR_LABELS } = require('./base');

function generateNav(pages) {
  const sections = {};

  for (const page of pages) {
    const dir = page.outputDir || 'campaign';
    if (!sections[dir]) sections[dir] = [];
    sections[dir].push(page);
  }

  return function navFor(currentOutputPath) {
    let html = '';
    for (const [dir, label] of Object.entries(DIR_LABELS)) {
      const dirPages = sections[dir];
      if (!dirPages || dirPages.length === 0) continue;
      html += `<h2>${escapeHtml(label)}</h2>\n<ul>\n`;
      for (const p of [...dirPages].sort((a, b) => a.title.localeCompare(b.title))) {
        const currentDir = currentOutputPath.substring(0, currentOutputPath.lastIndexOf('/'));
        const href = relativePath(currentDir, p.outputPath);
        html += `<li><a href="${href}">${escapeHtml(p.title)}</a></li>\n`;
      }
      html += `</ul>\n`;
    }
    return html;
  };
}

module.exports = { generateNav };
```

- [ ] **Step 3: Create templates/pc.js**

```javascript
const { escapeHtml } = require('../processor');
const { baseShell, cssPath, rootPath, portraitImg } = require('./base');

function pcTemplate(page, processedContent, sections, navFor, config, imageMap) {
  const fm = page.frontmatter;
  const traits = fm.key_traits ? escapeHtml(fm.key_traits.join(', ')) : '';
  const portrait = portraitImg(fm, page.outputPath, imageMap || {});
  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.title)}</h1>
  <p class="concept">${traits}</p>
  <div class="meta">
    <span><span class="label">Player</span> ${escapeHtml(fm.player_name || '')}</span>
    <span><span class="label">Points</span> ${escapeHtml(String(fm.point_total || 200))}/200</span>
    <span><span class="label">Background</span> ${escapeHtml(fm.occupation || '')}</span>
    <span><span class="label">Status</span> ${escapeHtml(fm.status || 'active')}</span>
  </div>
</div>`;

  const sectionNav = sections.length > 0
    ? `<nav class="section-nav" aria-label="Sheet sections">${sections.map(s => `<a href="#${s.id}">${escapeHtml(s.title)}</a>`).join('\n')}</nav>`
    : '';

  const accordions = sections.map(s => `
<div class="accordion" id="${s.id}">
  <button class="accordion-header" aria-expanded="false" onclick="const o=this.parentElement.classList.toggle('open');this.setAttribute('aria-expanded',o)">${escapeHtml(s.title)}</button>
  <div class="accordion-body">
    ${s.html}
  </div>
</div>`).join('\n');

  const content = `${headerCard}\n${sectionNav}\n${accordions}\n${processedContent.relationships}`;

  return baseShell({
    title: page.title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath),
    rootHref: rootPath(page.outputPath),
    content,
    footer: config.footer,
  });
}

module.exports = { pcTemplate };
```

- [ ] **Step 4: Create templates/npc.js**

```javascript
const { escapeHtml } = require('../processor');
const { baseShell, cssPath, rootPath, stubBadge, portraitImg } = require('./base');

function npcTemplate(page, processedContent, navFor, config, imageMap) {
  const fm = page.frontmatter;
  const portrait = portraitImg(fm, page.outputPath, imageMap || {});

  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.title)}${stubBadge(fm)}</h1>
  <div class="meta">
    ${fm.occupation ? `<span><span class="label">Role</span> ${escapeHtml(fm.occupation)}</span>` : ''}
    ${fm.nationality ? `<span><span class="label">Nationality</span> ${escapeHtml(fm.nationality)}</span>` : ''}
    ${fm.status ? `<span><span class="label">Status</span> ${escapeHtml(fm.status)}</span>` : ''}
    ${fm.age ? `<span><span class="label">Age</span> ${escapeHtml(String(fm.age))}</span>` : ''}
    ${fm.rank ? `<span><span class="label">Rank</span> ${escapeHtml(fm.rank)}</span>` : ''}
  </div>
</div>`;

  const content = `${headerCard}\n${processedContent.html}\n${processedContent.relationships}`;

  return baseShell({
    title: page.title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath),
    rootHref: rootPath(page.outputPath),
    content,
    footer: config.footer,
  });
}

module.exports = { npcTemplate };
```

- [ ] **Step 5: Create templates/location.js**

```javascript
const { escapeHtml } = require('../processor');
const { baseShell, cssPath, rootPath, stubBadge, portraitImg } = require('./base');

function locationTemplate(page, processedContent, navFor, config, imageMap) {
  const fm = page.frontmatter;
  const portrait = portraitImg(fm, page.outputPath, imageMap || {});

  const badges = [];
  if (fm.location_type) badges.push(fm.location_type);
  if (fm.security_level) badges.push(`Security: ${fm.security_level}`);
  if (fm.atmosphere) badges.push(fm.atmosphere);

  const badgeHtml = badges.length > 0
    ? `<div class="metadata-badges">${badges.map(b => `<span class="metadata-badge">${escapeHtml(b)}</span>`).join('\n')}</div>`
    : '';

  const breadcrumb = fm.parent_location
    ? `<div class="breadcrumb">${escapeHtml(fm.parent_location.replace(/\[\[|\]\]/g, ''))} <span class="sep">&rsaquo;</span> ${escapeHtml(page.title)}</div>`
    : '';

  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.title)}${stubBadge(fm)}</h1>
</div>`;

  const content = `${headerCard}\n${breadcrumb}\n${badgeHtml}\n${processedContent.html}\n${processedContent.relationships}`;

  return baseShell({
    title: page.title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath),
    rootHref: rootPath(page.outputPath),
    content,
    footer: config.footer,
  });
}

module.exports = { locationTemplate };
```

- [ ] **Step 6: Create templates/wiki.js**

```javascript
const { escapeHtml } = require('../processor');
const { baseShell, cssPath, rootPath, stubBadge, metadataBadgesFor, portraitImg } = require('./base');

function wikiTemplate(page, processedContent, navFor, config, imageMap) {
  const fm = page.frontmatter;
  const badges = metadataBadgesFor(fm);
  const portrait = portraitImg(fm, page.outputPath, imageMap || {});

  const content = `<h1 class="page-title">${escapeHtml(page.title)}${stubBadge(fm)}</h1>\n${portrait}\n${badges}\n${processedContent.html}\n${processedContent.relationships}`;

  return baseShell({
    title: page.title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath),
    rootHref: rootPath(page.outputPath),
    content,
    footer: config.footer,
  });
}

module.exports = { wikiTemplate };
```

- [ ] **Step 7: Create templates/index-page.js**

```javascript
const { escapeHtml, relativePath } = require('../processor');
const { baseShell, cssPath, rootPath, stubBadge } = require('./base');

function indexTemplate(outputDir, title, pages, navFor, config) {
  const outputPath = outputDir ? `${outputDir}/index.html` : 'index.html';

  const cards = pages.length > 0
    ? `<div class="roster">${pages.map(p => {
        const fm = p.frontmatter;
        const subtitle = fm.occupation || fm.event_type || fm.faction_type || fm.location_type || fm.type || '';
        const currentDir = outputDir || '';
        const href = p.outputPath.startsWith(currentDir + '/')
          ? p.outputPath.substring(currentDir.length + 1)
          : relativePath(currentDir, p.outputPath);
        return `
<div class="roster-card">
  <h3><a href="${href}">${escapeHtml(p.title)}</a>${stubBadge(fm)}</h3>
  ${subtitle ? `<div class="role">${escapeHtml(subtitle)}</div>` : ''}
</div>`;
      }).join('\n')}</div>`
    : '<p>No entries yet.</p>';

  const content = `<h1 class="page-title">${escapeHtml(title)}</h1>\n${cards}`;

  return baseShell({
    title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(outputPath),
    navHtml: navFor(outputPath),
    rootHref: rootPath(outputPath),
    content,
    footer: config.footer,
  });
}

module.exports = { indexTemplate };
```

- [ ] **Step 8: Create templates/landing.js**

```javascript
const { escapeHtml } = require('../processor');
const { baseShell, DIR_LABELS } = require('./base');

function landingTemplate(pages, navFor, config) {
  const outputPath = 'index.html';

  const sectionOrder = [
    'characters/pcs',
    'characters/npcs',
    'campaign',
    'factions',
    'events',
    'locations',
    'items',
    'creatures',
    'documents',
    'clues',
    'chapters',
  ];
  const sectionLabels = Object.fromEntries(sectionOrder.map(k => [k, DIR_LABELS[k]]));

  const navCards = Object.entries(sectionLabels).map(([dir, label]) => {
    const dirPages = pages.filter(p => p.outputDir === dir);
    const links = dirPages.map(p => `<li><a href="${p.outputPath}">${escapeHtml(p.title)}</a></li>`).join('\n');
    return `
<div class="nav-card">
  <h3><a href="${dir}/index.html">${escapeHtml(label)}</a></h3>
  <ul>${links || '<li>No entries yet</li>'}</ul>
</div>`;
  }).join('\n');

  const tagline = config.landingTagline || 'Welcome to the campaign.';
  const params = config.landingParams || '';

  const content = `
<div class="hero">
  <h1>${escapeHtml(config.siteTitle)}</h1>
  <p class="tagline">${escapeHtml(tagline)}</p>
  ${params ? `<p class="params">${escapeHtml(params)}</p>` : ''}
</div>

<div class="nav-grid">
${navCards}
</div>`;

  return baseShell({
    title: 'Home',
    siteTitle: config.siteTitle,
    cssHref: 'css/style.css',
    navHtml: navFor(outputPath),
    rootHref: './',
    content,
    footer: config.footer,
  });
}

module.exports = { landingTemplate };
```

- [ ] **Step 9: Create templates/index.js (re-exports)**

```javascript
const { DIR_LABELS, cssPath, rootPath, baseShell, stubBadge, TYPE_BADGE_FIELDS, metadataBadgesFor, portraitImg } = require('./base');
const { generateNav } = require('./nav');
const { pcTemplate } = require('./pc');
const { npcTemplate } = require('./npc');
const { locationTemplate } = require('./location');
const { wikiTemplate } = require('./wiki');
const { indexTemplate } = require('./index-page');
const { landingTemplate } = require('./landing');

module.exports = {
  DIR_LABELS,
  cssPath,
  rootPath,
  baseShell,
  stubBadge,
  TYPE_BADGE_FIELDS,
  metadataBadgesFor,
  portraitImg,
  generateNav,
  pcTemplate,
  npcTemplate,
  locationTemplate,
  wikiTemplate,
  indexTemplate,
  landingTemplate,
};
```

- [ ] **Step 10: Update build.js imports**

```javascript
// Change from:
const { generateNav, pcTemplate, npcTemplate, locationTemplate, wikiTemplate, indexTemplate, landingTemplate, DIR_LABELS } = require('./templates');

// To:
const { generateNav, pcTemplate, npcTemplate, locationTemplate, wikiTemplate, indexTemplate, landingTemplate, DIR_LABELS } = require('./templates/index');
```

- [ ] **Step 11: Update lib/index.js**

```javascript
// Change from:
const templates = require('./templates');

// To:
const templates = require('./templates/index');
```

- [ ] **Step 12: Delete old templates.js**

```bash
rm tools/publish/lib/templates.js
```

- [ ] **Step 13: Verify build still works**

```bash
cd tools/publish
cat > test.config.json << 'EOF'
{
  "vaultPath": "/Users/antonypegg/Documents/specialforces_vault",
  "outputDir": "./test-output",
  "attachmentsDir": "_attachments",
  "siteTitle": "Test Site",
  "excludeDirs": ["_meta", "_Templates", "_resources", ".obsidian", ".smart-env", "node_modules"],
  "excludeSections": ["Player Notes", "Source References", "Relationships"],
  "folderMap": {
    "_Campaign": "campaign",
    "Characters/PCs": "characters/pcs",
    "Characters/NPCs": "characters/npcs",
    "Factions & Organizations": "factions",
    "Events": "events",
    "Locations": "locations",
    "Items & Artifacts": "items",
    "Documents": "documents",
    "Clues": "clues",
    "Chapters": "chapters"
  }
}
EOF
node -e "require('./lib/build').build({ configPath: './test.config.json' })"
ls test-output/index.html && echo "PASS: build succeeded"
rm -rf test-output test.config.json
```

- [ ] **Step 14: Commit**

```bash
git add tools/publish/lib/templates/ tools/publish/lib/build.js tools/publish/lib/index.js
git rm tools/publish/lib/templates.js
git commit -m "Split templates.js into individual files"
```

---

## Phase 3: Unit Test Suite + CI

### Task 3.1: Set Up Test Infrastructure

**Files:**
- Create: `tools/publish/test/unit/scanner.test.js`
- Create: `tools/publish/test/unit/processor.test.js`
- Create: `tools/publish/test/unit/templates.test.js`

- [ ] **Step 1: Create test directory structure**

```bash
mkdir -p tools/publish/test/unit
mkdir -p tools/publish/test/integration
mkdir -p tools/publish/test/cli
mkdir -p tools/publish/test/fixtures
```

- [ ] **Step 2: Create scanner.test.js**

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { slugify, mapFolder, buildLinkMap } = require('../../lib/scanner');

describe('slugify', () => {
  it('converts to lowercase', () => {
    assert.strictEqual(slugify('Hello World'), 'hello-world');
  });

  it('removes apostrophes', () => {
    assert.strictEqual(slugify("Captain's Log"), 'captains-log');
  });

  it('converts ampersand to "and"', () => {
    assert.strictEqual(slugify('Factions & Organizations'), 'factions-and-organizations');
  });

  it('replaces non-alphanumeric with hyphens', () => {
    assert.strictEqual(slugify('Item (rare)'), 'item-rare');
  });

  it('trims leading/trailing hyphens', () => {
    assert.strictEqual(slugify('--test--'), 'test');
  });

  it('returns "untitled" for empty string', () => {
    assert.strictEqual(slugify(''), 'untitled');
  });
});

describe('mapFolder', () => {
  const folderMap = {
    'Characters/PCs': 'characters/pcs',
    'Characters/NPCs': 'characters/npcs',
    '_Campaign': 'campaign',
  };

  it('maps exact folder match', () => {
    assert.strictEqual(mapFolder('Characters/PCs', folderMap), 'characters/pcs');
  });

  it('maps nested paths', () => {
    // Note: path.sep is platform-specific, test with forward slash for now
    assert.strictEqual(mapFolder('Characters/PCs/subfolder', folderMap), 'characters/pcs/subfolder');
  });

  it('returns null for unmapped folders', () => {
    assert.strictEqual(mapFolder('Unknown', folderMap), null);
  });
});

describe('buildLinkMap', () => {
  it('maps titles to output paths', () => {
    const pages = [
      { title: 'John Doe', outputPath: 'characters/pcs/john-doe.html', frontmatter: {} },
    ];
    const map = buildLinkMap(pages);
    assert.strictEqual(map['John Doe'], 'characters/pcs/john-doe.html');
  });

  it('maps aliases', () => {
    const pages = [
      { title: 'John Doe', outputPath: 'characters/pcs/john-doe.html', frontmatter: { aliases: ['Johnny'] } },
    ];
    const map = buildLinkMap(pages);
    assert.strictEqual(map['Johnny'], 'characters/pcs/john-doe.html');
  });

  it('prefers canonical title over alias', () => {
    const pages = [
      { title: 'John', outputPath: 'a.html', frontmatter: {} },
      { title: 'Jane', outputPath: 'b.html', frontmatter: { aliases: ['John'] } },
    ];
    const map = buildLinkMap(pages);
    assert.strictEqual(map['John'], 'a.html');
  });

  it('redirects superseded entities', () => {
    const pages = [
      { title: 'New Name', outputPath: 'new.html', frontmatter: {} },
      { title: 'Old Name', outputPath: 'old.html', frontmatter: { canon_status: 'SUPERSEDED', superseded_by: '[[New Name]]' } },
    ];
    const map = buildLinkMap(pages);
    assert.strictEqual(map['Old Name'], 'new.html');
  });
});
```

- [ ] **Step 3: Run scanner tests**

```bash
cd tools/publish && node --test test/unit/scanner.test.js
```

Expected: All tests pass.

- [ ] **Step 4: Create processor.test.js**

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { escapeHtml, relativePath, resolveWikiLinks, filterSections, stripDataview, stripLeadingH1 } = require('../../lib/processor');

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    assert.strictEqual(escapeHtml('<script>'), '&lt;script&gt;');
  });

  it('escapes ampersand', () => {
    assert.strictEqual(escapeHtml('A & B'), 'A &amp; B');
  });

  it('escapes quotes', () => {
    assert.strictEqual(escapeHtml('"test"'), '&quot;test&quot;');
  });

  it('handles null/undefined', () => {
    assert.strictEqual(escapeHtml(null), '');
    assert.strictEqual(escapeHtml(undefined), '');
  });
});

describe('relativePath', () => {
  it('returns path unchanged when fromDir is empty', () => {
    assert.strictEqual(relativePath('', 'foo/bar.html'), 'foo/bar.html');
  });

  it('computes relative path with parent traversal', () => {
    assert.strictEqual(relativePath('characters/pcs', 'factions/guild.html'), '../../factions/guild.html');
  });

  it('handles same directory', () => {
    assert.strictEqual(relativePath('characters/pcs', 'characters/pcs/jane.html'), 'jane.html');
  });
});

describe('resolveWikiLinks', () => {
  const linkMap = { 'John Doe': 'characters/pcs/john-doe.html' };

  it('resolves wiki links', () => {
    const result = resolveWikiLinks('See [[John Doe]]', linkMap, 'index.html');
    assert.strictEqual(result, 'See [John Doe](characters/pcs/john-doe.html)');
  });

  it('uses display text when provided', () => {
    const result = resolveWikiLinks('See [[John Doe|the hero]]', linkMap, 'index.html');
    assert.strictEqual(result, 'See [the hero](characters/pcs/john-doe.html)');
  });

  it('returns display text only for unknown links', () => {
    const result = resolveWikiLinks('See [[Unknown]]', linkMap, 'index.html');
    assert.strictEqual(result, 'See Unknown');
  });
});

describe('filterSections', () => {
  it('removes excluded sections', () => {
    const md = '# Title\n\n## Keep\nContent\n\n## Remove\nSecret';
    const result = filterSections(md, ['Remove']);
    assert.ok(result.includes('## Keep'));
    assert.ok(!result.includes('## Remove'));
    assert.ok(!result.includes('Secret'));
  });

  it('is case-insensitive', () => {
    const md = '## PLAYER NOTES\nSecret';
    const result = filterSections(md, ['Player Notes']);
    assert.ok(!result.includes('Secret'));
  });
});

describe('stripDataview', () => {
  it('removes dataview blocks', () => {
    const md = 'Before\n```dataview\nLIST\n```\nAfter';
    const result = stripDataview(md);
    assert.strictEqual(result, 'Before\n\nAfter');
  });
});

describe('stripLeadingH1', () => {
  it('removes leading H1', () => {
    const md = '# Title\n\nContent';
    const result = stripLeadingH1(md);
    assert.ok(!result.includes('# Title'));
    assert.ok(result.includes('Content'));
  });

  it('preserves non-leading H1', () => {
    const md = 'Intro\n\n# Title\n\nContent';
    const result = stripLeadingH1(md);
    assert.ok(result.includes('# Title'));
  });
});
```

- [ ] **Step 5: Run processor tests**

```bash
cd tools/publish && node --test test/unit/processor.test.js
```

Expected: All tests pass.

- [ ] **Step 6: Create templates.test.js**

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { stubBadge, metadataBadgesFor, cssPath, rootPath } = require('../../lib/templates/base');

describe('stubBadge', () => {
  it('returns badge for STUB status', () => {
    const result = stubBadge({ canon_status: 'STUB' });
    assert.ok(result.includes('stub-badge'));
    assert.ok(result.includes('Stub'));
  });

  it('returns empty string for non-stub', () => {
    assert.strictEqual(stubBadge({ canon_status: 'ACTIVE' }), '');
    assert.strictEqual(stubBadge({}), '');
  });
});

describe('metadataBadgesFor', () => {
  it('renders event badges', () => {
    const fm = { type: 'event', event_type: 'Combat', date: '1943-05-01' };
    const result = metadataBadgesFor(fm);
    assert.ok(result.includes('Combat'));
    assert.ok(result.includes('1943-05-01'));
  });

  it('strips wiki-link brackets', () => {
    const fm = { type: 'event', location: '[[Berlin]]' };
    const result = metadataBadgesFor(fm);
    assert.ok(result.includes('Berlin'));
    assert.ok(!result.includes('[['));
  });

  it('returns empty for unknown type', () => {
    const fm = { type: 'unknown' };
    assert.strictEqual(metadataBadgesFor(fm), '');
  });
});

describe('cssPath', () => {
  it('handles root level', () => {
    assert.strictEqual(cssPath('index.html'), 'css/style.css');
  });

  it('handles one level deep', () => {
    assert.strictEqual(cssPath('factions/index.html'), '../css/style.css');
  });

  it('handles two levels deep', () => {
    assert.strictEqual(cssPath('characters/pcs/john.html'), '../../css/style.css');
  });
});

describe('rootPath', () => {
  it('handles root level', () => {
    assert.strictEqual(rootPath('index.html'), './');
  });

  it('handles nested paths', () => {
    assert.strictEqual(rootPath('characters/pcs/john.html'), '../../');
  });
});
```

- [ ] **Step 7: Run all unit tests**

```bash
cd tools/publish && npm test
```

Expected: All tests pass.

- [ ] **Step 8: Commit tests**

```bash
git add tools/publish/test/
git commit -m "Add unit tests for scanner, processor, templates"
```

### Task 3.2: Add CI Workflow

**Files:**
- Create: `.github/workflows/publish-tool-ci.yml`

- [ ] **Step 1: Create CI workflow**

```yaml
name: Publish Tool CI

on:
  push:
    branches: [main]
    paths:
      - 'tools/publish/**'
      - '.github/workflows/publish-tool-ci.yml'
  pull_request:
    paths:
      - 'tools/publish/**'
      - '.github/workflows/publish-tool-ci.yml'

jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: tools/publish/package-lock.json
      
      - name: Install dependencies
        working-directory: tools/publish
        run: npm ci
      
      - name: Run tests
        working-directory: tools/publish
        run: npm test
```

- [ ] **Step 2: Generate package-lock.json**

```bash
cd tools/publish && npm install
```

- [ ] **Step 3: Commit CI workflow**

```bash
git add .github/workflows/publish-tool-ci.yml tools/publish/package-lock.json
git commit -m "Add cross-platform CI workflow for publish tool"
```

---

## Phase 4: Integration Tests with Fixtures

### Task 4.1: Create Minimal Fixture

**Files:**
- Create: `tools/publish/test/fixtures/minimal/Characters/PCs/Test PC.md`
- Create: `tools/publish/test/fixtures/minimal/Characters/NPCs/Test NPC.md`
- Create: `tools/publish/test/fixtures/minimal/Locations/Test Location.md`
- Create: `tools/publish/test/fixtures/minimal/_Campaign/Campaign Overview.md`
- Create: `tools/publish/test/fixtures/minimal/_meta/entity-types.md`

- [ ] **Step 1: Create minimal fixture directory**

```bash
mkdir -p "tools/publish/test/fixtures/minimal/Characters/PCs"
mkdir -p "tools/publish/test/fixtures/minimal/Characters/NPCs"
mkdir -p "tools/publish/test/fixtures/minimal/Locations"
mkdir -p "tools/publish/test/fixtures/minimal/_Campaign"
mkdir -p "tools/publish/test/fixtures/minimal/_meta"
```

- [ ] **Step 2: Create PC file**

```markdown
---
type: pc
player_name: Test Player
point_total: 200
occupation: Test Role
status: active
key_traits:
  - Brave
  - Smart
---

# Test PC

A test player character.

## Background

Some background.

## Skills

- Skill A
- Skill B
```

Save to `tools/publish/test/fixtures/minimal/Characters/PCs/Test PC.md`

- [ ] **Step 3: Create NPC file**

```markdown
---
type: npc
occupation: Merchant
nationality: British
status: active
---

# Test NPC

A test NPC.
```

Save to `tools/publish/test/fixtures/minimal/Characters/NPCs/Test NPC.md`

- [ ] **Step 4: Create Location file**

```markdown
---
type: location
location_type: City
security_level: Low
---

# Test Location

A test location.
```

Save to `tools/publish/test/fixtures/minimal/Locations/Test Location.md`

- [ ] **Step 5: Create Campaign Overview file**

```markdown
---
type: campaign
---

# Campaign Overview

Test campaign.
```

Save to `tools/publish/test/fixtures/minimal/_Campaign/Campaign Overview.md`

- [ ] **Step 6: Create entity-types.md (marker file)**

```markdown
# Entity Types

This file marks this as a gm-apprentice vault.
```

Save to `tools/publish/test/fixtures/minimal/_meta/entity-types.md`

- [ ] **Step 7: Commit minimal fixture**

```bash
git add tools/publish/test/fixtures/minimal/
git commit -m "Add minimal test fixture"
```

### Task 4.2: Create Integration Test

**Files:**
- Create: `tools/publish/test/integration/build.test.js`

- [ ] **Step 1: Create build.test.js**

```javascript
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');

describe('build integration', () => {
  const fixturesDir = path.join(__dirname, '..', 'fixtures');
  
  describe('minimal fixture', () => {
    let outputDir;
    let configPath;
    
    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-'));
      configPath = path.join(outputDir, 'config.json');
      
      const config = {
        vaultPath: path.join(fixturesDir, 'minimal'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Test Site',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: ['Player Notes'],
        folderMap: {
          '_Campaign': 'campaign',
          'Characters/PCs': 'characters/pcs',
          'Characters/NPCs': 'characters/npcs',
          'Locations': 'locations',
        },
      };
      
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    });
    
    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });
    
    it('creates output directory', () => {
      build({ configPath });
      assert.ok(fs.existsSync(path.join(outputDir, 'docs')));
    });
    
    it('creates landing page', () => {
      const indexPath = path.join(outputDir, 'docs', 'index.html');
      assert.ok(fs.existsSync(indexPath));
      const html = fs.readFileSync(indexPath, 'utf-8');
      assert.ok(html.includes('Test Site'));
    });
    
    it('creates PC page', () => {
      const pcPath = path.join(outputDir, 'docs', 'characters', 'pcs', 'test-pc.html');
      assert.ok(fs.existsSync(pcPath));
      const html = fs.readFileSync(pcPath, 'utf-8');
      assert.ok(html.includes('Test PC'));
      assert.ok(html.includes('Test Player'));
    });
    
    it('creates NPC page', () => {
      const npcPath = path.join(outputDir, 'docs', 'characters', 'npcs', 'test-npc.html');
      assert.ok(fs.existsSync(npcPath));
    });
    
    it('creates Location page', () => {
      const locPath = path.join(outputDir, 'docs', 'locations', 'test-location.html');
      assert.ok(fs.existsSync(locPath));
    });
    
    it('copies CSS', () => {
      const cssPath = path.join(outputDir, 'docs', 'css', 'style.css');
      assert.ok(fs.existsSync(cssPath));
    });
    
    it('creates .nojekyll', () => {
      const nojekyllPath = path.join(outputDir, 'docs', '.nojekyll');
      assert.ok(fs.existsSync(nojekyllPath));
    });
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
cd tools/publish && node --test test/integration/
```

Expected: All tests pass.

- [ ] **Step 3: Commit integration test**

```bash
git add tools/publish/test/integration/
git commit -m "Add integration tests for build"
```

### Task 4.3: Create Remaining Fixtures

Create fixtures for edge cases. Each follows the same pattern as minimal.

- [ ] **Step 1: Create empty fixture**

```bash
mkdir -p "tools/publish/test/fixtures/empty/_meta"
echo "# Entity Types" > "tools/publish/test/fixtures/empty/_meta/entity-types.md"
```

- [ ] **Step 2: Create malformed fixture**

```bash
mkdir -p "tools/publish/test/fixtures/malformed/Locations"
cat > "tools/publish/test/fixtures/malformed/Locations/Bad YAML.md" << 'EOF'
---
type: location
invalid yaml: [unclosed
---

# Bad YAML

This file has malformed frontmatter.
EOF

cat > "tools/publish/test/fixtures/malformed/Locations/Good File.md" << 'EOF'
---
type: location
---

# Good File

This file has valid frontmatter. Links to [[Nonexistent]].
EOF

mkdir -p "tools/publish/test/fixtures/malformed/_meta"
echo "# Entity Types" > "tools/publish/test/fixtures/malformed/_meta/entity-types.md"
```

- [ ] **Step 3: Create wiki-collisions fixture**

```bash
mkdir -p "tools/publish/test/fixtures/wiki-collisions/Characters/NPCs"
cat > "tools/publish/test/fixtures/wiki-collisions/Characters/NPCs/John.md" << 'EOF'
---
type: npc
---

# John

The canonical John.
EOF

cat > "tools/publish/test/fixtures/wiki-collisions/Characters/NPCs/Jane.md" << 'EOF'
---
type: npc
aliases:
  - John
---

# Jane

Has alias "John" but canonical John should win.
EOF

mkdir -p "tools/publish/test/fixtures/wiki-collisions/_meta"
echo "# Entity Types" > "tools/publish/test/fixtures/wiki-collisions/_meta/entity-types.md"
```

- [ ] **Step 4: Create superseded-entities fixture**

```bash
mkdir -p "tools/publish/test/fixtures/superseded-entities/Characters/NPCs"
cat > "tools/publish/test/fixtures/superseded-entities/Characters/NPCs/New Name.md" << 'EOF'
---
type: npc
---

# New Name

The current version.
EOF

cat > "tools/publish/test/fixtures/superseded-entities/Characters/NPCs/Old Name.md" << 'EOF'
---
type: npc
canon_status: SUPERSEDED
superseded_by: "[[New Name]]"
---

# Old Name

Superseded by New Name.
EOF

mkdir -p "tools/publish/test/fixtures/superseded-entities/_meta"
echo "# Entity Types" > "tools/publish/test/fixtures/superseded-entities/_meta/entity-types.md"
```

- [ ] **Step 5: Commit remaining fixtures**

```bash
git add tools/publish/test/fixtures/
git commit -m "Add edge case test fixtures"
```

---

## Phase 5: New Dedicated Templates

### Task 5.1: Create Creature Template

**Files:**
- Create: `tools/publish/lib/templates/creature.js`
- Modify: `tools/publish/lib/templates/index.js`
- Modify: `tools/publish/lib/build.js`

- [ ] **Step 1: Create creature.js**

```javascript
const { escapeHtml } = require('../processor');
const { baseShell, cssPath, rootPath, stubBadge, portraitImg } = require('./base');

function creatureTemplate(page, processedContent, navFor, config, imageMap) {
  const fm = page.frontmatter;
  const portrait = portraitImg(fm, page.outputPath, imageMap || {});

  // Build stat block
  const stats = [];
  if (fm.hp) stats.push({ label: 'HP', value: fm.hp });
  if (fm.dr) stats.push({ label: 'DR', value: fm.dr });
  if (fm.speed) stats.push({ label: 'Speed', value: fm.speed });
  if (fm.sm) stats.push({ label: 'SM', value: fm.sm });
  if (fm.st) stats.push({ label: 'ST', value: fm.st });
  if (fm.dx) stats.push({ label: 'DX', value: fm.dx });
  if (fm.iq) stats.push({ label: 'IQ', value: fm.iq });
  if (fm.ht) stats.push({ label: 'HT', value: fm.ht });

  const statBlock = stats.length > 0
    ? `<div class="stat-block">
        ${stats.map(s => `<div class="stat-item"><span class="stat-label">${escapeHtml(s.label)}</span><span class="stat-value">${escapeHtml(String(s.value))}</span></div>`).join('\n')}
       </div>`
    : '';

  // Abilities list
  const abilities = fm.abilities && Array.isArray(fm.abilities)
    ? `<div class="abilities"><h3>Abilities</h3><ul>${fm.abilities.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul></div>`
    : '';

  // Weaknesses list
  const weaknesses = fm.weaknesses && Array.isArray(fm.weaknesses)
    ? `<div class="weaknesses"><h3>Weaknesses</h3><ul>${fm.weaknesses.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>`
    : '';

  const badges = [];
  if (fm.creature_type) badges.push(fm.creature_type);
  if (fm.threat_level) badges.push(`Threat: ${fm.threat_level}`);

  const badgeHtml = badges.length > 0
    ? `<div class="metadata-badges">${badges.map(b => `<span class="metadata-badge">${escapeHtml(b)}</span>`).join('\n')}</div>`
    : '';

  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.title)}${stubBadge(fm)}</h1>
</div>`;

  const content = `${headerCard}\n${badgeHtml}\n${statBlock}\n${abilities}\n${weaknesses}\n${processedContent.html}\n${processedContent.relationships}`;

  return baseShell({
    title: page.title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath),
    rootHref: rootPath(page.outputPath),
    content,
    footer: config.footer,
  });
}

module.exports = { creatureTemplate };
```

- [ ] **Step 2: Add to templates/index.js**

```javascript
const { creatureTemplate } = require('./creature');

// Add to exports:
module.exports = {
  // ... existing exports ...
  creatureTemplate,
};
```

- [ ] **Step 3: Add to build.js switch**

```javascript
// In the switch statement:
case 'creature':
  html = creatureTemplate(page, processed, navFor, config, imageMap);
  break;
```

- [ ] **Step 4: Add CSS for stat-block**

Append to `tools/publish/css/style.css`:

```css
/* ===== CREATURE STAT BLOCK ===== */
.stat-block {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(5rem, 1fr));
  gap: 0.5rem;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 1rem;
  margin-bottom: 1rem;
}
.stat-block .stat-item {
  text-align: center;
}
.stat-block .stat-label {
  display: block;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.stat-block .stat-value {
  display: block;
  font-family: var(--mono);
  font-weight: 700;
  font-size: 1.25rem;
}

.abilities, .weaknesses {
  margin-bottom: 1rem;
}
.abilities h3, .weaknesses h3 {
  margin-top: 0;
  margin-bottom: 0.5rem;
}
.abilities ul, .weaknesses ul {
  margin: 0;
}
```

- [ ] **Step 5: Commit creature template**

```bash
git add tools/publish/lib/templates/creature.js tools/publish/lib/templates/index.js tools/publish/lib/build.js tools/publish/css/style.css
git commit -m "Add creature template with stat block"
```

### Task 5.2: Create Item Template

**Files:**
- Create: `tools/publish/lib/templates/item.js`
- Modify: `tools/publish/lib/templates/index.js`
- Modify: `tools/publish/lib/build.js`

- [ ] **Step 1: Create item.js**

```javascript
const { escapeHtml, relativePath } = require('../processor');
const { baseShell, cssPath, rootPath, stubBadge, portraitImg } = require('./base');

function itemTemplate(page, processedContent, navFor, config, imageMap, linkMap) {
  const fm = page.frontmatter;
  const portrait = portraitImg(fm, page.outputPath, imageMap || {});

  // Build stat block
  const stats = [];
  if (fm.damage) stats.push({ label: 'Damage', value: fm.damage });
  if (fm.dr) stats.push({ label: 'DR', value: fm.dr });
  if (fm.weight) stats.push({ label: 'Weight', value: fm.weight });
  if (fm.cost) stats.push({ label: 'Cost', value: fm.cost });
  if (fm.tl) stats.push({ label: 'TL', value: fm.tl });

  const statBlock = stats.length > 0
    ? `<div class="stat-block">
        ${stats.map(s => `<div class="stat-item"><span class="stat-label">${escapeHtml(s.label)}</span><span class="stat-value">${escapeHtml(String(s.value))}</span></div>`).join('\n')}
       </div>`
    : '';

  const badges = [];
  if (fm.item_type) badges.push(fm.item_type);
  if (fm.rarity) badges.push(fm.rarity);

  const badgeHtml = badges.length > 0
    ? `<div class="metadata-badges">${badges.map(b => `<span class="metadata-badge">${escapeHtml(b)}</span>`).join('\n')}</div>`
    : '';

  // Current holder link
  let holderHtml = '';
  if (fm.current_holder) {
    const holderName = String(fm.current_holder).replace(/\[\[|\]\]/g, '').trim();
    const holderPath = linkMap?.[holderName];
    const currentDir = page.outputPath.substring(0, page.outputPath.lastIndexOf('/'));
    if (holderPath) {
      const href = relativePath(currentDir, holderPath);
      holderHtml = `<p><strong>Current Holder:</strong> <a href="${href}">${escapeHtml(holderName)}</a></p>`;
    } else {
      holderHtml = `<p><strong>Current Holder:</strong> ${escapeHtml(holderName)}</p>`;
    }
  }

  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.title)}${stubBadge(fm)}</h1>
</div>`;

  const content = `${headerCard}\n${badgeHtml}\n${statBlock}\n${holderHtml}\n${processedContent.html}\n${processedContent.relationships}`;

  return baseShell({
    title: page.title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath),
    rootHref: rootPath(page.outputPath),
    content,
    footer: config.footer,
  });
}

module.exports = { itemTemplate };
```

- [ ] **Step 2: Update templates/index.js and build.js**

Add `itemTemplate` to exports and switch statement.

- [ ] **Step 3: Commit item template**

```bash
git add tools/publish/lib/templates/item.js tools/publish/lib/templates/index.js tools/publish/lib/build.js
git commit -m "Add item template with stat block"
```

### Task 5.3: Create Faction Template

**Files:**
- Create: `tools/publish/lib/templates/faction.js`
- Modify: `tools/publish/lib/templates/index.js`
- Modify: `tools/publish/lib/build.js`

- [ ] **Step 1: Create faction.js**

```javascript
const { escapeHtml, relativePath } = require('../processor');
const { baseShell, cssPath, rootPath, stubBadge, portraitImg } = require('./base');

function factionTemplate(page, processedContent, navFor, config, imageMap, linkMap, allPages) {
  const fm = page.frontmatter;
  const portrait = portraitImg(fm, page.outputPath, imageMap || {});

  const badges = [];
  if (fm.faction_type) badges.push(fm.faction_type);
  if (fm.alignment) badges.push(fm.alignment);

  const badgeHtml = badges.length > 0
    ? `<div class="metadata-badges">${badges.map(b => `<span class="metadata-badge">${escapeHtml(b)}</span>`).join('\n')}</div>`
    : '';

  // Goals list
  const goals = fm.goals && Array.isArray(fm.goals)
    ? `<div class="goals"><h3>Goals</h3><ul>${fm.goals.map(g => `<li>${escapeHtml(g)}</li>`).join('')}</ul></div>`
    : '';

  // Leadership link
  let leadershipHtml = '';
  if (fm.leadership) {
    const leaderName = String(fm.leadership).replace(/\[\[|\]\]/g, '').trim();
    const leaderPath = linkMap?.[leaderName];
    const currentDir = page.outputPath.substring(0, page.outputPath.lastIndexOf('/'));
    if (leaderPath) {
      const href = relativePath(currentDir, leaderPath);
      leadershipHtml = `<p><strong>Leadership:</strong> <a href="${href}">${escapeHtml(leaderName)}</a></p>`;
    } else {
      leadershipHtml = `<p><strong>Leadership:</strong> ${escapeHtml(leaderName)}</p>`;
    }
  }

  // Territory link
  let territoryHtml = '';
  if (fm.territory) {
    const territoryName = String(fm.territory).replace(/\[\[|\]\]/g, '').trim();
    const territoryPath = linkMap?.[territoryName];
    const currentDir = page.outputPath.substring(0, page.outputPath.lastIndexOf('/'));
    if (territoryPath) {
      const href = relativePath(currentDir, territoryPath);
      territoryHtml = `<p><strong>Territory:</strong> <a href="${href}">${escapeHtml(territoryName)}</a></p>`;
    } else {
      territoryHtml = `<p><strong>Territory:</strong> ${escapeHtml(territoryName)}</p>`;
    }
  }

  // Member rollup: find entities with member_of or assigned_to pointing to this faction
  const factionTitle = page.title;
  const members = (allPages || []).filter(p => {
    const rels = p.frontmatter.relationships;
    if (!rels || !Array.isArray(rels)) return false;
    return rels.some(r => {
      const target = String(r.target || '').replace(/\[\[|\]\]/g, '').trim();
      return target === factionTitle && (r.type === 'member_of' || r.type === 'assigned_to');
    });
  });

  let membersHtml = '';
  if (members.length > 0) {
    const currentDir = page.outputPath.substring(0, page.outputPath.lastIndexOf('/'));
    const memberLinks = members.map(m => {
      const href = relativePath(currentDir, m.outputPath);
      return `<li><a href="${href}">${escapeHtml(m.title)}</a></li>`;
    }).join('\n');
    membersHtml = `<div class="members"><h3>Members</h3><ul>${memberLinks}</ul></div>`;
  }

  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.title)}${stubBadge(fm)}</h1>
</div>`;

  const content = `${headerCard}\n${badgeHtml}\n${leadershipHtml}\n${territoryHtml}\n${goals}\n${membersHtml}\n${processedContent.html}\n${processedContent.relationships}`;

  return baseShell({
    title: page.title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath),
    rootHref: rootPath(page.outputPath),
    content,
    footer: config.footer,
  });
}

module.exports = { factionTemplate };
```

- [ ] **Step 2: Update build.js to pass allPages to faction template**

```javascript
case 'faction':
case 'organization':
  html = factionTemplate(page, processed, navFor, config, imageMap, linkMap, pages);
  break;
```

- [ ] **Step 3: Add CSS for members section**

Append to `tools/publish/css/style.css`:

```css
/* ===== FACTION MEMBERS ===== */
.members, .goals {
  margin-bottom: 1rem;
}
.members h3, .goals h3 {
  margin-top: 0;
  margin-bottom: 0.5rem;
}
.members ul, .goals ul {
  margin: 0;
}
```

- [ ] **Step 4: Commit faction template**

```bash
git add tools/publish/lib/templates/faction.js tools/publish/lib/templates/index.js tools/publish/lib/build.js tools/publish/css/style.css
git commit -m "Add faction template with member rollup"
```

### Task 5.4: Add Fixtures for New Templates

**Files:**
- Create: `tools/publish/test/fixtures/with-creature/`
- Create: `tools/publish/test/fixtures/with-item/`
- Create: `tools/publish/test/fixtures/with-faction/`

- [ ] **Step 1: Create with-creature fixture**

```bash
mkdir -p "tools/publish/test/fixtures/with-creature/Creatures"
mkdir -p "tools/publish/test/fixtures/with-creature/_meta"
cat > "tools/publish/test/fixtures/with-creature/Creatures/Test Creature.md" << 'EOF'
---
type: creature
creature_type: Undead
hp: 15
dr: 2
speed: 6
abilities:
  - Night Vision
  - Claws (1d+2 cut)
weaknesses:
  - Vulnerable to fire
  - Cannot cross running water
---

# Test Creature

A scary test creature.
EOF
echo "# Entity Types" > "tools/publish/test/fixtures/with-creature/_meta/entity-types.md"
```

- [ ] **Step 2: Create with-item fixture**

```bash
mkdir -p "tools/publish/test/fixtures/with-item/Items & Artifacts"
mkdir -p "tools/publish/test/fixtures/with-item/_meta"
cat > "tools/publish/test/fixtures/with-item/Items & Artifacts/Test Sword.md" << 'EOF'
---
type: item
item_type: Weapon
damage: 2d+1 cut
weight: 3 lbs
cost: $500
tl: 3
current_holder: "[[Test Hero]]"
---

# Test Sword

A legendary blade.

## History

Found in an ancient tomb.
EOF
echo "# Entity Types" > "tools/publish/test/fixtures/with-item/_meta/entity-types.md"
```

- [ ] **Step 3: Create with-faction fixture**

```bash
mkdir -p "tools/publish/test/fixtures/with-faction/Factions & Organizations"
mkdir -p "tools/publish/test/fixtures/with-faction/Characters/NPCs"
mkdir -p "tools/publish/test/fixtures/with-faction/_meta"

cat > "tools/publish/test/fixtures/with-faction/Factions & Organizations/Test Guild.md" << 'EOF'
---
type: faction
faction_type: Guild
leadership: "[[Guild Master]]"
goals:
  - Control the trade routes
  - Expand influence
---

# Test Guild

A powerful merchant guild.
EOF

cat > "tools/publish/test/fixtures/with-faction/Characters/NPCs/Guild Master.md" << 'EOF'
---
type: npc
occupation: Guild Leader
relationships:
  - target: "[[Test Guild]]"
    type: member_of
---

# Guild Master

Leader of the guild.
EOF

cat > "tools/publish/test/fixtures/with-faction/Characters/NPCs/Guild Member.md" << 'EOF'
---
type: npc
occupation: Merchant
relationships:
  - target: "[[Test Guild]]"
    type: member_of
---

# Guild Member

A member of the guild.
EOF

echo "# Entity Types" > "tools/publish/test/fixtures/with-faction/_meta/entity-types.md"
```

- [ ] **Step 4: Add integration tests for new templates**

Add to `tools/publish/test/integration/build.test.js`:

```javascript
describe('creature fixture', () => {
  // Similar pattern to minimal fixture
  // Verify stat-block renders, abilities list renders
});

describe('item fixture', () => {
  // Verify stat-block renders, current_holder link renders
});

describe('faction fixture', () => {
  // Verify goals render, member rollup includes both NPCs
});
```

- [ ] **Step 5: Commit fixtures**

```bash
git add tools/publish/test/fixtures/with-creature tools/publish/test/fixtures/with-item tools/publish/test/fixtures/with-faction
git commit -m "Add fixtures for creature, item, faction templates"
```

---

## Phase 6: CLI, Skill, and Documentation

### Task 6.1: Create CLI Entry Point

**Files:**
- Create: `tools/publish/bin/gm-publish.js`

- [ ] **Step 1: Create bin/gm-publish.js**

```javascript
#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
gm-apprentice-publish - Static site generator for gm-apprentice campaign vaults

Usage:
  gm-apprentice-publish init [target-dir]    Scaffold a new site
  gm-apprentice-publish build [options]      Build the site
  gm-apprentice-publish --version            Show version
  gm-apprentice-publish --help               Show this help

Build options:
  --config <path>    Path to vault.config.json (default: ./vault.config.json)
`);
}

function printVersion() {
  const pkg = require('../package.json');
  console.log(pkg.version);
}

if (command === '--help' || command === '-h' || !command) {
  printHelp();
  process.exit(0);
}

if (command === '--version' || command === '-v') {
  printVersion();
  process.exit(0);
}

if (command === 'init') {
  const targetDir = args[1] || '.';
  const { init } = require('../lib/init');
  init(targetDir);
  process.exit(0);
}

if (command === 'build') {
  let configPath = './vault.config.json';
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      configPath = args[i + 1];
      break;
    }
  }
  
  if (!fs.existsSync(configPath)) {
    console.error(`Error: Config file not found: ${configPath}`);
    process.exit(1);
  }
  
  const { build } = require('../lib/build');
  try {
    build({ configPath });
  } catch (err) {
    console.error(`Build failed: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
printHelp();
process.exit(1);
```

- [ ] **Step 2: Make executable**

```bash
chmod +x tools/publish/bin/gm-publish.js
```

- [ ] **Step 3: Test CLI**

```bash
cd tools/publish
node bin/gm-publish.js --help
node bin/gm-publish.js --version
```

Expected: Help text and version number printed.

- [ ] **Step 4: Commit CLI**

```bash
git add tools/publish/bin/
git commit -m "Add CLI entry point"
```

### Task 6.2: Create Init Command

**Files:**
- Create: `tools/publish/lib/init.js`
- Create: `tools/publish/templates-scaffold/`

- [ ] **Step 1: Create scaffold templates**

Create `tools/publish/templates-scaffold/vault.config.json.tmpl`:

```json
{
  "vaultPath": "{{VAULT_PATH}}",
  "outputDir": "./docs",
  "attachmentsDir": "_attachments",
  "siteTitle": "{{SITE_TITLE}}",
  "siteUrl": "{{SITE_URL}}",
  "landingTagline": "{{TAGLINE}}",
  "landingParams": "",
  "footer": "",
  "excludeDirs": ["_meta", "_Templates", "_resources", ".obsidian", ".smart-env", "node_modules"],
  "excludeSections": ["Player Notes", "Source References"],
  "folderMap": {
    "_Campaign": "campaign",
    "Characters/PCs": "characters/pcs",
    "Characters/NPCs": "characters/npcs",
    "Factions & Organizations": "factions",
    "Events": "events",
    "Locations": "locations",
    "Items & Artifacts": "items",
    "Creatures": "creatures",
    "Documents": "documents",
    "Clues": "clues",
    "Chapters": "chapters"
  }
}
```

Create `tools/publish/templates-scaffold/package.json.tmpl`:

```json
{
  "name": "{{SITE_NAME}}",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "gm-apprentice-publish build"
  },
  "dependencies": {
    "gm-apprentice-publish": "^0.1.0"
  }
}
```

Create `tools/publish/templates-scaffold/.gitignore`:

```
node_modules/
.DS_Store
```

Create `tools/publish/templates-scaffold/README.md.tmpl`:

```markdown
# {{SITE_TITLE}}

Campaign site generated with [gm-apprentice-publish](https://github.com/AntTheLimey/gm-apprentice).

## Build

```bash
npm install
npm run build
```

Output goes to `docs/` for GitHub Pages.
```

Create `tools/publish/templates-scaffold/css/overrides.css`:

```css
/* Custom CSS overrides for your site */
/* Add your styles here to customize the default theme */
```

- [ ] **Step 2: Create lib/init.js**

```javascript
const fs = require('fs');
const path = require('path');

function init(targetDir) {
  const resolved = path.resolve(targetDir);
  
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
  
  const scaffoldDir = path.join(__dirname, '..', 'templates-scaffold');
  
  // Copy static files
  const staticFiles = ['.gitignore', 'css/overrides.css'];
  for (const file of staticFiles) {
    const src = path.join(scaffoldDir, file);
    const dest = path.join(resolved, file);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      console.log(`  created ${file}`);
    }
  }
  
  // Copy template files with placeholders
  const templates = [
    { src: 'vault.config.json.tmpl', dest: 'vault.config.json' },
    { src: 'package.json.tmpl', dest: 'package.json' },
    { src: 'README.md.tmpl', dest: 'README.md' },
  ];
  
  for (const { src, dest } of templates) {
    const srcPath = path.join(scaffoldDir, src);
    const destPath = path.join(resolved, dest);
    if (fs.existsSync(srcPath)) {
      let content = fs.readFileSync(srcPath, 'utf-8');
      // Replace placeholders with defaults (user will edit)
      content = content
        .replace(/\{\{VAULT_PATH\}\}/g, '/path/to/your/vault')
        .replace(/\{\{SITE_TITLE\}\}/g, 'My Campaign')
        .replace(/\{\{SITE_URL\}\}/g, 'https://username.github.io/my-campaign')
        .replace(/\{\{SITE_NAME\}\}/g, 'my-campaign-site')
        .replace(/\{\{TAGLINE\}\}/g, 'Welcome to the campaign.');
      fs.writeFileSync(destPath, content);
      console.log(`  created ${dest}`);
    }
  }
  
  // Create .nojekyll
  fs.writeFileSync(path.join(resolved, '.nojekyll'), '');
  console.log('  created .nojekyll');
  
  console.log(`\nScaffold complete in ${resolved}`);
  console.log('\nNext steps:');
  console.log('  1. Edit vault.config.json with your vault path and site details');
  console.log('  2. npm install');
  console.log('  3. npm run build');
}

module.exports = { init };
```

- [ ] **Step 3: Test init command**

```bash
cd tools/publish
node bin/gm-publish.js init /tmp/test-site
ls -la /tmp/test-site
cat /tmp/test-site/vault.config.json
rm -rf /tmp/test-site
```

- [ ] **Step 4: Commit init command**

```bash
git add tools/publish/lib/init.js tools/publish/templates-scaffold/
git commit -m "Add init command with scaffold templates"
```

### Task 6.3: Create publish-site Skill

**Files:**
- Create: `skills/publish-site/SKILL.md`
- Create: `skills/publish-site/references/setup-wizard.md`
- Create: `skills/publish-site/references/troubleshooting.md`
- Create: `skills/publish-site/references/github-pages.md`
- Create: `skills/publish-site/references/schema-reference.md`

- [ ] **Step 1: Create SKILL.md**

```markdown
---
name: publish-site
description: Publish a gm-apprentice campaign vault as a static GitHub Pages site
triggers:
  - publish my campaign
  - set up a site for my vault
  - create a campaign website
  - update my site
  - rebuild the site
  - site not working
  - build error
---

# publish-site

Orchestrates the `gm-apprentice-publish` npm package to convert campaign vaults into static GitHub Pages sites.

## Capabilities

1. **First-time setup** — scaffold a new site repo, configure, initial build
2. **Routine updates** — rebuild and push changes
3. **Troubleshooting** — diagnose build errors, missing images, broken links
4. **Schema migrations** — update folder mappings when campaign-organizer adds entity types
5. **Multi-site management** — update multiple campaign sites at once

## Copyright Notice

The generated site publishes campaign content publicly. Before building:
- Verify the vault contains only original content or properly licensed material
- Check `gm-apprentice/ATTRIBUTION.md` for license requirements
- Do not publish verbatim rule text from copyrighted game systems

## References

- `setup-wizard.md` — first-time setup flow
- `troubleshooting.md` — common issues and fixes
- `github-pages.md` — manual GitHub Pages enablement
- `schema-reference.md` — frontmatter fields per entity type
```

- [ ] **Step 2: Create references/setup-wizard.md**

```markdown
# First-Time Setup Flow

## Prerequisites

- Node.js 22+
- A gm-apprentice campaign vault (has `_meta/entity-types.md`)
- GitHub account (for hosting)

## Flow

### 1. Gather Information

Ask the user for:
- **Vault path**: Full path to their Obsidian vault
- **Site title**: Display name for the site
- **GitHub username**: For the URL
- **Repository name**: e.g., `my-campaign`
- **Tagline**: Short hook for the landing page

### 2. Scaffold the Site

Run in a new directory:

```bash
npx gm-apprentice-publish init my-campaign-site
cd my-campaign-site
```

### 3. Configure

Edit `vault.config.json`:
- Set `vaultPath` to the vault's full path
- Set `siteTitle` to the campaign name
- Set `siteUrl` to `https://<username>.github.io/<repo-name>`
- Set `landingTagline` to the tagline

### 4. Install and Build

```bash
npm install
npm run build
```

Verify `docs/` contains the generated site.

### 5. Initialize Git

```bash
git init
git add .
git commit -m "Initial site scaffold"
```

### 6. Create GitHub Repository

If `gh` CLI is available and authenticated:

```bash
gh repo create <repo-name> --public --source=. --push
```

Otherwise, create manually on GitHub.com and push:

```bash
git remote add origin https://github.com/<username>/<repo-name>.git
git push -u origin main
```

### 7. Enable GitHub Pages

See `github-pages.md` for manual steps.
```

- [ ] **Step 3: Create remaining reference files**

Create `references/troubleshooting.md`, `references/github-pages.md`, `references/schema-reference.md` with appropriate content.

- [ ] **Step 4: Validate skill with skill-creator**

```bash
# Invoke skill-creator validation
```

- [ ] **Step 5: Commit skill**

```bash
git add skills/publish-site/
git commit -m "Add publish-site skill for campaign site generation"
```

### Task 6.4: Create Package Documentation

**Files:**
- Create: `tools/publish/README.md`
- Create: `docs/publish-tool.md`
- Modify: `README.md` (root)

- [ ] **Step 1: Create tools/publish/README.md**

```markdown
# gm-apprentice-publish

Static site generator for [gm-apprentice](https://github.com/AntTheLimey/gm-apprentice) campaign vaults.

Converts Obsidian-compatible markdown vaults into mobile-friendly GitHub Pages sites with character sheets, NPC pages, locations, factions, and more.

## Install

```bash
npm install gm-apprentice-publish
```

Or use directly with npx:

```bash
npx gm-apprentice-publish init my-site
```

## Quick Start

1. **Scaffold a new site:**
   ```bash
   npx gm-apprentice-publish init my-campaign-site
   cd my-campaign-site
   ```

2. **Configure:** Edit `vault.config.json` with your vault path and site details.

3. **Build:**
   ```bash
   npm install
   npm run build
   ```

4. **Deploy:** Push `docs/` to GitHub Pages.

## CLI

```bash
gm-apprentice-publish init [target-dir]     # Scaffold new site
gm-apprentice-publish build [--config path] # Build site
gm-apprentice-publish --version             # Show version
gm-apprentice-publish --help                # Show help
```

## Configuration

See `vault.config.json` for all options.

## License

MIT
```

- [ ] **Step 2: Create docs/publish-tool.md**

High-level overview for gm-apprentice users.

- [ ] **Step 3: Update root README.md**

Add publish-site to the skills table and mention tools/publish/ in the structure section.

- [ ] **Step 4: Commit documentation**

```bash
git add tools/publish/README.md docs/publish-tool.md README.md
git commit -m "Add publish tool documentation"
```

### Task 6.5: Update ROADMAP.md

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Mark completed items**

Strike through completed publish-tool items in ROADMAP.md and move to Completed section.

- [ ] **Step 2: Commit**

```bash
git add ROADMAP.md
git commit -m "Update ROADMAP with completed publish tool work"
```

---

## Final Milestone Commit

- [ ] **Step 1: Run full test suite**

```bash
cd tools/publish && npm test
```

- [ ] **Step 2: Tag v0.1.0**

```bash
git tag publish-v0.1.0
git push origin publish-v0.1.0
```

This triggers the release workflow to publish to npm.

---

## Summary

**Total tasks:** 19
**Estimated time:** 20-25 hours across 6 phases

Each phase ends in a committable milestone. Pause cleanly between any two phases.
