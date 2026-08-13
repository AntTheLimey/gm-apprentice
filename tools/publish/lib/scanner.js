const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { getCanonStatus } = require('./templates/base');
const { canonicalNfc, nfcLookupTable } = require('./unicode');

function slugify(name) {
  const slug = name
    // Decompose accented characters (NFD) and drop the resulting combining marks (#139)
    // so "González" slugifies to "gonzalez" instead of falling through to the
    // catch-all replace and turning each accent into a stray hyphen ("gonz-lez"). Also
    // makes NFC- and NFD-typed filenames — which look identical but differ byte-for-byte
    // — produce the same slug regardless of which normal form the source file used.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'untitled';
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function mapFolder(vaultRelPath, folderMap) {
  const rel = toPosix(vaultRelPath);
  const entries = Object.entries(folderMap).sort(([a], [b]) => b.length - a.length);
  for (const [vaultDir, outputDir] of entries) {
    if (rel === vaultDir || rel.startsWith(vaultDir + '/')) {
      return outputDir + rel.substring(vaultDir.length);
    }
  }
  return null;
}

function scanVault(config) {
  const { vaultPath, excludeDirs, folderMap } = config;
  const pages = [];
  const warnedDirs = new Set();
  // Output path -> the vault-relative source that first claimed it. Stripping combining
  // marks (#139) collapses names that used to slug apart ("Renée"/"Renee" both give
  // renee.html), and the later page silently overwrites the earlier one on disk.
  const claimedOutputPaths = new Map();

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = toPosix(path.relative(vaultPath, fullPath));

      if (entry.isDirectory()) {
        if (excludeDirs.some(ex => relPath === ex || relPath.startsWith(ex + '/')) || entry.name.startsWith('.')) continue;
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
        if (!outputDir && dirRel !== '') {
          const dirKey = toPosix(dirRel);
          if (!warnedDirs.has(dirKey)) {
            warnedDirs.add(dirKey);
            console.warn(`scanner: skipping "${dirKey}" — not in folderMap; typed pages inside will not publish. Add it to folderMap to publish, or to excludeDirs to silence this warning.`);
          }
          continue;
        }

        const baseName = path.basename(entry.name, '.md');
        const displayTitle = frontmatter.title || baseName.replace(/_/g, ' ');
        const slug = slugify(baseName);
        const outputPath = outputDir
          ? outputDir + '/' + slug + '.html'
          : slug + '.html';

        if (claimedOutputPaths.has(outputPath)) {
          console.warn(
            `scanner: page slug collision — "${outputPath}" is produced by both ` +
            `"${claimedOutputPaths.get(outputPath)}" and "${relPath}". The latter will be used. ` +
            `Rename one of the files so they slugify apart.`
          );
        } else {
          claimedOutputPaths.set(outputPath, relPath);
        }

        pages.push({
          sourcePath: fullPath,
          title: baseName,
          displayTitle,
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

// Titles/aliases in, output paths out. Keys are canonicalized to NFC (#139) and the table is
// wrapped so lookups canonicalize too: the wikilink text a GM types inside a note and the
// filename it names are authored in different apps and routinely disagree on normal form,
// which used to render the link as plain text with no warning. Values — the output paths —
// are stored exactly as given; nothing here rewrites an emitted path or URL.
function buildLinkMap(pages) {
  const map = {};

  // Pass 1: add all canonical titles (non-superseded first so they claim their own names)
  for (const page of pages) {
    if (getCanonStatus(page.frontmatter) !== 'SUPERSEDED') {
      map[canonicalNfc(page.title)] = page.outputPath;
    }
  }

  // Pass 2: add superseded titles, redirecting to their superseded_by target if possible
  for (const page of pages) {
    if (getCanonStatus(page.frontmatter) === 'SUPERSEDED') {
      const title = canonicalNfc(page.title);
      if (title in map) continue;
      const supersededBy = page.frontmatter.superseded_by;
      if (supersededBy) {
        const targetName = canonicalNfc(String(supersededBy).replace(/\[\[|\]\]/g, '').trim());
        map[title] = map[targetName] || page.outputPath;
      } else {
        map[title] = page.outputPath;
      }
    }
  }

  // Pass 3: add aliases (only if not already claimed by a canonical title)
  for (const page of pages) {
    if (Array.isArray(page.frontmatter.aliases)) {
      for (const alias of page.frontmatter.aliases) {
        const key = canonicalNfc(alias);
        if (!(key in map)) {
          map[key] = page.outputPath;
        }
      }
    }
  }

  return nfcLookupTable(map);
}

function scanAttachments(config) {
  const { vaultPath, attachmentsDir } = config;
  const attachmentsPath = path.join(vaultPath, attachmentsDir || '_attachments');
  const map = {};

  if (!fs.existsSync(attachmentsPath)) return map;

  const IMAGE_EXTS = /\.(jpe?g|png|webp|gif|svg|avif)$/i;

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (IMAGE_EXTS.test(entry.name)) {
        const relPath = toPosix(path.relative(attachmentsPath, full));
        // Key canonicalized to NFC (#139) so a `portrait:` value or `![[embed]]` typed in the
        // other normal form still finds the file. sourcePath and relPath keep the filesystem's
        // own bytes — they name a real file and become the copied output path.
        const key = canonicalNfc(entry.name);
        if (key in map) {
          console.warn(
            `scanner: attachment basename collision — "${entry.name}" found at both ` +
            `"${map[key].relPath}" and "${relPath}". The latter will be used.`
          );
        }
        map[key] = {
          sourcePath: full,
          relPath,
        };
      }
    }
  }

  walk(attachmentsPath);
  return nfcLookupTable(map);
}

function pairStoryFiles(pages, vaultPath) {
  const pcPages = pages.filter(p => p.frontmatter.type === 'pc');
  const storyIndices = new Set();

  for (const pc of pcPages) {
    const pcDir = path.dirname(pc.sourcePath);
    const pcBase = path.basename(pc.sourcePath, '.md');
    const storyPath = path.join(pcDir, pcBase + '_Story.md');

    const idx = pages.findIndex(p => p.sourcePath === storyPath);
    if (idx !== -1) storyIndices.add(idx);

    if (fs.existsSync(storyPath)) {
      let data, content;
      try {
        ({ data, content } = matter(fs.readFileSync(storyPath, 'utf-8')));
      } catch (e) {
        console.warn(`scanner: skipping story file ${storyPath} — malformed frontmatter: ${e.message}`);
        continue;
      }
      if (data.type !== 'character-story') continue;
      pc.storyMarkdown = content;
    }
  }

  for (const idx of [...storyIndices].sort((a, b) => b - a)) {
    pages.splice(idx, 1);
  }
}

module.exports = { slugify, scanVault, buildLinkMap, mapFolder, scanAttachments, pairStoryFiles };
