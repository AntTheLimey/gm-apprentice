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

// exclude_dirs entries are already normalized (slashes, leading "./", trailing "/",
// absolute→vault-relative) by config.js's loadPublishConfig before they reach here — but
// case is not, deliberately: a GM's own casing survives dedup for display. Matching must
// still be case-insensitive, because the filesystem the scanner walks may or may not be
// (macOS/Windows: case-insensitive by default; Linux: case-sensitive). Without this, a
// vault-config.md entry spelled "GM" and a JSON excludeDirs entry spelled "gm" collapse
// to one surviving spelling in the union, and whichever one wins case-sensitively matches
// the on-disk folder on macOS but silently fails to exclude it on Linux.
// Returns the excludeDirs entry that matched relPath (in its own configured casing, for
// display — "in NPCs/Hidden/ — listed in excludeDirs" should show the GM's own spelling),
// or undefined if none matched. dirIsExcluded is this with only the boolean kept.
function matchExcludedDir(relPath, excludeDirs) {
  if (!Array.isArray(excludeDirs) || excludeDirs.length === 0) return undefined;
  const lower = relPath.toLowerCase();
  return excludeDirs.find((ex) => {
    const exLower = String(ex).toLowerCase();
    return lower === exLower || lower.startsWith(exLower + '/');
  });
}

function dirIsExcluded(relPath, excludeDirs) {
  return matchExcludedDir(relPath, excludeDirs) !== undefined;
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

// The walk, and everything it learned — including the two classes of file it could
// NOT turn into a page. scanVault() prints those as warnings and throws the detail
// away; `manifest diff`, `doctor --site` and `explain` need the detail itself, so
// the walk reports and the printing lives one level up.
function scanVaultReport(config) {
  const { vaultPath, excludeDirs, folderMap } = config;
  const pages = [];
  // Vault-relative paths of .md files carrying no `type:`. They never publish,
  // and skipping them in silence is how a GM ends up hunting for a note that
  // was never going to appear.
  const untyped = [];
  // Directories holding typed pages that no folderMap entry covers, in first-seen
  // order, each with the number of pages it silently swallowed.
  const unmapped = [];
  const unmappedByDir = new Map();
  // .md files gray-matter could not parse at all (bad YAML, an unterminated quoted
  // scalar, …). Distinct from `untyped`: those parse fine and simply lack `type:`.
  // A malformed file never produced frontmatter to inspect, so it belongs in its
  // own bucket rather than silently vanishing — `doctor --site` and `explain` need
  // to say the file itself is broken, not "no type:".
  const malformed = [];
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
        if (dirIsExcluded(relPath, excludeDirs) || entry.name.startsWith('.')) continue;
        walk(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        let frontmatter, content;
        try {
          ({ data: frontmatter, content } = matter(raw));
        } catch (e) {
          malformed.push({ rel: relPath, fullPath, message: e.message });
          continue;
        }

        if (!frontmatter.type) { untyped.push(relPath); continue; } // skip files without typed frontmatter

        const dirRel = path.relative(vaultPath, dir);
        const outputDir = mapFolder(dirRel, folderMap);
        if (!outputDir && dirRel !== '') {
          const dirKey = toPosix(dirRel);
          let entry = unmappedByDir.get(dirKey);
          if (!entry) {
            entry = { dir: dirKey, typedFileCount: 0 };
            unmappedByDir.set(dirKey, entry);
            unmapped.push(entry);
          }
          entry.typedFileCount++;
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
  return { pages, untyped, unmapped, malformed };
}

// The build's entry point: the pages, with the three "could not publish this"
// classes reported to the console rather than returned.
function scanVault(config) {
  const { pages, untyped, unmapped, malformed } = scanVaultReport(config);
  for (const { fullPath, message } of malformed) {
    console.warn(`scanner: skipping ${fullPath} — malformed frontmatter: ${message}`);
  }
  for (const { dir } of unmapped) {
    console.warn(`scanner: skipping "${dir}" — not in folderMap; typed pages inside will not publish. Add it to folderMap to publish, or to excludeDirs to silence this warning.`);
  }
  if (untyped.length > 0) {
    const shown = untyped.slice(0, 5).join(', ');
    const more = untyped.length > 5 ? ` (+${untyped.length - 5} more)` : '';
    console.warn(
      `scanner: skipped ${untyped.length} file(s) with no \`type:\` in frontmatter — ` +
      `they will not publish: ${shown}${more}. Add \`type:\` to publish them, or list ` +
      `their folder in excludeDirs to silence this.`
    );
  }
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
  const { vaultPath, attachmentsDir, excludeDirs } = config;
  const attachmentsPath = path.join(vaultPath, attachmentsDir || '_attachments');
  const map = {};

  // Wrapped on this path too: the returned type must not depend on whether _attachments/ exists.
  if (!fs.existsSync(attachmentsPath)) return nfcLookupTable(map);

  // Same vault-relative exclusion rule scanVaultReport applies to pages (#210): a GM who
  // lists a folder in excludeDirs — including a subfolder of the attachments tree, e.g.
  // "_attachments/gm-maps" — means it in both places. Without this, a GM-only map or
  // hidden-NPC portrait dropped there ships on every build regardless of mode.
  const excludes = Array.isArray(excludeDirs) ? excludeDirs : [];

  // The walk below only tests CHILD directories against excludeDirs — it never checks
  // the attachments root itself, so a GM who excludes the whole attachments folder (e.g.
  // a vault-config.md that gives GM-only attachments their own directory and excludes
  // it wholesale) still got every image directly under that root scanned and copied
  // (CodeRabbit review, PR #234). Check the root the same way before ever walking it.
  const attachmentsRootRel = toPosix(path.relative(vaultPath, attachmentsPath));
  if (dirIsExcluded(attachmentsRootRel, excludes)) {
    console.warn(`scanner: attachments root "${attachmentsRootRel}" is listed in excludeDirs — no attachments scanned`);
    return nfcLookupTable(map);
  }

  const IMAGE_EXTS = /\.(jpe?g|png|webp|gif|svg|avif)$/i;

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const relDir = toPosix(path.relative(vaultPath, full));
        if (dirIsExcluded(relDir, excludes) || entry.name.startsWith('.')) continue;
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

// Every note in the vault with just its name and frontmatter, ignoring
// excludeDirs, folderMap and `type:` (#212). GM aliases are resolved against
// this, because Obsidian resolves a link to any note in the vault, and a
// GM-only folder the site never scans is the likeliest home for a secret.
function scanAllNotes(vaultPath) {
  const out = [];
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.md')) continue;
      const title = e.name.slice(0, -3);
      let frontmatter = {};
      try {
        const text = fs.readFileSync(full, 'utf8');
        // Only a note that declares aliases needs its frontmatter parsed.
        if (/^(gm_)?aliases:/m.test(text)) frontmatter = matter(text).data || {};
      } catch (err) { /* unreadable or malformed: its name still counts */ }
      out.push({ title, displayTitle: title.replace(/_/g, ' '), frontmatter, sourcePath: full });
    }
  })(vaultPath);
  return out;
}

module.exports = { scanAllNotes, slugify, scanVault, scanVaultReport, buildLinkMap, mapFolder, scanAttachments, pairStoryFiles, dirIsExcluded, matchExcludedDir };
