'use strict';

// `doctor --site`: audit one vault the way the build sees it.
//
// The plain `doctor` checks the machine — Node, git, wrangler, credentials. This
// checks the campaign: the notes that will silently not publish, the portrait that
// points at a file nobody added, the wikilink whose target is spelled one letter
// off. Every one of those fails quietly today: the site builds, and something the
// GM wrote is simply not on it.
//
// Every finding carries a `fix` that names the edit to make, because "LINK_UNRESOLVED
// in Miskatonic_Library.md" is only half an answer.
const fs = require('fs');
const path = require('path');
const { scanVaultReport, buildLinkMap, scanAttachments, pairStoryFiles, slugify } = require('./scanner');
const { loadPublishConfig, vaultRelPath } = require('./config');
const { loadManifest } = require('./manifest');
const { decidePage, publishesPage } = require('./publish-decision');
const { parseWikiRef, portraitBasename, playerSafeMarkdown } = require('./processor');
const { canonicalNfc } = require('./unicode');
const { pinnedVersionOf } = require('./update-pin');

const UNTYPED_ROW_CAP = 20;
const LINK_ROW_CAP = 30;
const NEAREST_LIMIT = 3;
const REGISTRABLE_TYPES = new Set(['session', 'session_wrap', 'chapter']);
// The order codes appear in the human report: the ones that stop the audit first,
// then roughly in the order a GM would act on them.
const CODE_ORDER = [
  'CONFIG_INVALID', 'VAULT_MISSING', 'VERSION_DRIFT', 'FOLDER_UNMAPPED', 'FILE_UNTYPED',
  'PORTRAIT_MISSING', 'LINK_UNRESOLVED', 'MANIFEST_ORPHAN', 'MANIFEST_UNREGISTERED', 'RECAP_INCOMPLETE',
];

// Sørensen–Dice over character bigrams: enough to tell "Dr_Armitag" from
// "Dr_Armitage" without pulling in a dependency for one suggestion list.
function bigrams(value) {
  const s = String(value).toLowerCase();
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

function diceCoefficient(a, b) {
  if (a === b) return 1;
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.length === 0 || right.length === 0) return 0;
  const pool = new Map();
  for (const g of left) pool.set(g, (pool.get(g) || 0) + 1);
  let hits = 0;
  for (const g of right) {
    const count = pool.get(g) || 0;
    if (count > 0) { hits++; pool.set(g, count - 1); }
  }
  return (2 * hits) / (left.length + right.length);
}

// The closest few candidates, best first. Anything below the floor is noise — a
// suggestion that is not actually similar is worse than no suggestion.
function nearestNames(target, candidates, limit = NEAREST_LIMIT, floor = 0.4) {
  return candidates
    .map((name) => ({ name, score: diceCoefficient(target, name) }))
    .filter((row) => row.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.name);
}

// The folderMap value a GM would most likely want for an unmapped directory.
function suggestedSlug(dir) {
  return dir.split('/').map(slugify).join('/');
}

