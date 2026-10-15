'use strict';
// Dated: removed with settings/legacy.js at 1.11.0. Read only when the vault has no _meta/publish-list.yaml.
// The old Markdown publish list (_meta/publish-manifest.md): the reader the build used, and the annotated reader
// the conversion uses for reasons. Nothing here writes the old file.
const { parseNote } = require('./frontmatter');
const { canonicalNfc: canonicalPath } = require('./unicode');

// Manifest entries are vault-relative paths, optionally annotated with an inline
// `— comment` (the Excluded section uses these throughout). Keep only the path, so an
// annotated Publishing entry still matches a scanned file instead of silently
// blackholing the page.
//
// The path is anchored on its file extension rather than split on the first dash: vault
// filenames legitimately contain " — " ("Items/Six — Field Sundries.md"), and splitting on
// the dash would truncate them into the very blackhole this exists to prevent. The lazy
// prefix stops at the first extension that leaves only a comment (or nothing) behind, so
// both "Six — Field Sundries.md" and "Foo.md — see Bar.md" resolve correctly.
const ENTRY_RE = /^(.*?\.\w+)(?:\s+(?:—|–|--)\s+.*)?$/;

function stripInlineComment(entry) {
  const trimmed = String(entry).trim();
  const match = ENTRY_RE.exec(trimmed);
  return canonicalPath(match ? match[1] : trimmed);
}

function parseManifest(markdown) {
  const { data, content } = parseNote(markdown);
  const publishing = [];
  const needsDecision = [];
  const resolved = [];
  const excluded = [];

  const checkedPattern = /^- \[[xX]\]\s+(.+)$/;
  const uncheckedPattern = /^- \[ \]\s+(.+)$/;

  let currentSection = null;
  for (const line of content.replace(/\r/g, '').split('\n')) {
    const sectionMatch = line.match(/^## (.+)/);
    if (sectionMatch) {
      const title = sectionMatch[1].trim();
      if (title.startsWith('Publishing')) currentSection = 'publishing';
      else if (title.startsWith('Needs Decision')) currentSection = 'needs_decision';
      else if (title.startsWith('Excluded')) currentSection = 'excluded';
      else currentSection = null;
      continue;
    }

    if (currentSection === 'publishing') {
      const match = line.match(checkedPattern);
      if (match) publishing.push(stripInlineComment(match[1]));
    }

    if (currentSection === 'needs_decision') {
      const unchecked = line.match(uncheckedPattern);
      if (unchecked) needsDecision.push(stripInlineComment(unchecked[1]));
      const checked = line.match(checkedPattern);
      if (checked) resolved.push(stripInlineComment(checked[1]));
    }

    // Collect the Excluded file paths so the build can tell a *deliberately* excluded file
    // from one that is simply absent from the manifest — only the latter is a forgot-to-register
    // warning (#101). Two shapes appear: the documented `- [x] path — reason` checkbox lines
    // (same as Publishing, see publish-site/references/content-filtering.md) and a grouped
    // `- Reason: …` category with indented `  - path` bullets. Handle both; skip Reason bullets.
    if (currentSection === 'excluded') {
      const checkboxed = line.match(checkedPattern);
      if (checkboxed) {
        excluded.push(stripInlineComment(checkboxed[1]));
      } else {
        const bullet = line.match(/^\s+-\s+(.+)$/);
        if (bullet && !/^reason:/i.test(bullet[1].trim())) excluded.push(stripInlineComment(bullet[1]));
      }
    }
  }

  return {
    meta: data,
    publishing,
    needsDecision,
    resolved,
    excluded,
  };
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

module.exports = { parseManifest, parseAnnotatedManifest, stripInlineComment, ENTRY_RE };
