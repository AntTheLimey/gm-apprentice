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
const { scanVaultReport } = require('./scanner');
const { loadPublishConfig, vaultRelPath } = require('./config');
const { loadManifest, canonicalPath } = require('./manifest');
const { decidePage } = require('./publish-decision');

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
        if (excluded.some((ex) => rel === ex || rel.startsWith(ex + '/'))) continue;
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
  const config = deps.config || require(configPath);
  const vaultPath = deps.config ? config.vaultPath : path.resolve(configDir, config.vaultPath);
  const publishConfig = deps.publishConfig || loadPublishConfig(vaultPath, config);
  const manifest = loadManifest(vaultPath);

  const report = scanVaultReport(Object.assign({}, config, { vaultPath }));
  const pagesByRel = new Map(report.pages.map((p) => [vaultRelPath(vaultPath, p.sourcePath), p]));
  const untyped = new Set(report.untyped.map(canonicalPath));
  const unmappedDirs = new Set(report.unmapped.map((u) => canonicalPath(u.dir)));

  const files = listVaultMarkdown(vaultPath, config.excludeDirs);
  const verdicts = new Map();
  for (const rel of files) {
    const page = pagesByRel.get(rel);
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    verdicts.set(rel, decidePage(page || { rel, frontmatter: null }, {
      rel,
      publishConfig,
      manifest,
      pageIndex: pagesByRel,
      folderMapped: page ? true : !(unmappedDirs.has(dir) && !untyped.has(rel)),
    }));
  }

  return { config, configPath, vaultPath, publishConfig, manifest, files, verdicts, pagesByRel, report };
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

  let pruned = 0;
  if (options.prune) {
    for (const rel of [...entries.keys()]) {
      if (!onDisk.has(rel)) { entries.delete(rel); pruned++; }
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

async function runManifest(options, deps) {
  const opts = options || {};
  const d = deps || {};
  const out = d.out || console.log;
  const survey = surveyVault(opts, d);
  if (opts.verb === 'diff') return runDiff(opts, d, survey);
  if (opts.verb === 'apply') return runApply(opts, d, survey);
  out(`Unknown manifest command: ${opts.verb}`);
  return 1;
}

// surveyVault is shared with explain-cli so both commands see one vault the same
// way: the same file list, the same verdicts, the same config resolution.
module.exports = { runManifest, surveyVault, parseAnnotatedManifest, renderManifest, listVaultMarkdown, splitReason };
