'use strict';

// `manifest diff` and `manifest apply`: the publish manifest as a thing you can
// compare and edit, rather than a markdown file the model rewrites from memory.
//
// `diff` walks the vault, asks publish-decision what each file would do, and shows
// what the manifest does not yet say about it — so the answer comes from the same
// code the build runs, not from re-reading the filtering rules.
// `apply` moves named paths between the three sections and rewrites the file in the
// documented format (publish-site/references/content-filtering.md § Manifest Format),
// keeping the annotations on the entries it was not asked to touch.
const fs = require('fs');
const path = require('path');
const { scanVaultReport, dirIsExcluded, scanAllNotes } = require('./scanner');
const { loadPublishConfig, vaultRelPath, loadVaultConfig, scanConfigFor } = require('./config');
const { loadManifest, canonicalPath } = require('./manifest');
const { decidePage, publishesPage } = require('./publish-decision');
const { pairHubs, isWrapUp } = require('./session-hub');
const { getCanonStatus } = require('./templates/base');
const { sitePin } = require('./site-pin');

const SECTIONS = [
  { key: 'publishing', title: 'Publishing', checked: true },
  { key: 'excluded', title: 'Excluded', checked: true },
  { key: 'needsDecision', title: 'Needs Decision', checked: false },
];
const TITLE_OF = { publishing: 'Publishing', excluded: 'Excluded', needsDecision: 'Needs Decision' };

function toPosix(p) {
  return p.split(path.sep).join('/');
}

// Every .md file the GM could publish: the whole vault minus the directories the
// config already rules out. Deliberately NOT the scanner's page list — a file the
// scanner refused (no `type:`, unmapped folder) is exactly the kind the GM needs
// to see in a diff.
function listVaultMarkdown(vaultPath, excludeDirs) {
  const excluded = Array.isArray(excludeDirs) ? excludeDirs : [];
  const found = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = toPosix(path.relative(vaultPath, full));
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        if (dirIsExcluded(rel, excluded)) continue;
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        found.push(canonicalPath(rel));
      }
    }
  }
  walk(vaultPath);
  return found.sort();
}

// The manifest as an editable structure: path -> { section, annotation }, in
// first-seen order. parseManifest() throws annotations away (the build has no use
// for them); rewriting the file without them would silently delete the GM's own
// notes on why each entry is where it is.
function parseAnnotatedManifest(markdown) {
  const entries = new Map();
  const body = String(markdown).replace(/\r/g, '').replace(/^---\n[\s\S]*?\n---\n?/, '');
  const ENTRY = /^- \[([ xX])\]\s+(.+)$/;
  const GROUPED = /^\s+-\s+(.+)$/;
  const REASON = /^- Reason:\s*(.+)$/;

  let section = null;
  let groupReason = null;
  for (const line of body.split('\n')) {
    const heading = /^## (.+)/.exec(line);
    if (heading) {
      const title = heading[1].trim();
      section = title.startsWith('Publishing') ? 'publishing'
        : title.startsWith('Needs Decision') ? 'needsDecision'
          : title.startsWith('Excluded') ? 'excluded' : null;
      groupReason = null;
      continue;
    }
    if (!section) continue;

    const reason = REASON.exec(line);
    if (reason) { groupReason = reason[1].trim(); continue; }

    let raw = null;
    const checkbox = ENTRY.exec(line);
    if (checkbox) raw = checkbox[2].trim();
    else {
      const grouped = GROUPED.exec(line);
      if (grouped && !/^reason:/i.test(grouped[1].trim())) raw = grouped[1].trim();
    }
    if (!raw) continue;

    // Same anchoring as manifest.js: a filename may legitimately contain " — ".
    const split = /^(.*?\.\w+)(?:\s+(?:—|–|--)\s+(.*))?$/.exec(raw);
    const rel = canonicalPath(split ? split[1] : raw);
    const annotation = (split && split[2] ? split[2].trim() : null) || groupReason || null;
    entries.set(rel, { section, annotation: section === 'needsDecision' ? null : annotation });
  }
  return entries;
}

