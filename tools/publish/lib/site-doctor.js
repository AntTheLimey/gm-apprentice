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
const { scanVaultReport, buildLinkMap, scanAttachments, scanAllNotes, pairStoryFiles, slugify } = require('./scanner');
const { resolveConfig, vaultRelPath, scanConfigFor } = require('./config');
const { formatFault, entry: settingEntry } = require('./settings');
const { pcKeepList } = require('./pc-prose');
const { loadManifest } = require('./manifest');
const { decidePage, publishesPage } = require('./publish-decision');
const {
  parseWikiRef, portraitBasename, playerSafeMarkdown, publishMode, keepOnlySections, publishedFrontmatter, pcHeadingsUnstable,
} = require('./processor');
const { CODES: NOTE_FAULT_CODES, PAGES_SHOWN } = require('./note-faults');
const { getsNoPage } = require('./previews');
const { pairHubs } = require('./session-hub');
const { canonicalNfc } = require('./unicode');
const { wikilinkRe } = require('./wikilink');
const { pinnedVersionOf } = require('./update-pin');

const UNTYPED_ROW_CAP = 20;
const LINK_ROW_CAP = 30;
// The note-fault codes list this many rows in the human report; --json has them all.
const FAULT_ROW_CAP = 20;
const FAULT_CODES = new Set(NOTE_FAULT_CODES);
const NEAREST_LIMIT = 3;
const REGISTRABLE_TYPES = new Set(['session', 'session_wrap', 'chapter']);
// The order codes appear in the human report: the ones that stop the audit first,
// then roughly in the order a GM would act on them.
const CODE_ORDER = [
  'SETTINGS_FAULT', 'CONFIG_INVALID', 'VAULT_MISSING', 'NOTE_FAULTS_UNCHECKED', 'VERSION_DRIFT', 'FONTS_GOOGLE', 'FOLDER_UNMAPPED', 'FILE_UNTYPED', 'FILE_UNPARSEABLE',
  'FRONTMATTER_MISTYPED',
  'PORTRAIT_MISSING', 'LINK_UNRESOLVED', 'MANIFEST_ORPHAN', 'MANIFEST_UNREGISTERED', 'RECAP_INCOMPLETE',
  ...NOTE_FAULT_CODES,
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
  // A note a manifest reason marks "stays hidden:" is settled: whole in --json, left out of
  // the report and the counts.
  const open = findings.filter((f) => !f.settled);
  const errors = open.filter((f) => f.severity === 'error').length;
  const warnings = open.length - errors;
  if (asJson) {
    out(JSON.stringify({
      ok: errors === 0,
      findings,
      counts: { errors, warnings, total: open.length, settled: findings.length - open.length },
    }, null, 2));
    return errors === 0 ? 0 : 1;
  }

  out(`Site audit (${vaultLabel}) — ${plural(errors, 'error')}, ${plural(warnings, 'warning')}`);
  if (open.length === 0) {
    out('No findings.');
    return 0;
  }
  const codes = [...new Set(open.map((f) => f.code))]
    .sort((a, b) => CODE_ORDER.indexOf(a) - CODE_ORDER.indexOf(b));
  for (const code of codes) {
    const rows = open.filter((f) => f.code === code);
    // One code can hold errors and warnings (NAMED_NO_PAGE: an error when its note is withheld).
    const severities = ['error', 'warning'].filter((sev) => rows.some((r) => (r.severity === 'error') === (sev === 'error')));
    out('');
    out(`${code} (${severities.map((sev) => plural(rows.filter((r) => (r.severity === 'error') === (sev === 'error')).length, sev)).join(', ')})`);
    const shown = FAULT_CODES.has(code) ? rows.slice(0, FAULT_ROW_CAP) : rows;
    for (const row of shown) {
      out(`  ${row.path} — ${row.detail}`);
      // The pages that link a note with no page: the first few by name; the JSON has them all.
      if (code === 'NAMED_NO_PAGE' && Array.isArray(row.pages) && row.pages.length > 0) {
        const first = row.pages.slice(0, PAGES_SHOWN);
        const more = row.pages.length - first.length;
        out(`      named on: ${first.join(', ')}${more > 0 ? ` (+${more} more; --json lists them all)` : ''}`);
      }
      out(`      → ${row.fix}`);
    }
    if (shown.length < rows.length) out(`  +${rows.length - shown.length} more — run with --json for the whole list`);
  }
  return errors === 0 ? 0 : 1;
}

