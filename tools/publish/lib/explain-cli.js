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
const { mapFolder } = require('./scanner');
const { decidePage, publishesPage, autoExcludeCode, ALWAYS_EXCLUDE_DIRS } = require('./publish-decision');
const { surveyVault } = require('./manifest-cli');
const { canonicalPath } = require('./manifest');
const { extractSections, publishMode } = require('./processor');
const { getCanonStatus } = require('./templates/base');
const { nearestNames } = require('./site-doctor');

const MANIFEST_LABEL = { publishing: 'Publishing', excluded: 'Excluded', needsDecision: 'Needs Decision' };

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

function outputRoot(config) {
  const raw = String(config.outputDir || './docs').replace(/^\.\//, '').replace(/\/+$/, '');
  return raw || 'docs';
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
  const configExcluded = (config.excludeDirs || []).find((ex) => dir === ex || dir.startsWith(ex + '/'));
  const alwaysExcluded = dir.split('/').some((segment) => ALWAYS_EXCLUDE_DIRS.includes(segment));

  const verdict = verdicts.get(target)
    || (configExcluded && !alwaysExcluded
      ? { bucket: 'exclude', code: 'DIR_ALWAYS_EXCLUDED', reason: `in ${configExcluded}/ — listed in excludeDirs`, outputPath: null }
      : decidePage(page || { rel: target, frontmatter: null }, {
        rel: target,
        publishConfig,
        manifest,
        folderMapped: page ? true : !(unmappedDirs.has(dir) && !untyped.has(target)),
      }));

  const frontmatter = (page && page.frontmatter) || null;
  const markdown = page ? String(page.markdown || '') : (() => {
    try { return require('gray-matter')(readFile(path.join(vaultPath, target))).content; } catch { return ''; }
  })();

  const excludeSections = publishConfig.exclude_sections || [];
  const present = extractSections(markdown).map((s) => s.title);
  const stripped = excludeSections.filter((title) => present.includes(title));
  const gmOnlyBlocks = (markdown.match(/<!--\s*gm-only\s*-->/g) || []).length;

  const publishes = publishesPage(verdict);
  const outputPath = publishes && verdict.outputPath ? `${outputRoot(config)}/${verdict.outputPath}` : null;
  const auto = frontmatter ? autoExcludeCode(frontmatter) : null;
  const canonStatus = frontmatter ? getCanonStatus(frontmatter) : null;
  const section = manifestSectionOf(manifest, target);

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
      manifestSection: manifest ? (section ? MANIFEST_LABEL[section] : 'not listed') : null,
      verdict,
      publishes,
      outputPath,
      strippedSections: stripped,
      gmOnlyBlocks,
    }, null, 2));
    return 0;
  }

  out(target);
  out('');
  out('  exists: yes');
  out(`  directory: ${dir || '(vault root)'} — ${
    configExcluded ? `listed in excludeDirs (${configExcluded})`
      : mappedTo ? `mapped to ${mappedTo}`
        : dir ? 'not in folderMap' : 'the vault root'}`);
  out(`  type: ${(frontmatter && frontmatter.type) || '(none)'}`);
  out(`  publish mode: ${frontmatter ? publishMode(frontmatter) : '(no frontmatter)'}`);
  out(`  auto-exclude: ${auto ? autoExcludeLabel(frontmatter, auto) : 'none'}`);
  out(`  canon status: ${canonStatus || 'none'} (exclude_drafts ${publishConfig.exclude_drafts ? 'on' : 'off'})`);
  out(`  manifest: ${manifest ? (section ? MANIFEST_LABEL[section] : 'not listed') : 'no manifest'}`);
  out(publishes
    ? `  VERDICT: publishes at ${outputPath}`
    : `  VERDICT: does not publish — ${verdict.reason} (${verdict.code})`);
  out('');
  out(`  sections stripped on publish: ${stripped.length ? stripped.join(', ') : 'none'}`);
  out(`  gm-only blocks: ${gmOnlyBlocks}`);
  return 0;
}

// The `field: value` that autoExcludeCode matched on, for the report line.
function autoExcludeLabel(frontmatter, code) {
  const field = { AUTO_EXCLUDED_STATUS: 'status', AUTO_EXCLUDED_STAGE: 'stage', AUTO_EXCLUDED_SOURCE: 'source' }[code];
  return `${field}: ${String(frontmatter[field]).toLowerCase()}`;
}

module.exports = { runExplain };