function renderManifest({ entries, generated, vault, mode, totalFiles }) {
  const bySection = { publishing: [], excluded: [], needsDecision: [] };
  for (const [rel, entry] of entries) bySection[entry.section].push({ rel, annotation: entry.annotation });
  for (const key of Object.keys(bySection)) bySection[key].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const lines = [
    '---',
    `generated: ${generated}`,
    `vault: ${JSON.stringify(vault)}`,
    `mode: ${mode}`,
    `total_files: ${totalFiles}`,
    `publishing: ${bySection.publishing.length}`,
    `excluded: ${bySection.excluded.length}`,
    `needs_decision: ${bySection.needsDecision.length}`,
    '---',
    '',
  ];
  for (const section of SECTIONS) {
    const rows = bySection[section.key];
    lines.push(`## ${section.title} (${rows.length} files)`, '');
    for (const row of rows) {
      const box = section.checked ? '- [x]' : '- [ ]';
      lines.push(row.annotation ? `${box} ${row.rel} — ${row.annotation}` : `${box} ${row.rel}`);
    }
    lines.push('');
  }
  // An empty section contributes header + two blanks; collapse those, and end the
  // file on exactly one newline.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n');
}

// `--exclude "Path.md=reason"`. The path is everything before the first `=`, so a
// reason may contain one.
function splitReason(arg) {
  const value = String(arg);
  const at = value.indexOf('=');
  if (at === -1) return { rel: canonicalPath(value.trim()), annotation: null };
  return {
    rel: canonicalPath(value.slice(0, at).trim()),
    annotation: value.slice(at + 1).trim() || null,
  };
}

// The shared half of both verbs: resolve the config, walk the vault, and hand back
// one verdict per file.
function surveyVault(options, deps) {
  const configPath = path.resolve(options.configPath || './vault.config.json');
  const configDir = path.dirname(configPath);
  // options.vaultPath (`--vault`) reads another vault through this site's rules —
  // vault_check asks about the vault it is checking, which need not be the one the
  // site's own vaultPath names (a working copy, say).
  const config = loadVaultConfig(configPath, deps, { requireVaultPath: !options.vaultPath });
  const vaultPath = options.vaultPath ? path.resolve(options.vaultPath)
    : deps.config ? config.vaultPath : path.resolve(configDir, config.vaultPath);
  const publishConfig = deps.publishConfig || loadPublishConfig(vaultPath, config);
  const manifest = loadManifest(vaultPath);

  // scanConfigFor: same unioned, normalized exclude_dirs build.js uses, so this command
  // predicts exactly what the build does with a folder excluded only via vault-config.md's
  // publish.exclude_dirs, not just the legacy vault.config.json field (#209 follow-up).
  const scanConfig = scanConfigFor(Object.assign({}, config, { vaultPath }), publishConfig);
  const report = scanVaultReport(scanConfig);
  const pagesByRel = new Map(report.pages.map((p) => [vaultRelPath(vaultPath, p.sourcePath), p]));
  const untyped = new Set(report.untyped.map(canonicalPath));
  const unmappedDirs = new Set(report.unmapped.map((u) => canonicalPath(u.dir)));
  // A file gray-matter could not parse at all never produced a scanner page, and
  // decidePage would read that the same as "no `type:`" (NO_TYPE) — the wrong verdict,
  // since there is no frontmatter to have a type. Both `manifest diff` and `explain`
  // (which shares this verdicts map) need to say the file itself is broken instead.
  const malformedByRel = new Map(report.malformed.map((m) => [canonicalPath(m.rel), m.message]));

  const files = listVaultMarkdown(vaultPath, publishConfig.exclude_dirs);
  const verdicts = new Map();
  for (const rel of files) {
    const page = pagesByRel.get(rel);
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const parseError = malformedByRel.get(rel);
    verdicts.set(rel, parseError
      ? { bucket: 'exclude', code: 'FILE_UNPARSEABLE', reason: `frontmatter could not be parsed: ${parseError}`, outputPath: null }
      : decidePage(page || { rel, frontmatter: null }, {
        rel,
        publishConfig,
        manifest,
        pageIndex: pagesByRel,
        folderMapped: page ? true : !(unmappedDirs.has(dir) && !untyped.has(rel)),
      }));
  }

  return { config, configPath, siteDir: configDir, vaultPath, publishConfig, manifest, files, verdicts, pagesByRel, report };
}

