const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

function parseManifest(markdown) {
  const { data, content } = matter(markdown);
  const publishing = [];
  const needsDecision = [];
  const resolved = [];

  const checkedPattern = /^- \[x\]\s+(.+)$/;
  const uncheckedPattern = /^- \[ \]\s+(.+)$/;

  let currentSection = null;
  for (const line of content.split('\n')) {
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
      if (match) publishing.push(match[1].trim());
    }

    if (currentSection === 'needs_decision') {
      const unchecked = line.match(uncheckedPattern);
      if (unchecked) needsDecision.push(unchecked[1].trim());
      const checked = line.match(checkedPattern);
      if (checked) resolved.push(checked[1].trim());
    }
  }

  return {
    meta: data,
    publishing,
    needsDecision,
    resolved,
  };
}

function loadManifest(vaultPath) {
  const manifestPath = path.join(vaultPath, '_meta', 'publish-manifest.md');
  if (!fs.existsSync(manifestPath)) return null;
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  return parseManifest(raw);
}

module.exports = { parseManifest, loadManifest };
