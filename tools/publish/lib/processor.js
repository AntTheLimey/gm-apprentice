const MarkdownIt = require('markdown-it');
const md = new MarkdownIt({ html: true, typographer: true });

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function relativePath(fromDir, toPath) {
  if (!fromDir) return toPath;
  const fromParts = fromDir.split('/').filter(Boolean);
  const toParts = toPath.split('/').filter(Boolean);
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++;
  }
  const ups = fromParts.length - common;
  const result = '../'.repeat(ups) + toParts.slice(common).join('/');
  return result || toPath;
}

function resolveWikiLinks(markdown, linkMap, currentOutputPath) {
  return markdown.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, target, displayText) => {
    const display = displayText || target;
    const targetPath = linkMap[target];
    if (!targetPath) return display;
    const currentDir = currentOutputPath.substring(0, currentOutputPath.lastIndexOf('/'));
    const relative = relativePath(currentDir, targetPath);
    return `[${display}](${relative})`;
  });
}

function filterSections(markdown, excludeSections = []) {
  const lines = markdown.split('\n');
  const result = [];
  let excluding = false;
  let excludeLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();

      if (excluding && level <= excludeLevel) {
        excluding = false;
      }

      if (excludeSections.some(s => title.toLowerCase() === s.toLowerCase())) {
        excluding = true;
        excludeLevel = level;
        continue;
      }

      // Also exclude Appearances sections that are just placeholder text (case-insensitive)
      if (title.toLowerCase() === 'appearances') {
        const nextContentLines = [];
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].match(/^#{1,6}\s/)) break;
          if (lines[j].trim()) nextContentLines.push(lines[j].trim());
        }
        const content = nextContentLines.join(' ');
        if (!content || content.startsWith('*Scenes') || content.startsWith('*Events')) {
          excluding = true;
          excludeLevel = level;
          continue;
        }
      }
    }

    if (!excluding) {
      result.push(line);
    }
  }

  return result.join('\n');
}

function stripDataview(markdown) {
  return markdown.replace(/```dataview[\s\S]*?```/g, '');
}

// Strip a single leading H1 from the markdown body. Templates inject their own H1
// from the page title, so the author's `# Title` line at the top would render as a duplicate.
function stripLeadingH1(markdown) {
  const lines = markdown.split('\n');
  let i = 0;
  // Skip leading blank lines
  while (i < lines.length && lines[i].trim() === '') i++;
  // If the first non-blank line is an H1, remove it
  if (i < lines.length && /^#\s+/.test(lines[i])) {
    lines.splice(i, 1);
  }
  return lines.join('\n');
}

function renderRelationships(frontmatter, linkMap, currentOutputPath) {
  const rels = frontmatter.relationships;
  if (!rels || !Array.isArray(rels)) return '';
  const valid = rels.filter(r => r.target && r.type);
  if (valid.length === 0) return '';

  const currentDir = currentOutputPath.substring(0, currentOutputPath.lastIndexOf('/'));
  const items = valid.map(r => {
    const targetName = r.target.replace(/\[\[|\]\]/g, '');
    const targetPath = linkMap[targetName];
    const escapedName = escapeHtml(targetName);
    const link = targetPath
      ? `<a href="${relativePath(currentDir, targetPath)}" class="entity-link">${escapedName}</a>`
      : escapedName;
    const typeRaw = r.type.replace(/_/g, ' ');
    const typeCapitalized = typeRaw.charAt(0).toUpperCase() + typeRaw.slice(1);
    const type = escapeHtml(typeCapitalized);
    const desc = r.description ? ` &mdash; ${escapeHtml(r.description)}` : '';
    return `<li><strong class="rel-label">${type}</strong> ${link}${desc}</li>`;
  });

  return `<h2>Relationships</h2>\n<ul class="relationship-list">\n${items.join('\n')}\n</ul>`;
}

const IMAGE_EXT_REGEX = /\.(jpe?g|png|webp|gif)$/i;

function resolveImageEmbeds(markdown, imageMap, currentOutputPath) {
  // Match ![[filename.ext]] or ![[filename.ext|alt text]]
  return markdown.replace(/!\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (match, target, alt) => {
    const basename = target.trim();
    if (!IMAGE_EXT_REGEX.test(basename)) return match; // not an image, leave as-is

    const entry = imageMap[basename];
    if (!entry) return `<!-- image not found: ${basename} -->`;

    // Output goes to docs/images/{relPath}. Compute relative path from current page.
    const currentDir = currentOutputPath.substring(0, currentOutputPath.lastIndexOf('/'));
    const imgPath = 'images/' + entry.relPath;
    const relativeImgPath = relativePath(currentDir, imgPath);
    const altText = alt || basename.replace(IMAGE_EXT_REGEX, '').replace(/[-_]/g, ' ');
    return `![${altText}](${relativeImgPath})`;
  });
}

function processContent(page, linkMap, excludeSections, imageMap = {}) {
  let markdown = page.markdown;
  markdown = stripDataview(markdown);
  markdown = stripLeadingH1(markdown);
  markdown = filterSections(markdown, excludeSections);
  markdown = resolveImageEmbeds(markdown, imageMap, page.outputPath);
  markdown = resolveWikiLinks(markdown, linkMap, page.outputPath);
  const html = md.render(markdown);
  const relationships = renderRelationships(page.frontmatter, linkMap, page.outputPath);
  return { html, relationships };
}

// Extract ## sections for accordion rendering (used by PC/NPC templates)
function extractSections(markdown) {
  const lines = markdown.split('\n');
  const sections = [];
  let current = null;

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      if (current) sections.push(current);
      current = { title: h2Match[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);

  return sections.map(s => ({
    title: s.title,
    id: s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    html: md.render(s.lines.join('\n')),
  }));
}

module.exports = { processContent, extractSections, resolveWikiLinks, filterSections, stripDataview, stripLeadingH1, renderRelationships, relativePath, escapeHtml, resolveImageEmbeds };