async function runDiff(options, deps, survey) {
  const out = deps.out || console.log;
  const readFile = deps.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const { vaultPath, publishConfig, manifest, files, verdicts } = survey;

  const listed = manifest
    ? parseAnnotatedManifest(readFile(path.join(vaultPath, '_meta', 'publish-manifest.md')))
    : new Map();

  const added = [];
  const unchanged = { publishing: 0, excluded: 0, needsDecision: 0 };
  for (const rel of files) {
    const entry = listed.get(rel);
    if (entry) { unchanged[entry.section]++; continue; }
    const v = verdicts.get(rel);
    added.push({ path: rel, bucket: v.bucket, code: v.code, reason: v.reason });
  }

  const onDisk = new Set(files);
  const removed = [];
  for (const [rel, entry] of listed) {
    if (!onDisk.has(rel)) removed.push({ path: rel, section: TITLE_OF[entry.section] });
  }

  const counts = {
    publishing: files.filter((f) => verdicts.get(f).bucket === 'publish').length,
    excluded: files.filter((f) => verdicts.get(f).bucket === 'exclude').length,
    needsDecision: files.filter((f) => verdicts.get(f).bucket === 'decide').length,
    new: added.length,
    removed: removed.length,
    unchanged,
  };

  if (options.json) {
    out(JSON.stringify({
      mode: publishConfig.mode,
      manifestExists: !!manifest,
      new: added,
      removed,
      counts,
    }, null, 2));
    return 0;
  }

  const header = manifest ? `mode ${publishConfig.mode}` : 'no manifest';
  out(`manifest: ${header} — ${counts.publishing} publishing, ${counts.excluded} excluded, ${counts.needsDecision} needs decision`);
  out('');
  out(`New (${added.length}):`);
  for (const row of added) out(`  ${row.path}\t${row.bucket}\t${row.code}\t${row.reason}`);
  out('');
  out(`Removed (${removed.length}):`);
  for (const row of removed) out(`  ${row.path}\t${row.section}`);
  out('');
  out(`Unchanged: Publishing ${unchanged.publishing}, Excluded ${unchanged.excluded}, Needs Decision ${unchanged.needsDecision}`);
  return 0;
}

async function runApply(options, deps, survey) {
  const out = deps.out || console.log;
  const readFile = deps.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const writeFile = deps.writeFile || ((p, c) => fs.writeFileSync(p, c));
  const exists = deps.exists || ((p) => fs.existsSync(p));
  const mkdir = deps.mkdir || ((p) => fs.mkdirSync(p, { recursive: true }));
  const now = deps.now || (() => new Date());
  const { config, vaultPath, publishConfig, files } = survey;

  const manifestPath = path.join(vaultPath, '_meta', 'publish-manifest.md');
  const entries = exists(manifestPath)
    ? parseAnnotatedManifest(readFile(manifestPath))
    : new Map();

  const moves = [
    ...(options.publish || []).map((a) => Object.assign(splitReason(a), { section: 'publishing' })),
    ...(options.exclude || []).map((a) => Object.assign(splitReason(a), { section: 'excluded' })),
    ...(options.decide || []).map((a) => ({ rel: canonicalPath(String(a).trim()), annotation: null, section: 'needsDecision' })),
  ];

  // Validate before touching anything: a typo that half-applies leaves the GM with
  // a manifest they have to reconstruct to find out what happened.
  const onDisk = new Set(files);
  const missing = moves.filter((m) => !onDisk.has(m.rel));
  if (missing.length > 0) {
    for (const m of missing) out(`no such file in the vault: ${m.rel}`);
    out('Nothing was written. Run `gm-publish manifest diff` for the paths the vault actually has.');
    return 1;
  }

  const counted = { publishing: 0, excluded: 0, needsDecision: 0 };
  for (const move of moves) {
    entries.set(move.rel, { section: move.section, annotation: move.annotation });
    counted[move.section]++;
  }

  // Deliberately NOT `onDisk` (the scanned file list): that set omits anything under
  // excludeDirs, so adding a folder to excludeDirs would make prune read every entry
  // under it as gone and silently delete the manifest's history for it. Prune only
  // entries whose file is actually gone from the vault.
  let pruned = 0;
  if (options.prune) {
    for (const rel of [...entries.keys()]) {
      if (!exists(path.join(vaultPath, rel))) { entries.delete(rel); pruned++; }
    }
  }

  const text = renderManifest({
    entries,
    generated: now().toISOString(),
    vault: publishConfig.title || config.siteTitle || path.basename(vaultPath),
    mode: publishConfig.mode,
    totalFiles: files.length,
  });
  mkdir(path.dirname(manifestPath));
  writeFile(manifestPath, text);

  const sectionCounts = { publishing: 0, excluded: 0, needsDecision: 0 };
  for (const entry of entries.values()) sectionCounts[entry.section]++;

  if (options.json) {
    out(JSON.stringify({
      path: manifestPath,
      mode: publishConfig.mode,
      totalFiles: files.length,
      publishing: sectionCounts.publishing,
      excluded: sectionCounts.excluded,
      needsDecision: sectionCounts.needsDecision,
      moved: counted,
      pruned,
    }, null, 2));
    return 0;
  }
  out(`manifest updated: +${counted.publishing} publishing, +${counted.excluded} excluded, +${counted.needsDecision} needs decision, -${pruned} pruned`);
  out(`  ${manifestPath}`);
  return 0;
}