function finding(code, severity, pathText, detail, fix) {
  return { code, severity, path: pathText, detail, fix };
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function emit(out, findings, vaultLabel, asJson) {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;
  if (asJson) {
    out(JSON.stringify({
      ok: errors === 0,
      findings,
      counts: { errors, warnings, total: findings.length },
    }, null, 2));
    return errors === 0 ? 0 : 1;
  }

  out(`Site audit (${vaultLabel}) — ${plural(errors, 'error')}, ${plural(warnings, 'warning')}`);
  if (findings.length === 0) {
    out('No findings.');
    return 0;
  }
  const codes = [...new Set(findings.map((f) => f.code))]
    .sort((a, b) => CODE_ORDER.indexOf(a) - CODE_ORDER.indexOf(b));
  for (const code of codes) {
    const rows = findings.filter((f) => f.code === code);
    const severity = rows[0].severity;
    out('');
    out(`${code} (${plural(rows.length, severity)})`);
    for (const row of rows) {
      out(`  ${row.path} — ${row.detail}`);
      out(`      → ${row.fix}`);
    }
  }
  return errors === 0 ? 0 : 1;
}

async function runSiteDoctor(options, deps) {
  const opts = options || {};
  const d = deps || {};
  const out = d.out || console.log;
  const readFile = d.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const exists = d.exists || ((p) => fs.existsSync(p));
  const detect = d.detect || require('./version-check').detectVersionDrift;
  const asJson = !!opts.json;

  const configPath = path.resolve(opts.configPath || './vault.config.json');
  const siteRoot = path.dirname(configPath);

  let config;
  try {
    config = d.config || JSON.parse(readFile(configPath));
  } catch (err) {
    return emit(out, [finding(
      'CONFIG_INVALID', 'error', configPath,
      `could not be read as JSON: ${err.message}`,
      `edit vault.config.json so it is valid JSON with a "vaultPath" pointing at your vault`,
    )], configPath, asJson);
  }
  if (!config.vaultPath) {
    return emit(out, [finding(
      'CONFIG_INVALID', 'error', configPath,
      'has no "vaultPath"',
      'edit vault.config.json to add "vaultPath": "<path to your vault>"',
    )], configPath, asJson);
  }

  const vaultPath = path.resolve(siteRoot, config.vaultPath);
  if (!exists(vaultPath)) {
    return emit(out, [finding(
      'VAULT_MISSING', 'error', vaultPath,
      'no such directory',
      `vaultPath points at ${vaultPath}, which does not exist — correct it in ${configPath}`,
    )], vaultPath, asJson);
  }

  const publishConfig = loadPublishConfig(vaultPath, config);
  const manifest = loadManifest(vaultPath);
  const scanConfig = Object.assign({}, config, { vaultPath });
  const report = scanVaultReport(scanConfig);
  const attachments = scanAttachments(scanConfig);

  const pages = report.pages;
  const relOf = (page) => vaultRelPath(vaultPath, page.sourcePath);
  // Snapshot before pairing, exactly as build.js does: pairStoryFiles removes a PC's
  // `_Story.md` companion from the page list, and a manifest entry naming one is not
  // an orphan — the build folds its content into the PC page.
  const corpus = pages.slice();
  pairStoryFiles(pages, vaultPath);
  const published = pages.filter((page) => publishesPage(
    decidePage(page, { rel: relOf(page), publishConfig, manifest })));
  const linkMap = buildLinkMap(published);
  const linkNames = Object.keys(linkMap);

  const findings = [];

  // --- the tool the site is pinned to -------------------------------------
  const drift = (() => { try { return detect(); } catch { return null; } })();
  if (drift) {
    let sitePin = null;
    try {
      const spec = (JSON.parse(readFile(path.join(siteRoot, 'package.json'))).dependencies || {})['gm-apprentice-publish'];
      if (spec && String(spec).startsWith('file:')) sitePin = pinnedVersionOf(String(spec).slice('file:'.length));
    } catch {
      // No site package.json: the running tool's own drift is still worth saying.
    }
    const stale = sitePin && sitePin !== drift.latest;
    if (drift.drift || stale) {
      findings.push(finding(
        'VERSION_DRIFT', 'warning', path.join(siteRoot, 'package.json'),
        `site pinned to ${sitePin || drift.pinned}, newest installed is ${drift.latest} — the site builds with the old renderer`,
        'run `gm-publish update-pin`',
      ));
    }
  }

  // --- files and folders the scan could not turn into pages ---------------
  for (const entry of report.unmapped) {
    findings.push(finding(
      'FOLDER_UNMAPPED', 'warning', entry.dir,
      `${plural(entry.typedFileCount, 'typed page')} inside will not publish`,
      `add "${entry.dir}": "${suggestedSlug(entry.dir)}" to folderMap or list it in excludeDirs`,
    ));
  }
  const shownUntyped = report.untyped.slice(0, UNTYPED_ROW_CAP);
  for (const rel of shownUntyped) {
    findings.push(finding(
      'FILE_UNTYPED', 'warning', rel,
      'no `type:` in frontmatter, so it never publishes',
      'add `type:` to the frontmatter',
    ));
  }
  if (report.untyped.length > shownUntyped.length) {
    findings.push(finding(
      'FILE_UNTYPED', 'warning', `+${report.untyped.length - shownUntyped.length} more`,
      'also carry no `type:`',
      'add `type:` to the frontmatter',
    ));
  }

  // --- what the published pages point at ----------------------------------
  const linkRows = [];
  for (const page of published) {
    const rel = relOf(page);

    const portrait = portraitBasename(page.frontmatter);
    if (portrait && !(portrait in attachments)) {
      findings.push(finding(
        'PORTRAIT_MISSING', 'warning', rel,
        `portrait: ${portrait} is not in ${config.attachmentsDir || '_attachments'}/`,
        `put ${portrait} in _attachments/ or fix the portrait: value`,
      ));
    }

    // Only the body a reader will actually get: a dead link inside a GM Notes
    // section is not on the site and is not the GM's problem today.
    const body = playerSafeMarkdown(page.markdown || '', {
      excludeCallouts: publishConfig.exclude_callouts,
      excludeSections: publishConfig.exclude_sections,
    }).text;
    const seen = new Set();
    for (const match of body.matchAll(/!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
      const { target } = parseWikiRef(match[1]);
      const key = canonicalNfc(target);
      if (!target || seen.has(key) || key in linkMap) continue;
      seen.add(key);
      const near = nearestNames(target, linkNames);
      linkRows.push(finding(
        'LINK_UNRESOLVED', 'warning', rel,
        `[[${target}]] matches no published page, so it renders as plain text`,
        near.length
          ? `rename the link to one of: ${near.join(', ')} — or add an alias to the page it means`
          : 'create the page, or add an alias to the page it means',
      ));
    }
  }
  findings.push(...linkRows.slice(0, LINK_ROW_CAP));
  if (linkRows.length > LINK_ROW_CAP) {
    findings.push(finding(
      'LINK_UNRESOLVED', 'warning', `+${linkRows.length - LINK_ROW_CAP} more`,
      'further wikilinks match no published page',
      'run the audit again after fixing these',
    ));
  }

  // --- the manifest against the vault -------------------------------------
  if (manifest) {
    const scanned = new Set(corpus.map(relOf));
    for (const entry of manifest.publishing) {
      if (!scanned.has(entry)) {
        findings.push(finding(
          'MANIFEST_ORPHAN', 'warning', entry,
          'is listed under Publishing but no such page was scanned',
          'remove the entry or fix the path',
        ));
      }
    }
    if (publishConfig.mode === 'player') {
      const registered = new Set([...manifest.publishing, ...(manifest.excluded || []), ...(manifest.needsDecision || [])]);
      for (const page of corpus) {
        const type = page.frontmatter && page.frontmatter.type;
        if (!REGISTRABLE_TYPES.has(type)) continue;
        const rel = relOf(page);
        if (registered.has(rel)) continue;
        findings.push(finding(
          'MANIFEST_UNREGISTERED', 'warning', rel,
          `is a ${type} in no manifest section, so it will not publish`,
          'run `gm-publish manifest diff`',
        ));
      }
    }
  }

  // --- the recap chain a player follows -----------------------------------
  if (publishConfig.mode === 'player') {
    const typeOf = (page) => page.frontmatter && page.frontmatter.type;
    const wraps = published.filter((p) => typeOf(p) === 'session_wrap');
    const playedSessions = published.filter((p) => typeOf(p) === 'session'
      && ['played', 'reviewed'].includes(String((p.frontmatter && p.frontmatter.status) || '').toLowerCase()));
    const chapters = published.filter((p) => typeOf(p) === 'chapter');
    if (wraps.length > 0 && (playedSessions.length === 0 || chapters.length === 0)) {
      const missing = [
        playedSessions.length === 0 ? 'no published session with status played/reviewed' : null,
        chapters.length === 0 ? 'no published chapter page' : null,
      ].filter(Boolean).join(' and ');
      for (const wrap of wraps) {
        findings.push(finding(
          'RECAP_INCOMPLETE', 'warning', relOf(wrap),
          `is published but there is ${missing} — readers land on a recap with nothing around it`,
          'publish the session index and chapter page',
        ));
      }
    }
  }

  return emit(out, findings, vaultPath, asJson);
}

module.exports = { runSiteDoctor, nearestNames, diceCoefficient, suggestedSlug };
