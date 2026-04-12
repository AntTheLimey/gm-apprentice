const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

function slugify(name) {
  const slug = name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'untitled';
}

function mapFolder(vaultRelPath, folderMap) {
  for (const [vaultDir, outputDir] of Object.entries(folderMap)) {
    if (vaultRelPath === vaultDir || vaultRelPath.startsWith(vaultDir + path.sep)) {
      return outputDir + vaultRelPath.substring(vaultDir.length);
    }
  }
  return null;
}

function scanVault(config) {
  const { vaultPath, excludeDirs, folderMap } = config;
  const pages = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(vaultPath, fullPath);

      if (entry.isDirectory()) {
        if (excludeDirs.some(ex => relPath.startsWith(ex)) || entry.name.startsWith('.')) continue;
        walk(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        let frontmatter, content;
        try {
          ({ data: frontmatter, content } = matter(raw));
        } catch (e) {
          console.warn(`scanner: skipping ${fullPath} — malformed frontmatter: ${e.message}`);
          continue;
        }

        if (!frontmatter.type) continue; // skip files without typed frontmatter

        const dirRel = path.relative(vaultPath, dir);
        const outputDir = mapFolder(dirRel, folderMap);
        if (!outputDir && dirRel !== '') continue; // skip unmapped directories

        const baseName = path.basename(entry.name, '.md');
        const slug = slugify(baseName);
        const outputPath = outputDir
          ? path.join(outputDir, slug + '.html')
          : slug + '.html';

        pages.push({
          sourcePath: fullPath,
          title: baseName,
          slug,
          outputPath,
          outputDir: outputDir || '',
          frontmatter,
          markdown: content,
        });
      }
    }
  }

  walk(vaultPath);
  return pages;
}

function buildLinkMap(pages) {
  const map = {};

  // Pass 1: add all canonical titles (non-superseded first so they claim their own names)
  for (const page of pages) {
    if (page.frontmatter.canon_status !== 'SUPERSEDED') {
      map[page.title] = page.outputPath;
    }
  }

  // Pass 2: add superseded titles, redirecting to their superseded_by target if possible
  for (const page of pages) {
    if (page.frontmatter.canon_status === 'SUPERSEDED') {
      const supersededBy = page.frontmatter.superseded_by;
      if (supersededBy) {
        const targetName = String(supersededBy).replace(/\[\[|\]\]/g, '').trim();
        // Redirect to target if we have it, otherwise point at own page
        map[page.title] = map[targetName] || page.outputPath;
      } else if (!(page.title in map)) {
        map[page.title] = page.outputPath;
      }
    }
  }

  // Pass 3: add aliases (only if not already claimed by a canonical title)
  for (const page of pages) {
    if (page.frontmatter.aliases) {
      for (const alias of page.frontmatter.aliases) {
        if (!(alias in map)) {
          map[alias] = page.outputPath;
        }
      }
    }
  }

  return map;
}

function scanAttachments(config) {
  const { vaultPath, attachmentsDir } = config;
  const attachmentsPath = path.join(vaultPath, attachmentsDir || '_attachments');
  const map = {};

  if (!fs.existsSync(attachmentsPath)) return map;

  const IMAGE_EXTS = /\.(jpe?g|png|webp|gif)$/i;

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (IMAGE_EXTS.test(entry.name)) {
        const relPath = path.relative(attachmentsPath, full);
        map[entry.name] = {
          sourcePath: full,
          relPath, // e.g., "characters/ronnie-vint.jpg"
        };
      }
    }
  }

  walk(attachmentsPath);
  return map;
}

module.exports = { slugify, scanVault, buildLinkMap, mapFolder, scanAttachments };