const PLAYED_STATUSES = new Set(['played', 'wrap-up', 'reviewed']);

// Why the site's own build would publish a ticked hub's body, or null (site-pin.js).
function staleSitePin(siteDir) {
  return sitePin(siteDir).stale;
}

// A session is reviewed once reconcile has run on it: reconcile promotes the Wrap-Up to
// AUTHORITATIVE and sets the index's status to `reviewed` (shared/reconcile.md step 6),
// and vault_check derives `reviewed` from the Wrap-Up alone. Either counts.
function isReviewed(hub, wrapUp) {
  if (String((hub.frontmatter || {}).status || '').toLowerCase() === 'reviewed') return true;
  return !!(wrapUp && wrapUp.frontmatter && getCanonStatus(wrapUp.frontmatter) === 'AUTHORITATIVE');
}

// The pages that would publish if `extra` were added to the manifest's Publishing
// section: the build's own verdicts (decidePage) under that hypothetical manifest.
function publishedWith(survey, extra) {
  const { manifest, publishConfig, pagesByRel } = survey;
  const hypothetical = Object.assign({}, manifest, {
    publishing: [...new Set(manifest.publishing.concat(extra))],
  });
  const published = [];
  for (const [rel, page] of pagesByRel) {
    const verdict = decidePage(page, { rel, publishConfig, manifest: hypothetical, pageIndex: pagesByRel });
    // A story companion folds into its PC's page; the build never holds it as a page.
    if (publishesPage(verdict) && verdict.code !== 'STORY_COMPANION') published.push(page);
  }
  return published;
}

// Hub -> Wrap-Up pairs on `published`, through the build's own alias-rewrite-then-pair
// step (session-hub.js pairHubs), so `explain` and publish-played pair on exactly the
// frontmatter the build does. The whole-vault note list is read once per survey.
function pairsWith(survey, published) {
  if (!survey.allNotes) survey.allNotes = scanAllNotes(survey.vaultPath);
  return pairHubs([...survey.pagesByRel.values()], published, { allNotes: survey.allNotes });
}

