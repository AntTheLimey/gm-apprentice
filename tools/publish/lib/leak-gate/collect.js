'use strict';
// The hidden text of a vault, for the leak gate (#293): every part a hiding rule keeps off the player site, as pieces of
// four words or more, each with its note and why it is hidden. Made by the GM site's own marking code with every kind
// on (the GM site's switches decide what it shows, not what the player site must not), without building GM pages.
// Also the player site's own source text: a hidden piece that a published note also says is not hidden.
const fs = require('fs');
const path = require('path');
const { scanVaultReport, scanAllNotes, buildLinkMap, scanAttachments, STORY_SUFFIX } = require('../scanner');
const { resolveConfig, loadPublishConfig, loadVaultConfig, vaultRelPath } = require('../config');
const { readSettings, forSite } = require('../settings');
const { loadManifest } = require('../manifest');
const { publishedPages } = require('../published-pages');
const { ALWAYS_EXCLUDE_DIRS } = require('../publish-decision');
const { getsNoPage, listedOnly, rowsFor } = require('../previews');
const { pcKeepList } = require('../pc-prose');
const { pairHubs } = require('../session-hub');
const { parseNote } = require('../frontmatter');
const { canonicalNfc } = require('../unicode');
const {
  playerSafeMarkdown, stubMarked, stubCut, hiddenFieldsOf, publishedFrontmatter, pcHeadingsUnstable, publishMode, isWithheld, stripLeadingH1,
} = require('../processor');
const { createMarks, markKinds, sanitize, markedSpans } = require('../gm-marks');
const { piecesOfMarkdown, piecesOfValue, piecesOfHtml, fieldRunsOf, tableRunsOf, textsOfMarkdown, wordsOf } = require('./text');
const { TEXT_EXT, fileText } = require('./match');
const { planProps, planStatePictures, stateFileOf, bytesOf, textOf } = require('../props/plan');
const { placeCollection, propTaken, containerItems, propRow, sealedTitlesOn, stateFieldsOf, stateFieldsOfListed } = require('../props/collection');
const { cutHtml } = require('../props/html-cut');
const { styledPageProblem } = require('../props/page');
const { pathProblem } = require('../props/files');
const { buildConnections } = require('../connections');

