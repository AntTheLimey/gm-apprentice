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

// The part of a section that precedes its first `### ` subheading.
function aboveSubheadings(sectionHtml) {
  return String(sectionHtml || '').split(/<h3[ >]/i)[0];
}

// A section's own tables. Sheets keep descriptive helper tables under `###` subheadings;
// those carry a foreign column schema and must not be flattened into the machine-readable
// table. Falls back to the whole section when nothing above the first subheading holds a
// table, so a sheet whose only table sits under a `###` still parses.
//
// Not for Equipment: its `### Load-Outs` / `### Encumbrance` subsections hold real tables
// that must never be read as items, so it wants aboveSubheadings() with no fallback.
function topLevelHtml(sectionHtml) {
  const top = aboveSubheadings(sectionHtml);
  return /<table[ >]/i.test(top) ? top : sectionHtml;
}

// Each table in a fragment as its own row list, in document order. parseTableRows
// flattens every table into one list, which is right for a single-schema section
// and wrong for a combined one (`## Melee & Ranged` holds two tables with two
// header rows, #177).
function parseTables(html) {
  const out = [];
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = tableRegex.exec(String(html || ''))) !== null) {
    const rows = parseTableRows(m[1]);
    if (rows.length) out.push(rows);
  }
  return out;
}

function countTables(html) {
  return (String(html || '').match(/<table[ >]/gi) || []).length;
}

// Loose heading key: case-folded, `&`/`&amp;`/`+` read as "and", punctuation
// and runs of whitespace collapsed to one space. A sheet author writes
// `## Melee & Ranged` or `## Advantages/Perks` and expects it to match; exact
// string equality silently dropped whole sections (#177).
function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[&+]/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findSectionByTitle(sections, ...titles) {
  const keys = titles.map(normalizeTitle);
  return sections.find(s => keys.includes(normalizeTitle(s.title)));
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

module.exports = { parseTableRows, parseTables, countTables, normalizeTitle, findSectionByTitle, extractSubsectionHtml, topLevelHtml, aboveSubheadings };
