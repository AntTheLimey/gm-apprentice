// The identity strip of a PC page whose character sheet is not published: who
// the character is (level, class, ancestry), never what they can do. A fixed
// list of fields per system, read from the note's sections or from frontmatter
// the GM chose to publish. Anything else the sheet holds stays off the page.
const { getSheetFamily, getRenderer } = require('./pc-registry');
const { renderCoCSheet } = require('./coc/index');
const {
  sectionReader, boldField, consumeTable, filled, ATTRIBUTE_COLUMNS,
} = require('./sheet-parse');

const CLASS = 'Class(?:es)?(?:\\s*/\\s*Subclass(?:es)?)?';

// The cell `pick` returns from the first row, in any table of the section, that it accepts.
// `pick(cells)` gets [label, value] and returns the value to take, or '' to go on.
function tableValue(section, columns, pick) {
  if (!section) return '';
  let found = '';
  for (const table of String(section.html || '').match(/<table[\s\S]*?<\/table>/gi) || []) {
    consumeTable(table, columns, (cells) => {
      if (!found) found = filled(pick(cells));
      return true;
    });
    if (found) break;
  }
  return found;
}

const levelRow = (section) => tableValue(section, ATTRIBUTE_COLUMNS, ([label, value]) => (/^level$/i.test(label) ? value : ''));
// The last cell of the first `## Points Summary` row whose first cell says total.
const pointsTotal = (section) => tableValue(section, [/./, /./], ([label, value]) => (/total/i.test(label) ? value : ''));

function fromFrontmatter(frontmatter, key) {
  const raw = (frontmatter || {})[key];
  return typeof raw === 'string' || typeof raw === 'number' ? filled(String(raw)) : '';
}

// A points total: a positive finite number, or a string of digits only. Anything else
// (text, a list, 0) is not a total, and the body's Points Summary is read instead.
function pointTotal(frontmatter) {
  const raw = (frontmatter || {}).point_total;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? String(raw) : '';
  return typeof raw === 'string' && /^\d+$/.test(raw.trim()) && Number(raw) > 0 ? raw.trim() : '';
}

// pcIdentity(system, frontmatter, sections) -> [[label, value], ...]
//   frontmatter — the PC's published frontmatter (a field the GM hid is not here)
//   sections    — extractSections of the note with GM content stripped, before the
//                 keep-list; [] when nothing of the body may be read
function pcIdentity(system, frontmatter, sections) {
  const read = sectionReader(sections);
  const stat = read.first('Stat Sheet');
  const background = read.first('Background');
  const field = (label) => (background ? boldField(background.html, label) : '');
  let pairs;

  const family = getSheetFamily(system);
  if (family === 'dnd') {
    pairs = [['Level', levelRow(stat)], ['Class', field(CLASS)], ['Species', field('(?:Species|Race)')], ['Background', field('Background')]];
  } else if (family === 'pf2e') {
    pairs = [['Level', levelRow(stat)], ['Class', field(CLASS)], ['Ancestry', field('Ancestry')], ['Heritage', field('Heritage')], ['Background', field('Background')]];
  } else if (family === 'fitd') {
    pairs = [['Playbook', stat ? boldField(stat.html, 'Playbook') : ''], ['Heritage', field('Heritage')], ['Vice', field('Vice(?:/Purveyor)?')]];
  } else if (family === 'gurps') {
    pairs = [['Points', pointTotal(frontmatter) || pointsTotal(read.first('Points Summary'))]];
  } else if (system && getRenderer(system) === renderCoCSheet) {
    pairs = [['Occupation', fromFrontmatter(frontmatter, 'occupation')], ['Age', fromFrontmatter(frontmatter, 'age')]];
  } else {
    pairs = [];
  }
  return pairs.filter(([, value]) => value);
}

module.exports = { pcIdentity };
