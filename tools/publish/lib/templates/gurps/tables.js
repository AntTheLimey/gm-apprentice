function parseTableRows(html) {
  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function findSectionByTitle(sections, ...titles) {
  const lower = titles.map(t => t.toLowerCase());
  return sections.find(s => lower.includes(s.title.toLowerCase()));
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSubsectionHtml(sectionHtml, subsectionTitle) {
  // Escape regex metacharacters in the title, then allow `&` to match either
  // the literal `&` or its HTML entity `&amp;` so titles like "Appearance & Social"
  // match rendered HTML containing `&amp;`.
  const escaped = escapeRegex(subsectionTitle).replace(/&/g, '&(?:amp;)?');
  const pattern = new RegExp(`<h3[^>]*>\\s*${escaped}\\s*</h3>([\\s\\S]*?)(?=<h3|$)`, 'i');
  const match = sectionHtml.match(pattern);
  return match ? match[1] : '';
}

module.exports = { parseTableRows, findSectionByTitle, extractSubsectionHtml };
