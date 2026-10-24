'use strict';
// Dated: removed with settings/legacy.js at 1.11.0, and not before no vault can still be held on the old file:
// the update's publish-list step holds a vault there while its site's tool is older than 1.27.0 or a build step
// reads the old file, and stamps it all the same. Removing this while that hold exists leaves a held vault with
// no list read, so an un-pinned build publishes everything: first make the hold a stop (the vault is not up to
// date until its list has moved), then remove this file.
// Used only when the vault has no _meta/publish-list.yaml.
// The old Markdown publish list (_meta/publish-manifest.md): the reader the build used, the annotated reader, and
// the writer every command but the update and `manifest convert` uses while a vault is on it (main's renderManifest,
// unchanged), so a vault stays on the file it is on until it is moved on purpose.
const { parseNote } = require('./frontmatter');
const { canonicalNfc: canonicalPath } = require('./unicode');
const { OLD_LIST_FILE } = require('./settings/layout');
const { uncommentedLines } = require('./processor');

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
  let note;
  try {
    note = parseNote(markdown);
  } catch (e) {
    // One line that names the file, so the vault check can say which note it is (#333).
    throw new Error(`${OLD_LIST_FILE}: the frontmatter cannot be read (${String(e.reason || e.message).split('\n')[0].trim()})`);
  }
  const { data, content } = note;
  const publishing = [];
  const needsDecision = [];
  const resolved = [];
  const excluded = [];

  const checkedPattern = /^- \[[xX]\]\s+(.+)$/;
  const uncheckedPattern = /^- \[ \]\s+(.+)$/;

  let currentSection = null;
  // A line a `%%` or `<!-- -->` comment hides is not read: in Obsidian it is gone (#498).
  for (const line of uncommentedLines(content).lines) {
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
  // Nor here: the writer rewrites the file from these entries, and would print a commented-out line uncommented.
  for (const line of uncommentedLines(body).lines) {
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
    let unticked = false;
    const checkbox = ENTRY.exec(line);
    if (checkbox) { raw = checkbox[2].trim(); unticked = checkbox[1] === ' '; }
    else {
      const grouped = GROUPED.exec(line);
      if (grouped && !/^reason:/i.test(grouped[1].trim())) raw = grouped[1].trim();
    }
    if (!raw) continue;

    // Same anchoring as manifest.js: a filename may legitimately contain " — ".
    const split = /^(.*?\.\w+)(?:\s+(?:—|–|--)\s+(.*))?$/.exec(raw);
    const rel = canonicalPath(split ? split[1] : raw);
    const annotation = (split && split[2] ? split[2].trim() : null) || groupReason || null;
    // The writer drops a Needs Decision reason, as it always has; readers that list the file still see it.
    // An unticked Publishing entry is not published (parseManifest skips it); the writer keeps it unticked (#403).
    entries.set(rel, { section, annotation: section === 'needsDecision' ? null : annotation, decisionNote: section === 'needsDecision' ? annotation : null, ...(section === 'publishing' && unticked ? { unticked: true } : {}) });
  }
  return entries;
}

const SECTIONS = [
  { key: 'publishing', title: 'Publishing', checked: true },
  { key: 'excluded', title: 'Excluded', checked: true },
  { key: 'needsDecision', title: 'Needs Decision', checked: false },
];

// The old file's text for an entries map (parseAnnotatedManifest's shape), in the documented layout.
function renderManifest({ entries, generated, vault, totalFiles }) {
  const bySection = { publishing: [], excluded: [], needsDecision: [] };
  for (const [rel, entry] of entries) bySection[entry.section].push({ rel, annotation: entry.annotation, unticked: !!entry.unticked });
  for (const key of Object.keys(bySection)) bySection[key].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const lines = [
    '---',
    'type: meta',
    `generated: ${generated}`,
    `vault: ${JSON.stringify(vault)}`,
    'mode: player',
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
      const box = section.checked && !row.unticked ? '- [x]' : '- [ ]';
      lines.push(row.annotation ? `${box} ${row.rel} — ${row.annotation}` : `${box} ${row.rel}`);
    }
    lines.push('');
  }
  // An empty section contributes header + two blanks; collapse those, and end the
  // file on exactly one newline.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n');
}

function lines(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) || [];
}

// Renames one path in the old Markdown list, text kept byte for byte but for the name. null when it names no entry.
function renameInOldList(text, from, to) {
  const want = canonicalPath(from);
  let section = null;
  let changed = false;
  const out = lines(text).map((line) => {
    const eol = /\r?\n$/.exec(line);
    const body = eol ? line.slice(0, -eol[0].length) : line;
    const heading = /^## (.+)/.exec(body);
    if (heading) {
      const title = heading[1].trim();
      section = title.startsWith('Publishing') || title.startsWith('Needs Decision') || title.startsWith('Excluded') ? title : null;
      return line;
    }
    if (!section) return line;
    const prefix = /^(?:- \[[ xX]\]\s+|\s+-\s+)/.exec(body);
    if (!prefix) return line;
    const rest = body.slice(prefix[0].length);
    const entry = ENTRY_RE.exec(rest.trim());
    const named = entry ? entry[1] : rest.trim();
    if (canonicalPath(named) !== want || !rest.startsWith(named)) return line;
    changed = true;
    return prefix[0] + to + rest.slice(named.length) + (eol ? eol[0] : '');
  });
  return changed ? out.join('') : null;
}

module.exports = { parseManifest, parseAnnotatedManifest, renderManifest, stripInlineComment, renameInOldList, ENTRY_RE };
