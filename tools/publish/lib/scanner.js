const fs = require('fs');
const path = require('path');
const { parseNote } = require('./frontmatter');
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

// The key a PC's live state (current HP/SAN, loadouts, the party board, flush) is stored
// under. A PC note's `live_key` pins it; with none it is the slug of the filename, as it
// always was. A rename writes `live_key`, so the state stays with the character. Every
// place that derives or matches this key goes through here.
function pcLiveKey(frontmatter, title) {
  const pinned = frontmatter && typeof frontmatter.live_key === 'string' ? frontmatter.live_key.trim() : '';
  return slugify(pinned || title);
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
          ({ data: frontmatter, content } = parseNote(raw));
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
          // Vault-relative path without `.md`: the target of an Obsidian path
          // link (`[[Locations/Drageby]]`), which names one page when two
          // folders hold a note of the same name.
          vaultPath: relPath.replace(/\.md$/i, ''),
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
  return warnScanReport(scanVaultReport(config));
}

// Prints what the walk could not publish and hands back the pages. The build keeps
// the report too, to repeat the unparseable files where the GM reads (#287).
function warnScanReport(report) {
  const { pages, untyped, unmapped, malformed } = report;
  for (const { fullPath, message } of malformed) {
    console.warn(`scanner: skipping ${fullPath} — malformed frontmatter: ${message}`);
  }
  for (const { dir } of unmapped) {
    console.warn(`scanner: skipping "${dir}" — not in publish.folder_map; typed pages inside will not publish. Add it to publish.folder_map in _meta/vault-config.md to publish, or to publish.exclude_dirs to silence this warning.`);
  }
  if (untyped.length > 0) {
    const shown = untyped.slice(0, 5).join(', ');
    const more = untyped.length > 5 ? ` (+${untyped.length - 5} more)` : '';
    console.warn(
      `scanner: skipped ${untyped.length} file(s) with no \`type:\` in frontmatter — ` +
      `they will not publish: ${shown}${more}. Add \`type:\` to publish them, or list ` +
      `their folder in publish.exclude_dirs (_meta/vault-config.md) to silence this.`
    );
  }
  return pages;
}

// Titles/aliases in, output paths out. Keys are canonicalized to NFC (#139) and the table is
// wrapped so lookups canonicalize too: the wikilink text a GM types inside a note and the
// filename it names are authored in different apps and routinely disagree on normal form,
// which used to render the link as plain text with no warning. Values — the output paths —
// are stored exactly as given; nothing here rewrites an emitted path or URL.
// The three kinds of name a `[[link]]` reaches a page by, NFC. buildLinkMap keys on
// these and nothing else, and session-hub.js pairs a session index with its Wrap-Up
// through linkKeys, so a pairing link resolves exactly as the same link in a page body.
function titleKey(page) { return canonicalNfc(page.title); }
function pathKey(page) { return page.vaultPath ? canonicalNfc(page.vaultPath) : null; }
function aliasKeys(page) {
  const aliases = page.frontmatter && page.frontmatter.aliases;
  return Array.isArray(aliases) ? aliases.map(canonicalNfc) : [];
}
function linkKeys(page) {
  return [titleKey(page), pathKey(page), ...aliasKeys(page)].filter(Boolean);
}

function buildLinkMap(pages) {
  const map = {};

  // Pass 1: add all canonical titles (non-superseded first so they claim their own names)
  for (const page of pages) {
    if (getCanonStatus(page.frontmatter) !== 'SUPERSEDED') {
      map[titleKey(page)] = page.outputPath;
    }
  }

  // Pass 2: add superseded titles, redirecting to their superseded_by target if possible
  for (const page of pages) {
    if (getCanonStatus(page.frontmatter) === 'SUPERSEDED') {
      const title = titleKey(page);
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

  // Pass 3: add vault paths (`[[Folder/Name]]`). A path names exactly one file, so it
  // goes in before aliases: an alias spelled like a path must not claim it. Titles can't
  // contain `/`, so none of these collide with pass 1.
  for (const page of pages) {
    const key = pathKey(page);
    if (key && !(key in map)) map[key] = page.outputPath;
  }

  // Pass 4: add aliases (only if not already claimed by a canonical title or path)
  for (const page of pages) {
    for (const key of aliasKeys(page)) {
      if (!(key in map)) {
        map[key] = page.outputPath;
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
    console.warn(`scanner: attachments root "${attachmentsRootRel}" is listed in publish.exclude_dirs — no attachments scanned`);
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
        ({ data, content } = parseNote(fs.readFileSync(storyPath, 'utf-8')));
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
const SESSION_TYPE_LINE = /^type:\s*["']?(session|session_wrap|session-wrap-up|session-wrapup)["']?\s*$/m;

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
      let text = '';
      try {
        text = fs.readFileSync(full, 'utf8');
        // Only a note that declares aliases needs its frontmatter parsed — or a session
        // index or Wrap-Up the scan skipped, which session-hub.js still counts when it
        // resolves a pairing link (a same-titled hub elsewhere makes a link ambiguous).
        if (/^(gm_)?aliases:/m.test(text) || SESSION_TYPE_LINE.test(text)) frontmatter = parseNote(text).data || {};
      } catch (err) {
        // Its name still counts. A secret that silently stops being
        // protected is the one failure that must not be quiet.
        if (/^gm_aliases:/m.test(text)) {
          console.warn(`WARNING: ${path.relative(vaultPath, full)} has gm_aliases but its frontmatter `
            + `can't be read (${err.message.split('\n')[0]}); those names are NOT hidden on the site.`);
        }
      }
      out.push({
        title, displayTitle: title.replace(/_/g, ' '), frontmatter, sourcePath: full,
        vaultPath: toPosix(path.relative(vaultPath, full)).replace(/\.md$/i, ''),
      });
    }
  })(vaultPath);
  return out;
}

module.exports = { scanAllNotes, slugify, pcLiveKey, scanVault, scanVaultReport, warnScanReport, buildLinkMap, linkKeys, mapFolder, scanAttachments, pairStoryFiles, dirIsExcluded, matchExcludedDir };
