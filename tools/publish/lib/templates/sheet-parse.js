// Shared parsing for the PC sheets built from a note's body sections (D&D,
// PF2e, FitD). Sections arrive as rendered HTML from extractSections.
//
// The contract every sheet built on this keeps, and pc.js relies on: once a
// sheet renders, every section it consumes is on the sheet in full. What it
// cannot place structurally — a row with an extra column, prose under a table,
// a repeated section, an unknown `### ` subsection — is passed through as
// written, never dropped.
const { escapeHtml } = require('../processor');
const { decodeEntities, normalizeTitle, aboveSubheadings } = require('./gurps/tables');

const ATTRIBUTE_COLUMNS = [/^(attribute|stat|field|name)$/i, /^value$/i];


function cellText(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, '')).trim();
}

// A Yes/No cell: true, false, or null when it says something else (which the
// sheet has no mark for, so the row is passed through instead).
function yesNo(cell) {
  const s = String(cell || '').trim();
  if (/^(yes|y|true|x|\[x\]|✓|✔|●|1|p|prof|proficient|trained|e|expert|expertise)$/i.test(s)) return true;
  if (/^(no|n|false|\[ ?\]|✗|0|—|–|-)?$/i.test(s)) return false;
  return null;
}

function isPlaceholder(text) {
  return /^\{[^}]*\}$/.test(String(text || '').trim());
}

// A header value: template placeholders and dashes are not values.
function filled(text) {
  const s = String(text == null ? '' : text).trim();
  return s && !isPlaceholder(s) && s !== '—' ? s : '';
}

// Text, or something that shows without text (an image, an embed).
function hasContent(html) {
  const s = String(html || '');
  return /<(img|svg|video|audio|iframe|object|embed)[ >/]/i.test(s) || cellText(s).length > 0;
}

function statItem(label, value) {
  return `<div class="stat-item"><span class="stat-label">${escapeHtml(label)}</span><span class="stat-value">${escapeHtml(value || '—')}</span></div>`;
}

// Each `### ` subsection as { title, html }, in document order. The title is
// plain text, so `### **Combat**` is still Combat.
function subsections(sectionHtml) {
  const out = [];
  const re = /<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3[ >]|$)/gi;
  let m;
  while ((m = re.exec(sectionHtml || '')) !== null) {
    out.push({ title: cellText(m[1]), html: m[2] });
  }
  return out;
}

// Take the first table out of a fragment and offer each body row to `place`.
//   columns — one pattern per column the sheet reads, matched against the
//             table's header. Cells are read by position, so a table whose
//             leading columns are something else is not this table: no row
//             is offered and it is shown whole. A row with text beyond the
//             columns read (a Notes column, say) is never offered either.
//   place   — (cells) => true when the sheet placed the row.
// Returns what is left: the rows nobody placed (as a table, under the original
// header, with their markup intact) followed by the fragment minus the table.
// Empty string when there is nothing left to show.
function consumeTable(html, columns, place) {
  const cols = columns.length;
  const source = String(html || '');
  const tableMatch = source.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return hasContent(source) ? source : '';
  const inner = tableMatch[1];
  const theadMatch = inner.match(/<thead[^>]*>[\s\S]*?<\/thead>/i);
  const body = theadMatch ? inner.replace(theadMatch[0], '') : inner;

  const cellsOf = rowHtml => {
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) cells.push(cellText(cellMatch[1]));
    return cells;
  };
  const header = theadMatch ? cellsOf(theadMatch[0]) : null;
  const known = !header || columns.every((pattern, i) => pattern.test(header[i] || ''));

  const unplaced = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(body)) !== null) {
    if (!hasContent(rowMatch[1])) continue;
    const cells = cellsOf(rowMatch[1]);
    // A tile shows text only, so a row holding a link or an image is not placed.
    const plain = !/<(a|img)[ >]/i.test(rowMatch[1]);
    const fits = known && plain && cells.slice(cols).every(c => !c);
    if (!(fits && place(cells.slice(0, cols)))) unplaced.push(rowMatch[0]);
  }

  const rest = source.replace(tableMatch[0], '');
  return [
    unplaced.length ? `<table>${theadMatch ? theadMatch[0] : ''}<tbody>${unplaced.join('')}</tbody></table>` : '',
    hasContent(rest) ? rest : '',
  ].filter(Boolean).join('\n');
}

