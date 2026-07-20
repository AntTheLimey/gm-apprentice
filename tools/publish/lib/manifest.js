const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

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
  return match ? match[1] : trimmed;
}

function parseManifest(markdown) {
  const { data, content } = matter(markdown);
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

    // The Excluded section lists a `- Reason: …` category bullet followed by indented
    // `  - path.md` file bullets. Collect the file paths (skip the Reason categories) so the
    // build can tell a *deliberately* excluded file from one that is simply absent from the
    // manifest — only the latter is a forgotten-to-register warning (#101).
    if (currentSection === 'excluded') {
      const m = line.match(/^\s*-\s+(.+)$/);
      if (m && !/^reason:/i.test(m[1].trim())) excluded.push(stripInlineComment(m[1]));
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

function loadManifest(vaultPath) {
  const manifestPath = path.join(vaultPath, '_meta', 'publish-manifest.md');
  if (!fs.existsSync(manifestPath)) return null;
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  return parseManifest(raw);
}

module.exports = { parseManifest, loadManifest, stripInlineComment };
