const { createRenderer } = require('./markdown');
const md = createRenderer();

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Turn a wiki-link slug/target into human-readable display text (underscores → spaces).
// Used wherever a raw entity name would otherwise show, e.g. Lord_Percival_Harcourt.
function humanizeName(s) {
  return String(s == null ? '' : s).replace(/_/g, ' ');
}

// Parse a wiki ref (`[[Target]]` or `[[Target|Alias]]`, brackets optional) into the raw
// lookup target and a display label. The target keeps its underscores so it still matches
// linkMap keys; the label is the explicit alias if given, otherwise the humanized target.
function parseWikiRef(raw) {
  const inner = String(raw == null ? '' : raw).replace(/\[\[|\]\]/g, '').trim();
  if (!inner) return { target: '', label: '' };
  const pipe = inner.indexOf('|');
  if (pipe === -1) return { target: inner, label: humanizeName(inner) };
  return { target: inner.slice(0, pipe).trim(), label: inner.slice(pipe + 1).trim() };
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

// Relative href between two OUTPUT FILE paths. relativePath() expects a directory as its
// base, so callers that have a page's file path must strip the filename first — passing the
// file directly counts the filename as a directory level and emits one extra `../` (B3).
function relativeHref(fromOutputPath, toOutputPath) {
  const i = String(fromOutputPath).lastIndexOf('/');
  const fromDir = i === -1 ? '' : fromOutputPath.slice(0, i);
  return relativePath(fromDir, toOutputPath);
}

function resolveWikiLinks(markdown, linkMap, currentOutputPath) {
  // The leading `!` of a non-image transclusion (`![[Backstory]]`) is consumed and dropped,
  // degrading it to an ordinary link. Leaving it would pair with the `[text](path)` emitted
  // below into `![text](path)` — an <img> whose src points at an HTML page. Image embeds
  // resolve earlier, in resolveImageEmbeds, so nothing reaching here should stay an image.
  return markdown.replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, target, displayText) => {
    // Without an explicit |alias, humanize the slug (Lord_Percival_Harcourt → Lord Percival
    // Harcourt) so neither resolved link text nor unresolved plain text shows raw underscores.
    const display = displayText || humanizeName(target);
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

// Strip content between a named HTML-comment marker pair (e.g. "gm-only" for
// <!-- gm-only -->...<!-- /gm-only -->). Shared implementation behind
// stripGmOnly and stripSpoiler — same stripping behavior, different marker
// name, so a marker of one name never strips a block of the other name.
function stripMarkedBlocks(markdown, markerName) {
  const openRe = new RegExp(`^<!--\\s*${markerName}\\s*-->`);
  const closeRe = new RegExp(`^<!--\\s*/${markerName}\\s*-->`);
  const lines = markdown.split('\n');
  const result = [];
  const warnings = [];
  let excluding = false;
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^```/.test(line)) {
      inCodeFence = !inCodeFence;
    }

    if (inCodeFence) {
      if (!excluding) result.push(line);
      continue;
    }

    if (openRe.test(line.trim())) {
      excluding = true;
      result.push('');
      continue;
    }

    if (closeRe.test(line.trim())) {
      excluding = false;
      continue;
    }

    if (!excluding) {
      result.push(line);
    }
  }

  if (excluding) {
    warnings.push(`unclosed <!-- ${markerName} --> marker — content stripped to end of file`);
  }

  const text = result.join('\n');
  return warnings.length > 0 ? { text, warnings } : text;
}

function stripGmOnly(markdown) {
  return stripMarkedBlocks(markdown, 'gm-only');
}

function stripSpoiler(markdown) {
  return stripMarkedBlocks(markdown, 'spoiler');
}

// Remove every `<!-- ... -->` comment, including multi-line ones, outside fenced code
// blocks. Authors keep private notes (UNVERIFIED flags, change logs, import provenance)
// as comments; the renderer runs with `html: false`, so anything left here is escaped and
// printed as visible body text. Must run AFTER stripGmOnly/stripSpoiler, whose block
// markers are themselves comments.
//
// A line that holds nothing but a comment is dropped rather than blanked: a blank line
// would split the paragraph the comment was sitting inside.
function stripHtmlComments(markdown) {
  const lines = String(markdown || '').split('\n');
  const result = [];
  const warnings = [];
  // Track which marker opened the fence: a ``` line inside a ~~~ block is content, not a
  // close, and must not toggle the fence off and expose the rest of the block to stripping.
  let fenceMarker = null;
  let inComment = false;

  for (const line of lines) {
    const fence = inComment ? null : /^\s*(```|~~~)/.exec(line);
    if (fence) {
      if (fenceMarker === null) fenceMarker = fence[1];
      else if (fenceMarker === fence[1]) fenceMarker = null;
    }
    // Inside a fence, or on the line that opened or closed one: pass through verbatim.
    if (fenceMarker !== null || fence) {
      result.push(line);
      continue;
    }

    let kept = '';
    let i = 0;
    while (i < line.length) {
      if (inComment) {
        const end = line.indexOf('-->', i);
        if (end === -1) { i = line.length; break; }
        inComment = false;
        i = end + 3;
      } else {
        const start = line.indexOf('<!--', i);
        if (start === -1) { kept += line.slice(i); break; }
        kept += line.slice(i, start);
        inComment = true;
        i = start + 4;
      }
    }

    if (kept.trim() === '' && line.trim() !== '') continue;
    result.push(kept);
  }

  if (inComment) {
    warnings.push('unclosed <!-- comment --> — content stripped to end of file');
  }

  const text = result.join('\n');
  return warnings.length > 0 ? { text, warnings } : text;
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
    const targetName = String(r.target).replace(/\[\[|\]\]/g, '');
    const targetPath = linkMap[targetName];
    const escapedName = escapeHtml(targetName.replace(/_/g, ' '));
    const link = targetPath
      ? `<a href="${relativePath(currentDir, targetPath)}" class="entity-link">${escapedName}</a>`
      : escapedName;
    const typeRaw = String(r.type).replace(/_/g, ' ');
    const typeCapitalized = typeRaw.charAt(0).toUpperCase() + typeRaw.slice(1);
    const type = escapeHtml(typeCapitalized);
    const desc = r.description ? ` &mdash; ${escapeHtml(r.description)}` : '';
    return `<li><strong class="rel-label">${type}</strong> ${link}${desc}</li>`;
  });

  return `<h2>Relationships</h2>\n<ul class="relationship-list">\n${items.join('\n')}\n</ul>`;
}

const IMAGE_EXT_REGEX = /\.(jpe?g|png|webp|gif|svg)$/i;

// Percent-encode each path segment. A destination containing a raw space — which vault
// attachments routinely do ("Chrome Jockey.png") — is not a valid markdown link, so
// markdown-it emits the whole `![alt](path)` as literal text and the typographer then
// rewrites the leading `../` into a `…/` ellipsis. Parens are encoded too: markdown-it
// only tolerates balanced ones inside a destination.
function encodeImageUrl(imagePath) {
  return String(imagePath)
    .split('/')
    .map(segment => encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29'))
    .join('/');
}

function resolveImageEmbeds(markdown, imageMap, currentOutputPath, usedImages, options = {}) {
  // The entity's `portrait:` frontmatter. An inline embed of the same file exists so the
  // image shows in Obsidian's reading view; on the site the portrait already displays it,
  // so the inline copy is dropped rather than duplicated.
  //
  // Safe because every entity template renders `portrait:` (world-domain.js was the last
  // holdout). A new template that skips the portrait must not be given a portraitBasename.
  const portrait = options.portraitBasename;
  const dedupeBasename = portrait && imageMap[portrait] ? portrait.toLowerCase() : null;

  // Match ![[filename.ext]] or ![[filename.ext|alt text]]
  return markdown.replace(/!\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (match, target, alt) => {
    const basename = target.trim();
    if (!IMAGE_EXT_REGEX.test(basename)) return match; // not an image, leave as-is

    const entry = imageMap[basename];
    if (!entry) {
      console.warn(`processor: image embed not found — "${basename}" (${currentOutputPath})`);
      return '';
    }

    if (usedImages) usedImages.add(basename);
    if (dedupeBasename && basename.toLowerCase() === dedupeBasename) return '';

    // Output goes to docs/images/{relPath}. Compute relative path from current page.
    const currentDir = currentOutputPath.substring(0, currentOutputPath.lastIndexOf('/'));
    const imgPath = 'images/' + entry.relPath;
    const relativeImgPath = encodeImageUrl(relativePath(currentDir, imgPath));
    const rawAlt = alt || basename.replace(IMAGE_EXT_REGEX, '').replace(/[-_]/g, ' ');
    const altText = rawAlt.replace(/[[\]]/g, '\\$&');
    return `![${altText}](${relativeImgPath})`;
  });
}

// Render a frontmatter-derived display value (summary, occupation, …) as HTML, resolving
// any `[[wikilink]]` it carries the way body prose does. Everything else is escaped.
function renderMetaValue(raw, linkMap = {}, currentOutputPath = '') {
  const text = String(raw == null ? '' : raw);
  const out = [];
  const pattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    out.push(escapeHtml(text.slice(last, match.index)));
    const { target, label } = parseWikiRef(match[0]);
    const targetPath = linkMap[target];
    out.push(targetPath
      ? `<a href="${relativeHref(currentOutputPath, targetPath)}" class="entity-link">${escapeHtml(label)}</a>`
      : escapeHtml(label));
    last = match.index + match[0].length;
  }
  out.push(escapeHtml(text.slice(last)));
  return out.join('');
}

// Plain-text form of the above, for values rendered inside an enclosing <a> (card
// subtitles, landing tiles) where a nested anchor would be invalid HTML.
function plainMetaValue(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m) => parseWikiRef(m).label);
}

function separateBoldLabelLines(markdown) {
  const lines = markdown.split('\n');
  const result = [];
  const boldStart = /^\*\*[^*]+\*\*/;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('```')) inFence = !inFence;
    result.push(lines[i]);
    if (!inFence &&
        boldStart.test(lines[i].trim()) &&
        i + 1 < lines.length &&
        boldStart.test(lines[i + 1].trim())) {
      result.push('');
    }
  }
  return result.join('\n');
}

// A page's reader-visible source: the gm-only/spoiler/excluded-section-stripped view that
// build.js precomputes, falling back to raw markdown for pages it never saw (story units,
// test doubles). Everything derived from prose — backlinks, search, recency, excerpts —
// must read through this, or unpublished content leaks into a derived widget (B6).
function publishedSource(page) {
  if (!page) return '';
  return page.publishedMarkdown != null ? page.publishedMarkdown : (page.markdown || '');
}

function portraitBasename(frontmatter) {
  const portrait = frontmatter && frontmatter.portrait;
  return portrait ? String(portrait).split('/').pop() : null;
}

function processContent(page, linkMap, excludeSections, imageMap = {}, options = {}) {
  let markdown = page.markdown.replace(/\r/g, '');
  const warnings = [];
  markdown = stripDataview(markdown);
  const gmResult = stripGmOnly(markdown);
  if (gmResult.warnings) {
    warnings.push(...gmResult.warnings);
    markdown = gmResult.text;
  } else {
    markdown = gmResult;
  }
  const spoilerResult = stripSpoiler(markdown);
  if (spoilerResult.warnings) {
    warnings.push(...spoilerResult.warnings);
    markdown = spoilerResult.text;
  } else {
    markdown = spoilerResult;
  }
  const commentResult = stripHtmlComments(markdown);
  if (commentResult.warnings) {
    warnings.push(...commentResult.warnings);
    markdown = commentResult.text;
  } else {
    markdown = commentResult;
  }
  markdown = stripLeadingH1(markdown);
  markdown = filterSections(markdown, excludeSections);
  markdown = separateBoldLabelLines(markdown);
  markdown = resolveImageEmbeds(markdown, imageMap, page.outputPath, options.usedImages, {
    portraitBasename: portraitBasename(page.frontmatter),
  });
  markdown = resolveWikiLinks(markdown, linkMap, page.outputPath);
  const html = md.render(markdown);
  const relationships = renderRelationships(page.frontmatter, linkMap, page.outputPath);
  return { html, relationships, warnings };
}

// Extract ## sections for accordion rendering (used by PC/NPC templates)
function extractSections(markdown) {
  const lines = markdown.replace(/\r/g, '').split('\n');
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

function filterFields(frontmatter, excludeFields = [], overrides = {}) {
  const filtered = { ...frontmatter };
  const reInclude = overrides.include || [];
  for (const field of excludeFields) {
    if (reInclude.includes(field)) continue;
    delete filtered[field];
  }
  return filtered;
}

module.exports = { processContent, extractSections, resolveWikiLinks, filterSections, stripDataview, stripGmOnly, stripSpoiler, stripHtmlComments, stripLeadingH1, renderRelationships, relativePath, relativeHref, humanizeName, parseWikiRef, escapeHtml, resolveImageEmbeds, encodeImageUrl, publishedSource, renderMetaValue, plainMetaValue, portraitBasename, filterFields };
