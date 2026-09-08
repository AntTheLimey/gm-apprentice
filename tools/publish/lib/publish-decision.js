'use strict';

// One page, one verdict — the single answer to "does this file publish, and why?".
//
// The rules used to live inline in build.js: an `isAutoExcluded` closure, a DRAFT
// filter, a `publish: none` filter and a manifest allowlist, each a separate pass.
// Nothing else could ask the question, so `manifest diff`, `doctor --site` and
// `explain` would each have had to re-derive it — and re-derive it slightly
// differently, which is how a tool ends up telling a GM a page will publish and
// then not publishing it. The rules live here now; build.js is just the first
// caller.
//
// `bucket` answers the GM's question (publish / exclude / you decide).
// `publishesPage(verdict)` answers the build's, which is not the same question:
// see the note on PUBLISHED_DECIDE_CODES.
//
// The evaluation order below is not arbitrary: it reproduces the order build.js
// applied its four passes in, because the build's console breakdown ("Auto-excluded
// N prep/draft file(s)", "Excluded N DRAFT entity/entities", "publish: false —
// skipped N file(s)") attributes each dropped page to whichever pass caught it
// first. A page carrying both `publish: false` and `status: planned` was counted as
// auto-excluded, and still is. The order is:
//
//   directory checks → NO_TYPE → STORY_COMPANION → DRAFT_EXCLUDED →
//   AUTO_EXCLUDED_* → SCENE_CUT_SKIPPED → manifest codes → PUBLISH_FALSE/NONE →
//   SUPERSEDED_NO_TARGET → OK
//
// SUPERSEDED_NO_TARGET sits last, immediately before OK, and that placement is
// load-bearing: it is the one `decide` the build still publishes, so putting it
// ahead of any real exclusion would make a superseded page outrank the manifest
// allowlist or an explicit `publish: false` and reach the site when the old build
// dropped it.
const { publishMode } = require('./processor');
const { getCanonStatus } = require('./templates/base');

const AUTO_EXCLUDE_STATUS = new Set(['planned', 'prepped']);
const AUTO_EXCLUDE_STAGE = new Set(['outline', 'draft', 'ready']);
const AUTO_EXCLUDE_SOURCE = new Set(['prep']);

// Directories that never publish, whatever the config says. `_templates` is the
// lowercase spelling some vaults use; `personal` holds the GM's own licensed
// reference copies. These are belt-and-braces: a vault's excludeDirs normally
// stops the scanner from ever producing a page here, but `manifest diff` and
// `explain` walk the raw vault and would otherwise offer them as candidates.
const ALWAYS_EXCLUDE_DIRS = ['_meta', '_Templates', '_templates', 'personal'];

// A scene that was cut or skipped did not happen. content-filtering.md has listed
// these as always-excluded since the filtering model was written; they are gated
// behind the same mode/manifest checks as the other prep-state heuristics so the
// GM's own full-mode copy still shows everything and an explicit manifest entry
// still wins.
const SCENE_SKIP_STATUS = new Set(['cut', 'skipped']);

function lower(value) {
  return String(value == null ? '' : value).toLowerCase();
}

// Which frontmatter field marks this file as prep, or null. Exported because
// build.js still reports "Auto-excluded N prep/draft file(s)" as its own line and
// needs to count the pages a manifest entry later re-included.
function autoExcludeCode(frontmatter) {
  const fm = frontmatter || {};
  if (AUTO_EXCLUDE_STATUS.has(lower(fm.status))) return 'AUTO_EXCLUDED_STATUS';
  if (AUTO_EXCLUDE_STAGE.has(lower(fm.stage))) return 'AUTO_EXCLUDED_STAGE';
  if (AUTO_EXCLUDE_SOURCE.has(lower(fm.source))) return 'AUTO_EXCLUDED_SOURCE';
  return null;
}

