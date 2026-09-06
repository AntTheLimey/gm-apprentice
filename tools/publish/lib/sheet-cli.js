'use strict';

// `sheet show` command: print one PC's character sheet from the vault.
//
// The default view is the raw source file — the GM's own note, verbatim.
// `--player-safe` is the interesting one: it prints what a player can see, by
// running the sheet through the same strip chain the build runs. That makes it
// a data boundary rather than an instruction. A skill that needs to talk about
// a PC without leaking prep no longer has to be told "remember not to look at
// GM Notes"; it reads the player-safe view and the GM content is simply not
// there. If the two ever disagree, the build is the spec and this is the bug.
//
// Every side effect is behind an injectable dep (as in flush-cli) so the runner
// is unit-testable with no config file and no vault on disk.
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { scanVault, slugify } = require('./scanner');
const { loadPublishConfig } = require('./config');
const {
  stripDataview,
  stripGmOnly,
  stripSpoiler,
  stripHtmlComments,
  stripCallouts,
  filterSections,
  keepOnlySections,
  publishedFrontmatter,
  publishMode,
} = require('./processor');

// The strip functions return either a string or { text, warnings }. Warnings
// (an unclosed <!-- gm-only -->, say) must reach stderr and never the sheet:
// the output is meant to be pasted or piped as markdown.
function applyStrip(fn, markdown, warnings) {
  const result = fn(markdown);
  if (typeof result === 'string') return result;
  if (Array.isArray(result.warnings)) warnings.push(...result.warnings);
  return result.text;
}

function casefold(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function displayNameOf(page) {
  return page.displayTitle || page.title;
}

// Match on any of the three names a GM might type: the file name, the display
// title, or the frontmatter `name`. Slug equality on the file name absorbs
// underscores, case and accents ("jane ashford" finds Jane_Ashford.md).
function findPc(pcs, wanted) {
  const wantSlug = slugify(wanted);
  const wantFold = casefold(wanted);
  return pcs.find((p) => {
    if (slugify(p.title) === wantSlug) return true;
    if (casefold(p.displayTitle) === wantFold) return true;
    const fmName = p.frontmatter && p.frontmatter.name;
    return fmName != null && casefold(fmName) === wantFold;
  }) || null;
}

// The published body: build.js's pipeline for a PC page, stopped at markdown.
// stripLeadingH1 is deliberately NOT applied — the site drops the H1 because
// the page template prints the name in a header, but this is a text view with
// no template around it, so the name has to stay in the document.
function playerSafeMarkdown(page, publishConfig, warnings) {
  let md = String(page.markdown || '').replace(/\r/g, '');
  md = stripDataview(md);
  md = applyStrip(stripGmOnly, md, warnings);
  md = applyStrip(stripSpoiler, md, warnings);
  md = applyStrip(stripHtmlComments, md, warnings);
  md = stripCallouts(md, publishConfig.exclude_callouts);
  md = filterSections(md, publishConfig.exclude_sections);
  if (publishMode(page.frontmatter) === 'stub') {
    const include = Array.isArray(page.frontmatter.publish_include_sections)
      ? page.frontmatter.publish_include_sections
      : [];
    md = keepOnlySections(md, include);
  }
  return md;
}

// gray-matter emits a trailing blank line for an empty body; trim it so the
// caller controls the spacing between the frontmatter fence and the body.
function frontmatterBlock(frontmatter) {
  return matter.stringify('', frontmatter).replace(/\n+$/, '\n');
}

async function runSheetShow(deps) {
  deps = deps || {};
  const out = deps.out || console.log;
  const err = deps.err || console.error;
  const readFile = deps.readFile || function (p) { return fs.readFileSync(p, 'utf8'); };
  const playerSafe = !!deps.playerSafe;
  const asJson = !!deps.json;

  // Resolve config exactly as flush-cli/build.js do, so the same vault and the
  // same exclude lists back this view as back the site.
  const configPath = path.resolve(deps.configPath || './vault.config.json');
  const configDir = path.dirname(configPath);
  const config = deps.config || require(configPath);
  const vaultPath = deps.config ? config.vaultPath : path.resolve(configDir, config.vaultPath);
  const publishConfig = deps.publishConfig || loadPublishConfig(vaultPath, config);

  const wanted = String(deps.pc == null ? '' : deps.pc).trim();
  if (!wanted) {
    err('sheet show needs --pc <name>.');
    return 1;
  }

  const scan = deps.scan || function () { return scanVault(Object.assign({}, config, { vaultPath: vaultPath })); };
  const pcs = scan().filter((p) => p.frontmatter && p.frontmatter.type === 'pc');
  const page = findPc(pcs, wanted);
  if (!page) {
    const names = pcs.map(displayNameOf).join(', ');
    err(`No PC named "${wanted}". PCs: ${names || '(none in this vault)'}`);
    return 1;
  }

  const name = displayNameOf(page);

  if (!playerSafe) {
    if (asJson) {
      out(JSON.stringify({
        pc: name,
        sourcePath: page.sourcePath,
        playerSafe: false,
        frontmatter: page.frontmatter,
        markdown: String(page.markdown || ''),
      }, null, 2));
    } else {
      out(readFile(page.sourcePath));
    }
    return 0;
  }

  const warnings = [];
  const fm = publishedFrontmatter(
    page.frontmatter,
    publishConfig.exclude_fields,
    (page.frontmatter && page.frontmatter.publish_overrides) || {},
  );

  // `publish: none` means the site has no page for this PC at all. Printing a
  // stripped body anyway would invent a player view that does not exist.
  if (publishMode(page.frontmatter) === 'none') {
    for (const w of warnings) err(`sheet: ${name} — ${w}`);
    if (asJson) {
      out(JSON.stringify({
        pc: name,
        sourcePath: page.sourcePath,
        playerSafe: true,
        frontmatter: fm,
        markdown: '',
        notPublished: true,
      }, null, 2));
    } else {
      out(`(${name} is not published — publish: none)`);
    }
    return 0;
  }

  const markdown = playerSafeMarkdown(page, publishConfig, warnings);
  for (const w of warnings) err(`sheet: ${name} — ${w}`);

  if (asJson) {
    out(JSON.stringify({
      pc: name,
      sourcePath: page.sourcePath,
      playerSafe: true,
      frontmatter: fm,
      markdown: markdown,
    }, null, 2));
  } else {
    out(frontmatterBlock(fm) + '\n' + markdown.replace(/^\n+/, ''));
  }
  return 0;
}

module.exports = { runSheetShow };
