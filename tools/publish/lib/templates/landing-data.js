function getLatestSession(pages) {
  const played = pages.filter(
    p => p.frontmatter.type === 'session' && p.frontmatter.status === 'played'
  );
  if (played.length === 0) return null;
  played.sort((a, b) => (b.frontmatter.session_number || 0) - (a.frontmatter.session_number || 0));
  return played[0];
}

function stripWikiLinks(text) {
  return text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1');
}

function extractRecap(page) {
  if (!page) return null;
  const md = page.markdown;
  if (!md) return null;

  const recapMatch = md.match(/^## Narrative Recap\s*$/m);
  let paragraph;

  if (recapMatch) {
    const after = md.slice(recapMatch.index + recapMatch[0].length);
    const nextHeading = after.search(/^## /m);
    const section = nextHeading === -1 ? after : after.slice(0, nextHeading);
    const paragraphs = section.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    paragraph = paragraphs[0] || null;
  } else {
    const withoutH1 = md.replace(/^# .+\n+/, '');
    const paragraphs = withoutH1.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    paragraph = paragraphs[0] || null;
  }

  if (!paragraph) return null;

  paragraph = stripWikiLinks(paragraph);

  if (paragraph.length > 500) {
    const truncated = paragraph.slice(0, 500);
    const lastSpace = truncated.lastIndexOf(' ');
    paragraph = (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + '…';
  }

  return paragraph;
}

function getInitials(name) {
  if (!name) return '';
  const words = name.split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function getPCs(pages) {
  return pages
    .filter(p => p.frontmatter.type === 'pc')
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

module.exports = { getLatestSession, extractRecap, getInitials, getPCs };
