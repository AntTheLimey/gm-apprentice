'use strict';

// `explain <path>`: why one file does, or does not, reach the site.
//
// "Session 7 isn't on the site" is the most common publish-site question, and the
// answer is always one of half a dozen rules interacting — a status, a folder that
// is not in folderMap, a manifest that never got the entry. Printing the chain the
// build walked, and then the build's own verdict, replaces a guess with a lookup.
//
// The verdict comes from decidePage, so it is the build's answer rather than a
// second reading of the same rules.
const fs = require('fs');
const path = require('path');
const { mapFolder, matchExcludedDir } = require('./scanner');
const { decidePage, publishesPage, autoExcludeCode, storyCompanionPc, ALWAYS_EXCLUDE_DIRS } = require('./publish-decision');
const { surveyVault, pairsWith } = require('./manifest-cli');
const { assertNoStops, outputFolderOf } = require('./config');
const { canonicalPath } = require('./manifest');
const { strippedSectionTitles, sheetWithheldTitles, publishMode } = require('./processor');
const { pcKeepList, retiredSheetFieldsFor } = require('./pc-prose');
const { getCanonStatus } = require('./templates/base');
const { sheetSourceOf } = require('./sheet-source');
const { parseNote } = require('./frontmatter');
const { markersIn } = require('./markers');
const YAML = require('yaml');
const { nearestNames, readerView } = require('./site-doctor');
const { nameIn } = require('./settings');
const { sheetFamilyOf } = require('./party-board-registry');

// The switches as the build resolves them, without the config notes.
function switchesOf(publishConfig) {
  const { characterSheets, liveStats, inbox } = publishConfig.switches || {};
  return { characterSheets, liveStats, inbox };
}

// The `##` titles only the PC keep-list withholds. Raw-text decision: a note whose
// headings a link label shifts is withheld whole by the build, which this does not
// replicate (the build's own stability check owns that).
function sheetWithheldOf(publishConfig, markdown, frontmatter) {
  return [...new Set(sheetWithheldTitles(markdown, publishConfig.exclude_sections || [], frontmatter,
    { pcKeepSections: pcKeepList(publishConfig) }))];
}

const MANIFEST_LABEL = { publishing: 'publishing', excluded: 'excluded', needsDecision: 'needs a decision' };

function dirOf(rel) {
  return rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
}

function manifestSectionOf(manifest, rel) {
  if (!manifest) return null;
  if (manifest.publishing.includes(rel)) return 'publishing';
  if ((manifest.excluded || []).includes(rel)) return 'excluded';
  if ((manifest.needsDecision || []).includes(rel)) return 'needsDecision';
  return null;
}