// What publish-played would do, without doing it: `ticks` maps each played hub it would
// tick to its paired Wrap-Up (both vault-relative), `wrapsOnly` lists reviewed Wrap-Ups
// it would tick without their hub (the site's pin predates body withholding), and
// `unclear` lists the played hubs it would not tick, each with the reason and the
// Wrap-Up it pairs with, if any. Shared with build.js's end-of-run summary so the build
// promises only what publish-played will actually do.
//
// `only` (`--session`) plans that one vault-relative session index and nothing else;
// `includeUnreviewed` waives the review check for it (session-wrapup's "Publish now?").
// Every other check holds: the hub is ticked only with a Wrap-Up that pairs with it and
// will publish, and never on a stale site pin.
function planPublishPlayed(survey, { only = null, includeUnreviewed = false } = {}) {
  const { vaultPath, publishConfig, manifest, files, pagesByRel } = survey;
  const readFile = survey.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const listed = parseAnnotatedManifest(readFile(path.join(vaultPath, '_meta', 'publish-manifest.md')));
  const sectionOf = (rel) => (listed.get(rel) || {}).section || null;
  const onDisk = new Set(files);
  const relOf = new Map([...pagesByRel].map(([rel, page]) => [page, rel]));

  const hubs = [...pagesByRel]
    .filter(([rel]) => only === null || rel === only)
    .filter(([rel, p]) => {
      const fm = p.frontmatter || {};
      return fm.type === 'session' && PLAYED_STATUSES.has(String(fm.status || '').toLowerCase())
        && onDisk.has(rel) && sectionOf(rel) !== 'excluded';
    })
    .map(([rel, page]) => ({ rel, page }));
  // Everything this call might tick: the played hubs, and every Wrap-Up the GM has not
  // Excluded. The pairing is then read off the pages that would publish with all of them.
  const wrapCandidates = [...pagesByRel]
    .filter(([rel, p]) => isWrapUp(p) && onDisk.has(rel) && sectionOf(rel) !== 'excluded')
    .map(([rel]) => rel);
  let pending = hubs.map((h) => h.rel).concat(wrapCandidates);
  const allPages = [...pagesByRel.values()];

  // Pair, then keep only the ticks the resulting manifest actually supports; dropping a
  // tick can unpair another hub (two hubs linking one Wrap-Up), so repeat until stable.
  // Each round drops at least one hub from `pending`, so this ends.
  let ticks;
  for (;;) {
    const pairs = pairsWith(survey, publishedWith(survey, pending));
    ticks = new Map();
    for (const { rel, page } of hubs.filter((h) => pending.includes(h.rel))) {
      const wrap = pairs.get(page);
      if (wrap) ticks.set(rel, relOf.get(wrap));
    }
    const next = [...ticks.keys()].concat([...ticks.values()]);
    const after = pairsWith(survey, publishedWith(survey, next));
    const unsupported = [...ticks.keys()].filter((rel) => !after.has(pagesByRel.get(rel)));
    if (unsupported.length === 0) break;
    pending = next.filter((rel) => !unsupported.includes(rel));
  }

  // Clear means reviewed: an unreviewed Wrap-Up is still a DRAFT the GM may not want
  // on the site (session-wrapup's "after reconcile"), so it waits for publish-site to
  // ask. And a site pinned below 1.11.40 (site-pin.js) would publish a ticked hub's
  // body, so no hub is ticked there; its reviewed Wrap-Up still can be.
  const unclear = [];
  const pinReason = survey.siteDir ? staleSitePin(survey.siteDir) : null;
  const wrapOnly = [];
  for (const [rel, wrapRel] of [...ticks]) {
    // Both already published (the GM said "publish now" at wrap-up): nothing to tick,
    // nothing to ask.
    if (sectionOf(rel) === 'publishing' && sectionOf(wrapRel) === 'publishing') continue;
    const reason = !includeUnreviewed && !isReviewed(pagesByRel.get(rel), pagesByRel.get(wrapRel))
      ? `Wrap-Up not reviewed yet (${wrapRel})`
      : pinReason;
    if (!reason) continue;
    ticks.delete(rel);
    if (reason === pinReason) wrapOnly.push(wrapRel);
    unclear.push({ path: rel, reason, wrapUp: wrapRel });
  }
  const stillTicked = new Set(ticks.values());
  const wrapsOnly = [...new Set(wrapOnly)].filter((w) => !stillTicked.has(w));

  const ifAllPublished = pairsWith(survey, allPages);
  for (const { rel, page } of hubs) {
    // A named session is always answered for, even one already under Publishing.
    if (ticks.has(rel) || (only === null && sectionOf(rel) === 'publishing')
      || unclear.some((u) => u.path === rel)) continue;
    // Why not: the Wrap-Up the hub would pair with if every Wrap-Up published.
    const wouldBe = ifAllPublished.get(page) || null;
    const wrapRel = wouldBe ? relOf.get(wouldBe) : null;
    const fm = page.frontmatter;
    const docs = fm.documents && typeof fm.documents === 'object' ? fm.documents : {};
    let reason;
    if (wrapRel && sectionOf(wrapRel) === 'excluded') {
      reason = `Wrap-Up is Excluded (${wrapRel})`;
    } else if (wrapRel) {
      // Its verdict as if ticked: the rule that would still stop it (publish: none, …).
      const verdict = decidePage(wouldBe, {
        rel: wrapRel, publishConfig, pageIndex: pagesByRel,
        manifest: Object.assign({}, manifest, { publishing: manifest.publishing.concat([wrapRel]) }),
      });
      reason = `Wrap-Up ${wrapRel} does not publish: ${verdict.reason}`;
    } else if (docs.wrap_up) {
      reason = `documents.wrap_up ${docs.wrap_up} names no Wrap-Up (a link matches a note's exact name, path or alias)`;
    } else {
      reason = `status ${fm.status} but no Wrap-Up linked to it`;
    }
    unclear.push({ path: rel, reason, wrapUp: wrapRel });
  }
  // The named path is not a played session index this call could tick: say which.
  if (only !== null && hubs.length === 0) {
    const fm = (pagesByRel.get(only) || {}).frontmatter || {};
    const reason = sectionOf(only) === 'excluded' ? 'the session index is Excluded'
      : `not a played session index (type ${fm.type || 'none'}, status ${fm.status || 'none'})`;
    unclear.push({ path: only, reason, wrapUp: null });
  }
  return { ticks, wrapsOnly, unclear, sectionOf };
}

