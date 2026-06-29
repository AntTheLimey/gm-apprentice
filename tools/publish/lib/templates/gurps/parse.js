const { parseTableRows, findSectionByTitle, extractSubsectionHtml } = require('./tables');
const { splitMarkers } = require('./render');

const PRIMARY = ['ST', 'DX', 'IQ', 'HT'];

function emptyModel() {
  return {
    identity: {}, status: {},
    attributes: { primary: {}, secondary: {}, bl: null, thrust: null, swing: null, dodge: null },
    senses: {}, defenses: { parry: [], block: [], dodge: null, hitLocations: [] },
    encumbrance: [], reactions: {},
    social: { cultural: [], languages: [] },
    traits: { advantages: [], perks: [], disadvantages: [], quirks: [], templates: [] },
    skills: [], techniques: [], spells: [], grimoire: [],
    melee: [], ranged: [],
    equipment: { items: [], loadouts: [] },
    chains: { melee: [], ranged: [] },
    points: [],
  };
}

function cell(v) { const { value, markers } = splitMarkers(v); return { value, markers }; }

function parseAttributes(model, sections, fm) {
  const sec = findSectionByTitle(sections, 'stat sheet');
  if (sec) {
    const primHtml = extractSubsectionHtml(sec.html, 'Primary Attributes') || sec.html;
    for (const row of parseTableRows(primHtml)) {
      if (row.length >= 2 && PRIMARY.includes(row[0])) model.attributes.primary[row[0]] = cell(row[1]);
    }
    const secHtml = extractSubsectionHtml(sec.html, 'Secondary Characteristics');
    for (const row of parseTableRows(secHtml)) {
      if (row.length >= 2) model.attributes.secondary[row[0]] = cell(row[1]);
    }
  }
  if (fm.attributes) {
    for (const a of PRIMARY) {
      if (fm.attributes[a] != null) model.attributes.primary[a] = { value: String(fm.attributes[a]), markers: [] };
    }
  }
  if (fm.secondary) {
    for (const [k, v] of Object.entries(fm.secondary)) {
      model.attributes.secondary[k] = { value: String(v), markers: [] };
    }
  }
}

function parseGurps(frontmatter, sections) {
  const fm = frontmatter || {};
  const secs = sections || [];
  const model = emptyModel();
  parseAttributes(model, secs, fm);
  // NOTE: later tasks add parseSkills/parseTraits/... calls here.
  return model;
}

module.exports = { parseGurps, emptyModel, cell };