async function runExplain(options, deps) {
  const opts = options || {};
  const d = deps || {};
  const out = d.out || console.log;
  const exists = d.exists || ((p) => fs.existsSync(p));
  const readFile = d.readFile || ((p) => fs.readFileSync(p, 'utf8'));

  const target = canonicalPath(String(opts.target == null ? '' : opts.target).trim().replace(/^\.\//, ''));
  if (!target) {
    out('explain needs a vault-relative path, e.g. `gm-publish explain "Sessions/Session 7.md"`.');
    return 1;
  }

  const survey = surveyVault(opts, d);
  assertNoStops(survey.publishConfig, 'explain');
  const { config, vaultPath, publishConfig, manifest, files, verdicts, pagesByRel, report } = survey;

  // Existence is checked on disk, not against the walked list: a file under
  // excludeDirs is not in the list, and "why isn't _meta/x.md on the site" is a
  // question worth answering rather than calling the file missing.
  const onDisk = exists(path.join(vaultPath, target));
  if (!onDisk) {
    out(`no such file in the vault: ${target}`);
    const near = nearestNames(target, files, 3, 0.3);
    if (near.length > 0) {
      out('Did you mean:');
      for (const name of near) out(`  ${name}`);
    }
    return 1;
  }

  const dir = dirOf(target);
  const page = pagesByRel.get(target);
  const untyped = new Set(report.untyped.map(canonicalPath));
  const unmappedDirs = new Set(report.unmapped.map((u) => canonicalPath(u.dir)));
  const mappedTo = dir ? mapFolder(dir, config.folderMap || {}) : '';

  // excludeDirs is the scanner's rule, not decidePage's — decidePage only knows the
  // directories that are excluded on every site. Fold the config's own list in here
  // so the verdict matches what the build would actually do with this file.
  // publishConfig.exclude_dirs (not the raw config.excludeDirs): the normalized union of
  // vault-config.md's publish.exclude_dirs and the legacy vault.config.json field, matched
  // case-insensitively — otherwise this command disagreed with the build about a folder
  // excluded only via vault-config.md, or via a differently-cased spelling (#209 follow-up).
  const configExcluded = matchExcludedDir(dir, publishConfig.exclude_dirs);
  const alwaysExcluded = dir.split('/').some((segment) => ALWAYS_EXCLUDE_DIRS.includes(segment));

  // `excludeDirs` names a folder never true of every site — that is ALWAYS_EXCLUDE_DIRS,
  // a fixed rule (#2 below). Reusing DIR_ALWAYS_EXCLUDED for this vault's own config
  // choice told the GM the wrong story: "never published, by rule" instead of "this
  // vault's config chose to exclude it".
  const verdict = verdicts.get(target)
    || (configExcluded && !alwaysExcluded
      ? { bucket: 'exclude', code: 'DIR_CONFIG_EXCLUDED', reason: `in ${configExcluded}/ — listed in ${nameIn(vaultPath, 'player_site.hide.folders')}`, outputPath: null }
      : decidePage(page || { rel: target, frontmatter: null }, {
        rel: target,
        publishConfig,
        manifest,
        pageIndex: pagesByRel,
        folderMapped: page ? true : !(unmappedDirs.has(dir) && !untyped.has(target)),
      }));

  const frontmatter = (page && page.frontmatter) || null;
  // The scanner already knows which files it could not parse (report.malformed) —
  // reuse that rather than parse the file a second time here.
  const parseFailure = report.malformed.find((m) => canonicalPath(m.rel) === target);
  // Kept, not swallowed: a file whose frontmatter gray-matter cannot parse at all
  // has no sections and no gm-only markers to count, and silently reporting "none"/
  // "0" for those reads as a clean file rather than one this command could not read.
  let frontmatterError = parseFailure ? parseFailure.message : null;
  const markdown = page ? String(page.markdown || '')
    : frontmatterError ? ''
      : (() => {
        // A file under excludeDirs never reaches the scanner's walk at all, so
        // report.malformed has nothing to say about it — this is the only parse
        // attempt it gets.
        try { return parseNote(readFile(path.join(vaultPath, target))).content; }
        catch (e) { frontmatterError = e.message; return ''; }
      })();

  const excludeSections = publishConfig.exclude_sections || [];
  // The strip's own walk, so a document's Keeper sections (#280) are named here too.
  const stripped = frontmatterError ? null
    : [...new Set(strippedSectionTitles(markdown, excludeSections, frontmatter, { pcKeepSections: pcKeepList(publishConfig) }))];
  const sheetWithheld = frontmatterError || !page ? null : sheetWithheldOf(publishConfig, markdown, frontmatter);
  const gmOnlyBlocks = frontmatterError ? null : markersIn(markdown).filter((m) => m.name === 'gm-only' && !m.close).length;

  const publishes = publishesPage(verdict);
  // Whether this is a session index whose body the site withholds (#276).
  // Paired the way the build pairs (GM aliases rewritten first); a file the scanner
  // produced no page for is no session index the build could pair.
  const hubBodyUnpublished = !!page && pairsWith(survey, publishedPagesOf(survey)).has(page);
  // A story companion has no page of its own; its content is on the PC's page, so
  // that is the URL to name.
  const mergedInto = verdict.code === 'STORY_COMPANION' ? storyCompanionPc(target, pagesByRel) : null;
  const outputPath = mergedInto
    ? `${outputFolderOf(config)}/${mergedInto.outputPath}`
    : (publishes && verdict.outputPath ? `${outputFolderOf(config)}/${verdict.outputPath}` : null);
  const auto = frontmatter ? autoExcludeCode(frontmatter) : null;
  const canonStatus = frontmatter ? getCanonStatus(frontmatter) : null;
  const section = manifestSectionOf(manifest, target);

  // --shown: what the site holds of this note, or would if it published. The build is run
  // in memory with the note built as if it published, and what comes back is read off the
  // page it made: the text of the page (and of a PC's story page), its link-preview card,
  // and what the search index holds. So it is the page, not a second reading of the note.
  // A note the build can make no page of (no type, a folder not on the site) has no
  // template to print it: for that one the frontmatter as published and the body after
  // every cut are shown instead, and `from` says so. A `publish: false` note shows nothing.
  let shown = null;
  if (opts.shown && !frontmatterError) {
    let source = page;
    if (!source) {
      try {
        const parsed = parseNote(readFile(path.join(vaultPath, target)));
        source = { markdown: parsed.content, frontmatter: parsed.data || {} };
      } catch (e) { source = null; }
    }
    if (source && publishMode(source.frontmatter) === 'none') {
      shown = { from: 'none' };
    } else if (source) {
      // A build that fails is not a build that makes no page: the first is an error, said
      // as one, and never answered with the note's own text as if nothing more were on the site.
      let built = null;
      let failed = null;
      try {
        built = require('./build').build({ configPath: survey.configPath, vaultPath, rawConfig: d.config, inMemory: true, shownFor: target }).shown;
      } catch (e) { failed = String((e && e.message) || e).split('\n')[0]; }
      if (failed !== null) {
        shown = { from: 'error', error: failed };
      } else if (built && (built.page !== null || built.story !== null)) {
        shown = Object.assign({ from: 'page' }, built);
      } else {
        const view = readerView(source, publishConfig, { bodyWithheld: hubBodyUnpublished, rel: target });
        shown = { from: 'note', frontmatter: view.frontmatter, markdown: view.safe.text.replace(/\n{3,}/g, '\n\n').trim() };
      }
    }
  }

  if (opts.json) {
    out(JSON.stringify({
      path: target,
      exists: true,
      directory: dir,
      mappedTo: mappedTo || null,
      type: (frontmatter && frontmatter.type) || null,
      publishMode: frontmatter ? publishMode(frontmatter) : null,
      autoExclude: auto,
      canonStatus,
      excludeDrafts: !!publishConfig.exclude_drafts,
      excludeSections: publishConfig.exclude_sections || [],
      manifestSection: manifest ? (section ? MANIFEST_LABEL[section] : 'not listed') : null,
      verdict,
      publishes,
      outputPath,
      mergedInto: mergedInto ? mergedInto.displayTitle || mergedInto.title : null,
      frontmatterError,
      strippedSections: stripped,
      sheetWithheldSections: sheetWithheld,
      gmOnlyBlocks,
      bodyPublishes: publishes && !hubBodyUnpublished,
      bodyWithheld: hubBodyUnpublished,
      ...(opts.shown ? { shown } : {}),
    }, null, 2));
    return shown && shown.from === 'error' ? 1 : 0;
  }

  out(target);
  out('');
  out('  exists: yes');
  out(`  directory: ${dir || '(vault root)'} — ${
    configExcluded ? `listed in ${nameIn(vaultPath, 'player_site.hide.folders')} (${configExcluded})`
      : mappedTo ? `mapped to ${mappedTo}`
        : dir ? `not in ${nameIn(vaultPath, 'player_site.folder_map')}` : 'the vault root'}`);
  if (frontmatterError) out(`  frontmatter: could not be parsed — ${frontmatterError}`);
  out(`  type: ${(frontmatter && frontmatter.type) || '(none)'}`);
  out(`  publish mode: ${frontmatter ? publishMode(frontmatter) : '(no frontmatter)'}`);
  out(`  auto-exclude: ${auto ? autoExcludeLabel(frontmatter, auto) : 'none'}`);
  out(`  canon status: ${canonStatus || 'none'} (exclude_drafts ${publishConfig.exclude_drafts ? 'on' : 'off'})`);
  out(`  publish list: ${manifest ? (section ? MANIFEST_LABEL[section] : 'not listed') : 'no publish list'}`);
  out(mergedInto
    ? `  VERDICT: publishes as part of ${outputPath}`
    : publishes
      ? `  VERDICT: publishes at ${outputPath}`
      : `  VERDICT: does not publish — ${verdict.reason} (${verdict.code})`);
  out('');
  out(`  sections stripped on publish: ${
    stripped == null ? 'unknown — frontmatter could not be parsed' : (stripped.length ? stripped.join(', ') : 'none')}`);
  if (sheetWithheld && sheetWithheld.length) {
    out(`  sections withheld with the character sheet: ${sheetWithheld.join(', ')}`);
  }
  out(`  gm-only blocks: ${gmOnlyBlocks == null ? 'unknown' : gmOnlyBlocks}`);
  if (hubBodyUnpublished) {
    // A hub that does not publish has no page to build from anything; say only that
    // its body would be withheld if it did, so the GM is not sent looking for a page.
    out(publishes
      ? '  body: not published — a session index is metadata only, and this session has a published Wrap-Up; its page is built from frontmatter and the Wrap-Up'
      : '  body: not published — the page itself does not publish; if it did, the body would still be withheld, since this session has a published Wrap-Up');
  }
  if (opts.shown) {
    out('');
    const block = (text) => { for (const line of (text || '(nothing)').split('\n')) out(`    ${line}`); };
    if (!shown) {
      out('  what the site holds of this note: unknown — the note could not be read');
      return 0;
    }
    if (shown.from === 'error') {
      out(`  what the site holds of this note: could not be read — the site could not be built in memory: ${shown.error}`);
      return 1;
    }
    if (shown.from === 'none') {
      out('  what the site holds of this note: nothing — it is marked publish: false, so no page is built from it');
      return 0;
    }
    const iff = publishes || mergedInto ? '' : ', if it published';
    if (shown.from === 'note') {
      out(`  the site can build no page of this note as it stands (${verdict.code}), so this is the note after every cut a page gets${iff}:`);
      out('');
      out('  frontmatter as published (a page prints some of these fields, the search and the cards read others):');
      block(Object.keys(shown.frontmatter).length
        ? YAML.stringify(shown.frontmatter, { lineWidth: 0 }).trimEnd() : '(none)');
      out('');
      out('  body as published:');
      block(shown.markdown);
      return 0;
    }
    out(`  what the site holds of this note${iff}, read off the page as the build makes it:`);
    if (shown.page !== null) {
      out('');
      out('  its page:');
      block(shown.page);
    }
    if (shown.story !== null) {
      out('');
      out('  its story page:');
      block(shown.story);
    }
    if (shown.images && shown.images.length > 0) {
      out('');
      out('  image files that publish with it:');
      block(shown.images.join('\n'));
    }
    if (shown.card) {
      out('');
      out('  its link-preview card:');
      block([shown.card.t, shown.card.k, ...(shown.card.f || []).map(([label, value]) => `${label}: ${value}`), shown.card.x].filter(Boolean).join('\n'));
    }
    if (shown.search) {
      out('');
      out('  what the search finds it by (not all of it is printed on the page):');
      block([`title: ${shown.search.title}`, shown.search.subtitle ? `subtitle: ${shown.search.subtitle}` : '',
        shown.search.aliases.length ? `aliases: ${shown.search.aliases.join(', ')}` : '',
        'every word of the body as published:', shown.search.body.replace(/\n{3,}/g, '\n\n').trim() || '(nothing)'].filter(Boolean).join('\n'));
    }
    out('');
    out('  Nothing else of this note\'s body and fields is on the site. Other pages that link the note still print its name.');
  }
  return 0;
}

// The scanner pages that publish, as the build holds them: a story companion folds
// into its PC's page and is not a page of its own.
function publishedPagesOf(survey) {
  return [...survey.pagesByRel.entries()]
    .filter(([rel]) => survey.verdicts.has(rel) && publishesPage(survey.verdicts.get(rel))
      && survey.verdicts.get(rel).code !== 'STORY_COMPANION')
    .map(([, p]) => p);
}

// `explain --all --json`: a top-level `switches` block ({ characterSheets, liveStats,
// inbox }, as the build resolves them), the campaign `system` and its `sheetFamily`
// (gurps, coc, dnd, or null for a system with no sheet), a top-level `pcKeepSections` (the resolved PC
// keep-list; null when sheets are on), a top-level `excludeSections` (the `##` titles
// the build strips: the vault file's list, else the site file's, else the default), then the verdict for every file the vault walk sees, in one run,
// so a caller that needs the build's answer for many files (vault_check gm-leak and
// sessions, #276) asks once instead of re-implementing the rules. Each entry:
//   path           vault-relative path (NFC, POSIX)
//   type           frontmatter `type`, or null
//   publishes      the build makes a page for it (a story companion merges into its PC)
//   code           the verdict code decidePage returned
//   bodyWithheld   a session index whose body the site withholds (session-hub pairHubs)
//   bodyPublishes  publishes && !bodyWithheld
//   sheetSourceSet a PC whose `sheet_source` says where its sheet is kept (#273);
//                  null for any other file
//   sheetWithheldSections  the `##` headings only the PC keep-list withholds (character
//                  sheets off); [] when none, null when the scanner made no page. Disjoint
//                  from strippedSections.
//   retiredSheetFields  a PC's frontmatter fields the campaign system's sheet no longer reads (the note
//                  body is the only source); [] when none, null for any other file
//   frontmatterError the parser's message for a file whose frontmatter could not be
//                  parsed (code FILE_UNPARSEABLE, no page is built); null otherwise (#287)
async function runExplainAll(options, deps) {
  const opts = options || {};
  const d = deps || {};
  const out = d.out || console.log;
  const survey = surveyVault(opts, d);
  assertNoStops(survey.publishConfig, 'explain');
  const pairs = pairsWith(survey, publishedPagesOf(survey));
  const parseErrors = new Map(survey.report.malformed.map((m) => [canonicalPath(m.rel), m.message]));
  const pages = survey.files.map((rel) => {
    const page = survey.pagesByRel.get(rel);
    const verdict = survey.verdicts.get(rel);
    const publishes = publishesPage(verdict);
    const withheld = !!page && pairs.has(page);
    return {
      path: rel,
      type: (page && page.frontmatter && page.frontmatter.type) || null,
      publishes,
      code: verdict.code,
      bodyWithheld: withheld,
      bodyPublishes: publishes && !withheld,
      // The headings the site withholds from this file's body, as written; null when
      // the scanner produced no page for it. gm-leak reads these rather than keep a
      // second copy of the rules (#280).
      strippedSections: page
        ? [...new Set(strippedSectionTitles(page.markdown || '', survey.publishConfig.exclude_sections || [], page.frontmatter, { pcKeepSections: pcKeepList(survey.publishConfig) }))]
        : null,
      sheetWithheldSections: page ? sheetWithheldOf(survey.publishConfig, page.markdown || '', page.frontmatter) : null,
      // vault_check pc-body reads this rather than parse the field itself.
      sheetSourceSet: page && page.frontmatter && page.frontmatter.type === 'pc'
        ? Boolean(sheetSourceOf(page.frontmatter))
        : null,
      // vault_check pc-body warns on these; the list lives in pc-prose.js.
      retiredSheetFields: page && page.frontmatter && page.frontmatter.type === 'pc'
        ? retiredSheetFieldsFor(page.sourceFrontmatter || page.frontmatter, survey.publishConfig.system)
        : null,
      // vault_check frontmatter reports these: its own reader accepts YAML this one rejects.
      frontmatterError: parseErrors.has(rel) ? parseErrors.get(rel) : null,
    };
  });
  out(JSON.stringify({ vaultPath: survey.vaultPath, switches: switchesOf(survey.publishConfig),
    system: survey.publishConfig.system || null, sheetFamily: sheetFamilyOf(survey.publishConfig.system),
    pcKeepSections: pcKeepList(survey.publishConfig),
    excludeSections: survey.publishConfig.exclude_sections || [], pages }, null, 2));
  return 0;
}

// The `field: value` that autoExcludeCode matched on, for the report line.
function autoExcludeLabel(frontmatter, code) {
  const field = { AUTO_EXCLUDED_STATUS: 'status', AUTO_EXCLUDED_STAGE: 'stage', AUTO_EXCLUDED_SOURCE: 'source' }[code];
  return `${field}: ${String(frontmatter[field]).toLowerCase()}`;
}

module.exports = { runExplain, runExplainAll };
