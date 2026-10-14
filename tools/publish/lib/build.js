const { scopeColorScheme, headScript, storageKey } = require('./color-mode');
const { configureColorMode, configureLinkPreviews, configureConnections } = require('./templates/base');
const { hasSheetStructure } = require('./templates/sheet-parse');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanVaultReport, warnScanReport, buildLinkMap, scanAttachments, scanAllNotes, pcLiveKey, STORY_SUFFIX, slugify } = require('./scanner');
const { optimizeImages, resolveImageConfig } = require('./image-optimize');
const { resolveBanner, renderBanner, defaultAlt, isSvg, bannerSlug, copiedBannerFiles } = require('./banners');
const { pcKeepList, retiredSheetFieldsFor, retiredSheetFieldsMessage } = require('./pc-prose');
const { nameList, gmAliasList, strippedLines, noteFacts, keptFlags, stubCut, pcHeadingsUnstable, HEADINGS_UNSTABLE_WARNING, processContent, playerSafeMarkdown, extractSections, filterSections, filterFields, publishedFrontmatter, isGmOnlyEdge, publishMode, keepOnlySections, resolveImageEmbeds, resolveWikiLinks, relativePath, relativeHref, escapeHtml, portraitBasename, encodeHref } = require('./processor');
const { pairHubs } = require('./session-hub');
const { generateNav, pcTemplate, npcTemplate, creatureTemplate, locationTemplate, itemTemplate, factionTemplate, eventTemplate, heritageTemplate, worldDomainTemplate, wikiTemplate, sessionBodyHtml, indexTemplate, landingTemplate, fourOhFourTemplate, DIR_LABELS, getRenderer } = require('./templates/index');
const { isRoster } = require('./templates/nav');
const { getsNoPage } = require('./previews');
const { runSteps, packageScripts, packageNotes } = require('./settings/steps');
const { startNoteAudit, summaryLines, pageText, mainOf, MARK_RE } = require('./note-faults');
const { ignoringMark } = require('./heading-key');
const { linkText, parseWikilink } = require('./wikilink');
const { nameIn, fileLabel } = require('./settings');
const { resolveConfig, assertNoStops, vaultRelPath, scanConfigFor, loadVaultConfig, siteOff } = require('./config');
const { clipValue, isDressed, skinsCss, fontFamiliesFor } = require('./skins');
const { loadManifest } = require('./manifest');
const { canonicalNfc } = require('./unicode');
const { generateThemeCSS, googleFontNames, FONT_FORMATS, fontOutputPath } = require('./theme');
const fontsLib = require('./fonts');
const { buildStorySpine, chapterOfSession, unitRefs, characterStoryGroup } = require('./story-spine');
const { storyPage: renderStoryUnit, characterStoryPage } = require('./templates/story');
const { storyLanding } = require('./templates/story-landing');
const { partyDataScript } = require('./party-manifest');
const { boardFor } = require('./party-board-registry');
const { hasRealKvId, detectInbox, detectStatusBar } = require('./backend-flags');
const { SITE_OLD_ROOTS } = require('./settings/legacy');
const { publishesPage, autoExcludeCode } = require('./publish-decision');
const { publishedPages } = require('./published-pages');
const { isOutOfPlay } = require('./pc-status');
const { sheetSourceOf } = require('./sheet-source');
const { pcIdentity } = require('./templates/pc-identity');

const PLAYED_SESSION_STATUSES = new Set(['played', 'wrap-up', 'reviewed']);

// The closing line about vault.config.json keys that moved to _meta/vault-config.md. Used
// keys are listed plainly, a key the vault file also sets is "ignored", and an entry of a
// list that the vault file's list lacks is named as still applied from the site file. The
// old `backend` block and `landingTagline` are named too: either gives the migration work.
// A list key that is not a list, or holds only entries that cannot be carried over, gets its
// own clause (the migration cannot move it) and does not send the GM to migrate.py when it is all that is left. Returns the lines to print.
function legacyWarning(legacy, rawConfig, layout) {
  const parts = [];
  const byHand = [];
  for (const rec of Array.isArray(legacy) ? legacy : []) {
    if (rec.notAList) {
      byHand.push(`${rec.key} in vault.config.json is not a list and is ignored; remove it or move its entries to publish.${rec.publishKey} by hand`);
      continue;
    }
    if (rec.unmovable) {
      byHand.push(`${rec.key} in vault.config.json holds entries that are not text and cannot be moved; remove them or the key by hand`);
      continue;
    }
    parts.push(rec.status === 'ignored' ? `${rec.key} (ignored; the vault file sets it)` : rec.key);
    for (const x of rec.stillApplied || []) parts.push(`${rec.key} entry "${x}" is still applied from vault.config.json`);
  }
  for (const key of SITE_OLD_ROOTS) {
    if (rawConfig && rawConfig[key] !== undefined) parts.push(key);
  }
  const moved = parts.length && layout === 'new'
    ? `WARNING: vault.config.json still holds campaign settings: ${parts.join(', ')}. This vault's settings are in ${fileLabel(rawConfig.vaultPath)}, so these are no longer read; remove them from vault.config.json.`
    : parts.length
    ? `WARNING: vault.config.json still holds campaign settings: ${parts.join(', ')}. Settings left in vault.config.json are planned to stop being read in plugin 1.11.0. Run \`migrate.py <vault>\` to move them.`
    : null;
  return [moved, ...byHand.map((c) => `WARNING: ${c}.`)].filter(Boolean);
}

// Run `fn` with the console quiet: the in-memory build prints nothing, and a page rendered a
// second time for the audit must not repeat its warnings.
function quietly(fn) {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try { return fn(); } finally { Object.assign(console, saved); }
}

// Reads a link the GM wrote in a setting (a menu entry's `link`, a banner's `link`), in this order:
//   text starting http:// or https://     an address outside the site, as written
//   the name of a note that has a page     that page (names are matched as the link map matches them)
//   the name of a note with no page        dropped: { kind: 'none' }; the caller warns, and prints nothing
//   anything else                          an address on the site, as written
// The notes with no page are known to the link map itself: the build registers every note's names against it
// (`rememberHiddenNames`), so a caller cannot forget them. A name matches in any letter case, as a wiki-link does;
// a note's file name, title and aliases all count.
// Returns { kind: 'outside' | 'page' | 'site' | 'none', href }.
const HIDDEN_NAMES = new WeakMap();   // link map -> Set of lower-cased names of the notes
const LOWER_KEYS = new WeakMap();     // link map -> Map of lower-cased key -> output path

const foldName = (name) => name.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

// A name is folded two ways, and a link is hidden if any of its path segments matches either: the lower-cased name
// (spaces and underscores alike) and the slug the build gives page file names (so hyphens count too).
const HIDDEN_SLUGS = new WeakMap();   // link map -> Set of slugs of the notes' names

function rememberHiddenNames(linkMap, notes) {
  const names = new Set();
  const slugs = new Set();
  for (const note of notes) {
    const fm = note.frontmatter || {};
    const vaultPath = String(note.vaultPath).replace(/\\/g, '/');
    const all = [path.posix.basename(vaultPath), vaultPath, note.displayTitle, typeof fm.title === 'string' ? fm.title : '',
      ...nameList(fm.aliases), ...gmAliasList(fm)];
    for (const name of all) {
      if (typeof name !== 'string' || !name.trim()) continue;
      names.add(foldName(canonicalNfc(name)));
      const slug = slugify(canonicalNfc(name));
      if (slug !== 'untitled') slugs.add(slug);
    }
  }
  HIDDEN_NAMES.set(linkMap, names);
  HIDDEN_SLUGS.set(linkMap, slugs);
}

// The parts of a link's path, tidied: slashes and dot segments normalised, empty parts dropped, and a .html / .htm / .md
// ending taken off each part.
const pathParts = (text) => path.posix.normalize(`/${text.replace(/\\/g, '/')}`).split('/')
  .filter(Boolean).map((part) => part.replace(/\.(?:html?|md)$/i, ''));

