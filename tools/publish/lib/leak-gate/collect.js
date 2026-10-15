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
const { getsNoPage } = require('../previews');
const { pcKeepList } = require('../pc-prose');
const { pairHubs } = require('../session-hub');
const { parseNote } = require('../frontmatter');
const { canonicalNfc } = require('../unicode');
const {
  playerSafeMarkdown, stubMarked, stubCut, hiddenFieldsOf, publishedFrontmatter, pcHeadingsUnstable, publishMode,
} = require('../processor');
const { createMarks, markKinds, sanitize, markedSpans } = require('../gm-marks');
const { piecesOfMarkdown, piecesOfValue, wordsOf } = require('./text');

const NEVER_SHOWN = ALWAYS_EXCLUDE_DIRS.map((d) => d.toLowerCase());
const neverShown = (rel) => rel.split('/').slice(0, -1).some((s) => NEVER_SHOWN.includes(s.toLowerCase()));
const clip = (s, max = 160) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function collectHidden({ configPath }) {
  const resolvedConfig = path.resolve(configPath || './vault.config.json');
  const siteDir = path.dirname(resolvedConfig);
  const rawConfig = loadVaultConfig(resolvedConfig);
  const vaultPath = path.resolve(siteDir, rawConfig.vaultPath);
  rawConfig.vaultPath = vaultPath;
  const keptBy = forSite(readSettings({ vaultPath, siteConfig: rawConfig, siteDir }), 'player').vault.kept_by;
  const empty = { vaultPath, siteDir, keptBy, pieces: [], visible: [], notes: [], published: [], publishedRels: new Set(), linkMap: {}, outOf: () => null };
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
    visible.push(String(page.displayTitle || ''), ...piecesOfValue(publishedFrontmatter(fm, excludeFields, overrides)));
    if (hubs.has(page)) {
      add(piecesOfMarkdown(page.markdown), rel, 'session index body (its Wrap-Up publishes)');
      continue;
    }
    if (pcKeepSections && pcHeadingsUnstable(page, linkMap, excludeSections, imageMap, { excludeCallouts, pcKeepSections })) {
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
      visible.push(playerSafeMarkdown(shownText, options).text);
    }
  }

  // Every other note's body is hidden text: no page publishes it.
  const scannedByRel = new Map(corpus.map((p) => [relOf(p), p]));
  for (const note of notes) {
    const rel = canonicalNfc(String(note.vaultPath).replace(/\\/g, '/') + '.md');
    if (publishedRels.has(rel) || neverShown(rel)) continue;
    const page = scannedByRel.get(rel);
    if (page && publishedSet.has(page)) continue;
    const verdict = page ? verdicts.get(page) : null;
    let body = page ? page.markdown : null;
    if (body == null) {
      try { body = parseNote(fs.readFileSync(note.sourcePath, 'utf8')).content; } catch (e) { body = ''; }
    }
    const why = verdict && verdict.player ? verdict.player.reason : 'not on the site';
    add(piecesOfMarkdown(body), rel, `unpublished note: ${why}`);
  }

  return { vaultPath, siteDir, keptBy, pieces, visible, notes, published, publishedRels, linkMap, outOf: (rel) => outputOf.get(rel) || null };
}

module.exports = { collectHidden };
