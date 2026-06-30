const fs = require('fs');
const path = require('path');
const { scanVault, buildLinkMap, scanAttachments, pairStoryFiles } = require('./scanner');
const { processContent, extractSections, filterSections, stripDataview, stripGmOnly, filterFields, resolveImageEmbeds, resolveWikiLinks, relativeHref, escapeHtml } = require('./processor');
const { generateNav, pcTemplate, npcTemplate, creatureTemplate, locationTemplate, itemTemplate, factionTemplate, eventTemplate, heritageTemplate, worldDomainTemplate, wikiTemplate, indexTemplate, landingTemplate, fourOhFourTemplate, DIR_LABELS, getRenderer } = require('./templates/index');
const { loadPublishConfig } = require('./config');
const { loadManifest } = require('./manifest');
const { generateThemeCSS, resolveGenrePreset } = require('./theme');
const { buildStorySpine, unitRefs } = require('./story-spine');
const { storyPage: renderStoryUnit } = require('./templates/story');

const AUTO_EXCLUDE_STATUS = new Set(['planned', 'prepped']);
const AUTO_EXCLUDE_STAGE = new Set(['outline', 'draft', 'ready']);
const AUTO_EXCLUDE_SOURCE = new Set(['prep']);

function build(options = {}) {
  const configPath = options.configPath || './vault.config.json';
  const resolvedConfigPath = path.resolve(configPath);
  const configDir = path.dirname(resolvedConfigPath);
  const config = require(resolvedConfigPath);
  config.vaultPath = path.resolve(configDir, config.vaultPath);
  const outputDir = path.resolve(configDir, config.outputDir);

  const publishConfig = loadPublishConfig(config.vaultPath, config);
  const genrePreset = resolveGenrePreset(publishConfig.theme.genre);
  publishConfig._genrePreset = genrePreset;
  const manifest = loadManifest(config.vaultPath);
  const excludeSections = publishConfig.exclude_sections;
  const excludeFields = publishConfig.exclude_fields;
  const fieldOverrides = publishConfig.overrides.fields || {};

  function assertSafeOutputDir() {
    const resolved = path.resolve(outputDir);
    const root = path.parse(resolved).root;
    if (resolved === root) {
      throw new Error(`Refusing to clean filesystem root: ${resolved}`);
    }
    const resolvedVault = path.resolve(config.vaultPath);
    if (resolved === resolvedVault || resolvedVault.startsWith(resolved + path.sep)) {
      throw new Error(`Refusing to clean outputDir that contains the vault: ${resolved}`);
    }
    if (resolved.startsWith(resolvedVault + path.sep)) {
      throw new Error(`Refusing to write outputDir inside the vault: ${resolved}`);
    }
  }

  function cleanOutput() {
    if (!fs.existsSync(outputDir)) return;
    assertSafeOutputDir();
    const preserve = Array.isArray(config.preserveDirs) ? config.preserveDirs : [];
    for (const entry of fs.readdirSync(outputDir)) {
      if (preserve.includes(entry)) continue;
      const full = path.join(outputDir, entry);
      fs.rmSync(full, { recursive: true, force: true });
    }
  }

  function ensureDir(filePath) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
  }

  function copyCSS() {
    const src = path.join(__dirname, '../css/style.css');
    const dest = path.join(outputDir, 'css/style.css');
    ensureDir(dest);
    fs.copyFileSync(src, dest);
  }

  function copyGenreCSS() {
    if (!genrePreset) return;
    const src = path.join(__dirname, `../css/themes/${genrePreset}.css`);
    const dest = path.join(outputDir, `css/themes/${genrePreset}.css`);
    ensureDir(dest);
    fs.copyFileSync(src, dest);
    console.log(`  wrote css/themes/${genrePreset}.css`);
  }

  function copyJS() {
    const jsDir = path.join(__dirname, '../js');
    if (!fs.existsSync(jsDir)) return;
    const destDir = path.join(outputDir, 'js');
    for (const file of fs.readdirSync(jsDir)) {
      if (!file.endsWith('.js')) continue;
      const src = path.join(jsDir, file);
      const dest = path.join(destDir, file);
      ensureDir(dest);
      fs.copyFileSync(src, dest);
      console.log(`  wrote js/${file}`);
    }
  }

  function writeThemeCSS() {
    const css = generateThemeCSS(publishConfig.theme);
    const dest = path.join(outputDir, 'css/theme.css');
    ensureDir(dest);
    fs.writeFileSync(dest, css);
    console.log('  wrote css/theme.css');
  }

  function writeNoJekyll() {
    fs.writeFileSync(path.join(outputDir, '.nojekyll'), '');
  }

  function write404() {
    const html = fourOhFourTemplate({
      siteTitle: config.siteTitle,
      siteUrl: config.siteUrl,
      four_oh_four: publishConfig.four_oh_four,
      theme: publishConfig.theme,
      genrePreset: publishConfig._genrePreset,
    });
    fs.writeFileSync(path.join(outputDir, '404.html'), html);
    console.log('  wrote 404.html');
  }

  function copyImages(imageMap) {
    for (const entry of Object.values(imageMap)) {
      const dest = path.join(outputDir, 'images', entry.relPath);
      ensureDir(dest);
      fs.copyFileSync(entry.sourcePath, dest);
    }
    console.log(`Copied ${Object.keys(imageMap).length} images`);
  }

  // Main build logic
  assertSafeOutputDir();
  console.log('Scanning vault:', config.vaultPath);
  let pages = scanVault(config);
  console.log(`Found ${pages.length} pages`);
  // Capture the scanned pages before the manifest/draft filters reassign `pages` to the published
  // subset, so templates can reach context that is excluded from rendering — above all the
  // `_Campaign` overview, which is normally unpublished. This preserves page *membership* only:
  // the page objects are shared, so any later field-level frontmatter filtering on published pages
  // is visible here too. Use corpus to reach excluded *pages* (e.g. the overview), not to recover
  // fields stripped from a *published* page.
  const corpus = pages.slice();
  pairStoryFiles(pages, config.vaultPath);

  // Exclude DRAFT entities when configured (after pairing so story files resolve)
  if (publishConfig.exclude_drafts) {
    const { getConfidence } = require('./templates/base');
    const before = pages.length;
    pages = pages.filter(p => getConfidence(p.frontmatter) !== 'DRAFT');
    const excluded = before - pages.length;
    if (excluded > 0) console.log(`Excluded ${excluded} DRAFT entity/entities`);
  }

  // Auto-exclude prep/draft files based on frontmatter (player mode only)
  function isAutoExcluded(fm) {
    const status = String(fm.status || '').toLowerCase();
    const stage = String(fm.stage || '').toLowerCase();
    const source = String(fm.source || '').toLowerCase();
    return AUTO_EXCLUDE_STATUS.has(status)
      || AUTO_EXCLUDE_STAGE.has(stage)
      || AUTO_EXCLUDE_SOURCE.has(source);
  }

  const autoExcludedPages = [];
  if (publishConfig.mode !== 'full') {
    const keptPages = [];
    for (const page of pages) {
      if (isAutoExcluded(page.frontmatter)) {
        autoExcludedPages.push(page);
      } else {
        keptPages.push(page);
      }
    }
    pages = keptPages;
    if (autoExcludedPages.length > 0) {
      console.log(`Auto-excluded ${autoExcludedPages.length} prep/draft file(s)`);
    }

    // If manifest explicitly lists an auto-excluded file, re-add it
    if (manifest) {
      const allowSet = new Set(manifest.publishing);
      const reincluded = autoExcludedPages.filter(page => {
        const vaultRelPath = path.relative(config.vaultPath, page.sourcePath).split(path.sep).join('/');
        return allowSet.has(vaultRelPath);
      });
      if (reincluded.length > 0) {
        pages = pages.concat(reincluded);
        console.log(`Manifest override: re-included ${reincluded.length} auto-excluded file(s)`);
      }
    }
  }

  // Filter pages by manifest if present
  if (manifest && publishConfig.mode === 'player') {
    const allowSet = new Set(manifest.publishing);
    const beforeCount = pages.length;
    pages = pages.filter(page => {
      const vaultRelPath = path.relative(config.vaultPath, page.sourcePath);
      const posixPath = vaultRelPath.split(path.sep).join('/');
      return allowSet.has(posixPath);
    });
    console.log(`Manifest filter: ${beforeCount} → ${pages.length} pages`);
  }

  const linkMap = buildLinkMap(pages);
  console.log(`Built link map with ${Object.keys(linkMap).length} entries`);

  const { buildBacklinks } = require('./backlinks');
  const { buildSearchIndex } = require('./search-index');
  const { scoreByRecency } = require('./recency');

  // Compute each page's "published view" — markdown with gm-only blocks and excluded
  // sections removed — once, so derived widgets (backlinks, recency, the relationship
  // graph) never surface names that only appear in unpublished content (B6 spoiler leak).
  for (const page of pages) {
    const stripped = stripGmOnly(page.markdown || '');
    const text = typeof stripped === 'string' ? stripped : stripped.text;
    page.publishedMarkdown = filterSections(text, excludeSections);
  }

  // Build-time data pipeline
  const backlinks = buildBacklinks(pages);
  console.log(`Built backlinks for ${Object.keys(backlinks).length} entities`);

  const sessions = pages.filter(p => p.frontmatter.type === 'session');
  const chapters = pages.filter(p => p.frontmatter.type === 'chapter');
  const npcs = pages.filter(p => p.frontmatter.type === 'npc');
  const locations = pages.filter(p => p.frontmatter.type === 'location');
  const wrapUps = pages.filter(p => ['session-wrap-up', 'session_wrap', 'session-wrapup'].includes(p.frontmatter.type));

  const landingConfig = (publishConfig.landing || {});
  const recencyWindow = landingConfig.recency_window || 3;

  const recentNPCs = scoreByRecency(npcs, sessions, chapters, {
    window: recencyWindow,
    max: landingConfig.max_npcs || 6,
    type: 'npc',
    wrapUps,
  });

  const recentLocations = scoreByRecency(locations, sessions, chapters, {
    window: recencyWindow,
    max: landingConfig.max_locations || 4,
    type: 'location',
    wrapUps,
  });

  console.log(`Recency: ${recentNPCs.length} NPCs, ${recentLocations.length} locations`);

  // Search index (skip if searchEnabled explicitly set to false in config)
  const searchEnabled = config.searchEnabled !== false;
  const searchData = searchEnabled ? buildSearchIndex(pages) : null;

  publishConfig._linkMap = linkMap;
  publishConfig._backlinks = backlinks;
  publishConfig._recentNPCs = recentNPCs;
  publishConfig._recentLocations = recentLocations;

  const { buildRelationshipGraph, renderRelationshipSVG } = require('./relationship-graph');

  const entityGraphData = {};
  const entityGraphs = {};
  for (const page of pages) {
    const graph = buildRelationshipGraph(page.title, pages, backlinks);
    if (graph.nodes.length > 1) {
      entityGraphData[page.title] = graph;
      entityGraphs[page.title] = renderRelationshipSVG(graph, { currentOutputPath: page.outputPath });
    }
  }
  console.log(`Generated ${Object.keys(entityGraphs).length} relationship graphs`);
  publishConfig._entityGraphs = entityGraphs;

  // Apply field filtering after link map is built (aliases/canon_status needed for resolution)
  for (const page of pages) {
    const vaultRelPath = path.relative(config.vaultPath, page.sourcePath).split(path.sep).join('/');
    const overridesForFile = fieldOverrides[vaultRelPath] || {};
    page.frontmatter = filterFields(page.frontmatter, excludeFields, overridesForFile);
  }

  const imageMap = scanAttachments(config);
  console.log(`Found ${Object.keys(imageMap).length} image files`);

  cleanOutput();
  copyCSS();
  copyJS();
  copyGenreCSS();
  writeThemeCSS();

  let campaignImageCopied = false;
  // Resolve campaign_image: copy from vault to output and rewrite to output-relative path
  if (publishConfig.theme.campaign_image) {
    const imgVal = publishConfig.theme.campaign_image;
    if (!imgVal.startsWith('http://') && !imgVal.startsWith('https://')) {
      const vaultRoot = path.resolve(config.vaultPath);
      const vaultImgPath = path.resolve(vaultRoot, imgVal);
      if (!vaultImgPath.startsWith(vaultRoot + path.sep)) {
        throw new Error(`Refusing to copy campaign_image outside vault: ${imgVal}`);
      }
      if (fs.existsSync(vaultImgPath)) {
        const basename = path.basename(imgVal);
        const dest = path.join(outputDir, 'images', basename);
        ensureDir(dest);
        fs.copyFileSync(vaultImgPath, dest);
        publishConfig.theme.campaign_image = 'images/' + basename;
        console.log(`  copied campaign image → images/${basename}`);
        campaignImageCopied = true;
      }
    }
  }

  writeNoJekyll();

  // Write search index (only if search is enabled)
  if (searchData) {
    const searchDest = path.join(outputDir, 'search-index.json');
    fs.writeFileSync(searchDest, JSON.stringify(searchData));
    console.log('  wrote search-index.json');

    // Copy lunr.js client library
    const lunrSrc = require.resolve('lunr');
    const lunrDest = path.join(outputDir, 'js', 'lunr.js');
    ensureDir(lunrDest);
    fs.copyFileSync(lunrSrc, lunrDest);
    console.log('  wrote js/lunr.js');
  } else {
    console.log('  search disabled — skipping search-index.json');
  }

  write404();

  const navFor = generateNav(pages);

  // Render each page
  const usedImages = new Set();
  let errorCount = 0;
  for (const page of pages) {
    try {
      if (page.frontmatter.type === 'world_flags') continue;
      if (page.frontmatter.portrait) {
        const basename = String(page.frontmatter.portrait).split('/').pop();
        if (basename && imageMap[basename]) usedImages.add(basename);
      }
      const processed = processContent(page, linkMap, excludeSections, imageMap, { usedImages });
      let html;

      switch (page.frontmatter.type) {
        case 'pc': {
          let filtered = stripDataview(page.markdown.replace(/\r/g, ''));
          const gmResult = stripGmOnly(filtered);
          filtered = typeof gmResult === 'string' ? gmResult : gmResult.text;
          filtered = filterSections(filtered, excludeSections);
          filtered = resolveWikiLinks(filtered, linkMap, page.outputPath);
          filtered = resolveImageEmbeds(filtered, imageMap, page.outputPath, usedImages);
          const sections = extractSections(filtered);

          let storyHtml;
          if (page.storyMarkdown) {
            const storyPage = {
              markdown: page.storyMarkdown,
              frontmatter: {},
              outputPath: page.outputPath,
            };
            const storyProcessed = processContent(storyPage, linkMap, excludeSections, imageMap, { usedImages });
            storyHtml = storyProcessed.html && storyProcessed.html.trim() ? storyProcessed.html : undefined;
          }

          const system = publishConfig.system;
          const systemRenderer = getRenderer(system);
          const rendered = systemRenderer ? systemRenderer(page.frontmatter, sections) : null;
          const systemOut = (rendered && typeof rendered === 'object')
            ? rendered
            : { sheetHtml: rendered || null };
          html = pcTemplate(page, processed, sections, navFor, config, imageMap, storyHtml, {
            publishConfig,
            pages,
            systemSheetHtml: systemOut.sheetHtml || null,
            systemCombatHtml: systemOut.combatHtml || null,
            systemEquipmentHtml: systemOut.equipmentHtml || null,
          });
          break;
        }
        case 'npc':
          html = npcTemplate(page, processed, navFor, config, imageMap, {
            pages, linkMap, publishConfig,
          });
          break;
        case 'creature':
          html = creatureTemplate(page, processed, navFor, config, imageMap, { publishConfig, linkMap });
          break;
        case 'location':
          html = locationTemplate(page, processed, navFor, config, imageMap, {
            pages, linkMap, publishConfig,
          });
          break;
        case 'item':
          html = itemTemplate(page, processed, navFor, config, imageMap, linkMap, { publishConfig });
          break;
        case 'faction':
        case 'organization':
          html = factionTemplate(page, processed, navFor, config, imageMap, linkMap, pages, { publishConfig });
          break;
        case 'event':
          html = eventTemplate(page, processed, navFor, config, imageMap, linkMap, { publishConfig });
          break;
        case 'heritage':
          html = heritageTemplate(page, processed, navFor, config, imageMap, { publishConfig, linkMap });
          break;
        case 'world_domain':
          html = worldDomainTemplate(page, processed, navFor, config, { publishConfig });
          break;
        default: {
          let extraSidebar = {};
          if (page.frontmatter.type === 'session') {
            const sessionMentionedNPCs = (pages || []).filter(p =>
              p.frontmatter.type === 'npc' &&
              ((publishConfig._backlinks || {})[p.title] || []).some(b => b.title === page.title)
            ).map(p => ({ displayTitle: p.displayTitle, outputPath: p.outputPath, type: 'npc' }));

            const sessionEvents = (pages || []).filter(p =>
              p.frontmatter.type === 'event' &&
              ((publishConfig._backlinks || {})[p.title] || []).some(b => b.title === page.title)
            ).map(p => ({ displayTitle: p.displayTitle, outputPath: p.outputPath }));

            extraSidebar = { mentionedNPCs: sessionMentionedNPCs, events: sessionEvents };
          }
          if (page.frontmatter.type === 'chapter') {
            const chapterTitle = String(page.frontmatter.title || page.displayTitle || '');
            const chapterTitleNorm = chapterTitle.toLowerCase();
            const chapterFilename = page.title.replace(/_/g, ' ');
            const chapterSessions = (pages || []).filter(p => {
              if (p.frontmatter.type !== 'session') return false;
              const chapterRef = String(p.frontmatter.chapter || '').replace(/\[\[|\]\]/g, '').trim();
              if (!chapterRef) return false;
              // 1. Exact match against page filename stem (e.g. "Chapter_1_Overview")
              if (chapterRef === page.title) return true;
              // 2. Match against filename stem with underscores as spaces (e.g. "Chapter 1 Overview")
              if (chapterRef === chapterFilename) return true;
              // 3. Case-insensitive substring: chapter's display title appears in the session's chapter ref
              //    (e.g. "London" in "Chapter 1 — London: The Orphean Society")
              if (chapterTitleNorm && chapterRef.toLowerCase().includes(chapterTitleNorm)) return true;
              return false;
            }).map(p => ({ displayTitle: p.displayTitle, outputPath: p.outputPath, type: 'session' }));

            extraSidebar = { constituentSessions: chapterSessions };
          }
          html = wikiTemplate(page, processed, navFor, config, imageMap, { publishConfig, linkMap, extraSidebar, pages });
          break;
        }
      }

      const outPath = path.join(outputDir, page.outputPath);
      ensureDir(outPath);
      fs.writeFileSync(outPath, html);
      console.log(`  wrote ${page.outputPath}`);
    } catch (e) {
      errorCount++;
      console.error(`  ERROR rendering ${page.outputPath}: ${e.message}`);
    }
  }

  // Copy images — in player mode, only copy images referenced by published pages
  if (manifest && publishConfig.mode === 'player') {
    const filteredMap = {};
    for (const [basename, entry] of Object.entries(imageMap)) {
      if (usedImages.has(basename)) filteredMap[basename] = entry;
    }
    copyImages(filteredMap);
    const suffix = campaignImageCopied ? ' (+ campaign image)' : '';
    console.log(`Player mode: copied ${Object.keys(filteredMap).length} referenced images${suffix}`);
  } else {
    copyImages(imageMap);
  }

  // Generate index pages for each output directory
  const dirs = {};
  for (const page of pages) {
    const dir = page.outputDir;
    if (!dirs[dir]) dirs[dir] = [];
    dirs[dir].push(page);
  }

  const pcRoster = pages.find(p => p.frontmatter.type === 'pc_roster');
  const pcRedirectTarget = pcRoster ? pcRoster.outputPath : null;

  for (const [dir, label] of Object.entries(DIR_LABELS)) {
    if (dir === 'characters/pcs' && pcRedirectTarget) {
      const depth = dir.split('/').length;
      const rel = '../'.repeat(depth) + pcRedirectTarget;
      const redirectHtml = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${rel}"><link rel="canonical" href="${rel}"></head><body><a href="${rel}">Player Characters</a></body></html>`;
      const outPath = path.join(outputDir, dir, 'index.html');
      ensureDir(outPath);
      fs.writeFileSync(outPath, redirectHtml);
      console.log(`  wrote ${dir}/index.html (redirect → ${pcRedirectTarget})`);
      continue;
    }
    if (dir === 'events') {
      const depth = dir.split('/').length;
      const rel = '../'.repeat(depth) + 'timeline.html';
      const redirectHtml = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${rel}"><link rel="canonical" href="${rel}"></head><body><a href="${rel}">Timeline</a></body></html>`;
      const outPath = path.join(outputDir, dir, 'index.html');
      ensureDir(outPath);
      fs.writeFileSync(outPath, redirectHtml);
      console.log(`  wrote ${dir}/index.html (redirect → timeline.html)`);
      continue;
    }
    let dirPages = [];
    for (const [pageDir, pageDirPages] of Object.entries(dirs)) {
      if (pageDir === dir || pageDir.startsWith(dir + '/')) {
        dirPages = dirPages.concat(pageDirPages);
      }
    }
    const indexHtml = indexTemplate(dir, label, dirPages, navFor, config, publishConfig);
    const outPath = path.join(outputDir, dir, 'index.html');
    ensureDir(outPath);
    fs.writeFileSync(outPath, indexHtml);
    console.log(`  wrote ${dir}/index.html`);
  }

  // Timeline page
  const { buildTimelineData, renderTimelineHTML, renderTimelineStrip } = require('./timeline');
  const { timelineTemplate } = require('./templates/timeline-page');

  const timelineData = buildTimelineData(pages);
  if (timelineData.events.length > 0) {
    const fullTimelineContent = renderTimelineHTML(timelineData);
    const timelineHtml = timelineTemplate(fullTimelineContent, navFor, config, publishConfig);
    const timelinePath = path.join(outputDir, 'timeline.html');
    ensureDir(timelinePath);
    fs.writeFileSync(timelinePath, timelineHtml);
    console.log('  wrote timeline.html');

    publishConfig._timelineStrip = renderTimelineStrip(timelineData, { maxEvents: 15 });
  }

  function renderRefsHtml(unit) {
    const refs = unitRefs(unit);
    const items = [];
    for (const p of refs.participants) {
      const out = linkMap[p.target];
      items.push(out ? `<li><a href="${relativeHref(unit.outputPath, out)}">${escapeHtml(p.label)}</a></li>`
                     : `<li>${escapeHtml(p.label)}</li>`);
    }
    if (refs.location) {
      const out = linkMap[refs.location.target];
      items.push(out ? `<li>Location: <a href="${relativeHref(unit.outputPath, out)}">${escapeHtml(refs.location.label)}</a></li>`
                     : `<li>Location: ${escapeHtml(refs.location.label)}</li>`);
    }
    return items.length ? `<ul>${items.join('')}</ul>` : '';
  }

  function buildStory() {
    const spine = buildStorySpine(pages);
    for (const unit of spine) {
      unit.refsHtml = renderRefsHtml(unit);
      const html = renderStoryUnit(unit, config, publishConfig, navFor);
      const outPath = path.join(outputDir, unit.outputPath);
      ensureDir(outPath);
      fs.writeFileSync(outPath, html);
      console.log(`  wrote ${unit.outputPath}`);
    }
    return spine;
  }

  const storySpine = buildStory();

  // Landing page
  const landingHtml = landingTemplate(pages, navFor, config, publishConfig, imageMap, corpus);
  fs.writeFileSync(path.join(outputDir, 'index.html'), landingHtml);
  console.log('  wrote index.html');

  if (errorCount > 0) {
    console.log(`Done with ${errorCount} error(s).`);
    const err = new Error(`Build completed with ${errorCount} render error(s)`);
    err.errorCount = errorCount;
    throw err;
  }
  console.log('Done!');
}

module.exports = { build };

// Allow running directly: node lib/build.js
if (require.main === module) {
  build();
}
