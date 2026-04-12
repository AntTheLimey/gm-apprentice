const fs = require('fs');
const path = require('path');
const { scanVault, buildLinkMap, scanAttachments } = require('./scanner');
const { processContent, extractSections, filterSections, stripDataview } = require('./processor');
const { generateNav, pcTemplate, npcTemplate, creatureTemplate, locationTemplate, itemTemplate, factionTemplate, wikiTemplate, indexTemplate, landingTemplate, DIR_LABELS } = require('./templates/index');

function build(options = {}) {
  const configPath = options.configPath || './vault.config.json';
  const config = require(path.resolve(configPath));
  const outputDir = path.resolve(path.dirname(path.resolve(configPath)), config.outputDir);

  // Clean output dir but preserve specs/plans subdirectory
  function cleanOutput() {
    if (!fs.existsSync(outputDir)) return;
    const preserve = ['superpowers'];
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

  function writeNoJekyll() {
    fs.writeFileSync(path.join(outputDir, '.nojekyll'), '');
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
  console.log('Scanning vault:', config.vaultPath);
  const pages = scanVault(config);
  console.log(`Found ${pages.length} pages`);

  const linkMap = buildLinkMap(pages);
  console.log(`Built link map with ${Object.keys(linkMap).length} entries`);

  const imageMap = scanAttachments(config);
  console.log(`Found ${Object.keys(imageMap).length} image files`);

  cleanOutput();
  copyCSS();
  copyImages(imageMap);
  writeNoJekyll();

  const navFor = generateNav(pages);

  // Render each page
  let errorCount = 0;
  for (const page of pages) {
    try {
      const processed = processContent(page, linkMap, config.excludeSections, imageMap);
      let html;

      switch (page.frontmatter.type) {
        case 'pc': {
          let filtered = stripDataview(page.markdown);
          filtered = filterSections(filtered, config.excludeSections);
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

  // Generate index pages for each output directory
  const dirs = {};
  for (const page of pages) {
    const dir = page.outputDir;
    if (!dirs[dir]) dirs[dir] = [];
    dirs[dir].push(page);
  }

  for (const [dir, label] of Object.entries(DIR_LABELS)) {
    const dirPages = dirs[dir] || [];
    const indexHtml = indexTemplate(dir, label, dirPages, navFor, config);
    const outPath = path.join(outputDir, dir, 'index.html');
    ensureDir(outPath);
    fs.writeFileSync(outPath, indexHtml);
    console.log(`  wrote ${dir}/index.html`);
  }

  // Landing page
  const landingHtml = landingTemplate(pages, navFor, config);
  fs.writeFileSync(path.join(outputDir, 'index.html'), landingHtml);
  console.log('  wrote index.html');

  if (errorCount > 0) {
    console.log(`Done with ${errorCount} error(s).`);
  } else {
    console.log('Done!');
  }
}

module.exports = { build };

// Allow running directly: node lib/build.js
if (require.main === module) {
  build();
}
