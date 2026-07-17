const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanVault, buildLinkMap, scanAttachments, pairStoryFiles } = require('./scanner');
const { optimizeImages, resolveImageConfig } = require('./image-optimize');
const { resolveBanner, renderBanner, defaultAlt, isSvg } = require('./banners');
const { processContent, extractSections, filterSections, stripDataview, stripGmOnly, stripSpoiler, stripHtmlComments, filterFields, resolveImageEmbeds, resolveWikiLinks, relativePath, relativeHref, escapeHtml, portraitBasename } = require('./processor');
const { generateNav, pcTemplate, npcTemplate, creatureTemplate, locationTemplate, itemTemplate, factionTemplate, eventTemplate, heritageTemplate, worldDomainTemplate, wikiTemplate, indexTemplate, landingTemplate, fourOhFourTemplate, DIR_LABELS, getRenderer } = require('./templates/index');
const { loadPublishConfig } = require('./config');
const { loadManifest } = require('./manifest');
const { generateThemeCSS, resolveGenrePreset } = require('./theme');
const { buildStorySpine, unitRefs, characterStoryGroup } = require('./story-spine');
const { storyPage: renderStoryUnit, characterStoryPage } = require('./templates/story');
const { storyLanding } = require('./templates/story-landing');
const { buildPartyManifest, partyDataScript } = require('./party-manifest');
const { renderPartyBoard } = require('./templates/gurps/party-board');

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

  const host = config.host || 'github-pages';
  if (host === 'cloudflare-pages' && typeof config.siteUrl === 'string' && /github\.io/i.test(config.siteUrl)) {
    console.warn(
      `⚠️  host is "cloudflare-pages" but siteUrl looks like a GitHub Pages URL (${config.siteUrl}).\n` +
      `   Cloudflare serves at the root, so the 404 page's links will break.\n` +
      `   Set siteUrl to your Cloudflare URL (e.g. https://<project>.pages.dev) and rebuild.`
    );
  }

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

  // `gm-publish init` scaffolds css/overrides.css next to vault.config.json as the seam for
  // durable per-site CSS. It is the only stylesheet the build does not generate, so it is the
  // only one safe to hand-edit — theme.css is rewritten every build. Returns whether a link
  // tag should be emitted; absent file means no link, no 404.
  function copyOverridesCSS() {
    const src = path.join(configDir, 'css/overrides.css');
    if (!fs.existsSync(src)) return false;
    const dest = path.join(outputDir, 'css/overrides.css');
    if (path.resolve(src) === path.resolve(dest)) return true;
    ensureDir(dest);
    fs.copyFileSync(src, dest);
    console.log('  wrote css/overrides.css');
    return true;
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
      overridesCss: publishConfig._overridesCss,
    });
    fs.writeFileSync(path.join(outputDir, '404.html'), html);
    console.log('  wrote 404.html');
  }

  // An unclosed <!-- comment -->, gm-only or spoiler marker strips the rest of the file to
  // EOF. That is the right behavior — never leak the block — but it must not be silent, or
  // an author who forgot a `-->` loses the tail of the page with no signal.
  function logWarnings(outputPath, warnings) {
    for (const warning of warnings || []) {
      console.warn(`  WARNING: ${outputPath}: ${warning}`);
    }
  }

  function copyImages(imageMap) {
    for (const entry of Object.values(imageMap)) {
      const dest = path.join(outputDir, 'images', entry.relPath);
      ensureDir(dest);
      fs.copyFileSync(entry.encodedPath || entry.sourcePath, dest);
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

  function vaultRelPathOf(page) {
    return path.relative(config.vaultPath, page.sourcePath).split(path.sep).join('/');
  }

  // A Publishing entry that matches no scanned file silently removes nothing and publishes
  // nothing — the page just never appears. Say so, so a typo can't blackhole a page.
  if (manifest) {
    const scanned = new Set(corpus.map(vaultRelPathOf));
    for (const entry of manifest.publishing) {
      if (!scanned.has(entry)) {
        console.warn(`  WARNING: manifest lists "${entry}" but no such page was scanned`);
      }
    }
  }

  pairStoryFiles(pages, config.vaultPath);

  // Exclude DRAFT entities when configured (after pairing so story files resolve)
  if (publishConfig.exclude_drafts) {
    const { getCanonStatus } = require('./templates/base');
    const before = pages.length;
    pages = pages.filter(p => getCanonStatus(p.frontmatter) !== 'DRAFT');
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
      const reincluded = autoExcludedPages.filter(page => allowSet.has(vaultRelPathOf(page)));
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
    pages = pages.filter(page => allowSet.has(vaultRelPathOf(page)));
    console.log(`Manifest filter: ${beforeCount} → ${pages.length} pages`);
  }

  const linkMap = buildLinkMap(pages);
  console.log(`Built link map with ${Object.keys(linkMap).length} entries`);

  const { buildBacklinks } = require('./backlinks');
  const { buildSearchIndex } = require('./search-index');
  const { scoreByRecency } = require('./recency');

  // Compute each page's "published view" — markdown with gm-only/spoiler blocks and
  // excluded sections removed — once, so derived widgets (backlinks, recency, the
  // relationship graph) never surface names that only appear in unpublished content
  // (B6 spoiler leak). Spoiler blocks are unrevealed narrative content, not permanent
  // secrets, but they're just as unpublished until reconcile's reveal step strips the
  // fence — until then they must never surface in a derived widget either.
  for (const page of pages) {
    const gmStripped = stripGmOnly(page.markdown || '');
    const afterGm = typeof gmStripped === 'string' ? gmStripped : gmStripped.text;
    const spoilerStripped = stripSpoiler(afterGm);
    const text = typeof spoilerStripped === 'string' ? spoilerStripped : spoilerStripped.text;
    page.publishedMarkdown = filterSections(text, excludeSections);
  }

  // Whether a Story section will exist. Computed early (pure function of pages) so the
  // top nav — threaded into every page, including story pages built later — can point
  // the Story group at story.html. Must match what buildStory() emits below.
  const hasStory = buildStorySpine(pages).length > 0
    || pages.some(p => p.frontmatter && p.frontmatter.type === 'pc' && p.storyMarkdown);

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

  // Apply field filtering after link map is built (aliases/canon_status needed for redirect resolution)
  for (const page of pages) {
    const overridesForFile = fieldOverrides[vaultRelPathOf(page)] || {};
    page.frontmatter = filterFields(page.frontmatter, excludeFields, overridesForFile);
  }

  // Where the timeline actually lives. Decided after field filtering — so an excluded
  // `in_game_date` can't resurrect a timeline the GM meant to suppress — but before the nav
  // is built, so the nav link and the events/ redirect can't disagree with the renderer.
  // A root timeline.html is generated only when dated events exist; failing that, an
  // authored Timeline page (which a folderMap may place anywhere, e.g.
  // campaign/timeline.html) is the real target. With neither, Events keeps its own index.
  const { buildTimelineData, renderTimelineHTML, renderTimelineStrip } = require('./timeline');
  const timelineData = buildTimelineData(pages);
  const generatesTimeline = timelineData.events.length > 0;
  const authoredTimeline = pages.find(p => p.frontmatter.type === 'timeline')
    || pages.find(p => p.outputPath.split('/').pop() === 'timeline.html');
  const timelineHref = generatesTimeline
    ? 'timeline.html'
    : (authoredTimeline ? authoredTimeline.outputPath : null);

  const imageMap = scanAttachments(config);
  console.log(`Found ${Object.keys(imageMap).length} image files`);

  // Re-encode before a single page renders. The tool owns both the image copy and every
  // `<img src>`, so converting here means the new extension flows into references at
  // emission time — no rewriting of generated HTML, and no string-matching URL-encoded
  // paths (`images/Rock%20Lavey.jpg`) that an external postbuild would silently miss.
  //
  // The cost of that ordering: player mode only learns which images are actually referenced
  // (`usedImages`) while rendering, so an unreferenced attachment is encoded here and then
  // dropped at copy time. Correct, just wasted work — and unavoidable without emitting a
  // `src` before knowing the extension it will end up with.
  let imagesTmpDir = null;
  if (resolveImageConfig(publishConfig.images).optimize) {
    imagesTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-img-'));
    const stats = optimizeImages(imageMap, publishConfig.images, imagesTmpDir);
    if (stats.reason) {
      console.warn(`  WARNING: image optimization requested but skipped — ${stats.reason}`);
    } else {
      const mb = bytes => (bytes / 1024 / 1024).toFixed(1);
      const saved = stats.bytesBefore > 0
        ? Math.round((1 - stats.bytesAfter / stats.bytesBefore) * 100)
        : 0;
      console.log(
        `Optimized ${stats.converted} image(s) via ${stats.encoder}: ` +
        `${mb(stats.bytesBefore)} MB → ${mb(stats.bytesAfter)} MB (${saved}% smaller)` +
        `${stats.skipped ? `, ${stats.skipped} left as-is` : ''}` +
        `${stats.failed ? `, ${stats.failed} failed` : ''}`
      );
    }
  }

  cleanOutput();
  copyCSS();
  copyJS();
  copyGenreCSS();
  writeThemeCSS();
  publishConfig._overridesCss = copyOverridesCSS();

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

  const navFor = generateNav(pages, { hasStory, timelineHref });

  // Render each page
  const usedImages = new Set();
  let errorCount = 0;
  const partyEntries = [];
  const partyCampaignId = require('./scanner').slugify(config.siteTitle || 'campaign');
  const deferredRosters = [];
  for (const page of pages) {
    try {
      if (page.frontmatter.type === 'world_flags') continue;
      if (page.frontmatter.portrait) {
        const basename = String(page.frontmatter.portrait).split('/').pop();
        if (basename && imageMap[basename]) usedImages.add(basename);
      }
      const processed = processContent(page, linkMap, excludeSections, imageMap, { usedImages });
      logWarnings(page.outputPath, processed.warnings);
      let html;

      if (page.frontmatter.type === 'pc_roster') { deferredRosters.push({ page, processed }); continue; }

      switch (page.frontmatter.type) {
        case 'pc': {
          let filtered = stripDataview(page.markdown.replace(/\r/g, ''));
          const gmResult = stripGmOnly(filtered);
          filtered = typeof gmResult === 'string' ? gmResult : gmResult.text;
          const spoilerResult = stripSpoiler(filtered);
          filtered = typeof spoilerResult === 'string' ? spoilerResult : spoilerResult.text;
          // Not logged here: processContent above ran this same strip chain over the same
          // markdown, and its warnings were already reported.
          const commentResult = stripHtmlComments(filtered);
          filtered = typeof commentResult === 'string' ? commentResult : commentResult.text;
          filtered = filterSections(filtered, excludeSections);
          // Images before wikilinks: resolveWikiLinks' `[[…]]` pattern also matches the inner
          // brackets of an `![[image.png]]` embed and would flatten it to literal text.
          filtered = resolveImageEmbeds(filtered, imageMap, page.outputPath, usedImages, {
            portraitBasename: portraitBasename(page.frontmatter),
          });
          filtered = resolveWikiLinks(filtered, linkMap, page.outputPath);
          const sections = extractSections(filtered);

          let storyHtml;
          if (page.storyMarkdown) {
            const storyPage = {
              markdown: page.storyMarkdown,
              frontmatter: {},
              outputPath: page.outputPath,
            };
            const storyProcessed = processContent(storyPage, linkMap, excludeSections, imageMap, { usedImages });
            logWarnings(page.outputPath, storyProcessed.warnings);
            storyHtml = storyProcessed.html && storyProcessed.html.trim() ? storyProcessed.html : undefined;
          }

          const system = publishConfig.system;
          const systemRenderer = getRenderer(system);
          const meta = {
            campaignId: require('./scanner').slugify(config.siteTitle || 'campaign'),
            pcSlug: require('./scanner').slugify(page.title),
            buildVersion: require('crypto').createHash('sha1')
              .update(JSON.stringify({ f: page.frontmatter, s: sections })).digest('hex').slice(0, 12),
          };
          const rendered = systemRenderer ? systemRenderer(page.frontmatter, sections, meta) : null;
          const systemOut = (rendered && typeof rendered === 'object')
            ? rendered
            : { sheetHtml: rendered || null };
          if (systemOut.liveData) {
            // Root-relative output path of the PC portrait, for the party-board
            // thumbnail. Resolved the same way portraitImg does (imageMap keyed
            // by bare basename → the scanner's relPath under images/).
            const { portraitBasename } = require('./processor');
            const pBase = portraitBasename(page.frontmatter);
            const pEntry = pBase && imageMap ? imageMap[pBase] : null;
            const portrait = pEntry ? 'images/' + pEntry.relPath : null;
            partyEntries.push({ name: page.displayTitle || page.title, outputPath: page.outputPath, portrait, data: systemOut.liveData });
          }
          html = pcTemplate(page, processed, sections, navFor, config, imageMap, storyHtml, {
            publishConfig,
            pages,
            systemSheetHtml: systemOut.sheetHtml || null,
            systemCombatHtml: systemOut.combatHtml || null,
            systemEquipmentHtml: systemOut.equipmentHtml || null,
            systemLiveData: systemOut.liveData || null,
            systemStatusPanelHtml: systemOut.statusPanelHtml || null,
            storyHref: page.storyMarkdown ? ('story/characters/' + require('./scanner').slugify(page.title) + '.html') : null,
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
          html = worldDomainTemplate(page, processed, navFor, config, imageMap, { publishConfig, linkMap });
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

  if (deferredRosters.length) {
    const manifest = buildPartyManifest(partyCampaignId, partyEntries);
    for (const deferredRoster of deferredRosters) {
      try {
        const boardHtml = manifest ? renderPartyBoard(manifest, deferredRoster.page.outputPath) : null;
        const islandHtml = manifest ? partyDataScript(manifest) : null;
        const html = wikiTemplate(deferredRoster.page, deferredRoster.processed, navFor, config, imageMap, {
          publishConfig, linkMap, pages, partyBoardHtml: boardHtml, partyDataScript: islandHtml,
        });
        const outPath = path.join(outputDir, deferredRoster.page.outputPath);
        ensureDir(outPath);
        fs.writeFileSync(outPath, html);
        console.log(`  wrote ${deferredRoster.page.outputPath} (party board)`);
      } catch (e) {
        errorCount++;
        console.error(`  ERROR rendering roster ${deferredRoster.page.outputPath}: ${e.message}`);
      }
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

  // The encoded bytes are now in the output tree. Scratch dir lives under os.tmpdir(), so a
  // build that throws before reaching here leaks nothing the OS won't reclaim.
  if (imagesTmpDir) fs.rmSync(imagesTmpDir, { recursive: true, force: true });

  // Generate index pages for each output directory
  const dirs = {};
  for (const page of pages) {
    const dir = page.outputDir;
    if (!dirs[dir]) dirs[dir] = [];
    dirs[dir].push(page);
  }

  // Section-index banners. Resolved and copied before the index loop so each index page can
  // be handed finished HTML with hrefs already relative to its own depth.
  function resolveVaultAsset(vaultRelPath, label) {
    const vaultRoot = path.resolve(config.vaultPath);
    const full = path.resolve(vaultRoot, vaultRelPath);
    if (full !== vaultRoot && !full.startsWith(vaultRoot + path.sep)) {
      console.warn(`  WARNING: ${label} "${vaultRelPath}" resolves outside the vault — skipping`);
      return null;
    }
    if (!fs.existsSync(full)) {
      console.warn(`  WARNING: ${label} "${vaultRelPath}" not found in the vault — skipping`);
      return null;
    }
    return full;
  }

  // Namespaced by section, because the conventional banner filename is identical in every
  // section folder: Locations/_banner.png and Creatures/_banner.png would otherwise both
  // land on images/banners/_banner.png, and whichever copied last would show on both pages.
  // The dir may itself contain a slash ("characters/npcs"), so flatten it to one segment.
  function copyBannerAsset(sourceFull, dir) {
    const slug = String(dir).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
    const outRel = `images/banners/${slug}/${path.basename(sourceFull)}`;
    const dest = path.join(outputDir, outRel);
    ensureDir(dest);
    fs.copyFileSync(sourceFull, dest);
    return outRel;
  }

  function buildBanners(dirs) {
    const rendered = {};
    for (const dir of dirs) {
      const entry = resolveBanner(dir, {
        vaultPath: config.vaultPath,
        folderMap: config.folderMap,
        banners: publishConfig.banners,
      });
      if (!entry) continue;

      const imageFull = resolveVaultAsset(entry.image, `banner for "${dir}"`);
      if (!imageFull) continue;

      // Inline SVG keeps its internal <a> links clickable; an <img> would not. A banner that
      // declares a link target is asking for the anchor instead, so it goes down the <img> path.
      if (isSvg(imageFull) && !entry.link) {
        rendered[dir] = renderBanner({ svg: fs.readFileSync(imageFull, 'utf8') });
        console.log(`  inlined banner for ${dir}/index.html`);
        continue;
      }

      let linkHref = null;
      if (entry.link) {
        const linkFull = resolveVaultAsset(entry.link, `banner link for "${dir}"`);
        if (linkFull) linkHref = relativePath(dir, copyBannerAsset(linkFull, dir));
      }
      rendered[dir] = renderBanner({
        imageHref: relativePath(dir, copyBannerAsset(imageFull, dir)),
        linkHref,
        alt: entry.alt || defaultAlt(imageFull),
      });
      console.log(`  wrote banner for ${dir}/index.html`);
    }
    return rendered;
  }

  publishConfig._banners = buildBanners(Object.keys(DIR_LABELS));

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
    // Redirect events/ at the timeline only when one exists; with no timeline the redirect
    // would dangle, so fall through and give events its own index.
    if (dir === 'events' && timelineHref) {
      const rel = relativePath(dir, timelineHref);
      const redirectHtml = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${rel}"><link rel="canonical" href="${rel}"></head><body><a href="${rel}">Timeline</a></body></html>`;
      const outPath = path.join(outputDir, dir, 'index.html');
      ensureDir(outPath);
      fs.writeFileSync(outPath, redirectHtml);
      console.log(`  wrote ${dir}/index.html (redirect → ${timelineHref})`);
      continue;
    }
    let dirPages = [];
    for (const [pageDir, pageDirPages] of Object.entries(dirs)) {
      if (pageDir === dir || pageDir.startsWith(dir + '/')) {
        dirPages = dirPages.concat(pageDirPages);
      }
    }
    const authoredIndex = dirPages.find(p => p.outputPath === dir + '/index.html');
    if (authoredIndex) {
      console.log(`  skipped ${dir}/index.html (authored index page)`);
      continue;
    }
    const indexHtml = indexTemplate(dir, label, dirPages, navFor, config, publishConfig, imageMap);
    const outPath = path.join(outputDir, dir, 'index.html');
    ensureDir(outPath);
    fs.writeFileSync(outPath, indexHtml);
    console.log(`  wrote ${dir}/index.html`);
  }

  // Timeline page
  const { timelineTemplate } = require('./templates/timeline-page');

  if (generatesTimeline) {
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

  function buildCharacterStories() {
    const { slugify } = require('./scanner');
    const stories = [];
    for (const pc of pages.filter(p => p.frontmatter.type === 'pc' && p.storyMarkdown)) {
      const outputPath = `story/characters/${slugify(pc.title)}.html`;
      const storyObj = { markdown: pc.storyMarkdown, frontmatter: {}, outputPath };
      const processed = processContent(storyObj, linkMap, excludeSections, imageMap, { usedImages });
      logWarnings(outputPath, processed.warnings);
      const story = {
        title: pc.displayTitle, outputPath, html: processed.html,
        sheetOutputPath: pc.outputPath, group: characterStoryGroup(pc.frontmatter),
      };
      const full = path.join(outputDir, outputPath);
      ensureDir(full);
      fs.writeFileSync(full, characterStoryPage(story, config, publishConfig, navFor));
      console.log(`  wrote ${outputPath}`);
      stories.push(story);
    }
    return stories;
  }

  function buildStory() {
    const spine = buildStorySpine(pages, linkMap);
    for (const unit of spine) {
      unit.refsHtml = renderRefsHtml(unit);
      const html = renderStoryUnit(unit, config, publishConfig, navFor);
      const outPath = path.join(outputDir, unit.outputPath);
      ensureDir(outPath);
      fs.writeFileSync(outPath, html);
      console.log(`  wrote ${unit.outputPath}`);
    }
    const characterStories = buildCharacterStories();
    if (spine.length || characterStories.length) {
      const landing = storyLanding(spine, characterStories, config, publishConfig, navFor);
      const lp = path.join(outputDir, 'story.html');
      ensureDir(lp);
      fs.writeFileSync(lp, landing);
      console.log('  wrote story.html');
    }
    return { spine, characterStories, hasStory: !!(spine.length || characterStories.length) };
  }

  buildStory();

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