// A note's body and frontmatter after the build's own cuts, in the build's order (a session
// index whose Wrap-Up is published has no body, a stub keeps only the sections it names),
// then the strip chain, and the frontmatter as published. The dead-link check reads the body;
// `explain --shown` prints both for a note the build can make no page of.
function readerView(page, publishConfig, { bodyWithheld = false, rel = '', pcKeepSections = pcKeepList(publishConfig) } = {}) {
  let source = bodyWithheld ? '' : (page.markdown || '');
  if (publishMode(page.frontmatter) === 'stub') {
    const include = Array.isArray(page.frontmatter.publish_include_sections) ? page.frontmatter.publish_include_sections : [];
    source = keepOnlySections(source, include, {
      excludeSections: publishConfig.exclude_sections, excludeCallouts: publishConfig.exclude_callouts,
      frontmatter: page.frontmatter, warn: () => {},
    });
  }
  const safe = playerSafeMarkdown(source, {
    excludeCallouts: publishConfig.exclude_callouts,
    excludeSections: publishConfig.exclude_sections,
    pcKeepSections,
    frontmatter: page.frontmatter,
  });
  const fieldOverrides = (publishConfig.overrides && publishConfig.overrides.fields) || {};
  return { source, safe, frontmatter: publishedFrontmatter(page.frontmatter, publishConfig.exclude_fields, fieldOverrides[rel] || {}) };
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
  if (!config.vaultPath && !opts.vaultPath) {
    return emit(out, [finding(
      'CONFIG_INVALID', 'error', configPath,
      'has no "vaultPath"',
      'edit vault.config.json to add "vaultPath": "<path to your vault>"',
    )], configPath, asJson);
  }

  // --vault: audit this vault through the site's rules, as `explain --all --vault` does, so
  // a caller that starts from a vault is never answered about another one.
  const vaultPath = opts.vaultPath ? path.resolve(opts.vaultPath) : path.resolve(siteRoot, config.vaultPath);
  if (!exists(vaultPath)) {
    return emit(out, [finding(
      'VAULT_MISSING', 'error', vaultPath,
      'no such directory',
      `vaultPath points at ${vaultPath}, which does not exist — correct it in ${configPath}`,
    )], vaultPath, asJson);
  }

  const rawSiteConfig = config;
  // The faults are reported as findings below, not also printed as warning lines.
  const resolved = resolveConfig(config, vaultPath, () => {});
  config = resolved.config;
  const publishConfig = resolved.publishConfig;
  const manifest = loadManifest(vaultPath);
  // scanConfigFor: same unioned, normalized exclude_dirs the build applies, so `doctor
  // --site` predicts exactly what the build does (#209 follow-up).
  const scanConfig = scanConfigFor(Object.assign({}, config, { vaultPath }), publishConfig);
  const report = scanVaultReport(scanConfig);
  const attachments = scanAttachments(scanConfig);

  const pages = report.pages;
  const relOf = (page) => vaultRelPath(vaultPath, page.sourcePath);
  // Snapshot before pairing, exactly as build.js does: pairStoryFiles removes a PC's
  // `_Story.md` companion from the page list, and a manifest entry naming one is not
  // an orphan — the build folds its content into the PC page.
  const corpus = pages.slice();
  pairStoryFiles(pages, vaultPath);
  const verdicts = new Map(pages.map((page) => [page, decidePage(page, { rel: relOf(page), publishConfig, manifest })]));
  // A note the build writes no page for (a world-flags file) is not in its link map either.
  const published = pages.filter((page) => publishesPage(verdicts.get(page)) && !getsNoPage(page));
  const linkMap = buildLinkMap(published);
  const linkNames = Object.keys(linkMap);
  // Which session index bodies the site withholds, paired as the build pairs (GM
  // aliases rewritten first; session-hub.js pairHubs).
  const allNotes = scanAllNotes(vaultPath);
  const hubPairs = pairHubs(corpus, published, { vaultPath, allNotes });

  // The body a reader gets of a page (readerView), for the dead-link check.
  const pcKeepSections = pcKeepList(publishConfig);
  const bodyOf = (page) => {
    const { safe } = readerView(page, publishConfig, { bodyWithheld: hubPairs.has(page), rel: relOf(page), pcKeepSections });
    const unstable = pcKeepSections && pcHeadingsUnstable(page, linkMap, publishConfig.exclude_sections, attachments,
      { excludeCallouts: publishConfig.exclude_callouts, pcKeepSections });
    return unstable ? '' : safe.text;
  };

  const findings = [];

  // --- the settings themselves ----------------------------------------------
  for (const f of publishConfig.faults) {
    findings.push(finding(
      'SETTINGS_FAULT', f.level === 'stop' ? 'error' : 'warning', '_meta/vault-config.md',
      formatFault(f),
      'correct it in _meta/vault-config.md, or ask the apprentice to run the Settings check',
    ));
  }
  const settingsStopped = publishConfig.faults.some((f) => f.level === 'stop');

  // --- the tool the site is pinned to -------------------------------------
  let drift = null;
  try {
    drift = detect();
  } catch (err) {
    findings.push(finding(
      'VERSION_DRIFT', 'warning', 'gm-apprentice-publish',
      `could not check the installed tool version: ${err.message}`,
      'this is usually harmless outside a plugin cache checkout; run `gm-publish update-pin` by hand if the site turns out stale',
    ));
  }
  if (drift) {
    let sitePin = null;
    const pkgPath = path.join(siteRoot, 'package.json');
    // Absent is fine — plenty of sites have no package.json yet, and the running
    // tool's own drift is still worth reporting. Present-but-unparseable is not:
    // that means the sitePin below is unknown for a reason worth naming, not "none".
    if (exists(pkgPath)) {
      try {
        const spec = (JSON.parse(readFile(pkgPath)).dependencies || {})['gm-apprentice-publish'];
        if (spec && String(spec).startsWith('file:')) sitePin = pinnedVersionOf(String(spec).slice('file:'.length));
      } catch (err) {
        findings.push(finding(
          'VERSION_DRIFT', 'warning', pkgPath,
          `could not be read as JSON: ${err.message} — cannot confirm the site's pinned version`,
          'fix the JSON in package.json',
        ));
      }
    }
    const stale = sitePin && sitePin !== drift.latest;
    if (drift.drift || stale) {
      findings.push(finding(
        'VERSION_DRIFT', 'warning', pkgPath,
        `site pinned to ${sitePin || drift.pinned}, newest installed is ${drift.latest} — the site builds with the old renderer`,
        'run `gm-publish update-pin`',
      ));
    }
  }

  // --- fonts fetched from Google at page load (#270) ------------------------
  const fontsCfg = publishConfig.theme.fonts || {};
  if (fontsCfg.source !== 'local' && fontsCfg.source !== 'self-host') {
    const { googleFontNames } = require('./theme');
    const { presetFamiliesFor } = require('./fonts');
    const names = [...googleFontNames(fontsCfg), ...presetFamiliesFor(publishConfig.theme)]
      .filter((v, i, a) => a.indexOf(v) === i);
    if (names.length > 0) {
      findings.push(finding(
        'FONTS_GOOGLE', 'warning', '_meta/vault-config.md',
        `custom fonts ${names.join(', ')} are loaded from Google Fonts at page load — visitors' IP addresses are sent to Google, and some jurisdictions (e.g. the EU under GDPR) require consent for that`,
        'set publish.theme.fonts.source: self-host to serve them from your site instead, or use a system font',
      ));
    }
  }

  // --- files and folders the scan could not turn into pages ---------------
  for (const entry of report.unmapped) {
    findings.push(finding(
      'FOLDER_UNMAPPED', 'warning', entry.dir,
      `${plural(entry.typedFileCount, 'typed page')} inside will not publish`,
      `add "${entry.dir}": "${suggestedSlug(entry.dir)}" to publish.folder_map or list it in publish.exclude_dirs (_meta/vault-config.md)`,
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
  // A value of the wrong type, which the build read as best it could or left unread.
  const mistyped = report.mistyped || [];
  for (const { rel, field, problem } of mistyped.slice(0, UNTYPED_ROW_CAP)) {
    findings.push(finding(
      'FRONTMATTER_MISTYPED', 'warning', rel,
      `${field}: ${problem}`,
      `write ${field}: as the kind of value it takes (one value, or a list of plain values)`,
    ));
  }
  if (mistyped.length > UNTYPED_ROW_CAP) {
    findings.push(finding(
      'FRONTMATTER_MISTYPED', 'warning', `+${mistyped.length - UNTYPED_ROW_CAP} more`,
      'also hold a frontmatter value of the wrong type',
      'the build names each note and field',
    ));
  }
  for (const { rel, message } of report.malformed) {
    findings.push(finding(
      'FILE_UNPARSEABLE', 'warning', rel,
      `frontmatter could not be parsed: ${message}`,
      'fix the YAML in the frontmatter block',
    ));
  }

  // --- faults in the notes themselves ---------------------------------------
  // Found first: a link to a note that exists but has no page is NAMED_NO_PAGE's, so the
  // dead-link check below leaves it out rather than say it twice.
  // They are the build's: it is run here in memory (every page rendered, nothing written),
  // so this list is the one the build prints its summary of.
  // A build that cannot run is an error, never a clean list.
  let noteFaults = Object.assign([], { namedTargets: new Set() });
  // A build stops on a hiding-side settings fault, so the in-memory one is not attempted: the
  // finding above says why, and the audit stops there rather than add a second error for it.
  if (settingsStopped) return emit(out, findings, vaultPath, asJson);
  try {
    const built = require('./build').build({ configPath, vaultPath, rawConfig: rawSiteConfig, inMemory: true });
    noteFaults = built.noteFaults;
    // A page that failed to render was not read, so the list is not the whole of it. The
    // findings that were made stand; the error says the list is short and why.
    const unread = built.renderErrors.length + built.auditGaps;
    if (unread > 0) {
      const first = built.renderErrors[0];
      findings.push(finding(
        'NOTE_FAULTS_UNCHECKED', 'error', vaultPath,
        `${plural(unread, 'page')} could not be rendered in memory${first ? ` (${first.split('\n')[0]})` : ''}, so the faults in the notes were not all looked for: the list is incomplete`,
        'run `gm-publish build` and fix the page it reports, then run the audit again',
      ));
    }
  } catch (err) {
    findings.push(finding(
      'NOTE_FAULTS_UNCHECKED', 'error', vaultPath,
      `the site could not be built in memory, so the faults in its notes were not looked for: ${String(err.message).split('\n')[0]}`,
      'run `gm-publish build` and fix what it reports, then run the audit again',
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
        `portrait: ${portrait} is not in ${config.attachmentsDir || settingEntry('vault.attachments').default}/`,
        `put ${portrait} in _attachments/ or fix the portrait: value`,
      ));
    }

    // Only the body a reader will actually get: a dead link inside a GM Notes
    // section is not on the site and is not the GM's problem today. Nor is anything
    // in a session index's body once the site withholds it (#276).
    const body = bodyOf(page);
    const seen = new Set();
    for (const match of body.matchAll(wikilinkRe('g', true))) {
      const { target } = parseWikiRef(match[1]);
      const key = canonicalNfc(target);
      if (!target || seen.has(key) || key in linkMap || noteFaults.namedTargets.has(key)) continue;
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

  findings.push(...noteFaults);

  return emit(out, findings, vaultPath, asJson);
}

module.exports = { runSiteDoctor, readerView, nearestNames, diceCoefficient, suggestedSlug };
