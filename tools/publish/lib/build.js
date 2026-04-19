const fs = require('fs');
const path = require('path');
const { scanVault, buildLinkMap, scanAttachments } = require('./scanner');
const { processContent, extractSections, filterSections, stripDataview, stripGmOnly, filterFields, resolveImageEmbeds, resolveWikiLinks } = require('./processor');
const { generateNav, pcTemplate, npcTemplate, creatureTemplate, locationTemplate, itemTemplate, factionTemplate, eventTemplate, wikiTemplate, indexTemplate, landingTemplate, fourOhFourTemplate, DIR_LABELS } = require('./templates/index');
const { loadPublishConfig } = require('./config');
const { loadManifest } = require('./manifest');
const { generateThemeCSS } = require('./theme');

function build(options = {}) {
  const configPath = options.configPath || './vault.config.json';
  const resolvedConfigPath = path.resolve(configPath);
  const configDir = path.dirname(resolvedConfigPath);
  const config = require(resolvedConfigPath);
  config.vaultPath = path.resolve(configDir, config.vaultPath);
  const outputDir = path.resolve(configDir, config.outputDir);

  const publishConfig = loadPublishConfig(config.vaultPath, config);
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
  writeThemeCSS();

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
      }
    }
  }

  writeNoJekyll();
  write404();

  const navFor = generateNav(pages);

  // Render each page
  const usedImages = new Set();
  let errorCount = 0;
  for (const page of pages) {
    try {
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
          html = pcTemplate(page, processed, sections, navFor, config, imageMap);
          break;
        }
        case 'npc':
          html = npcTemplate(page, processed, navFor, config, imageMap);
          break;
        case 'creature':
          html = creatureTemplate(page, processed, navFor, config, imageMap);
          break;
        case 'location':
          html = locationTemplate(page, processed, navFor, config, imageMap);
          break;
        case 'item':
          html = itemTemplate(page, processed, navFor, config, imageMap, linkMap);
          break;
        case 'faction':
        case 'organization':
          html = factionTemplate(page, processed, navFor, config, imageMap, linkMap, pages);
          break;
        case 'event':
          html = eventTemplate(page, processed, navFor, config, imageMap, linkMap);
          break;
        default:
          html = wikiTemplate(page, processed, navFor, config, imageMap);
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
    console.log(`Player mode: copied ${Object.keys(filteredMap).length} of ${Object.keys(imageMap).length} images`);
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

  for (const [dir, label] of Object.entries(DIR_LABELS)) {
    let dirPages = [];
    for (const [pageDir, pageDirPages] of Object.entries(dirs)) {
      if (pageDir === dir || pageDir.startsWith(dir + '/')) {
        dirPages = dirPages.concat(pageDirPages);
      }
    }
    const indexHtml = indexTemplate(dir, label, dirPages, navFor, config);
    const outPath = path.join(outputDir, dir, 'index.html');
    ensureDir(outPath);
    fs.writeFileSync(outPath, indexHtml);
    console.log(`  wrote ${dir}/index.html`);
  }

  // Landing page
  const landingHtml = landingTemplate(pages, navFor, config, publishConfig);
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