const NEVER_SHOWN = ALWAYS_EXCLUDE_DIRS.map((d) => d.toLowerCase());
const neverShown = (rel) => rel.split('/').slice(0, -1).some((s) => NEVER_SHOWN.includes(s.toLowerCase()));
// The plugin's own working folders, at the top of the vault: reports, inbox, archive and drafts that routinely quote the
// published site. Only these: a folder the GM lists in hide.folders (a "Secrets" folder) is collected like any other.
const WORKING_DIRS = ['_qa', '_inbox', '_archive', '_midwife'];
const inWorkingDir = (rel) => WORKING_DIRS.includes(rel.split('/')[0].toLowerCase());
// The fields a page prints under the tool's own labels (occupation as "Role"), as "label value".
function printedRows(page) {
  try { return rowsFor(page, {}).filter(([, text]) => text).map(([label, text]) => `${label} ${text}`); } catch (e) { return []; }
}
const HELD_TITLE = 'the title of an unpublished prop';
const HELD_FIELD = 'a field of an unpublished prop';
const clip = (s, max = 160) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// `outputDir`, when given, is the built site: a made page the build could not write there (a link on its path) is no
// shipping prop's.
function collectHidden({ configPath, outputDir = null }) {
  const resolvedConfig = path.resolve(configPath || './vault.config.json');
  const siteDir = path.dirname(resolvedConfig);
  const rawConfig = loadVaultConfig(resolvedConfig);
  const vaultPath = path.resolve(siteDir, rawConfig.vaultPath);
  rawConfig.vaultPath = vaultPath;
  const player = forSite(readSettings({ vaultPath, siteConfig: rawConfig, siteDir }), 'player');
  const keptBy = player.vault.kept_by;
  // The GM's own words that must never reach players (player_site.never_show): looked for on every kind of vault.
  const neverShow = (player.site.never_show || []).filter((w) => typeof w === 'string' && w.trim());
  const empty = { vaultPath, siteDir, keptBy, neverShow, pieces: [], visible: [], warnings: [], notes: [], published: [], publishedRels: new Set(), linkMap: {}, outOf: () => [], propOwner: new Map(), propFiles: new Set(), madeFiles: new Set(), stateFiles: new Set(), heldProps: [], heldNotePages: [], heldTitles: [], sealedOn: new Map(), collectionAddress: null, siteTakes: () => false, keeps: () => false };
  if (keptBy === 'player') return empty;

  const quiet = () => {};
  const { config } = resolveConfig(rawConfig, vaultPath, quiet, { quietStops: true, siteDir });
  const playerConfig = loadPublishConfig(vaultPath, rawConfig, quiet, { quietStops: true, siteDir, site: 'player' });
  const manifest = loadManifest(vaultPath, { warn: quiet });
  const relOf = (page) => vaultRelPath(vaultPath, page.sourcePath);

  // Every folder but the never-shown ones, as the GM site showing whole notes reads it.
  const scanConfig = Object.assign({}, config, { vaultPath, excludeDirs: ALWAYS_EXCLUDE_DIRS });
  const pages = scanVaultReport(scanConfig).pages;
  const corpus = pages.slice();
  const show = new Set(markKinds());
  const { verdicts, playerPublished } = publishedPages(pages, {
    vaultPath, publishConfig: playerConfig, manifest, relOf, site: 'gm', show, hiddenFolders: playerConfig.exclude_dirs, playerConfig,
  });
  const published = playerPublished.filter((p) => !getsNoPage(p));
  const publishedSet = new Set(published);
  // The props a container lists with no page of their own (previews.js listedOnly): published, shown in their listings.
  const listedSet = new Set(playerPublished.filter((p) => listedOnly(p)));
  const shownSet = new Set([...published, ...listedSet]);
  const linkMap = buildLinkMap(published);
  const notes = scanAllNotes(vaultPath);
  const hubs = pairHubs(corpus, published, { vaultPath, allNotes: notes, withheldWords: playerConfig.withheld_words });

  const excludeSections = playerConfig.exclude_sections;
  const excludeCallouts = playerConfig.exclude_callouts;
  const excludeFields = playerConfig.exclude_fields;
  const fieldOverrides = playerConfig.overrides.fields || {};
  const pcKeepSections = pcKeepList(playerConfig);
  const imageMap = pcKeepSections ? scanAttachments(scanConfig) : {};
  const mark = { marks: createMarks(), show, sanitized: true };

  const pieces = [];
  const visible = [];
  const warnings = [];
  const add = (texts, note, reason) => {
    for (const shown of texts) {
      const words = wordsOf(shown);
      pieces.push({ words, text: words.join(' '), shown: clip(shown), note, reason });
    }
  };
  const addMarked = (markdown, note) => {
    for (const span of markedSpans(markdown, mark.marks)) add(piecesOfMarkdown(span.text), note, span.label);
  };

  const publishedRels = new Set();
  const outputOf = new Map();
  // Each published note's body as its page shows it (the build's publishedMarkdown): a styled prop's page is made from it.
  const shownBodyOf = new Map();
  for (const page of published) {
    const rel = relOf(page);
    publishedRels.add(rel);
    outputOf.set(rel, page.outputPath);
    if (page.storyMarkdown) publishedRels.add(rel.replace(/\.md$/i, STORY_SUFFIX));
    const fm = page.frontmatter || {};
    const overrides = fieldOverrides[rel] || {};
    for (const h of hiddenFieldsOf(fm, excludeFields, overrides)) add(piecesOfValue(h.value), rel, h.label);
    const shownFields = publishedFrontmatter(fm, excludeFields, overrides);
    visible.push(String(page.displayTitle || ''), ...fieldRunsOf(shownFields, page.displayTitle), ...printedRows({ ...page, frontmatter: shownFields }));
    if (hubs.has(page)) {
      add(piecesOfMarkdown(page.markdown), rel, 'session index body (its Wrap-Up publishes)');
      continue;
    }
    // The page as the build holds it when it asks: the note's own frontmatter apart, the published one in its place (the
    // portrait named there decides which image embed the headings check drops).
    const asBuilt = { ...page, sourceFrontmatter: fm, frontmatter: publishedFrontmatter(fm, excludeFields, overrides) };
    if (pcKeepSections && pcHeadingsUnstable(asBuilt, linkMap, excludeSections, imageMap, { excludeCallouts, pcKeepSections })) {
      add(piecesOfMarkdown(page.markdown), rel, 'note body (a link label changes its headings)');
      continue;
    }
    const options = { excludeSections, excludeCallouts, frontmatter: fm, pcKeepSections };
    for (const source of [page.markdown, page.storyMarkdown].filter((t) => typeof t === 'string')) {
      let text = sanitize(source);
      let shownText = source;
      if (publishMode(fm) === 'stub') {
        const include = Array.isArray(fm.publish_include_sections) ? fm.publish_include_sections : [];
        const withhold = { excludeSections, excludeCallouts, frontmatter: fm };
        text = stubMarked(text, include, withhold, mark);
        shownText = stubCut(source, include, withhold).text;
      }
      addMarked(playerSafeMarkdown(text, { ...options, mark }).text, rel);
      // Read as the hidden pieces are (textsOfMarkdown), so a sentence the GM wrote in both places matches; its blocks as
      // one run, in order, as the page shows them (a table row's cells, a callout's title and its text, a heading).
      const shownMarkdown = playerSafeMarkdown(shownText, options).text;
      if (source === page.markdown) shownBodyOf.set(page, shownMarkdown);
      visible.push(textsOfMarkdown(shownMarkdown, { headings: true }).join('\n'));
      // The page's title heads its body in place of the note's own leading H1 (the build drops it), so the title runs on
      // into the first words under it: "[[Wrap Up]] — narrative recap" is a page title and the heading players see next.
      if (source === page.markdown) visible.push([String(page.displayTitle || ''), ...textsOfMarkdown(stripLeadingH1(shownMarkdown), { headings: true })].join('\n'));
      visible.push(...tableRunsOf(shownMarkdown));
    }
  }

  // Every other note's body is hidden text: no page publishes it. The folders that never publish and the plugin's own
  // working folders are left out (WORKING_DIRS); a folder the GM hides is not.
  const scannedByRel = new Map(corpus.map((p) => [relOf(p), p]));
  for (const note of notes) {
    const rel = canonicalNfc(String(note.vaultPath).replace(/\\/g, '/') + '.md');
    if (publishedRels.has(rel) || neverShown(rel) || inWorkingDir(rel)) continue;
    const page = scannedByRel.get(rel);
    if (page && shownSet.has(page)) continue;
    const verdict = page ? verdicts.get(page) : null;
    let body = page ? page.markdown : null;
    if (body == null) {
      // A note that cannot be read is checked as its whole text (it fails closed), and said.
      let raw = '';
      // A note that cannot be read at all stops the check: its text could be anywhere on the site.
      try { raw = fs.readFileSync(note.sourcePath, 'utf8'); } catch (e) { throw new Error(`Leak check: ${rel} could not be read (${e.message}), so its text cannot be checked. Fix the file and deploy again.`); }
      try { body = parseNote(raw).content; } catch (e) {
        body = raw;
        warnings.push(`Leak check: the frontmatter of ${rel} cannot be read (${String(e.message).split('\n')[0]}); its whole text is checked.`);
      }
    }
    const why = verdict && verdict.player ? verdict.player.reason : 'not on the site';
    add(piecesOfMarkdown(body), rel, `unpublished note: ${why}`);
  }

  // What a page's Connections section prints (lib/connections.js), made as the build makes it from the published
  // frontmatter: each group's label with each name under it ("Trusted by" and a name), words the page says itself. A tie
  // to a name with no page counts here as a note's (left off the page), so nothing is read in that the page leaves out.
  if (playerConfig.connections !== 'off') {
    const view = published.map((p) => ({ ...p, frontmatter: publishedFrontmatter(p.frontmatter || {}, excludeFields, fieldOverrides[relOf(p)] || {}) }));
    const cx = buildConnections({ pages: view, linkMap, backlinks: {}, hubPairs: new Map(), imageMap: {}, extras: new Map(), pageFor: () => undefined, noteExists: () => true });
    for (const page of view) {
      for (const tab of cx.for(page).tabs) for (const group of tab.groups) for (const it of group.items) visible.push(`${group.label} ${it.title}`);
    }
  }

  // The props, planned as the player build plans them (props/plan.js): a prop ships with its note's full page, never
  // with a stub's, at an address no page, tool folder, props page or (by default) kept folder takes, cut of its Keeper
  // parts. The props page is placed as the build places it (props/collection.js).
  const pageOutputs = published.map((p) => p.outputPath);
  const keptDirs = player.site.keep || [];
  const { collection } = placeCollection({ pages: published, settingsLike: playerConfig, pageOutputs, keptDirs });
  const taken = propTaken({ pageOutputs, keptDirs, collection });
  const propPlan = planProps({
    vaultPath, pages: corpus, relOf,
    ships: (p) => publishedSet.has(p) && publishMode(p.sourceFrontmatter || p.frontmatter) !== 'stub',
    taken,
    cutKeeper: true,
  });
  const { props } = propPlan;
  // What each container lists, as the build's listings show it: the pictures its state file names ship as its files
  // (props/plan.js), from the items' published fields.
  const listed = containerItems({ props, isShown: (pg) => shownSet.has(pg), excludeFields, fieldOverrides, hasPage: (pg) => publishedSet.has(pg) });
  const publishedFieldsOf = (p) => publishedFrontmatter(p.page.sourceFrontmatter || p.page.frontmatter || {}, excludeFields, fieldOverrides[p.rel] || {});
  planStatePictures(propPlan, stateFieldsOfListed(listed, { props, fieldsOf: publishedFieldsOf }));
  // Each file a shipping prop puts on the site, and its notes: there it is their published form. A file two props share
  // byte for byte is written once and belongs to both.
  const propOwner = new Map();
  const propOuts = new Map();
  const own = (out, rel) => {
    const key = canonicalNfc(out);
    if (!propOwner.has(key)) propOwner.set(key, new Set());
    propOwner.get(key).add(rel);
    if (!propOuts.has(rel)) propOuts.set(rel, []);
    propOuts.get(rel).push(out);
  };
  const heldProps = [];
  // A container's state file (prop_state) is a file the tool makes, as a container's page is: read as text, with no
  // hidden text of another note excused on it, only its sealed titles (sealedOn). One the build could not write is not.
  const stateFiles = new Set();
  const madeState = (p) => {
    const state = stateFileOf(p);
    if (!state || (outputDir && (pathProblem(outputDir, p.address) || pathProblem(outputDir, state.out)))) return;
    madeFiles.add(canonicalNfc(state.out));
    stateFiles.add(canonicalNfc(state.out));
    if (!propOuts.has(p.rel)) propOuts.set(p.rel, []);
    propOuts.get(p.rel).push(state.out);
  };
  // The page each unpublished prop note would have, at its scanned output path (index.js watches links to it). Not one
  // inside a kept folder: the build writes no page there, so a file there is the GM's own.
  const heldNotePages = [];
  // The pages the tool makes for shipping props (a styled page, a container's page): read as ordinary pages, their words
  // their notes' published words. Not a prop file of their note: no hidden text of another note is excused on them.
  const madeFiles = new Set();
  const shownName = (p, source) => {
    try { return path.relative(fs.realpathSync(path.dirname(p.page.sourcePath)), source).split(path.sep).join('/'); } catch (e) { return path.basename(source); }
  };
  // The titles of 2 words or more of unpublished props that are not withheld (a withheld one is a secret name already):
  // looked for whole, as written, in the kept folders (index.js), where an old listing can outlive the build.
  const heldTitles = [];
  const usedStyles = new Map();
  for (const p of props) {
    // A prop whose note the site does not publish: the title a listing would print for it is hidden text (an old props
    // page naming it). Allowed only where a container lists it sealed (sealedOn, below). Not one in the plugin's working
    // folders, whose notes are left out as above.
    if (!shownSet.has(p.page) && !inWorkingDir(p.rel)) {
      const title = propRow(p, { isShown: () => false, excludeFields, fieldOverrides }).title;
      add([title], p.rel, HELD_TITLE);
      // Its line and the fields a container's state file would give it: no listing prints them (a sealed row is its title).
      const heldFm = p.page.sourceFrontmatter || p.page.frontmatter || {};
      add(piecesOfValue([heldFm.prop_line, ...Object.values(stateFieldsOf(heldFm))]), p.rel, HELD_FIELD);
      if (!isWithheld(p.page.sourceFrontmatter || p.page.frontmatter) && wordsOf(title).length >= 2) heldTitles.push({ title, note: p.rel });
    }
    if (!shownSet.has(p.page) && p.page.outputPath && !taken.keeps(p.page.outputPath)) heldNotePages.push({ rel: p.rel, address: p.page.outputPath });
    if (!p.source) {
      // A page the build does not make is not on the site: its address is no shipping prop's. A styled page whose note
      // shows no words under ## The Text (styledPageProblem, which the build's make pass asks of the same player view; a
      // note with no body here is one its page withholds whole, '' to the build too), and a made page whose path in the
      // site folder is not a plain folder or file (props/files.js), as the build blocks them.
      const unmade = styledPageProblem(p, shownBodyOf.get(p.page) ?? '') !== null
        || Boolean(outputDir && p.address && pathProblem(outputDir, p.address));
      if (p.ships && p.address && p.made && !unmade) {
        madeFiles.add(canonicalNfc(p.address));
        if (p.style) usedStyles.set(p.style.name, p.style);
        if (!propOuts.has(p.rel)) propOuts.set(p.rel, []);
        propOuts.get(p.rel).push(p.address);
        madeState(p);
      } else if (!p.ships && p.address) {
        // A held prop the tool would make a page for (its style may not have loaded): a page at its address is stale.
        heldProps.push({ rel: p.rel, address: p.address, hash: null, size: null });
      }
      continue;
    }
    if (p.ships && p.address && p.files.length) {
      madeState(p);
      for (const f of p.files) {
        if (f.made === 'state') continue;
        own(f.out, p.rel);
        // What the cut takes out of a page or SVG: hidden text of the note, if it reaches the site. A hidden sentence the
        // same file also shows players (a GM's credits line beside the one players got) is on that page anyway: not hidden.
        if (!f.cut || !bytesOf(f)) continue;
        const cut = cutHtml(textOf(bytesOf(f)).text);
        const shownWords = ` ${wordsOf(fileText(f.out, cut.text)).join(' ')} `;
        for (const run of cut.cut) {
          add(piecesOfHtml(run).filter((t) => !shownWords.includes(` ${wordsOf(t).join(' ')} `)), p.rel, `a hidden part of its prop file (${shownName(p, f.source)})`);
        }
      }
      for (const out of p.shared) own(out, p.rel);
      continue;
    }
    // A prop that does not ship: its whole file is hidden, and so is any file at its address or with its bytes.
    const verdict = verdicts.get(p.page);
    const fm = p.page.sourceFrontmatter || p.page.frontmatter;
    const why = p.ships ? 'its file is not copied (PROP_NOT_COPIED)'
      : publishedSet.has(p.page) && publishMode(fm) === 'stub' ? 'publish: stub'
        : verdict && verdict.player ? verdict.player.reason : 'not on the site';
    let bytes;
    // A prop file that cannot be read stops the check, as a note does: its text could be anywhere on the site.
    try { bytes = fs.readFileSync(p.source); } catch (e) { throw new Error(`Leak check: the prop file of ${p.rel} could not be read (${e.message}), so its text cannot be checked. Fix the file and deploy again.`); }
    if (TEXT_EXT.has(path.extname(p.source).toLowerCase())) add(piecesOfHtml(textOf(bytes).text), p.rel, `unpublished prop: ${why}`);
    heldProps.push({ rel: p.rel, address: p.address, hash: p.hash, size: bytes.length });
  }

  // The words a style's layout (and its sheet) writes around every page made with it are the build's own, on the site
  // for players: already visible, as a published page's words are. Only a style a page on this site is made with.
  for (const style of usedStyles.values()) {
    for (const template of [style.layout, style.sheet]) {
      visible.push(...piecesOfHtml(String(template || '').replace(/\{\{\{?[^{}]*\}?\}\}/g, '\n')));
    }
  }

  // Where a container lists an item the players have not found by its title alone: that title's words, on that
  // container's page and on the props page, are no finding, whichever hidden note also says them (a prep note's list of
  // props to plant): the page prints those words and no more (index.js), and so does its state file. Never a withheld
  // item's title (containerItems lists none).
  const sealedOn = new Map();
  for (const [address, titles] of sealedTitlesOn(listed, collection && collection.address)) {
    sealedOn.set(canonicalNfc(address), new Set([...titles.values()].map((title) => wordsOf(title).join(' '))));
  }

  // A note's outputs: its page, then its prop's files.
  const outOf = (rel) => [outputOf.get(rel), ...(propOuts.get(rel) || [])].filter(Boolean);
  return {
    vaultPath, siteDir, keptBy, neverShow, pieces, visible, warnings, notes, published, publishedRels, linkMap, outOf,
    propOwner, propFiles: new Set(propOwner.keys()), madeFiles, stateFiles, heldProps, heldNotePages, heldTitles, sealedOn,
    keeps: (rel) => taken.keeps(rel),
    collectionAddress: collection && collection.address ? canonicalNfc(collection.address) : null,
    // An address the site itself fills (a page, a file it needs, a tool folder): a held prop there is not what is there.
    siteTakes: (address) => Boolean(taken.has(address, { explicit: true })),
  };
}

module.exports = { collectHidden, HELD_TITLE };