// `manifest publish-played` (#277): a reviewed session index is ticked under Publishing
// only together with a Wrap-Up that will publish and that session-hub.js pairs with it —
// i.e. only when pairHubs pairs the hub on the pages as they will publish
// after this call, so the hub's body is withheld and its session page is built from
// frontmatter plus the Wrap-Up. There is no matcher here: pairing is session-hub.js's.
// Every other played session is "unclear" with a reason — no Wrap-Up linked, the Wrap-Up
// not reviewed yet, the linked one Excluded / `publish: none` / otherwise not publishing,
// or a site pinned to a tool that predates withholding — and is listed, never ticked, so
// the skill asks the GM. `--session <index>` narrows the run to that one session and
// `--include-unreviewed` (only with --session) lets it through before reconcile. Files under Excluded
// are a deliberate GM decision and are left alone. Only meaningful in player mode with a
// manifest, the one place the manifest is an allowlist; elsewhere a no-op.
async function runPublishPlayed(options, deps, survey) {
  const out = deps.out || console.log;
  const { publishConfig, manifest } = survey;

  const report = (payload, line) => out(options.json ? JSON.stringify(payload, null, 2) : line);
  if (!manifest || publishConfig.mode !== 'player') {
    report({ applicable: false, mode: publishConfig.mode, manifestExists: !!manifest, published: [] },
      'manifest publish-played: nothing to do (needs a manifest and player mode)');
    return 0;
  }

  let only = null;
  if (options.session != null) {
    only = canonicalPath(String(options.session).trim().replace(/^\.\//, ''));
    if (!survey.files.includes(only)) {
      out(`no such file in the vault: ${only}`);
      out('Nothing was written. --session takes the session index path relative to the vault.');
      return 1;
    }
  }
  const { ticks, wrapsOnly, unclear, sectionOf } = planPublishPlayed(
    Object.assign({ readFile: deps.readFile }, survey),
    { only, includeUnreviewed: !!options.includeUnreviewed });
  const wanted = [];
  for (const rel of [...ticks].flat().concat(wrapsOnly)) {
    if (!wanted.includes(rel) && sectionOf(rel) !== 'publishing') wanted.push(rel);
  }

  if (wanted.length > 0 && !options.dryRun) {
    const rc = await runApply(Object.assign({}, options, { publish: wanted, exclude: [], decide: [], json: false }),
      Object.assign({}, deps, { out: () => {} }), survey);
    if (rc !== 0) return rc;
  }
  const verb = options.dryRun ? 'would publish' : 'published';
  const lines = [wanted.length === 0
    ? 'manifest publish-played: no finished session needed publishing'
    : `manifest publish-played: ${verb} ${wanted.length} file(s)\n${wanted.map((w) => `  ${w}`).join('\n')}`];
  if (unclear.length > 0) {
    lines.push(`Unclear, not ticked (${unclear.length}):`, ...unclear.map((u) => `  ${u.path} — ${u.reason}`));
  }
  report({ applicable: true, dryRun: !!options.dryRun, published: wanted, unclear }, lines.join('\n'));
  return 0;
}

async function runManifest(options, deps) {
  const opts = options || {};
  const d = deps || {};
  const out = d.out || console.log;
  if (opts.verb === 'publish-played' && opts.includeUnreviewed && opts.session == null) {
    out('--include-unreviewed needs --session: it publishes one session the GM chose, never every draft');
    return 1;
  }
  const survey = surveyVault(opts, d);
  if (opts.verb === 'diff') return runDiff(opts, d, survey);
  if (opts.verb === 'apply') return runApply(opts, d, survey);
  if (opts.verb === 'publish-played') return runPublishPlayed(opts, d, survey);
  out(`Unknown manifest command: ${opts.verb}`);
  return 1;
}

// surveyVault is shared with explain-cli so both commands see one vault the same
// way: the same file list, the same verdicts, the same config resolution.
module.exports = { runManifest, surveyVault, planPublishPlayed, pairsWith, parseAnnotatedManifest, renderManifest, listVaultMarkdown, splitReason };
