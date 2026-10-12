// Table cells arrive as rendered HTML, so their text still carries entities
// (`&quot;`, `&amp;`, `&#39;`). Blocks escape again on the way out, so a height of
// `6'2"` reached the page as the literal `6&quot;`. Decode at the parse boundary:
// everything downstream treats a cell as plain text. (The named table covers
// what the markdown renderer actually emits — its own escape set — plus
// numeric/hex forms; other named entities pass through as literal text.)
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

function decodeEntities(text) {
  return String(text == null ? '' : text).replace(
    /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi,
    (whole, body) => {
      if (body[0] === '#') {
        const cp = body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        const valid = Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff
          && !(cp >= 0xd800 && cp <= 0xdfff);   // lone surrogates are not scalar values
        return valid ? String.fromCodePoint(cp) : whole;
      }
      const key = body.toLowerCase();
      // own-property only: '&constructor;' must not stringify Object.prototype members
      const named = Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key)
        ? NAMED_ENTITIES[key] : undefined;
      return named === undefined ? whole : named;
    },
  );
}

// Rows of cells, as plain text. A table the build widened (a row had more cells than its
// header, #283) carries blank header cells marked `data-widened`; the readers address columns
// by position and by count, so each row is cut back to the columns the GM's header names
// and the cells beyond are left to overflowNotes. `keepExtra` returns every cell.
function parseTableRows(html, { keepExtra = false } = {}) {
  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  let known = Infinity;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells = [];
    let widened = 0;
    let heads = 0;
    const cellRegex = /<(t[dh])([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      if (cellMatch[1].toLowerCase() === 'th') { heads++; if (/data-widened/.test(cellMatch[2])) widened++; }
      cells.push(decodeEntities(cellMatch[3].replace(/<[^>]+>/g, '')).trim());
    }
    if (heads > 0) known = heads - widened;
    if (cells.length > 0) rows.push(keepExtra ? cells : cells.slice(0, known));
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

// Cells a row holds beyond the columns its table's header names (the build widens a table
// with blank header cells when a row is over-wide, #283). The sheets read columns by position,
// so such a cell reaches no tile or row; they list it instead, so nothing the GM wrote is lost.
// Returns [{ section, row, text }] for the sections named in `only`: those the sheet reads
// by position and so would not show. A section it shows whole already carries the cell.
function overflowNotes(sections, only) {
  const keys = typeof only === 'function' ? null : only.map(normalizeTitle);
  const wanted = (title) => (keys ? keys.includes(normalizeTitle(title)) : only(title));
  const out = [];
  for (const sec of sections || []) {
    if (!sec || !sec.html || !wanted(sec.title)) continue;
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let m;
    while ((m = tableRegex.exec(sec.html)) !== null) {
      const head = m[1].match(/<thead[^>]*>[\s\S]*?<\/thead>/i);
      if (!head) continue;
      const known = parseTableRows(head[0], { keepExtra: true })[0].length - (head[0].match(/data-widened/g) || []).length;
      const body = m[1].replace(head[0], '');
      for (const row of parseTableRows(body, { keepExtra: true })) {
        const extra = row.slice(known).filter(Boolean);
        if (extra.length) out.push({ section: sec.title, row: row[0] || '', text: extra.join(' · ') });
      }
    }
  }
  return out;
}

// A section's HTML with the columns the build added by widening taken out again: the table the
// sheet reads is the one the GM's header describes, as it was before #283. The cells are not lost:
// splitWidened lists them. Untouched when no table in the fragment was widened.
function stripWidened(html) {
  const source = String(html || '');
  if (!/data-widened/.test(source)) return source;
  return source.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, (table) => {
    if (!/data-widened/.test(table)) return table;
    const head = table.match(/<thead[^>]*>[\s\S]*?<\/thead>/i);
    if (!head) return table;
    const heads = [...head[0].matchAll(/<th(\s[^>]*)?>/gi)];
    const known = heads.length - heads.filter(h => /data-widened/.test(h[1] || '')).length;
    return table.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
      let at = 0;
      return row.replace(/<(t[dh])([^>]*)>[\s\S]*?<\/\1>\n?/gi, (cell) => (at++ < known ? cell : ''));
    });
  });
}

// For the sheets that read a section's tables whole (D&D, PF2e, FitD): the sections `isConsumed`
// names, with widened columns removed so every value and tracker comes out as it did when such a
// cell was dropped, and the notes (overflowNotes) to list on the sheet instead.
function splitWidened(sections, isConsumed) {
  const notes = overflowNotes(sections, isConsumed);
  const read = (sections || []).map(s => (s && s.html && isConsumed(s.title) && /data-widened/.test(s.html) ? { ...s, html: stripWidened(s.html) } : s));
  return { sections: read, notes };
}

module.exports = { stripWidened, splitWidened, overflowNotes, decodeEntities, parseTableRows, parseTables, countTables, normalizeTitle, findSectionByTitle, extractSubsectionHtml, topLevelHtml, aboveSubheadings };