// The template's own unfilled lines: `**Tools:** {list}`, alone on a line or
// in a paragraph. Only that shape and only the template's exact placeholders
// (`placeholders`: their text without the braces); braces an author wrote,
// anywhere else, are content.
function stripTemplatePlaceholders(html, placeholders) {
  const alternatives = placeholders.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(<p>|\\n)(?:<strong>[^<]*:</strong>\\s*)?\\{(?:${alternatives})\\}[ \\t]*(?=\\n|</p>)`, 'g');
  return String(html || '').replace(re, '$1').replace(/<p>\s*<\/p>/g, '');
}

// `**Species:** Elf` in a rendered section -> 'Elf'. A label needs its colon
// (bold prose is not a field) and its value runs to the next label or line end.
function boldField(html, label) {
  const re = new RegExp(`<strong>\\s*${label}\\s*(?::\\s*</strong>|</strong>\\s*:)([\\s\\S]*?)(?=<strong>[^<]*:|<br|</p>|\\n|$)`, 'i');
  const m = String(html || '').match(re);
  return m ? filled(cellText(m[1])) : '';
}

// An `Attribute | Value` table as tiles. Every row becomes a [label, value]
// pair unless `intercept(label, value)` takes it (Level, for the header). With
// `mergeHp`, the `HP (Current)` (or bare `HP`) and `HP (Max)` rows become one
// HP tile.
// Returns { rows, left }: `left` is what consumeTable could not place.
function readAttributes(html, { intercept, mergeHp } = {}) {
  const rows = [];
  const hp = { cur: '', max: '' };
  const hpSeen = { cur: false, max: false };
  const left = consumeTable(html, ATTRIBUTE_COLUMNS, ([label, value]) => {
    if (intercept && intercept(label, value)) return true;
    const m = mergeHp && label.match(/^HP\s*(?:\(\s*(cur(?:r(?:ent)?)?|max(?:imum)?)\.?\s*\))?$/i);
    if (!m) { rows.push([label, value]); return true; }
    // A bare `HP` row is the current value.
    const slot = /^max/i.test(m[1] || '') ? 'max' : 'cur';
    if (hpSeen[slot]) return false;
    if (!hpSeen.cur && !hpSeen.max) rows.push(['HP', null]);
    hpSeen[slot] = true;
    hp[slot] = value;
    return true;
  });
  const hpText = hp.max ? `${hp.cur || '—'} / ${hp.max}` : hp.cur;
  return { rows: rows.map(([label, value]) => [label, value === null ? hpText : value]), left };
}

function tiles(rows, extraClass) {
  if (!rows.length) return '';
  return `<div class="quick-stats${extraClass ? ' ' + extraClass : ''}">${rows.map(([l, v]) => statItem(l, v)).join('\n')}</div>`;
}

// Spell slot tiles from a `Level | Total | Expended` table, as remaining / total.
// A row with neither number is an unused level when `isLevel` accepts its label.
function readSlots(html, columns, isLevel) {
  const slots = [];
  const left = consumeTable(html, columns, ([level, total, expended]) => {
    if (!total && !expended) return isLevel.test(level);
    if (!/^\d+$/.test(total) || !/^\d*$/.test(expended)) return false;
    const t = parseInt(total, 10);
    const e = parseInt(expended, 10) || 0;
    if (e > t) return false;
    slots.push([level, `${t - e} / ${t}`]);
    return true;
  });
  return { slots, left };
}

// The first section of each title, and the rest of them as written.
function sectionReader(sections) {
  const byTitle = title => (sections || []).filter(s => normalizeTitle(s.title) === normalizeTitle(title));
  return {
    first: title => byTitle(title)[0],
    repeats: title => byTitle(title).slice(1)
      .filter(s => hasContent(s.html))
      .map(s => `<h3>${escapeHtml(s.title)}</h3>\n${s.html}`),
  };
}

function consumedTitleMatcher(titles) {
  const keys = titles.map(normalizeTitle);
  return title => keys.includes(normalizeTitle(title));
}

// Did a sheet built on this module place anything — a tile, an ability card,
// a skill, a track, an identity block, a proficiency or ability list — or
// pass a table through? If not it is only loose text ("TBD", "see D&D
// Beyond"), and the page has no character sheet (#273).
function hasSheetStructure(html) {
  const s = String(html || '');
  return /<table[ >]/i.test(s)
    || /class="(?:stat-item|dnd-ability-card|dnd-skill|dnd-proficiency|dnd-proficiency-list|fitd-action-row|fitd-tracker|fitd-identity|fitd-abilities)[ "]/.test(s);
}

module.exports = {
  hasSheetStructure,
  ATTRIBUTE_COLUMNS, aboveSubheadings, cellText, yesNo, isPlaceholder, filled, hasContent, statItem,
  subsections, consumeTable, stripTemplatePlaceholders, boldField, readAttributes, tiles, readSlots,
  sectionReader, consumedTitleMatcher,
};
