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
const { getsNoPage, rowsFor } = require('../previews');
const { pcKeepList } = require('../pc-prose');
const { pairHubs } = require('../session-hub');
const { parseNote } = require('../frontmatter');
const { canonicalNfc } = require('../unicode');
const {
  playerSafeMarkdown, stubMarked, stubCut, hiddenFieldsOf, publishedFrontmatter, pcHeadingsUnstable, publishMode,
} = require('../processor');
const { createMarks, markKinds, sanitize, markedSpans } = require('../gm-marks');
const { piecesOfMarkdown, piecesOfValue, piecesOfHtml, fieldRunsOf, tableRunsOf, textsOfMarkdown, wordsOf } = require('./text');
const { TEXT_EXT } = require('./match');
const { planProps, bytesOf } = require('../props/plan');
const { takenAddresses } = require('../props/address');
const { cutHtml } = require('../props/html-cut');

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
const clip = (s, max = 160) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function collectHidden({ configPath }) {
  const resolvedConfig = path.resolve(configPath || './vault.config.json');
  const siteDir = path.dirname(resolvedConfig);
  const rawConfig = loadVaultConfig(resolvedConfig);
  const vaultPath = path.resolve(siteDir, rawConfig.vaultPath);
  rawConfig.vaultPath = vaultPath;
  const player = forSite(readSettings({ vaultPath, siteConfig: rawConfig, siteDir }), 'player');
  const keptBy = player.vault.kept_by;
  // The GM's own words that must never reach players (player_site.never_show): looked for on every kind of vault.
  const neverShow = (player.site.never_show || []).filter((w) => typeof w === 'string' && w.trim());
  const empty = { vaultPath, siteDir, keptBy, neverShow, pieces: [], visible: [], warnings: [], notes: [], published: [], publishedRels: new Set(), linkMap: {}, outOf: () => [], propOwner: new Map(), propFiles: new Set(), heldProps: [], siteTakes: () => false };
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
      visible.push(textsOfMarkdown(shownMarkdown, { headings: true }).join('\n'));
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
    if (page && publishedSet.has(page)) continue;
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

  // The props, planned as the player build plans them (props/plan.js): a prop ships with its note's full page, never
  // with a stub's, at an address no page, tool folder or (by default) kept folder takes, cut of its Keeper parts.
  const taken = takenAddresses({ pageOutputs: published.map((p) => p.outputPath), keptDirs: player.site.keep || [] });
  const { props } = planProps({
    vaultPath, pages: corpus, relOf,
    ships: (p) => publishedSet.has(p) && publishMode(p.sourceFrontmatter || p.frontmatter) !== 'stub',
    taken,
    cutKeeper: true,
  });
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
  const shownName = (p, source) => {
    try { return path.relative(fs.realpathSync(path.dirname(p.page.sourcePath)), source).split(path.sep).join('/'); } catch (e) { return path.basename(source); }
  };
  for (const p of props) {
    if (!p.source) continue;
    if (p.ships && p.address && p.files.length) {
      for (const f of p.files) {
        own(f.out, p.rel);
        // What the cut takes out of a page or SVG: hidden text of the note, if it reaches the site.
        if (!f.cut || !bytesOf(f)) continue;
        for (const run of cutHtml(bytesOf(f).toString('utf8')).cut) add(piecesOfHtml(run), p.rel, `a hidden part of its prop file (${shownName(p, f.source)})`);
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
    if (TEXT_EXT.has(path.extname(p.source).toLowerCase())) add(piecesOfHtml(bytes.toString('utf8')), p.rel, `unpublished prop: ${why}`);
    heldProps.push({ rel: p.rel, address: p.address, hash: p.hash, size: bytes.length });
  }

  // A note's outputs: its page, then its prop's files.
  const outOf = (rel) => [outputOf.get(rel), ...(propOuts.get(rel) || [])].filter(Boolean);
  return {
    vaultPath, siteDir, keptBy, neverShow, pieces, visible, warnings, notes, published, publishedRels, linkMap, outOf,
    propOwner, propFiles: new Set(propOwner.keys()), heldProps,
    // An address the site itself fills (a page, a file it needs, a tool folder): a held prop there is not what is there.
    siteTakes: (address) => Boolean(taken.has(address, { explicit: true })),
  };
}

module.exports = { collectHidden };
