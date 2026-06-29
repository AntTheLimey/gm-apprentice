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

function splitCitation(name) {
  const m = String(name).match(/^(.*?)\s*\{p\.\s*([^}]+)\}\s*$/);
  return m ? { name: m[1].trim(), source: m[2].trim() } : { name: String(name).trim(), source: null };
}

function parseSkills(model, sections, fm) {
  if (Array.isArray(fm.skills)) {
    model.skills = fm.skills.map(s => ({
      name: s.name, level: String(s.level ?? ''), relative: s.relative || '',
      points: String(s.points ?? ''), parry: s.parry != null ? String(s.parry) : null,
      block: s.block != null ? String(s.block) : null, markers: [], source: s.source || null,
    }));
    return;
  }
  const sec = findSectionByTitle(sections, 'skills');
  if (!sec) return;
  const rows = parseTableRows(sec.html);
  const header = (rows[0] || []).map(h => h.toLowerCase());
  const idx = (names) => header.findIndex(h => names.some(n => h.includes(n)));
  const iName = idx(['name']) >= 0 ? idx(['name']) : 0;
  const iLevel = idx(['effective', 'level']);
  const iRel = idx(['relative']);
  const iPts = idx(['point']);
  for (const row of rows.slice(1)) {
    if (!row[iName]) continue;
    const { name, source } = splitCitation(row[iName]);
    const lv = splitMarkers(iLevel >= 0 ? row[iLevel] : '');
    model.skills.push({
      name, level: lv.value, relative: iRel >= 0 ? row[iRel] : '',
      points: iPts >= 0 ? row[iPts] : '', parry: null, block: null,
      markers: lv.markers, source,
    });
  }
}

function readTraitRows(html) {
  const out = [];
  for (const row of parseTableRows(html).slice(1)) {
    if (!row[0]) continue;
    const { name, source } = splitCitation(row[0]);
    const costCell = row[row.length - 1] || '';
    const cm = splitMarkers(costCell);
    out.push({ name, cost: cm.value, markers: cm.markers, source });
  }
  return out;
}

function parseTraits(model, sections, fm) {
  const map = [
    ['advantages', ['advantages & perks', 'advantages']],
    ['disadvantages', ['disadvantages & quirks', 'disadvantages']],
  ];
  for (const [key, titles] of map) {
    if (Array.isArray(fm[key])) {
      model.traits[key] = fm[key].map(t => ({ name: t.name || String(t), cost: String(t.cost ?? ''), markers: [], source: t.source || null }));
      continue;
    }
    const sec = findSectionByTitle(sections, ...titles);
    if (sec) model.traits[key] = readTraitRows(sec.html);
  }
  for (const key of ['perks', 'quirks', 'templates']) {
    if (Array.isArray(fm[key])) model.traits[key] = fm[key].map(t => ({ name: t.name || String(t), cost: String(t.cost ?? ''), markers: [], source: t.source || null }));
  }
}

function parseSenses(model, sections, fm) {
  if (fm.senses && typeof fm.senses === 'object') {
    for (const [k, v] of Object.entries(fm.senses)) model.senses[k] = String(v);
    return;
  }
  const sec = findSectionByTitle(sections, 'stat sheet');
  if (!sec) return;
  const subHtml = extractSubsectionHtml(sec.html, 'Appearance & Social') ||
    extractSubsectionHtml(sec.html, 'Senses') || '';
  for (const row of parseTableRows(subHtml).slice(1)) {
    if (row.length >= 2 && row[0]) model.senses[row[0]] = row[1];
  }
}

function parseDefenses(model, sections, fm) {
  if (fm.defenses && typeof fm.defenses === 'object') {
    model.defenses = { parry: fm.defenses.parry || [], block: fm.defenses.block || [],
      dodge: fm.defenses.dodge != null ? String(fm.defenses.dodge) : null,
      hitLocations: fm.defenses.hitLocations || [] };
    return;
  }
  const sec = findSectionByTitle(sections, 'active defenses');
  if (sec) {
    for (const row of parseTableRows(sec.html).slice(1)) {
      if (!row[0]) continue;
      const lower = row[0].toLowerCase();
      const { value } = splitMarkers(row[1] || '');
      if (lower.includes('parry')) model.defenses.parry.push({ label: row[0], value });
      else if (lower.includes('block')) model.defenses.block.push({ label: row[0], value });
      else if (lower.includes('dodge')) model.defenses.dodge = value;
    }
  }
  const drSec = findSectionByTitle(sections, 'dr by hit location', 'hit location');
  if (drSec) {
    for (const row of parseTableRows(drSec.html).slice(1)) {
      if (row[0]) model.defenses.hitLocations.push({ location: row[0], dr: row[1] || '0' });
    }
  }
}

function parseGurps(frontmatter, sections) {
  const fm = frontmatter || {};
  const secs = sections || [];
  const model = emptyModel();
  parseAttributes(model, secs, fm);
  parseSkills(model, secs, fm);
  parseTraits(model, secs, fm);
  parseSenses(model, secs, fm);
  parseDefenses(model, secs, fm);
  return model;
}

module.exports = { parseGurps, emptyModel, cell };
