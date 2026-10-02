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

// The value of the first `Level` row in any table of the section.
function levelRow(section) {
  if (!section) return '';
  let found = '';
  for (const table of String(section.html || '').match(/<table[\s\S]*?<\/table>/gi) || []) {
    consumeTable(table, ATTRIBUTE_COLUMNS, ([label, value]) => {
      if (!found && /^level$/i.test(label)) found = filled(value);
      return true;
    });
    if (found) break;
  }
  return found;
}

// The last cell of the first `## Points Summary` row whose first cell says total.
function pointsTotal(section) {
  if (!section) return '';
  let total = '';
  for (const table of String(section.html || '').match(/<table[\s\S]*?<\/table>/gi) || []) {
    consumeTable(table, [/./, /./], ([label, value]) => {
      if (!total && /total/i.test(label)) total = filled(value);
      return true;
    });
    if (total) break;
  }
  return total;
}

function fromFrontmatter(frontmatter, key) {
  const raw = (frontmatter || {})[key];
  return typeof raw === 'string' || typeof raw === 'number' ? filled(String(raw)) : '';
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
    pairs = [['Points', fromFrontmatter(frontmatter, 'point_total') || pointsTotal(read.first('Points Summary'))]];
  } else if (system && getRenderer(system) === renderCoCSheet) {
    pairs = [['Occupation', fromFrontmatter(frontmatter, 'occupation')], ['Age', fromFrontmatter(frontmatter, 'age')]];
  } else {
    pairs = [];
  }
  return pairs.filter(([, value]) => value);
}

module.exports = { pcIdentity };