function autoExcludeReason(code, frontmatter) {
  const field = { AUTO_EXCLUDED_STATUS: 'status', AUTO_EXCLUDED_STAGE: 'stage', AUTO_EXCLUDED_SOURCE: 'source' }[code];
  return `${field}: ${lower(frontmatter[field])}`;
}

// The first path segment (excluding the filename) that names an always-excluded
// directory. Segment equality, not prefix matching — `_metadata/` is a normal folder.
function alwaysExcludedSegment(rel) {
  const segments = String(rel == null ? '' : rel).split('/');
  segments.pop();
  return segments.find((s) => ALWAYS_EXCLUDE_DIRS.includes(s)) || null;
}

// Manifest sections are arrays; a page-by-page `includes()` would be quadratic on a
// large vault. Index each manifest object once and hang the index off it.
const manifestIndexes = new WeakMap();
function indexOf(manifest) {
  let idx = manifestIndexes.get(manifest);
  if (!idx) {
    idx = {
      publishing: new Set(manifest.publishing || []),
      excluded: new Set(manifest.excluded || []),
      needsDecision: new Set(manifest.needsDecision || []),
    };
    manifestIndexes.set(manifest, idx);
  }
  return idx;
}

// The PC page a `<Name>_Story.md` file belongs to, or null. Mirrors the condition
// pairStoryFiles splices on: same directory, stem minus the `_Story` suffix, and a
// scanned page there whose type is `pc`. `pageIndex` is a Map of vault-relative
// path to scanner page; without one there is nothing to resolve against and every
// story file falls through to the normal chain.
function storyCompanionPc(rel, pageIndex) {
  if (!pageIndex || !/_Story\.md$/.test(String(rel || ''))) return null;
  const pc = pageIndex.get(String(rel).replace(/_Story\.md$/, '.md'));
  return pc && pc.frontmatter && pc.frontmatter.type === 'pc' ? pc : null;
}

/**
 * Classify one file.
 *
 * @param {object} page A scanner page ({frontmatter, sourcePath, outputPath}), or —
 *   for a file the scanner never produced — {rel, frontmatter: null}.
 * @param {object} options
 * @param {string} options.rel Vault-relative posix path, NFC-canonicalized.
 * @param {object} options.publishConfig loadPublishConfig() output (mode, exclude_drafts).
 * @param {object|null} options.manifest loadManifest() output, or null.
 * @param {boolean} [options.folderMapped=true] False for a file whose directory is
 *   absent from folderMap, which is why the scanner produced no page for it.
 * @param {Map<string,object>} [options.pageIndex] Vault-relative path to scanner
 *   page. Only needed to recognise a PC's story companion; omit it and story files
 *   are classified as ordinary pages.
 * @returns {{bucket:'publish'|'exclude'|'decide', code:string, reason:string,
 *   outputPath:string|null}}
 */