// Addresses that are not a note and not on the site, and may stand as written (a mail or phone link).
const PASS_SCHEME_RE = /^(?:mailto|tel):/i;
const ANY_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function resolveSiteLink(link, { linkMap = Object.create(null), pages = [] } = {}) {
  const text = String(link == null ? '' : link).trim();
  if (/^https?:\/\//i.test(text)) return { kind: 'outside', href: text };
  if (PASS_SCHEME_RE.test(text)) return { kind: 'outside', href: text };
  if (ANY_SCHEME_RE.test(text) && !/^[a-z]:[\\/]/i.test(text)) return { kind: 'none', href: null };
  // The target is read as a wiki-link target is: brackets, `|label`, `#heading`, `^block` and `.md` come off, in
  // either spelling. The site has no heading anchors, so a heading is dropped. The name is tried with its folder
  // path and then without it.
  const wiki = /^\[\[([\s\S]+)\]\]$/.exec(text);
  // Percent-escapes are read as the browser would read them; one that is malformed is a link nobody can vouch for.
  let decoded;
  try { decoded = decodeURIComponent(wiki ? wiki[1] : text); } catch (e) { return { kind: 'none', href: null }; }
  const target = canonicalNfc(parseWikilink(decoded).name.replace(/\?[\s\S]*$/, '').trim());
  const parts = pathParts(target);
  const name = parts.length ? canonicalNfc(parts.join('/')) : '';
  if (name) {
    const candidates = [name];
    const last = parts[parts.length - 1];
    if (last !== name) candidates.push(last);
    if (!LOWER_KEYS.has(linkMap)) {
      const keys = new Map();
      for (const key of Object.keys(linkMap)) if (!keys.has(foldName(key))) keys.set(foldName(key), linkMap[key]);
      LOWER_KEYS.set(linkMap, keys);
    }
    for (const candidate of candidates) {
      const exact = linkMap[candidate] || (pages.find(p => canonicalNfc(p.title) === candidate) || {}).outputPath;
      if (exact) return { kind: 'page', href: exact };
      // The same name in another letter case is that page (the names of notes with pages are in the link map).
      const loose = LOWER_KEYS.get(linkMap).get(foldName(candidate));
      if (loose) return { kind: 'page', href: loose };
    }
  }
  // A bracketed link is a note, and no page was found for it: never printed.
  if (wiki) return { kind: 'none', href: null };
  // The address of a published page, spelled as the build writes it, stands.
  const address = parts.join('/').toLowerCase();
  if (Object.values(linkMap).some((p) => String(p).toLowerCase() === address)) return { kind: 'site', href: text.replace(/^\.\//, '') };
  // Anything else: if ANY part of the path is the name, file name, title, alias or slug of a hidden note, it is dropped.
  const hiddenNames = HIDDEN_NAMES.get(linkMap) || new Set();
  const hiddenSlugs = HIDDEN_SLUGS.get(linkMap) || new Set();
  if (parts.some((part) => hiddenNames.has(foldName(part)) || hiddenSlugs.has(slugify(part)))) return { kind: 'none', href: null };
  return { kind: 'site', href: text.replace(/^\.\//, '') };
}

// Build the site. With `options.inMemory` every page is rendered exactly as it would be
// written, and nothing is written, cleaned, copied or printed: `doctor --site` and
// `explain --shown` read the site this way, so what they report is what the build makes.
//   options.vaultPath   another vault through this site's rules (`--vault`)
//   options.rawConfig   the site file already parsed
//   options.shownFor    in memory: a vault-relative note path; the result's `shown` is what
//                       the site holds of it, built as if it published
// Returns { noteFaults, shown }.
function build(options = {}) {
  return options.inMemory ? quietly(() => buildSite(options)) : buildSite(options);
}

function buildSite(options) {
  const dry = options.inMemory === true;
  const configPath = options.configPath || './vault.config.json';
  const resolvedConfigPath = path.resolve(configPath);
  const configDir = path.dirname(resolvedConfigPath);
  const rawConfig = options.rawConfig ? Object.assign({}, options.rawConfig) : loadVaultConfig(resolvedConfigPath);
  rawConfig.vaultPath = options.vaultPath ? path.resolve(options.vaultPath) : path.resolve(configDir, rawConfig.vaultPath);
  // `allowFaults` is for the GM-site build a later change adds; nothing passes it yet but tests.
  const printWarning = (m) => console.warn(`  WARNING: ${m}`);
  const { config, publishConfig } = resolveConfig(rawConfig, rawConfig.vaultPath, printWarning, { quietStops: !options.allowFaults, siteDir: configDir });
  if (!options.allowFaults) assertNoStops(publishConfig, 'build');
  // `outputDirOverride` is the local preview's too: it builds into a temp directory, never the site's own.
  const outputDir = options.outputDirOverride ? path.resolve(options.outputDirOverride) : path.resolve(configDir, config.outputDir);
  const off = siteOff(publishConfig.switches, rawConfig.vaultPath);
  // A setting named in a message is named as this vault's file writes it.
  const nm = (name) => nameIn(rawConfig.vaultPath, name);
  if (off && !dry) throw new Error(off);
  // The vault's build steps run only for the `build` and `deploy` commands (`options.runSteps`): never in a dry build,
  // the preview, or any command that only reads. Before anything is read from the vault, in the site folder.
  const runningSteps = options.runSteps === true && !dry && !options.outputDirOverride;
  if (runningSteps) {
    const notes = packageNotes(publishConfig.layout === 'new' ? packageScripts(configDir) : {}, publishConfig.steps);
    if (notes.twice) printWarning(notes.twice);
    if (notes.only) (options.stepsLog || console.log)(`  ${notes.only}`);
    if (publishConfig.steps.before.length) runSteps(publishConfig.steps.before, { cwd: configDir, label: 'before_build', log: options.stepsLog, stdio: options.stepsStdio });
  }

  if (config.host === 'cloudflare-pages' && typeof config.siteUrl === 'string' && /github\.io/i.test(config.siteUrl)) {
    console.warn(
      `⚠️  ${nm('player_site.host')} is "cloudflare-pages" but ${nm('player_site.url')} looks like a GitHub Pages URL (${config.siteUrl}).\n` +
      `   Cloudflare serves at the root, so the 404 page's links will break.\n` +
      `   Set ${nm('player_site.url')} to your Cloudflare URL (e.g. https://<project>.pages.dev) and rebuild.`
    );
  }

  // The switches decide what the GM wants; a KV store (wrangler.toml, next to the site's
  // vault.config.json) decides whether it can work. Templates read publishConfig.live and
  // nothing else, so this must run before any page renders. A switch on without a KV
  // store is withheld and said so.
  const switches = publishConfig.switches || {};
  // `assumeKv` is the local preview's (scripts/live-preview.js): a store that is in memory, with no wrangler.toml.
  const kvWired = options.assumeKv === true || hasRealKvId(configDir);
  publishConfig.live = {
    stats: switches.liveStats === true && kvWired,
    inbox: switches.inbox === true && kvWired,
  };
  if (!kvWired) {
    if (switches.liveStats === true) console.warn(`  WARNING: ${nm('player_site.features.live_stats')} is on but this site has no KV store wired; live stats are not published`);
    if (switches.inbox === true) console.warn(`  WARNING: ${nm('player_site.features.inbox')} is on but this site has no KV store wired; the change-request inbox is not published`);
  }
  const genrePreset = publishConfig.theme.genre;
  publishConfig._genrePreset = genrePreset;
  const manifest = loadManifest(config.vaultPath);
  const excludeSections = publishConfig.exclude_sections;
  // The PC keep-list: null while character sheets are on, otherwise the sections a PC publishes.
  const pcKeepSections = pcKeepList(publishConfig);
  // The one derivation of "sheets off": the filter's own answer, handed to the page template.
  const sheetsOff = pcKeepSections !== null;
  const excludeCallouts = publishConfig.exclude_callouts;
  const excludeFields = publishConfig.exclude_fields;
  const fieldOverrides = publishConfig.overrides.fields || {};

  function assertSafeOutputDir() {
    // Real paths: a link in the site folder that leads to the vault is the vault.
    const real = (p) => { try { return fs.realpathSync.native(path.resolve(p)); } catch { return path.resolve(p); } };
    const resolved = real(outputDir);
    const root = path.parse(resolved).root;
    if (resolved === root) {
      throw new Error(`Refusing to clean filesystem root: ${resolved}`);
    }
    const resolvedVault = real(config.vaultPath);
    if (resolved === resolvedVault || resolvedVault.startsWith(resolved + path.sep)) {
      throw new Error(`Refusing to clean the output folder (${nm('player_site.output')}) that contains the vault: ${resolved}`);
    }
    if (resolved.startsWith(resolvedVault + path.sep)) {
      throw new Error(`Refusing to write the output folder (${nm('player_site.output')}) inside the vault: ${resolved}`);
    }
  }

  function cleanOutput() {
    if (dry) return;
    // A build that is let past the settings' faults (allowFaults) still never cleans a folder it cannot trust.
    if (publishConfig.faults.some((f) => f.level === 'stop' && (f.setting === 'player_site.output' || f.setting === 'player_site.keep'))) {
      throw new Error('The build did not start: it will not clean a folder while it cannot read where to build or what to keep.');
    }
    if (!fs.existsSync(outputDir)) return;
    assertSafeOutputDir();
    for (const entry of fs.readdirSync(outputDir)) {
      // A kept folder is kept in any letter case: this can only keep more.
      if (config.preserveDirs.some((kept) => kept.toLowerCase() === entry.toLowerCase())) continue;
      const full = path.join(outputDir, entry);
      fs.rmSync(full, { recursive: true, force: true });
    }
  }

  function ensureDir(filePath) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
  }

  // Every stylesheet the build writes goes through scopeColorScheme, so its light-mode
  // rules also answer to the reader's toggle (#260).
  function copyCSS() {
    if (dry) return;
    const src = path.join(__dirname, '../css/style.css');
    const dest = path.join(outputDir, 'css/style.css');
    ensureDir(dest);
    fs.writeFileSync(dest, scopeColorScheme(fs.readFileSync(src, 'utf8')));
  }

  // A genre preset's own CSS may hardcode a Google Fonts @import for its default look
  // (scifi's Rajdhani) independent of theme.fonts.heading/body — that import is baked
  // into the static css/themes/*.css file, so theme.js's fontsPreamble (which only sees
  // the GM's configured fonts) never touches it. theme.fonts.source: local means no
  // request to Google at all, so strip any such @import line on copy (#211 follow-up).
  // Without a files entry supplying the preset's own font (e.g. Rajdhani), the stack
  // falls back to the next family in the preset's own --font-heading list.
  const GOOGLE_FONTS_IMPORT_RE = /^@import\s+url\(['"]?https?:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)[^)]*\)\s*;\s*$/;

  function copyGenreCSS() {
    if (dry) return;
    if (!genrePreset) return;
    const src = path.join(__dirname, `../css/themes/${genrePreset}.css`);
    const dest = path.join(outputDir, `css/themes/${genrePreset}.css`);
    ensureDir(dest);
    const fontsCfg = publishConfig.theme.fonts || {};
    let css = fs.readFileSync(src, 'utf8');
    if (fontsCfg.source === 'local' || fontsCfg.source === 'self-host') {
      css = css
        .split('\n')
        .filter((line) => !GOOGLE_FONTS_IMPORT_RE.test(line.trim()))
        .join('\n');
    }
    fs.writeFileSync(dest, scopeColorScheme(css));
    console.log(`  wrote css/themes/${genrePreset}.css`);
  }

  // `gm-publish init` scaffolds css/overrides.css next to vault.config.json as the seam for
  // durable per-site CSS. It is the only stylesheet the build does not generate, so it is the
  // only one safe to hand-edit — theme.css is rewritten every build. Returns whether a link
  // tag should be emitted; absent file means no link, no 404.
  function copyOverridesCSS() {
    const src = path.join(configDir, 'css/overrides.css');
    if (!fs.existsSync(src)) return false;
    if (dry) return true;
    const dest = path.join(outputDir, 'css/overrides.css');
    // Output inside the site dir: never rewrite the GM's own source file.
    if (path.resolve(src) === path.resolve(dest)) return true;
    ensureDir(dest);
    fs.writeFileSync(dest, scopeColorScheme(fs.readFileSync(src, 'utf8')));
    console.log('  wrote css/overrides.css');
    return true;
  }

  function copyJS() {
    if (dry) return;
    const jsDir = path.join(__dirname, '../js');
    if (!fs.existsSync(jsDir)) return;
    const destDir = path.join(outputDir, 'js');
    for (const file of fs.readdirSync(jsDir)) {
      if (!file.endsWith('.js')) continue;
      // The link-preview script is for a site that has the cards file; with previews off no
      // page loads it, so it is not copied.
      if (file === 'previews.js' && publishConfig.link_previews === 'off') continue;
      // Likewise the Connections script: with Connections off no page holds a section or loads it.
      if (file === 'connections.js' && publishConfig.connections === 'off') continue;
      const src = path.join(jsDir, file);
      const dest = path.join(destDir, file);
      ensureDir(dest);
      fs.copyFileSync(src, dest);
      console.log(`  wrote js/${file}`);
    }
  }

  // theme.fonts.source: 'self-host' (#270): read the vault's font cache (filled by the async
  // prefetch before build()) into @font-face rules and a list of files to copy. Includes a
  // genre preset's own Google font (scifi's Rajdhani), whose @import copyGenreCSS strips.
  // A cache miss warns and leaves the family on its fallback stack — never a Google import.
  let selfHosted = null;
  function selfHostedFonts() {
    if (selfHosted) return selfHosted;
    const fonts = publishConfig.theme.fonts || {};
    selfHosted = { css: '', files: [] };
    if (fonts.source === 'self-host') {
      const families = fontsLib.selfHostFamilies(fonts, fontsLib.presetFamiliesFor(publishConfig.theme));
      selfHosted = fontsLib.selfHostedFontFaces(config.vaultPath, families);
    }
    return selfHosted;
  }

  // Source 'google' means every visitor's browser calls Google on page load. Say so, once
  // per build, whenever an import is actually emitted (#270).
  function warnGoogleFonts() {
    const fonts = publishConfig.theme.fonts || {};
    if (fonts.source === 'local' || fonts.source === 'self-host') return;
    const names = [...googleFontNames(fonts), ...fontsLib.presetFamiliesFor(publishConfig.theme)]
      .filter((v, i, a) => a.indexOf(v) === i);
    if (names.length === 0) return;
    console.warn(`  WARNING: ${fontsLib.GOOGLE_WARNING(names.join(', '))}`);
  }

  function copyFontFiles(files) {
    if (dry) return;
    for (const f of files) {
      const dest = path.join(outputDir, 'fonts', f.rel);
      ensureDir(dest);
      fs.copyFileSync(f.from, dest);
      console.log(`  wrote fonts/${f.rel}`);
    }
  }

  function copySelfHostedFonts() {
    copyFontFiles(selfHostedFonts().files);
  }

  function writeThemeCSS() {
    if (dry) return;
    warnGoogleFonts();
    const css = scopeColorScheme(generateThemeCSS(publishConfig.theme, { selfHostCss: selfHostedFonts().css }));
    const dest = path.join(outputDir, 'css/theme.css');
    ensureDir(dest);
    fs.writeFileSync(dest, css);
    console.log('  wrote css/theme.css');
  }

  // theme.fonts.source: 'local' (#211): the @font-face rules theme.js writes into
  // css/theme.css reference "../fonts/<fontOutputPath(path)>" — copy each listed file to
  // that same path (the full relative subpath, not just the basename, so two fonts that
  // happen to share a filename in different subfolders don't overwrite each other —
  // #211 follow-up) so the reference resolves. Same vault-relative safety check as
  // campaign_image: resolves against vaultPath, throws if it escapes the vault, warns
  // and skips (never fails the build) if the file just isn't there. A path whose
  // extension isn't a real font format is rejected with a warning before any of that —
  // otherwise a mistyped `files[].path` (e.g. a GM's .md page) would get copied straight
  // into the public site.
  function copyThemeFonts() {
    if (dry) return;
    const fontsCfg = publishConfig.theme.fonts || {};
    copySelfHostedFonts();
    const files = Array.isArray(fontsCfg.files) ? fontsCfg.files : [];
    if (files.length === 0) return;
    const vaultRoot = path.resolve(config.vaultPath);
    for (const f of files) {
      if (!f || !f.path) continue;
      const outPath = fontOutputPath(f.path);
      const ext = outPath.includes('.') ? outPath.split('.').pop().toLowerCase() : '';
      if (!Object.prototype.hasOwnProperty.call(FONT_FORMATS, ext)) {
        console.warn(`  WARNING: ${nm('player_site.theme.fonts.files')} entry "${f.path}" is not a supported font file (.woff2/.woff/.ttf/.otf) — skipping`);
        continue;
      }
      const vaultFontPath = path.resolve(vaultRoot, f.path);
      if (!vaultFontPath.startsWith(vaultRoot + path.sep)) {
        throw new Error(`Refusing to copy font file outside vault: ${f.path}`);
      }
      if (!fs.existsSync(vaultFontPath)) {
        console.warn(`  WARNING: ${nm('player_site.theme.fonts.files')} entry "${f.path}" not found in the vault — skipping`);
        continue;
      }
      // outPath now carries the GM's full relative subpath (not just a basename), so a
      // path containing ".." segments could otherwise escape outputDir/fonts/ on write —
      // the same class of check as vaultFontPath above, applied to the destination.
      const fontsRoot = path.resolve(outputDir, 'fonts');
      const dest = path.resolve(fontsRoot, outPath);
      if (dest !== fontsRoot && !dest.startsWith(fontsRoot + path.sep)) {
        console.warn(`  WARNING: ${nm('player_site.theme.fonts.files')} entry "${f.path}" resolves outside the site's fonts/ directory — skipping`);
        continue;
      }
      ensureDir(dest);
      fs.copyFileSync(vaultFontPath, dest);
      console.log(`  wrote fonts/${outPath}`);
    }
  }

  function writeNoJekyll() {
    if (dry) return;
    fs.writeFileSync(path.join(outputDir, '.nojekyll'), '');
  }

  function write404() {
    if (dry) return;
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
    if (dry) return;
    for (const entry of Object.values(imageMap)) {
      const dest = path.join(outputDir, 'images', entry.relPath);
      ensureDir(dest);
      fs.copyFileSync(entry.encodedPath || entry.sourcePath, dest);
    }
    console.log(`Copied ${Object.keys(imageMap).length} images`);
  }

  // Main build logic
  if (!dry) assertSafeOutputDir();
  // publishConfig.exclude_dirs is already the normalized union of vault.config.json's
  // legacy `excludeDirs` and `publish.exclude_dirs` from vault-config.md (config.js's
  // unionExcludeDirs), but the raw `config` object handed to the scanner still only
  // carries the legacy field. scanConfigFor routes the scanner through the unioned list
  // so a GM who sets `publish.exclude_dirs` in vault-config.md is actually honoured
  // (#209), and scanAttachments applies the same skip list to the attachments tree
  // (#210). `explain`, `manifest diff` and `doctor --site` use the same helper so all
  // four predict exactly the same exclusions the build applies.
  const scanConfig = scanConfigFor(config, publishConfig);
  console.log('Scanning vault:', config.vaultPath);
  const scanReport = scanVaultReport(scanConfig);
  let pages = warnScanReport(scanReport);
  console.log(`Found ${pages.length} pages`);
  // Capture the scanned pages before the manifest/draft filters reassign `pages` to the published
  // subset, so templates can reach context that is excluded from rendering — above all the
  // `_Campaign` overview, which is normally unpublished. This preserves page *membership* only:
  // the page objects are shared, so any later field-level frontmatter filtering on published pages
  // is visible here too. Use corpus to reach excluded *pages* (e.g. the overview), not to recover
  // fields stripped from a *published* page.
  const corpus = pages.slice();

  // NFC-normalized (#139): manifest.publishing/excluded entries are already canonicalized
  // by manifest.js's stripInlineComment, so every Set.has()/lookup comparison against them
  // below needs the scanned path in the same normal form — otherwise an NFD-typed filename
  // (e.g. from an editor or OS that decomposes accents) silently fails to match its NFC
  // manifest entry, or vice versa.
  function vaultRelPathOf(page) {
    return vaultRelPath(config.vaultPath, page.sourcePath);
  }

  // A Publishing entry that matches no scanned file silently removes nothing and publishes
  // nothing — the page just never appears. Say so, so a typo can't blackhole a page.
  // Played sessions the manifest would withhold (#277): reported once, at the end of the
  // build, because the per-file warning drowns in a real build's log.
  const unpublishedPlayedSessions = [];
  if (manifest) {
    const scanned = new Set(corpus.map(vaultRelPathOf));
    for (const entry of manifest.publishing) {
      if (!scanned.has(entry)) {
        console.warn(`  WARNING: manifest lists "${entry}" but no such page was scanned`);
      }
    }

    // Reverse direction (#101): a played session/chapter present in the vault but absent from
    // the manifest silently never publishes — session-wrapup writes canon but never registers
    // the file, and the allowlist then drops it with no signal. The landing "Latest Session"
    // block falls back to the previous session while showing the new date, which reads as a
    // broken link. Warn on registrable types that are in neither the Publishing nor the
    // Excluded list (a deliberate exclusion is a decision, not an oversight). Only meaningful in
    // player mode — that is the only mode where the manifest is enforced as an allowlist (the
    // filter below); in full/GM mode unregistered pages still publish, so the warning would lie.
    if (publishConfig.mode === 'player') {
      const registered = new Set([...manifest.publishing, ...(manifest.excluded || [])]);
      const REGISTRABLE_TYPES = new Set(['session', 'session_wrap', 'chapter']);
      for (const page of corpus) {
        const type = page.frontmatter && page.frontmatter.type;
        if (!REGISTRABLE_TYPES.has(type)) continue;
        const rel = vaultRelPathOf(page);
        if (!registered.has(rel)) {
          if (type === 'session' && PLAYED_SESSION_STATUSES.has(String(page.frontmatter.status || '').toLowerCase())) {
            unpublishedPlayedSessions.push({ rel, title: page.title || path.basename(rel, '.md') });
            continue;
          }
          const kind = type === 'chapter' ? 'chapter' : 'session';
          console.warn(`  WARNING: "${rel}" (type: ${type}) is present in the vault but not in the publish manifest — this ${kind} will NOT publish. Add it to _meta/publish-manifest.md.`);
        }
      }
    }
  }

  // One verdict per page, from the shared decision module — the same call
  // `manifest diff`, `doctor --site` and `explain` make, so what those commands
  // predict is exactly what the build does. Everything that is not published is
  // dropped below, before the link map, so a link to a withheld page resolves to
  // nothing and renders as plain text rather than as a broken href. Story companion
  // files are folded into their PC first (the DRAFT rule needs that pairing). The
  // rename tool asks the same function for the pages the link map is built from.
  const { verdicts, published } = publishedPages(pages, {
    vaultPath: config.vaultPath, publishConfig, manifest, relOf: vaultRelPathOf,
  });
  // In memory, for `explain --shown`: the note asked about is built as if it published, so
  // what it would put on the site can be read before it is given a page. A story companion
  // is shown with its PC. A `publish: false` note is never built.
  const shownRel = dry && options.shownFor ? canonicalNfc(options.shownFor) : null;
  const shownPage = shownRel === null ? null
    : pages.find(p => vaultRelPathOf(p) === shownRel)
      || pages.find(p => p.storyMarkdown && vaultRelPathOf(p).replace(/\.md$/i, STORY_SUFFIX) === shownRel) || null;
  if (shownPage && !publishesPage(verdicts.get(shownPage)) && publishMode(shownPage.frontmatter) !== 'none') {
    verdicts.set(shownPage, { bucket: 'publish', code: 'OK', reason: 'built as if it published', outputPath: shownPage.outputPath });
    published.push(shownPage);
  }
  const withCode = (...codes) => pages.filter(p => codes.includes(verdicts.get(p).code));

  const draftExcluded = withCode('DRAFT_EXCLUDED');
  if (draftExcluded.length > 0) console.log(`Excluded ${draftExcluded.length} DRAFT entity/entities`);

  const autoExcluded = withCode(
    'AUTO_EXCLUDED_STATUS', 'AUTO_EXCLUDED_STAGE', 'AUTO_EXCLUDED_SOURCE', 'SCENE_CUT_SKIPPED');
  if (autoExcluded.length > 0) console.log(`Auto-excluded ${autoExcluded.length} prep/draft file(s)`);

  if (manifest && publishConfig.mode !== 'full') {
    // A prep file the GM explicitly listed under Publishing: named here because a
    // reader landing on a published prep page deserves an explanation for why it's
    // there. decidePage checks the manifest allowlist before the auto-exclude
    // heuristics (publish-decision.js's evaluation order), so a re-included page's
    // verdict code is OK, not AUTO_EXCLUDED_* — it never reaches the "Auto-excluded
    // N" tally above at all. That count is therefore always the pages genuinely
    // withheld today, not "auto-excluded, then some put back": this line is purely
    // informational rather than a subtraction from the one above it.
    const reincluded = pages.filter(p => autoExcludeCode(p.frontmatter) && publishesPage(verdicts.get(p)));
    if (reincluded.length > 0) {
      console.log(`Manifest override: re-included ${reincluded.length} auto-excluded file(s)`);
    }
  }

  if (manifest && publishConfig.mode === 'player') {
    // Everything the earlier rules let through: the manifest allowlist is the only
    // thing between these pages and the site. decidePage evaluates the allowlist
    // before `publish: false`, in the order build's own passes ran, so both those
    // codes count as having reached this stage.
    const beforeManifest = new Set([
      'DRAFT_EXCLUDED', 'AUTO_EXCLUDED_STATUS', 'AUTO_EXCLUDED_STAGE', 'AUTO_EXCLUDED_SOURCE',
      'SCENE_CUT_SKIPPED', 'DIR_ALWAYS_EXCLUDED', 'DIR_UNMAPPED', 'NO_TYPE',
    ]);
    const reachedManifest = pages.filter(p => !beforeManifest.has(verdicts.get(p).code));
    // Allowlist membership alone, exactly as the old pass counted it: `publish: false`
    // was dropped by a LATER pass, so a page that is both listed and never-publish
    // still counted on this line. It is subtracted on the next line instead.
    const allowSet = new Set(manifest.publishing);
    const kept = reachedManifest.filter(p => allowSet.has(vaultRelPathOf(p)));
    console.log(`Manifest filter: ${reachedManifest.length} → ${kept.length} pages`);
  }

  const neverPublish = withCode('PUBLISH_FALSE', 'PUBLISH_NONE');
  if (neverPublish.length > 0) {
    console.log(`publish: false — skipped ${neverPublish.length} file(s)`);
  }

  // A note the build writes no page for (previews.js getsNoPage) leaves the list here, with
  // the unpublished: the link map, backlinks, Connections, indexes, search and cards all read
  // `pages`, so none of them can name it or link to a file that is not built.
  pages = published.filter(p => !getsNoPage(p));

  const linkMap = buildLinkMap(pages);
  console.log(`Built link map with ${Object.keys(linkMap).length} entries`);

  // A GM alias must never reach the site (#212): rewrite every one to the
  // title of the note that owns it, in every scanned page's body and
  // frontmatter, before anything renders or derives from them. Owners come
  // from the whole vault; the rewrite runs over the corpus, not just `pages`,
  // because the landing page also reads unpublished pages.
  // pairHubs does that rewrite (in place, `apply`) and then pairs each session index with
  // its Wrap-Up — the one alias-then-pair path `explain` and `manifest publish-played`
  // take too, so all three pair on the same frontmatter (#276).
  const allNotes = scanAllNotes(config.vaultPath);   // read once: the pairing and the note-faults audit both take it
  rememberHiddenNames(linkMap, allNotes);
  const hubPairs = pairHubs(corpus, pages, { vaultPath: config.vaultPath, apply: true, allNotes, withheldWords: publishConfig.withheld_words });

  // Reduce every page's frontmatter to its PUBLISHED view before anything
  // derived is built from it.
  //
  // This used to run ~80 lines further down, after backlinks, the search index
  // and Connections had all already read the raw frontmatter — so
  // excluding a field removed it from the page and left it in every derived
  // view (#166). Excluding `relationships` still drew the old graph, with the
  // secret targets as node labels; excluding `occupation` still shipped it as
  // the search-index subtitle. The link map is built above and is what redirect
  // resolution actually consults, so `aliases`/`canon_status` are safe to strip
  // from here on.
  //
  // A session index with a published Wrap-Up has its body withheld (#276; the rule is
  // session-hub.js's). Decided for every page before this loop reduces any frontmatter,
  // and the body emptied inside it, before the published view is computed, so search,
  // backlinks, recency, Connections and the landing fallback agree with the
  // page. A hub linking a prepped NPC who never appeared must not become that NPC's
  // "Mentions".
  //
  // The pairs are computed HERE, once, on the unreduced frontmatter, and handed to every
  // reader — the session page, the Saga, the landing recap and recency. None of them
  // pairs on its own: excluding `documents`, `session` or `aliases` below would leave a
  // late re-pairing blind to the very links that paired the page (#276 final review).
  const hubWrapUps = new Map();
  for (const page of pages) {
    if (hubPairs.has(page)) hubWrapUps.set(page, hubPairs.get(page));
  }
  const stubFacts = new Map();
  hubWrapUps.linked = hubPairs.linked;
  for (const page of pages) {
    if (hubWrapUps.has(page)) page.markdown = '';
    // `publish: stub` — emit the page shell so navigation and links still work,
    // but keep only the sections the GM explicitly named. Applied to
    // page.markdown itself, before the published view is computed, so every
    // downstream reader sees the same reduced body.
    if (publishMode(page.frontmatter) === 'stub') {
      const include = Array.isArray(page.frontmatter.publish_include_sections)
        ? page.frontmatter.publish_include_sections
        : [];
      // The cut is made on what the whole note publishes: cut first, and the heading or
      // marker that hid a line goes with it, so the strips below could not (#320). An
      // unclosed marker is reported from here: the cut text no longer holds it.
      const withhold = { excludeSections, excludeCallouts, frontmatter: page.frontmatter,
        warn: (message) => console.warn(`  WARNING: ${page.outputPath}: ${message}`) };
      // The cut text no longer holds a stray %% or an unclosed fence either: kept for the audit.
      const source = String(page.markdown || '');
      const cut = stubCut(source, include, withhold);
      stubFacts.set(page, { source, strays: cut.strays, openFence: cut.openFence });
      page.markdown = cut.text;
      // A PC's story companion is a SEPARATE file paired in by the scanner and
      // rendered on its own page. Reducing only page.markdown left a stubbed PC
      // publishing its complete story — the same content the stub exists to
      // withhold, one URL over.
      if (page.storyMarkdown) {
        page.storyMarkdown = keepOnlySections(page.storyMarkdown, include, withhold);
      }
    }
    const overridesForFile = fieldOverrides[vaultRelPathOf(page)] || {};
    // The section strip reads the file's own `type` (a handout's Keeper sections,
    // #280), which exclude_fields or publish_exclude_fields can remove from the
    // reader-facing copy below. Keep the original for it.
    page.sourceFrontmatter = page.frontmatter;
    page.frontmatter = publishedFrontmatter(
      page.frontmatter, excludeFields, overridesForFile);
  }

  // Two PCs on one live key would share one set of live stats (HP, loadouts, party board).
  {
    const byKey = new Map();
    for (const page of pages) {
      const fm = page.sourceFrontmatter || page.frontmatter;
      if (!fm || fm.type !== 'pc') continue;
      const key = pcLiveKey(fm, page.title);
      byKey.set(key, (byKey.get(key) || []).concat(vaultRelPathOf(page)));
    }
    for (const [key, rels] of byKey) {
      if (rels.length > 1) console.warn(`  WARNING: ${rels.join(' and ')} share the live key "${key}", so they share one set of live stats. Give one a different live_key in its frontmatter.`);
    }
  }

  // Scanned here, not later, because the keep-list stability check below reads it.
  const imageMap = scanAttachments(scanConfig);

  const { buildBacklinks, backlinksOf } = require('./backlinks');
  const { buildSearchIndex } = require('./search-index');
  const { scoreByRecency } = require('./recency');

  // Compute each page's "published view" — markdown with gm-only/spoiler blocks and
  // excluded sections removed — once, so derived widgets (backlinks, recency, the
  // Connections) never surface names that only appear in unpublished content
  // (B6 spoiler leak). Spoiler blocks are unrevealed narrative content, not permanent
  // secrets, but they're just as unpublished until reconcile's reveal step strips the
  // fence — until then they must never surface in a derived widget either.
  // A PC note whose link or embed labels would change its headings is withheld whole
  // while character sheets are off. Decided once, here, so the page, its sections and
  // the search/backlink text all get the same answer.
  for (const page of pages) {
    if (!pcKeepSections) break;
    page.headingsUnstable = pcHeadingsUnstable(page, linkMap, excludeSections, imageMap, { excludeCallouts, pcKeepSections });
    if (page.headingsUnstable) console.warn(`  WARNING: ${page.outputPath}: ${HEADINGS_UNSTABLE_WARNING}`);
  }
  // What the strip chain reports as it runs (a stray %%, an unclosed fence), kept for the
  // note-faults audit at the end: the chain is not run a second time for it.
  const stripFacts = new Map();
  for (const page of pages) {
    const source = String(page.markdown || '');
    const stripped = strippedLines(source, excludeCallouts);
    const fm = page.sourceFrontmatter || page.frontmatter;
    // A stub's facts were taken when it was cut. A fault that lies wholly in text the page
    // hides anyway (noteFacts) is none; a note withheld whole shows none.
    stripFacts.set(page, stubFacts.get(page) || {
      source,
      ...noteFacts(stripped, (lines) => (page.headingsUnstable ? lines.map(() => false) : keptFlags(lines, excludeSections, fm, { pcKeepSections }))),
    });
    const text = stripped.lines.join('\n');
    page.publishedMarkdown = page.headingsUnstable ? '' : filterSections(text, excludeSections, fm,
      { pcKeepSections });   // its warnings are the page render's to print, once
  }

  // Whether a Story section will exist. Computed early (pure function of pages) so the
  // top nav — threaded into every page, including story pages built later — can point
  // the Story group at story.html. Must match what buildStory() emits below.
  const hasStory = buildStorySpine(pages, null, hubWrapUps).length > 0
    || pages.some(p => p.frontmatter && p.frontmatter.type === 'pc' && p.storyMarkdown);

  // Build-time data pipeline
  const backlinks = buildBacklinks(pages, linkMap);
  console.log(`Built backlinks for ${Object.keys(backlinks).length} entities`);

  const sessions = pages.filter(p => p.frontmatter.type === 'session');
  const chapters = pages.filter(p => p.frontmatter.type === 'chapter');
  const npcs = pages.filter(p => p.frontmatter.type === 'npc');
  const locations = pages.filter(p => p.frontmatter.type === 'location');

  const landingConfig = (publishConfig.landing || {});
  const recencyWindow = landingConfig.recency_window;

  // Pinned entries come first, in the order the GM listed them; recency fills
  // whatever slots are left. This is the supported way to override the scoring
  // heuristic — without it a GM who knows which entities matter this session
  // has to reverse-engineer a score to feature them, and cannot break a tie at
  // all. Named by the same form a wiki-link uses (the filename), so a name that
  // can be linked can be pinned.
  function withFeatured(scored, candidates, featured, max, label) {
    const names = Array.isArray(featured) ? featured.filter(n => typeof n === 'string') : [];
    if (names.length === 0) return scored.slice(0, max);
    const byName = new Map(candidates.map(p => [canonicalNfc(p.title), p]));
    const pinned = [];
    const seen = new Set();
    for (const name of names) {
      const page = byName.get(canonicalNfc(name));
      if (!page) {
        // Silence here would repeat the very complaint this fixes: config that
        // looks applied and does nothing.
        console.warn(`  WARNING: ${nm(`player_site.landing.${label}`)} names "${name}", which is not a published ${label.replace('featured_', '').replace(/s$/, '')} — check spelling, or it may be excluded from the site`);
        continue;
      }
      if (seen.has(page.outputPath)) continue;
      seen.add(page.outputPath);
      pinned.push({ page, score: Infinity, pinned: true });
    }
    const rest = scored.filter(s => !seen.has(s.page.outputPath));
    return [...pinned, ...rest].slice(0, max);
  }

  const maxNPCs = landingConfig.max_npcs;
  const maxLocations = landingConfig.max_locations;

  const recentNPCs = withFeatured(
    scoreByRecency(npcs, sessions, chapters, {
      gone: publishConfig.statuses.gone, window: recencyWindow, max: maxNPCs, type: 'npc', wrapUpFor: hubWrapUps,
    }),
    npcs, landingConfig.featured_npcs, maxNPCs, 'featured_npcs');

  const recentLocations = withFeatured(
    scoreByRecency(locations, sessions, chapters, {
      gone: publishConfig.statuses.gone, window: recencyWindow, max: maxLocations, type: 'location', wrapUpFor: hubWrapUps,
    }),
    locations, landingConfig.featured_locations, maxLocations, 'featured_locations');

  // Quick links: a short GM-curated row of "go here first" pages — a map, a
  // calendar, a house-rules page. Resolved here rather than in the template so
  // an unresolvable name warns once, in the same place as the featured_* names.
  const quickLinks = [];
  {
    const names = Array.isArray(landingConfig.quick_links)
      ? landingConfig.quick_links.filter(n => typeof n === 'string')
      : [];
    const byName = new Map(pages.map(p => [canonicalNfc(p.title), p]));
    const seen = new Set();
    for (const name of names) {
      const page = byName.get(canonicalNfc(name));
      if (!page) {
        console.warn(`  WARNING: ${nm('player_site.landing.quick_links')} names "${name}", which is not a published page — check spelling, or it may be excluded from the site`);
        continue;
      }
      if (seen.has(page.outputPath)) continue;
      seen.add(page.outputPath);
      quickLinks.push(page);
    }
  }
  publishConfig._quickLinks = quickLinks;

  console.log(`Recency: ${recentNPCs.length} NPCs, ${recentLocations.length} locations`
    + (quickLinks.length ? `, ${quickLinks.length} quick links` : ''));

  // Search index (skip if searchEnabled explicitly set to false in config)
  const searchEnabled = config.searchEnabled !== false;
  const searchData = searchEnabled ? buildSearchIndex(pages) : null;

  publishConfig._linkMap = linkMap;
  publishConfig._backlinks = backlinks;
  publishConfig._recentNPCs = recentNPCs;
  publishConfig._recentLocations = recentLocations;

  // What each page's subject is connected to (lib/connections.js), built once from the
  // published list. The pairs handed over are `hubWrapUps` (hub page -> its Wrap-Up, only
  // for hubs in `pages`), not the raw `hubPairs`, which also pairs unpublished hubs.
  const { buildConnections, isEmpty: noConnections } = require('./connections');
  const connectionExtras = new Map();
  publishConfig._connections = publishConfig.connections === 'off' ? null
    : buildConnections({ pages, linkMap, backlinks, hubPairs: hubWrapUps, imageMap, extras: connectionExtras });
  // The lists a session or chapter page gathers (who appeared, what happened, which sessions
  // a chapter holds). `for(page)` reads `connectionExtras` lazily, so filling it after the
  // index is built is sound; nothing asks for a model until a page renders.
  function connectionExtrasFor(page) {
    const extras = [];
    if (page.frontmatter.type === 'session') {
      // A hub whose body is withheld (#276) takes its NPCs and events from the
      // Wrap-Up — who actually appeared — since its own links were prep, not play.
      const source = hubWrapUps.get(page) || page;
      const appearedIn = (p) => backlinksOf(backlinks, p).some(b => b.outputPath === source.outputPath);
      for (const p of pages) if (p.frontmatter.type === 'npc' && appearedIn(p)) extras.push({ group: 'Appearing', page: p });
      for (const p of pages) if (p.frontmatter.type === 'event' && appearedIn(p)) extras.push({ group: 'Events', page: p });
    }
    if (page.frontmatter.type === 'chapter') {
      // All three comparisons below are author-typed `chapter:` ref vs filename-derived
      // title, matched with `===`/`includes` rather than through a lookup table, so both
      // sides are canonicalized to NFC here (#139) — otherwise an accented chapter lists
      // no sessions.
      const chapterTitle = canonicalNfc(String(page.frontmatter.title || page.displayTitle || ''));
      const chapterTitleNorm = chapterTitle.toLowerCase();
      const chapterFileTitle = canonicalNfc(page.title);
      const chapterFilename = chapterFileTitle.replace(/_/g, ' ');
      for (const p of pages) {
        if (p.frontmatter.type !== 'session') continue;
        // A labelled link names its chapter by the target; its label is words to match on too.
        const chapterLink = linkText(p.frontmatter.chapter || '');
        const chapterRef = canonicalNfc(chapterLink.key.trim());
        if (!chapterRef) continue;
        if (chapterRef === chapterFileTitle      // 1. the filename stem (e.g. "Chapter_1_Overview")
          || chapterRef === chapterFilename      // 2. the stem with underscores as spaces
          // 3. case-insensitive substring: the chapter's display title appears in the session's
          //    chapter ref (e.g. "Harbour" in "Chapter 1 — Harbour: The Lantern Guild")
          || (chapterTitleNorm && (chapterRef.toLowerCase().includes(chapterTitleNorm)
            || canonicalNfc(chapterLink.words).toLowerCase().includes(chapterTitleNorm)))) {
          extras.push({ group: 'Sessions', page: p });
        }
      }
    }
    return extras;
  }
  for (const page of pages) {
    const extras = connectionExtrasFor(page);
    if (extras.length) connectionExtras.set(page, extras);
  }

  // Where the timeline actually lives. Decided after field filtering — so an excluded
  // `in_game_date` can't resurrect a timeline the GM meant to suppress — but before the nav
  // is built, so the nav link and the events/ redirect can't disagree with the renderer.
  // A root timeline.html is generated only when dated events exist; failing that, an
  // authored Timeline page (which a folderMap may place anywhere, e.g.
  // campaign/timeline.html) is the real target. With neither, Events keeps its own index.
  const { buildTimelineData, eventsNaming, renderTimelineHTML, renderTimelineStrip } = require('./timeline');
  const timelineData = buildTimelineData(pages);
  const generatesTimeline = timelineData.events.length > 0;
  // An authored Timeline takes Events over only when players would find something on it:
  // a title and bare headings (what a new vault starts with) would hide the list of events.
  const hasEntries = (p) => playerSafeMarkdown(p.markdown, { excludeCallouts, excludeSections, frontmatter: p.sourceFrontmatter || p.frontmatter }).text
    .split('\n').some(line => line.trim() && !/^#{1,6}\s/.test(line.trim()));
  const authoredTimeline = pages.find(p => p.frontmatter.type === 'timeline' && hasEntries(p))
    || pages.find(p => p.outputPath.split('/').pop() === 'timeline.html' && hasEntries(p));
  const timelineHref = generatesTimeline
    ? 'timeline.html'
    : (authoredTimeline ? authoredTimeline.outputPath : null);

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
  if (!dry && resolveImageConfig(publishConfig.images).optimize) {
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
  // Only a genre preset ships two palettes. A custom palette has one, and theme.css writes
  // it after the preset, so with one set a toggle would change nothing visible.
  const twoPalettes = Boolean(genrePreset) && !publishConfig.theme.palette;
  configureColorMode(twoPalettes
    ? headScript(publishConfig.theme.default_mode, storageKey(config.siteUrl || config.siteTitle || configDir))
    : '');
  if (!twoPalettes && publishConfig.theme.default_mode !== 'system') {
    console.warn(`${nm('player_site.theme.default_mode')} "${publishConfig.theme.default_mode}" has no effect: `
      + `it needs a genre preset (${nm('player_site.theme.genre')}) and no custom ${nm('player_site.theme.palette')}, the themes with two palettes`);
  }
  configureLinkPreviews(publishConfig.link_previews);
  configureConnections(publishConfig.connections);
  copyCSS();
  copyJS();
  copyGenreCSS();
  writeThemeCSS();
  copyThemeFonts();
  publishConfig._overridesCss = copyOverridesCSS();

  const campaignImageSource = publishConfig.theme.campaign_image;
  let campaignImageCopied = false;
  // Resolve campaign_image: copy from vault to output and rewrite to output-relative path
  if (!dry && publishConfig.theme.campaign_image) {
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
  if (dry) {
    // nothing is written
  } else if (searchData) {
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

  // The GM's extra menu entries (player_site.menu_extra), each link read by resolveSiteLink. An entry that
  // names a note with no page is left out, with a warning, and prints nothing. The labels of the rest are
  // texts the note audit reads.
  const menuExtra = [];
  for (const item of publishConfig.menu_extra || []) {
    const read = resolveSiteLink(item.link, { linkMap, pages });
    if (read.kind === 'none') {
      console.warn(`  WARNING: ${nm('player_site.menu_extra')} entry "${item.label}" links to "${item.link}", which is a note the site makes no page of, or an address the site cannot link to — it is left out of the menu`);
      continue;
    }
    menuExtra.push({ label: item.label, href: read.href, external: read.kind === 'outside', group: item.group || null });
  }
  const navFor = generateNav(pages, { hasStory, timelineHref, extra: menuExtra });

  // Render each page
  const usedImages = new Set();
  // The CoC sheet masthead renders a campaign-level crest (publishConfig.sheet_crest);
  // register it so the image-manifest pruning below doesn't drop it from the output.
  if (publishConfig.sheet_crest) {
    // Canonical NFC (#139): usedImages is matched against imageMap's own (NFC) keys by the
    // player-mode prune below, so a crest named in the other normal form must register the
    // key the map actually holds — otherwise the crest resolves on the page and is then
    // never copied.
    const crestBase = canonicalNfc(String(publishConfig.sheet_crest).split('/').pop());
    if (crestBase && imageMap[crestBase]) usedImages.add(crestBase);
  }
  let errorCount = 0;
  const renderErrors = [];   // what failed to render, for a caller that gets no console (the in-memory build)
  let auditGaps = 0;         // pages the note-faults audit could not render a second time
  const partyEntries = [];
  // PCs whose system has a sheet renderer that produced no sheet (#273).
  const sheetlessPcs = [];
  const retiredFieldPcs = [];
  const SHEETLESS_NAMED = 8;   // names printed before "and N more"
  const partyCampaignId = require('./scanner').slugify(config.siteTitle || 'campaign');
  const deferredRosters = [];
  // The party board the roster page carries, made once every PC page has been rendered.
  const roster = { board: null, partyManifest: null, live: false };
  const dressedSkins = new Set();
  let anyDressed = false;
  // One page as the site prints it: { html }, or { roster: processed } for the party roster,
  // which is rendered once every PC has been (renderRoster). `fx` is where the render's side
  // effects go (images used, warnings, party-board entries, the sheet tallies, a dressed
  // sheet): the build's own (`liveFx`), or throwaway ones when the audit renders a page again.
  function renderPage(page, fx) {
    const usedImages = fx.usedImages;
    if (page.frontmatter.portrait) {
      const basename = canonicalNfc(String(page.frontmatter.portrait).split('/').pop());
      if (basename && imageMap[basename]) usedImages.add(basename);
    }
    const processed = processContent(page, linkMap, excludeSections, imageMap, { usedImages, excludeCallouts, pcKeepSections });
    fx.warn(page.outputPath, processed.warnings);
    let html;

    if (isRoster(page)) return { roster: processed };

    switch (page.frontmatter.type) {
      case 'pc': {
        // Warnings are dropped here, not ignored: processContent above ran this same
        // strip chain over the same markdown and already reported them.
        let filtered = page.headingsUnstable ? '' : playerSafeMarkdown(page.markdown, { excludeCallouts, excludeSections, pcKeepSections, frontmatter: page.sourceFrontmatter || page.frontmatter }).text;
        // Images before wikilinks: resolveWikiLinks' `[[…]]` pattern also matches the inner
        // brackets of an `![[image.png]]` embed and would flatten it to literal text.
        filtered = resolveImageEmbeds(filtered, imageMap, page.outputPath, usedImages, {
          portraitBasename: portraitBasename(page.frontmatter),
        });
        filtered = resolveWikiLinks(filtered, linkMap, page.outputPath);
        const sections = extractSections(filtered);

        let storyHtml;
        // The page links to the story's own page (storyHref below) and prints none of it;
        // rendering it here registers the images it uses. The audit's second render needs neither.
        if (page.storyMarkdown && fx === liveFx) {
          const storyPage = {
            markdown: page.storyMarkdown,
            frontmatter: {},
            outputPath: page.outputPath,
          };
          const storyProcessed = processContent(storyPage, linkMap, excludeSections, imageMap, { usedImages, excludeCallouts });
          fx.warn(page.outputPath, storyProcessed.warnings);
          storyHtml = storyProcessed.html && storyProcessed.html.trim() ? storyProcessed.html : undefined;
        }

        const system = publishConfig.system;
        // With sheets off the renderer is never called: no sheet, tab, panel, island or party entry exists to leak.
        const systemRenderer = sheetsOff ? null : getRenderer(system);
        const meta = {
          system,
          campaignId: require('./scanner').slugify(config.siteTitle || 'campaign'),
          pcSlug: pcLiveKey(page.sourceFrontmatter || page.frontmatter, page.title),
          buildVersion: require('crypto').createHash('sha1')
            .update(JSON.stringify({ f: page.frontmatter, s: sections })).digest('hex').slice(0, 12),
          live: publishConfig.live.stats === true,
          tohit: publishConfig.tohit_calculator === 'on',
        };
        const rendered = systemRenderer ? systemRenderer(page.frontmatter, sections, meta) : null;
        // A renderer returns an object (CoC, GURPS, D&D), or (PF2e, FitD) the sheet as a string.
        // A string sheet that is only passed-through text placed no stats.
        const systemOut = (rendered && typeof rendered === 'object')
          ? rendered
          : { sheetHtml: rendered || null, sheetless: !!rendered && !hasSheetStructure(rendered) };
        // A PC page with no sheet says nothing on its Character Sheet tab, and
        // nothing else would tell the GM. A renderer reports it by returning no
        // sheetHtml, or `sheetless` when (CoC) its frame renders regardless.
        // `sheet_source` on the PC records that the sheet is kept elsewhere, which
        // is the answer, not a gap. Read from the source frontmatter:
        // `exclude_fields` may hide it from the page. A stub publishes named
        // sections only, so it is not expected to carry a sheet.
        const sourceFm = page.sourceFrontmatter || page.frontmatter;
        const sheetSource = sheetSourceOf(sourceFm);
        // The identity strip reads the note with GM content stripped but before the keep-list,
        // for this and nothing else. A note whose headings shift has no readable body.
        let identity = [];
        if (sheetsOff) {
          const identityText = page.headingsUnstable ? '' : resolveWikiLinks(
            playerSafeMarkdown(page.markdown, { excludeCallouts, excludeSections, frontmatter: sourceFm }).text,
            linkMap, page.outputPath);
          identity = pcIdentity(system, page.frontmatter, extractSections(identityText));
        }
        const sheetless = !!systemRenderer && (!systemOut.sheetHtml || systemOut.sheetless === true);
        const sheetExpected = !sheetSource && publishMode(sourceFm) !== 'stub';
        if (sheetless && sheetExpected) fx.sheetlessPcs.push(page.displayTitle || page.title);
        // A frontmatter stat is not read; with sheets off no sheet is built, so nothing is lost.
        if (!sheetsOff) {
          const retired = retiredSheetFieldsFor(sourceFm, system);
          if (retired.length) fx.retiredFieldPcs.push({ rel: vaultRelPathOf(page), names: retired });
        }
        // A system renderer may report structural warnings (e.g. a CoC sheet whose body
        // diverges from the contract and parses near-empty, #107). Surface them like other
        // page warnings instead of shipping a silently-broken sheet — unless the sheet is
        // empty on purpose (kept elsewhere, or a stub).
        if (systemOut.warnings && systemOut.warnings.length && !(sheetless && !sheetExpected)) {
          fx.warn(page.outputPath, systemOut.warnings);
        }
        // Out-of-play PCs (retired, dead, missing…) keep their sheet page but stay
        // off the roster's Party Status board (#265).
        if ((systemOut.liveData || systemOut.boardOnly) && !isOutOfPlay(page.frontmatter, publishConfig.statuses.out_of_play)) {
          // Root-relative output path of the PC portrait, for the party-board
          // thumbnail. Resolved the same way portraitImg does (imageMap keyed
          // by bare basename → the scanner's relPath under images/).
          const pBase = portraitBasename(page.frontmatter);
          const pEntry = pBase && imageMap ? imageMap[pBase] : null;
          const portrait = pEntry ? 'images/' + pEntry.relPath : null;
          fx.partyEntries.push({ name: page.displayTitle || page.title, outputPath: page.outputPath, portrait, data: systemOut.liveData || systemOut.boardOnly });
        }
        html = pcTemplate(page, processed, sections, navFor, config, imageMap, storyHtml, {
          publishConfig,
          pages,
          systemSheetHtml: systemOut.sheetHtml || null,
          systemCombatHtml: systemOut.combatHtml || null,
          systemEquipmentHtml: systemOut.equipmentHtml || null,
          systemSpellsHtml: systemOut.spellsHtml || null,
          systemVitalsHtml: systemOut.vitalsHtml || null,
          systemLiveData: systemOut.liveData || null,
          systemTohitData: systemOut.tohitData || null,
          systemStatusPanelHtml: systemOut.statusPanelHtml || null,
          systemRecordHtml: systemOut.recordHtml || null,
          systemStatusBarHtml: systemOut.statusBarHtml || null,
          identity,
          sheetsOff,
          // The PC's own events (#323), not the campaign's: the landing page has those.
          timelineStrip: renderTimelineStrip(eventsNaming(timelineData, page.outputPath, linkMap), { maxEvents: publishConfig.limits.timeline_events, from: page.outputPath }),
          onLook: fx.onLook,
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
        if (page.frontmatter.type === 'session') {
          const wrapUp = hubWrapUps.get(page);
          if (wrapUp) {
            // The page shell stays the wiki page's; only the article body is generated.
            const chapter = chapterOfSession(page, pages);
            processed.html = sessionBodyHtml(page, { wrapUp, chapter, recapChars: publishConfig.limits.recap_chars });
          }
        }
        html = wikiTemplate(page, processed, navFor, config, imageMap, { publishConfig, linkMap, pages });
        break;
      }
    }
    return { html };
  }

  function renderRoster(page, processed) {
    const boardHtml = (roster.board && roster.partyManifest)
      ? roster.board.renderBoard(roster.partyManifest, page.outputPath, { live: roster.live })
      : null;
    const islandHtml = (roster.live && roster.board && roster.partyManifest)
      ? partyDataScript(roster.partyManifest, roster.board.scriptId) : null;
    return wikiTemplate(page, processed, navFor, config, imageMap, {
      publishConfig, linkMap, pages,
      partyBoardHtml: boardHtml, partyDataScript: islandHtml,
      partyClientScripts: (roster.live && boardHtml) ? roster.board.clientScripts : [],
    });
  }

  const liveFx = {
    usedImages, warn: logWarnings, partyEntries, sheetlessPcs, retiredFieldPcs,
    onLook: (look, p) => {
      for (const n of look.notes) console.warn(`  WARNING: ${p.vaultPath ? p.vaultPath + '.md' : p.title}: ${n.key} ${JSON.stringify(clipValue(n.value))} ${n.problem}; ignored`);
      if (isDressed(look)) { anyDressed = true; dressedSkins.add(look.skin); }
    },
  };
  const scratchFx = () => ({ usedImages: new Set(), warn: () => {}, partyEntries: [], sheetlessPcs: [], retiredFieldPcs: [], onLook: () => {} });

  // The note-faults audit reads each page as it is written (`seen`), and at the end renders
  // again the pages that link a note with no page (`namedOnPages`).
  const audit = startNoteAudit({
    vaultPath: config.vaultPath, notes: allNotes, corpus, verdicts, report: scanReport, published: pages, linkMap,
    publishConfig, manifest, relOf: vaultRelPathOf, getsNoPage,
    // Whether a frontmatter value (`occupation`, `relationships[0].description`) is still in
    // the frontmatter the site reads. Asked of publishedFrontmatter itself, the one function
    // that removes fields (the exclude lists, the note's own list, gm_aliases, a gm_only
    // relationship), with the note as it was read and with the field put back in case its
    // whole value was a comment and the cut took it.
    printsField: (page, fieldPath) => {
      const top = String(fieldPath).split(/[.[]/)[0];
      const source = page.sourceFrontmatter || page.frontmatter || {};
      const overridesForFile = fieldOverrides[vaultRelPathOf(page)] || {};
      const own = (o) => Object.prototype.hasOwnProperty.call(o, top);
      if (own(source) && !own(page.frontmatter || {})) return false;
      if (!own(source) && !own(publishedFrontmatter({ ...source, [top]: 'x' }, excludeFields, overridesForFile))) return false;
      // One relationship of several: it is gone when it is marked gm_only.
      const row = /^relationships\[(\d+)\]/.exec(String(fieldPath));
      return !(row && Array.isArray(source.relationships) && isGmOnlyEdge(source.relationships[Number(row[1])]));
    },
  });
  const shown = { page: null, story: null };
  const markedOf = new Map();   // page -> its links to no-page notes, marked (null when it has none)
  const toRender = new Map();   // the pages that may print one of those names: rendered a second time
  function seen(rel, html, page, isStory) {
    audit.read(rel, html);
    audit.readAddresses(rel, html);
    if (page === shownPage) shown[isStory ? 'story' : 'page'] = html;
    // The names in a page's Connections are names the page prints: one with no page behind
    // it is looked up in the note index and counted against this page.
    const model = !isStory && publishConfig._connections && html.includes('class="cx"') ? publishConfig._connections.for(page) : null;
    if (model && !noConnections(model)) audit.connections(page, model);
    if (toRender.has(page)) return;
    if (!markedOf.has(page)) markedOf.set(page, audit.mark(page));
    const marked = markedOf.get(page);
    if (marked && audit.mayPrint(marked, html)) toRender.set(page, marked);
  }
  // What the site holds of the note `explain --shown` asked about: the text of its page as
  // built (and of a PC's story page), its link-preview card, and what the search index
  // holds of it. null when the build makes no page of it.
  function shownOf() {
    if (!shownPage || !pages.includes(shownPage)) return null;
    const text = (html) => (html === null ? null : pageText(mainOf(html), { spaced: true }));
    // The image files the page shows (a portrait, an embed): they are copied to the site with it.
    const images = [...new Set([shown.page, shown.story].filter(Boolean)
      .flatMap((html) => [...mainOf(html).matchAll(/<img\b[^>]*\ssrc="([^"]+)"/gi)].map((m) => m[1]))
      .filter((src) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src))
      .map((src) => { try { return decodeURIComponent(src); } catch (e) { return src; } })
      .map((src) => src.replace(/^(?:\.\.?\/)+/, '')))].sort();
    const fm = shownPage.frontmatter || {};
    let card = null;
    if (publishConfig.link_previews !== 'off') {
      const { cardFor } = require('./previews');
      const { usesCocFolio } = require('./templates/pc');
      card = cardFor(shownPage, { imageMap, excludeSections, hubWrapUps, cocFolio: usesCocFolio(publishConfig, sheetsOff), limits: publishConfig.limits, headerFacts: publishConfig.header_facts });
    }
    const { subtitleOf } = require('./search-index');
    return {
      // A story companion asked about by its own path shows the story page alone.
      page: vaultRelPathOf(shownPage) === shownRel ? text(shown.page) : null,
      story: text(shown.story),
      images,
      card,
      search: searchEnabled ? {
        title: shownPage.displayTitle || '', subtitle: subtitleOf(fm),
        aliases: Array.isArray(fm.aliases) ? fm.aliases : [],
        body: shownPage.publishedMarkdown || '',
      } : null,
    };
  }

  for (const page of pages) {
    try {
      if (getsNoPage(page)) continue;
      const out = renderPage(page, liveFx);
      if (out.roster) { deferredRosters.push({ page, processed: out.roster }); continue; }
      seen(vaultRelPathOf(page), out.html, page, false);
      if (dry) continue;
      const outPath = path.join(outputDir, page.outputPath);
      ensureDir(outPath);
      fs.writeFileSync(outPath, out.html);
      console.log(`  wrote ${page.outputPath}`);
    } catch (e) {
      errorCount++;
      renderErrors.push(`${page.outputPath}: ${e.message}`);
      console.error(`  ERROR rendering ${page.outputPath}: ${e.message}`);
    }
  }

  // Written only when a PC page was dressed; an untouched site gets no skins.css.
  if (anyDressed && !dry) {
    const dest = path.join(outputDir, 'css/skins.css');
    ensureDir(dest);
    // The skins' typefaces come from the vault's font cache and are served from the site,
    // whatever theme.fonts.source says. The @font-face rules sit outside every @media
    // block; a miss warns once and the skins keep their fallback stacks.
    let warned = false;
    const faces = fontsLib.selfHostedFontFaces(config.vaultPath, fontFamiliesFor([...dressedSkins]), () => {
      if (warned) return;
      warned = true;
      console.warn("  WARNING: the typefaces for the sheet skins are not in the vault's font cache and could not be downloaded; the skins use fallback type. Rebuild with network access.");
    });
    fs.writeFileSync(dest, faces.css + scopeColorScheme(skinsCss([...dressedSkins])));
    console.log('  wrote css/skins.css');
    copyFontFiles(faces.files);
  }

  if (deferredRosters.length) {
    // The roster/party board always renders as a static initiative table from
    // published values. When the status-bar tier is on it also goes live
    // (JSON island + client poll of /api/loadout-list). When off, the same
    // table renders without the live layer.
    roster.board = sheetsOff ? null : boardFor(publishConfig.system);
    roster.live = publishConfig.live.stats;
    // Guarded like every other render path so a manifest-build failure
    // does not abort the banners/story/timeline/landing stages that follow.
    if (roster.board) {
      try {
        roster.partyManifest = roster.board.buildManifest(partyCampaignId, partyEntries);
      } catch (e) {
        errorCount++;
        renderErrors.push(`the party board: ${e.message}`);
        console.error(`  ERROR building party manifest: ${e.message}`);
      }
    }
    for (const deferredRoster of deferredRosters) {
      try {
        const html = renderRoster(deferredRoster.page, deferredRoster.processed);
        seen(vaultRelPathOf(deferredRoster.page), html, deferredRoster.page, false);
        if (dry) continue;
        const outPath = path.join(outputDir, deferredRoster.page.outputPath);
        ensureDir(outPath);
        fs.writeFileSync(outPath, html);
        console.log(`  wrote ${deferredRoster.page.outputPath} (party board)`);
      } catch (e) {
        errorCount++;
        renderErrors.push(`${deferredRoster.page.outputPath}: ${e.message}`);
        console.error(`  ERROR rendering roster ${deferredRoster.page.outputPath}: ${e.message}`);
      }
    }
  }

  // Link-preview cards, written once every page is: `pages` is the published list (a
  // publish: false page and an excluded draft are absent), each page carries its filtered
  // frontmatter and publishedMarkdown, and a card is kept only if its page file exists.
  // cleanOutput() wipes a stale previews.json.
  if (publishConfig.link_previews !== 'off') {
    const { buildPreviews, onlyBuiltPages } = require('./previews');
    const { usesCocFolio } = require('./templates/pc');
    const cards = buildPreviews(pages, { imageMap, excludeSections, hubWrapUps, cocFolio: usesCocFolio(publishConfig, sheetsOff), limits: publishConfig.limits, headerFacts: publishConfig.header_facts });
    // The cards are read for withheld names in their own right, whatever the pages print (and
    // also when nothing is written): every string of every card, under the note it is made from.
    const byHref = new Map(pages.map((p) => [p.outputPath, p]));
    const cardStrings = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(cardStrings) : []);
    for (const [key, card] of Object.entries(cards)) {
      const page = byHref.get(key);
      const text = Object.values(card).flatMap(cardStrings).join('\n');
      if (page && text) audit.read(vaultRelPathOf(page), `<main><p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p></main>`, null, 'the link previews', 'withheld');
    }
    if (!dry) {
      const built = onlyBuiltPages(cards, (key) => fs.existsSync(path.join(outputDir, ...key.split('/'))));
      fs.writeFileSync(path.join(outputDir, 'previews.json'), JSON.stringify(built));
      console.log('  wrote previews.json');
    }
  }

  // Copy images — in player mode, only copy images referenced by published pages. This
  // always applies in player mode, manifest or not (#210): `pages` is already filtered to
  // what actually publishes (decidePage's verdicts, above), and `usedImages` is populated
  // from that filtered set regardless of whether a manifest exists, so gating this on
  // `manifest` just meant a manifest-less player build shipped every GM-only image.
  if (publishConfig.mode === 'player') {
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
    if (!fs.statSync(full).isFile()) {
      console.warn(`  WARNING: ${label} "${vaultRelPath}" is not a file — skipping`);
      return null;
    }
    return full;
  }

  // Namespaced by section, because the conventional banner filename is identical in every
  // section folder: Locations/_banner.png and Creatures/_banner.png would otherwise both
  // land on images/banners/_banner.png, and whichever copied last would show on both pages.
  // The dir may itself contain a slash ("characters/npcs"), so flatten it to one segment.
  function copyBannerAsset(sourceFull, dir) {
    const outRel = `images/banners/${bannerSlug(dir)}/${path.basename(sourceFull)}`;
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

  publishConfig._banners = dry ? {} : buildBanners(Object.keys(DIR_LABELS));

  // The landing page's banner (player_site.landing.banner.*). Its picture is found and copied by the section
  // banners' helpers, to images/banners/landing/; its link is read by resolveSiteLink, as a menu entry's is.
  // `image` and `link` leave here as the hrefs the page prints (null when there is none to print). A banner with
  // a link and nothing else shows nothing.
  let landingBannerResolved = false;
  function resolveLandingBanner() {
    if (landingBannerResolved) return;
    landingBannerResolved = true;
    const banner = publishConfig.landing.banner;
    if (!banner.title && !banner.text && !banner.image) {
      if (banner.link) console.warn(`  WARNING: ${nm('player_site.landing.banner.link')} is set but the banner has no title, text or picture — no banner is shown`);
      banner.link = null;
      return;
    }
    if (banner.image && !/^https?:\/\//i.test(banner.image)) {
      const imageFull = resolveVaultAsset(banner.image, nm('player_site.landing.banner.image'));
      banner.image = imageFull ? (dry ? `images/banners/landing/${path.basename(imageFull)}` : copyBannerAsset(imageFull, 'landing')) : null;
    }
    if (banner.link) {
      const read = resolveSiteLink(banner.link, { linkMap, pages });
      if (read.kind === 'none') {
        console.warn(`  WARNING: ${nm('player_site.landing.banner.link')} is "${banner.link}", which is a note the site makes no page of, or an address the site cannot link to — the banner is not a link`);
        banner.link = null;
      } else {
        banner.link = { href: read.href, external: read.kind === 'outside' };
      }
    }
  }

  const pcRoster = pages.find(isRoster);
  const pcRedirectTarget = pcRoster ? pcRoster.outputPath : null;

  const { timelineTemplate } = require('./templates/timeline-page');

  // Every page of the site that is not one note's own, in the order the build writes them:
  // the section indexes, the timeline, the story chapters, the story's contents page and the
  // landing page. Each prints words taken from many notes. `emit(out, html, said)` gets the
  // page's path on the site, its HTML and the line the build prints for it. `live` is the
  // build's own pass; the audit's pass (every note marked) asks for the pages again and
  // skips what holds no note's words (a redirect) and what is a note's own page (a PC's story).
  function eachListing(emit, live) {
    for (const [dir, label] of Object.entries(DIR_LABELS)) {
      if (dir === 'characters/pcs' && pcRedirectTarget) {
        const depth = dir.split('/').length;
        const rel = encodeHref('../'.repeat(depth) + pcRedirectTarget);
        const redirectHtml = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${rel}"><link rel="canonical" href="${rel}"></head><body><a href="${rel}">Player Characters</a></body></html>`;
        if (live) emit(`${dir}/index.html`, redirectHtml, `  wrote ${dir}/index.html (redirect → ${pcRedirectTarget})`);
        continue;
      }
      // Redirect events/ at the timeline only when one exists; with no timeline the redirect
      // would dangle, so fall through and give events its own index.
      if (dir === 'events' && timelineHref) {
        const rel = encodeHref(relativePath(dir, timelineHref));
        const redirectHtml = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${rel}"><link rel="canonical" href="${rel}"></head><body><a href="${rel}">Timeline</a></body></html>`;
        if (live) emit(`${dir}/index.html`, redirectHtml, `  wrote ${dir}/index.html (redirect → ${timelineHref})`);
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
        if (live) console.log(`  skipped ${dir}/index.html (authored index page)`);
        continue;
      }
      emit(`${dir}/index.html`, indexTemplate(dir, label, dirPages, navFor, config, publishConfig, imageMap), `  wrote ${dir}/index.html`);
    }

    // Timeline page
    if (generatesTimeline) {
      // The events are read from the notes as they stand: marked, in the audit's pass.
      const data = live ? timelineData : buildTimelineData(pages);
      emit('timeline.html', timelineTemplate(renderTimelineHTML(data), navFor, config, publishConfig), '  wrote timeline.html');
      publishConfig._timelineStrip = renderTimelineStrip(data, { maxEvents: publishConfig.limits.timeline_events });
    }

    // The story: its chapters, each PC's own story, its contents page.
    const spine = buildStorySpine(pages, linkMap, hubWrapUps);
    for (const unit of spine) {
      unit.refsHtml = renderRefsHtml(unit);
      emit(unit.outputPath, renderStoryUnit(unit, config, publishConfig, navFor), `  wrote ${unit.outputPath}`);
    }
    if (live) characterStories = buildCharacterStories();
    if (spine.length || characterStories.length) {
      emit('story.html', storyLanding(spine, characterStories, config, publishConfig, navFor), '  wrote story.html');
    }

    // Landing page
    resolveLandingBanner();
    emit('index.html', landingTemplate(pages, navFor, config, publishConfig, imageMap, corpus, hubWrapUps), '  wrote index.html');
  }
  let characterStories = [];

  function renderRefsHtml(unit) {
    const refs = unitRefs(unit);
    const items = [];
    for (const p of refs.participants) {
      const out = linkMap[p.target];
      items.push(out ? `<li><a href="${encodeHref(relativeHref(unit.outputPath, out))}">${escapeHtml(p.label)}</a></li>`
                     : `<li>${escapeHtml(p.label)}</li>`);
    }
    if (refs.location) {
      const out = linkMap[refs.location.target];
      items.push(out ? `<li>Location: <a href="${encodeHref(relativeHref(unit.outputPath, out))}">${escapeHtml(refs.location.label)}</a></li>`
                     : `<li>Location: ${escapeHtml(refs.location.label)}</li>`);
    }
    return items.length ? `<ul>${items.join('')}</ul>` : '';
  }

  // A PC's story page (its `_Story.md` companion), as it is written. `fx` as for renderPage.
  function renderCharacterStory(pc, fx) {
    const { slugify } = require('./scanner');
    const outputPath = `story/characters/${slugify(pc.title)}.html`;
    const storyObj = { markdown: pc.storyMarkdown, frontmatter: {}, outputPath };
    const processed = processContent(storyObj, linkMap, excludeSections, imageMap, { usedImages: fx.usedImages, excludeCallouts });
    fx.warn(outputPath, processed.warnings);
    const story = {
      title: pc.displayTitle, outputPath, html: processed.html,
      sheetOutputPath: pc.outputPath, group: characterStoryGroup(pc.frontmatter, publishConfig.statuses.fallen),
    };
    const html = characterStoryPage(story, config, publishConfig, navFor);
    if (fx === liveFx) seen(audit.storyRelOf(pc), html, pc, true);
    return { story, html };
  }

  function buildCharacterStories() {
    const stories = [];
    for (const pc of pages.filter(p => p.frontmatter.type === 'pc' && p.storyMarkdown)) {
      const { story, html } = renderCharacterStory(pc, liveFx);
      stories.push(story);
      if (dry) continue;
      const full = path.join(outputDir, story.outputPath);
      ensureDir(full);
      fs.writeFileSync(full, html);
      console.log(`  wrote ${story.outputPath}`);
    }
    return stories;
  }

  // The search index holds a subtitle read from fields a page may not print at all
  // (`occupation` on a location): read for a secret name as the page is, note by note.
  if (searchData) {
    const byHref = new Map(pages.map((p) => [p.outputPath, p]));
    const escapeText = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const strings = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings)
      : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
    for (const doc of Object.values(searchData.documents)) {
      const page = byHref.get(doc.href);
      const text = strings(doc.subtitle).join(' ');
      if (page && text) audit.read(vaultRelPathOf(page), `<main><p>${escapeText(text)}</p></main>`, null, 'the search index');
      // Every other string of the entry the search shows (its title, its type).
      const rest = strings(Object.entries(doc).filter(([k]) => k !== 'href' && k !== 'subtitle').map(([, v]) => v)).join('\n');
      if (page && rest) audit.read(vaultRelPathOf(page), `<main><p>${escapeText(rest)}</p></main>`, null, 'the search index', 'withheld');
    }
    // And every field of every record the index is built from, whichever fields it holds: its
    // aliases are words no page prints. Withheld names only, as the page text is read for the rest.
    for (const { page, record } of searchData.records) {
      const text = strings(Object.entries(record).filter(([k]) => k !== 'id').map(([, v]) => v)).join('\n');
      if (text) audit.read(vaultRelPathOf(page), `<main><p>${escapeText(text)}</p></main>`, null, 'the search index', 'withheld');
    }
  }

  // The files copied to the site are named after the vault's files: a withheld name in one of
  // them is in the address of the file. Attachments, then the other files a site copies from
  // the vault: the campaign image, a section banner and a font.
  for (const [name, entry] of Object.entries(imageMap)) {
    if (publishConfig.mode === 'player' && !usedImages.has(name)) continue;
    audit.readFileName(canonicalNfc(vaultRelPathOf({ sourcePath: entry.sourcePath })), `images/${entry.relPath}`);
  }
  {
    const vaultRoot = path.resolve(config.vaultPath);
    const there = (rel) => fs.existsSync(path.resolve(vaultRoot, rel));
    const rel = (p) => canonicalNfc(String(p).replace(/\\/g, '/'));
    if (campaignImageSource && !/^https?:\/\//.test(campaignImageSource) && there(campaignImageSource)) {
      audit.readFileName(rel(campaignImageSource), `images/${path.basename(campaignImageSource)}`);
    }
    for (const dir of Object.keys(DIR_LABELS)) {
      const entry = resolveBanner(dir, { vaultPath: config.vaultPath, folderMap: config.folderMap, banners: publishConfig.banners });
      if (!entry) continue;
      for (const file of copiedBannerFiles(entry)) {
        if (there(file)) audit.readFileName(rel(file), `images/banners/${bannerSlug(dir)}/${path.basename(file)}`);
      }
    }
    const fonts = (publishConfig.theme.fonts && Array.isArray(publishConfig.theme.fonts.files)) ? publishConfig.theme.fonts.files : [];
    for (const f of fonts) {
      if (f && f.path && there(f.path)) audit.readFileName(rel(f.path), `fonts/${fontOutputPath(f.path)}`);
    }
  }

  // Written, and read by the note-faults audit for a secret name. In memory nothing is
  // written, and every one of them is still made: what they print is part of the site.
  eachListing((out, html, said) => {
    audit.read(null, html, out);
    if (dry) return;
    const full = path.join(outputDir, out);
    ensureDir(full);
    fs.writeFileSync(full, html);
    console.log(said);
  }, true);

  // Last thing before "Done", so it is the line the GM reads (#277). A session in Excluded
  // is a decision and never lands here; one in Needs Decision or in no section does.
  // Split by what publish-played will do with each (its own plan, so this never promises
  // to publish a session it will only list as unclear): a reviewed one with a Wrap-Up
  // that pairs and publishes gets ticked; the rest — no Wrap-Up at all (recap-in-hub
  // vaults), a Wrap-Up not reviewed yet or not publishing, a stale site pin — are asked
  // about, each with publish-played's own reason.
  if (unpublishedPlayedSessions.length > 0 && !dry) {
    let plan = null;
    try {
      const { planPublishPlayed, surveyVault } = require('./manifest-cli');
      plan = planPublishPlayed(surveyVault({ configPath: resolvedConfigPath }, {}));
    } catch (_) { /* no plan: promise nothing */ }
    const reasons = new Map(plan ? plan.unclear.map((u) => [u.path, u.reason]) : []);
    const titles = (list) => list.map((s) => s.title).join(', ');
    const why = (list) => list.map((s) => (reasons.has(s.rel) ? `${s.title} (${reasons.get(s.rel)})` : s.title)).join(', ');
    const plural = (n, one, many) => (n === 1 ? one : many);
    const withWrap = plan ? unpublishedPlayedSessions.filter((s) => plan.ticks.has(s.rel)) : [];
    const without = unpublishedPlayedSessions.filter((s) => !withWrap.includes(s));
    if (withWrap.length > 0) {
      const n = withWrap.length;
      console.warn(`  WARNING: ${n} played session${plural(n, '', 's')} with a Wrap-Up ${plural(n, "isn't", "aren't")} published yet: ${titles(withWrap)} — \`manifest publish-played\` (run by publish-site before every build) will publish ${plural(n, 'it', 'them')}.`);
    }
    if (without.length > 0) {
      const n = without.length;
      console.warn(`  WARNING: ${n} played session${plural(n, " isn't", "s aren't")} published yet and need${plural(n, 's', '')} the GM's say: ${why(without)} — publish-site asks the GM about ${plural(n, 'it', 'these')}.`);
    }
  }

  for (const { rel, names } of retiredFieldPcs) {
    console.warn(`  WARNING: ${rel}: ${retiredSheetFieldsMessage(names)}`);
  }

  if (sheetlessPcs.length > 0) {
    const n = sheetlessPcs.length;
    const shown = sheetlessPcs.slice(0, SHEETLESS_NAMED);
    const more = n > shown.length ? `, and ${n - shown.length} more` : '';
    console.warn(`  WARNING: ${n} PC${n === 1 ? '' : 's'} published with no character sheet (${shown.join(', ')}${more}) — the site found no stats it can read. Fill in ## Stat Sheet to the system template's layout, or set sheet_source on the PC to say where the sheet is kept. \`vault_check.py <vault> pc-body\` lists each file.`);
  }

  // The scanner said this once, above every `wrote …` line, where nobody reads (#287).
  // The build read nothing from these files: a note that would have had a page has
  // none, and a story companion's text is missing from its PC.
  if (scanReport.malformed.length > 0) {
    const UNPARSEABLE_NAMED = 8;   // files printed before "and N more"
    const firstLine = (text) => String(text).split('\n')[0].trim().replace(/:$/, '');
    const n = scanReport.malformed.length;
    const shown = scanReport.malformed.slice(0, UNPARSEABLE_NAMED).map((m) => `${m.rel} (${firstLine(m.message)})`);
    const more = n > shown.length ? `, and ${n - shown.length} more` : '';
    console.warn(`  WARNING: the build skipped ${n} note${n === 1 ? '' : 's'} whose frontmatter is not valid YAML: ${shown.join('; ')}${more} — a skipped note has no page on the site, and a skipped story file (…_Story.md) is missing from its PC's page. Fix the frontmatter and rebuild. \`vault_check.py <vault> frontmatter\` lists each file.`);
  }

  // Settings that still live in the site file. One line, so it is the thing the GM reads.
  for (const line of legacyWarning(publishConfig.legacy, rawConfig, publishConfig.layout)) console.warn(`  ${line}`);

  // Live stats and the inbox used to be detected from a deployed backend; unset now means
  // off. A deployed feature whose switch neither file sets is never lost silently: the line
  // says what happened and what to do, whatever else the site file holds. Not said for live
  // stats when character_sheets is off (that is the GM's own choice, and the files are removed).
  const unset = switches.unset || [];
  // (The update does not switch such a feature on, so the line says what works now: set the switch.)
  const lost = (key, is, subject, them, its) => console.warn(
    `  WARNING: ${subject} ${is} deployed on this site but ${nm(`player_site.features.${key}`)} is not set, so ${them === 'them' ? 'they are' : 'it is'} off. Set ${nm(`player_site.features.${key}`)} to true to keep ${them}, or to false to remove ${its} functions.`);
  if (unset.includes('live_stats') && switches.characterSheets !== false && detectStatusBar(configDir)) lost('live_stats', 'are', 'live stats', 'them', 'their');
  if (unset.includes('inbox') && detectInbox(configDir)) lost('inbox', 'is', 'the inbox', 'it', 'its');

  // Faults in the notes themselves: one line per code, after every other warning, and
  // nothing for a vault with none. `doctor --site` lists the same findings in full.
  // A note with no page is named where a page prints the words of a link to it. Which
  // links a page prints is the page's own business (its template, its sections), so each
  // page that links such a note and may be printing its name (`seen`) is rendered once more
  // with those links marked, by the same renderPage, and the marks that come out in the
  // HTML are the names it prints.
  //
  // A page that is not one note's own prints words from many notes: an index its entries'
  // fields, the landing page a recap, a story chapter a session's cast. Those are rendered
  // once more too, with every note marked at once, and a mark that comes out there is
  // counted against the note the link is written in (audit.listing).
  //
  // While either runs, the heading reader takes the mark out of a title before reading it,
  // so a heading that holds a marked link hides or shows what it does in the build proper.
  const FIELDS = ['markdown', 'publishedMarkdown', 'storyMarkdown', 'frontmatter', 'displayTitle'];
  const putOn = (page, marked) => {
    const own = {};
    for (const f of FIELDS) {
      own[f] = page[f];
      if (f in page && marked[f] !== undefined) page[f] = marked[f];
    }
    return own;
  };
  const takeOff = (page, own) => { for (const f of FIELDS) if (f in page) page[f] = own[f]; };
  quietly(() => ignoringMark(MARK_RE, () => {
    for (const page of pages) {
      const marked = toRender.get(page);
      if (!marked) continue;
      const own = putOn(page, marked);
      let html = '';
      let storyHtml = '';
      try {
        const out = renderPage(page, scratchFx());
        html = out.roster ? renderRoster(page, out.roster) : out.html;
      } catch (e) { auditGaps++; }
      try {
        if (own.storyMarkdown && page.frontmatter.type === 'pc') storyHtml = renderCharacterStory(page, scratchFx()).html;
      } catch (e) { auditGaps++; }
      takeOff(page, own);
      audit.printed(page, marked, html, storyHtml);
    }

    // The landing page also reads notes that have no page (the campaign overview).
    for (const page of corpus) if (!markedOf.has(page)) markedOf.set(page, audit.mark(page));
    const everyMarked = [...markedOf].filter(([, marked]) => marked);
    if (everyMarked.length === 0) return;
    const owns = everyMarked.map(([page, marked]) => putOn(page, marked));
    const strip = publishConfig._timelineStrip;
    try {
      eachListing((out, html) => audit.listing(out, html), false);
    } catch (e) {
      auditGaps++;
    } finally {
      everyMarked.forEach(([page], k) => takeOff(page, owns[k]));
      publishConfig._timelineStrip = strip;
    }
  }));
  if (auditGaps > 0) {
    console.warn(`  WARNING: the note-faults check could not read ${auditGaps} page${auditGaps === 1 ? '' : 's'} a second time; a note named there with no page may be missing from its list.`);
  }
  // Every file is written: the after steps run, then the check of the notes and "Done!".
  if (runningSteps && errorCount === 0 && publishConfig.steps.after.length) runSteps(publishConfig.steps.after, { cwd: configDir, label: 'after_build', log: options.stepsLog, stdio: options.stepsStdio });
  const noteFaults = audit.findings((page) => stripFacts.get(page));
  if (options.onNoteFaults) options.onNoteFaults(noteFaults);
  for (const line of summaryLines(noteFaults)) console.warn(`  WARNING: ${line}`);

  if (dry) {
    return { noteFaults, shown: shownOf(), renderErrors, auditGaps, faults: publishConfig.faults };
  }

  if (errorCount > 0) {
    console.log(`Done with ${errorCount} error(s).`);
    const err = new Error(`Build completed with ${errorCount} render error(s)`);
    err.errorCount = errorCount;
    throw err;
  }
  console.log('Done!');
  return { noteFaults, shown: null, faults: publishConfig.faults };
}

module.exports = { build, resolveSiteLink, rememberHiddenNames };

// Allow running directly: node lib/build.js
// Prefetches self-hosted fonts first, as the CLI does; build() itself only reads the cache.
if (require.main === module) {
  fontsLib.buildWithFonts().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