function decidePage(page, options) {
  const opts = options || {};
  const rel = opts.rel;
  const publishConfig = opts.publishConfig || {};
  const manifest = opts.manifest || null;
  const folderMapped = opts.folderMapped !== false;
  const frontmatter = (page && page.frontmatter) || null;
  const outputPath = (page && page.outputPath) || null;
  const verdict = (bucket, code, reason) => ({ bucket, code, reason, outputPath });

  const excludedDir = alwaysExcludedSegment(rel);
  if (excludedDir) return verdict('exclude', 'DIR_ALWAYS_EXCLUDED', `in ${excludedDir}/ — never published`);
  if (!folderMapped) {
    return verdict('decide', 'DIR_UNMAPPED', 'its folder is not in folderMap');
  }
  if (!frontmatter || !frontmatter.type) {
    return verdict('decide', 'NO_TYPE', 'no `type:` in frontmatter');
  }

  // A PC's story companion has no page of its own: the scanner folds it into the
  // PC (pairStoryFiles) and drops it from the page list, so the build never asks
  // about it. Anything walking the raw vault does, and "does not publish" would be
  // the wrong answer — the content is on the site, at the PC's URL.
  const storyPc = storyCompanionPc(rel, opts.pageIndex);
  if (storyPc) {
    // outputPath is null rather than the story file's own scanner path: no such page
    // is ever built, and handing a caller a URL the site does not serve is worse than
    // handing it nothing. The PC's page is the destination; `explain` resolves it
    // through storyCompanionPc.
    return {
      bucket: 'publish',
      code: 'STORY_COMPANION',
      reason: `merged into ${storyPc.displayTitle || storyPc.title}'s page`,
      outputPath: null,
    };
  }

  const mode = publishConfig.mode || 'player';
  const index = manifest ? indexOf(manifest) : null;
  const listedForPublish = !!(index && index.publishing.has(rel));

  if (publishConfig.exclude_drafts && getCanonStatus(frontmatter) === 'DRAFT') {
    return verdict('exclude', 'DRAFT_EXCLUDED', 'canon_status: DRAFT and exclude_drafts is on');
  }

  // The prep-state heuristics. Off in full mode (the GM's own copy shows
  // everything) and overridden by an explicit manifest Publishing entry.
  if (mode !== 'full' && !listedForPublish) {
    const auto = autoExcludeCode(frontmatter);
    if (auto) return verdict('exclude', auto, autoExcludeReason(auto, frontmatter));
    if (lower(frontmatter.type) === 'scene' && SCENE_SKIP_STATUS.has(lower(frontmatter.status))) {
      return verdict('exclude', 'SCENE_CUT_SKIPPED', `scene status: ${lower(frontmatter.status)} — it did not happen`);
    }
  }

  // The manifest is an allowlist in player mode only. A listed page falls through
  // rather than returning: `publish: false` still has to be honoured below.
  if (manifest && mode === 'player' && !listedForPublish) {
    if (index.excluded.has(rel)) return verdict('exclude', 'MANIFEST_EXCLUDED', 'manifest: Excluded');
    if (index.needsDecision.has(rel)) return verdict('decide', 'MANIFEST_NEEDS_DECISION', 'manifest: Needs Decision');
    return verdict('decide', 'MANIFEST_UNLISTED', 'in no manifest section');
  }

  // `publish: false` is an instruction, not a heuristic — honoured in every mode,
  // and never overridden by a manifest entry.
  if (publishMode(frontmatter) === 'none') {
    return frontmatter.publish === 'none'
      ? verdict('exclude', 'PUBLISH_NONE', 'publish: none')
      : verdict('exclude', 'PUBLISH_FALSE', 'publish: false');
  }

  // Ambiguous, not withheld: the page publishes, and the GM is asked which entity
  // replaced it so the link map can redirect. Last, so it can never outrank a real
  // exclusion.
  if (getCanonStatus(frontmatter) === 'SUPERSEDED' && !frontmatter.superseded_by) {
    return verdict('decide', 'SUPERSEDED_NO_TARGET', 'canon_status: SUPERSEDED with no superseded_by');
  }

  return verdict('publish', 'OK', listedForPublish ? 'manifest: Publishing' : `mode: ${mode}`);
}

// The one `decide` code the build still emits a page for. A `decide` verdict
// usually means the file is being withheld until the GM classifies it, but
// SUPERSEDED_NO_TARGET asks for a successor reference, not for the page to
// disappear — dropping it would break every link that still names the old entity.
const PUBLISHED_DECIDE_CODES = new Set(['SUPERSEDED_NO_TARGET']);

function publishesPage(verdict) {
  return verdict.bucket === 'publish' || PUBLISHED_DECIDE_CODES.has(verdict.code);
}

module.exports = {
  decidePage,
  storyCompanionPc,
  publishesPage,
  autoExcludeCode,
  ALWAYS_EXCLUDE_DIRS,
  AUTO_EXCLUDE_STATUS,
  AUTO_EXCLUDE_STAGE,
  AUTO_EXCLUDE_SOURCE,
  SCENE_SKIP_STATUS,
};
