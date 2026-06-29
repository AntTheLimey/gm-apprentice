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

function parseEncumbrance(model, sections, fm) {
  if (Array.isArray(fm.encumbrance)) {
    model.encumbrance = fm.encumbrance.map(e => ({
      level: String(e.level || ''), weight: String(e.weight || ''),
      move: String(e.move || ''), dodge: String(e.dodge || ''), current: !!e.current,
    }));
    return;
  }
  const sec = findSectionByTitle(sections, 'encumbrance');
  if (!sec) {
    // also check Equipment section for ### Encumbrance subsection
    const equip = findSectionByTitle(sections, 'equipment');
    if (!equip) return;
    const subHtml = extractSubsectionHtml(equip.html, 'Encumbrance');
    if (!subHtml) return;
    const rows = parseTableRows(subHtml).slice(1);
    for (const row of rows) {
      if (row[0]) model.encumbrance.push({ level: row[0], weight: row[1] || '', move: row[2] || '', dodge: row[3] || '', current: false });
    }
    return;
  }
  for (const row of parseTableRows(sec.html).slice(1)) {
    if (row[0]) model.encumbrance.push({ level: row[0], weight: row[1] || '', move: row[2] || '', dodge: row[3] || '', current: false });
  }
}

function parseReactions(model, sections, fm) {
  if (fm.reactions && typeof fm.reactions === 'object') {
    for (const [k, v] of Object.entries(fm.reactions)) model.reactions[k] = String(v);
    return;
  }
  const sec = findSectionByTitle(sections, 'reaction modifiers', 'reactions');
  if (!sec) return;
  for (const row of parseTableRows(sec.html).slice(1)) {
    if (row.length >= 2 && row[0]) model.reactions[row[0]] = row[1];
  }
}

function parseSocial(model, sections, fm) {
  if (Array.isArray(fm.cultural)) {
    model.social.cultural = fm.cultural.map(c => ({ name: c.name || String(c), cost: String(c.cost ?? '0'), markers: [] }));
  } else {
    const sec = findSectionByTitle(sections, 'cultural familiarities', 'cultural');
    if (sec) {
      for (const row of parseTableRows(sec.html).slice(1)) {
        if (row[0]) model.social.cultural.push({ name: row[0], cost: row[row.length - 1] || '0', markers: [] });
      }
    }
  }
  if (Array.isArray(fm.languages)) {
    model.social.languages = fm.languages.map(l => ({
      name: l.name, spoken: l.spoken || '', written: l.written || '', points: String(l.points ?? '0'),
    }));
  } else {
    const sec = findSectionByTitle(sections, 'languages');
    if (sec) {
      const rows = parseTableRows(sec.html);
      const header = (rows[0] || []).map(h => h.toLowerCase());
      const iName = Math.max(0, header.findIndex(h => h.includes('name')));
      const iSpoken = header.findIndex(h => h.includes('spoken'));
      const iWritten = header.findIndex(h => h.includes('written'));
      const iPts = header.findIndex(h => h.includes('point'));
      for (const row of rows.slice(1)) {
        if (!row[iName]) continue;
        model.social.languages.push({
          name: row[iName], spoken: iSpoken >= 0 ? row[iSpoken] : '',
          written: iWritten >= 0 ? row[iWritten] : '', points: iPts >= 0 ? row[iPts] : '0',
        });
      }
    }
  }
}

function parseSpells(model, sections, fm) {
  if (Array.isArray(fm.spells)) {
    model.spells = fm.spells.map(s => ({
      name: s.name, level: String(s.level ?? ''), points: String(s.points ?? '0'),
      markers: [], source: s.source || null,
    }));
    return;
  }
  const sec = findSectionByTitle(sections, 'spells');
  if (!sec) return;
  const rows = parseTableRows(sec.html);
  const header = (rows[0] || []).map(h => h.toLowerCase());
  const iName = Math.max(0, header.findIndex(h => h.includes('name')));
  const iLevel = header.findIndex(h => h.includes('level') || h.includes('effective'));
  const iPts = header.findIndex(h => h.includes('point'));
  for (const row of rows.slice(1)) {
    if (!row[iName]) continue;
    const { name, source } = splitCitation(row[iName]);
    const lv = splitMarkers(iLevel >= 0 ? row[iLevel] : '');
    model.spells.push({ name, level: lv.value, points: iPts >= 0 ? row[iPts] : '0', markers: lv.markers, source });
  }
}

function parsePoints(model, sections, fm) {
  if (Array.isArray(fm.points)) {
    model.points = fm.points.map(p => ({
      label: p.label, value: String(p.value ?? ''), total: !!p.total, unspent: !!p.unspent,
    }));
    return;
  }
  const sec = findSectionByTitle(sections, 'points summary', 'points');
  if (!sec) return;
  for (const row of parseTableRows(sec.html).slice(1)) {
    if (!row[0]) continue;
    const label = row[0];
    const value = row[row.length - 1] || '';
    const lowerLabel = label.toLowerCase();
    model.points.push({ label, value, total: lowerLabel.includes('total'), unspent: lowerLabel.includes('unspent') });
  }
}

function parseMelee(model, sections, fm) {
  if (Array.isArray(fm.melee)) {
    model.melee = fm.melee.map(a => ({
      weapon: a.weapon || '', skill: String(a.skill ?? ''), parry: String(a.parry ?? ''),
      damage: a.damage || '', reach: a.reach || '', st: String(a.st ?? ''), notes: a.notes || '',
    }));
    return;
  }
  const sec = findSectionByTitle(sections, 'melee weapons', 'melee');
  if (!sec) return;
  const rows = parseTableRows(sec.html);
  const header = (rows[0] || []).map(h => h.toLowerCase());
  const idx = n => header.findIndex(h => h.includes(n));
  const iWep = Math.max(0, idx('weapon') >= 0 ? idx('weapon') : idx('mode') >= 0 ? idx('mode') : 0);
  const iSkill = idx('skill'); const iParry = idx('parry'); const iDmg = idx('damage') >= 0 ? idx('damage') : idx('dmg');
  const iReach = idx('reach'); const iSt = idx('st'); const iNotes = idx('notes');
  for (const row of rows.slice(1)) {
    if (!row[iWep]) continue;
    model.melee.push({
      weapon: row[iWep], skill: iSkill >= 0 ? row[iSkill] : '',
      parry: iParry >= 0 ? row[iParry] : '', damage: iDmg >= 0 ? row[iDmg] : '',
      reach: iReach >= 0 ? row[iReach] : '', st: iSt >= 0 ? row[iSt] : '',
      notes: iNotes >= 0 ? row[iNotes] : '',
    });
  }
}

function parseRanged(model, sections, fm) {
  if (Array.isArray(fm.ranged)) {
    model.ranged = fm.ranged.map(a => ({
      weapon: a.weapon || '', skill: String(a.skill ?? ''), damage: a.damage || '',
      acc: String(a.acc ?? ''), range: a.range || '', rof: String(a.rof ?? ''),
      shots: a.shots || '', st: String(a.st ?? ''), bulk: String(a.bulk ?? ''),
      rcl: String(a.rcl ?? ''), notes: a.notes || '',
    }));
    return;
  }
  const sec = findSectionByTitle(sections, 'ranged weapons', 'ranged');
  if (!sec) return;
  const rows = parseTableRows(sec.html);
  const header = (rows[0] || []).map(h => h.toLowerCase());
  const idx = n => header.findIndex(h => h.includes(n));
  const iWep = Math.max(0, idx('weapon'));
  const iSkill = idx('skill'); const iDmg = idx('damage') >= 0 ? idx('damage') : idx('dmg');
  const iAcc = idx('acc'); const iRange = idx('range'); const iRof = idx('rof');
  const iShots = idx('shots'); const iSt = idx('st'); const iBulk = idx('bulk');
  const iRcl = idx('rcl'); const iNotes = idx('notes');
  for (const row of rows.slice(1)) {
    if (!row[iWep]) continue;
    model.ranged.push({
      weapon: row[iWep], skill: iSkill >= 0 ? row[iSkill] : '',
      damage: iDmg >= 0 ? row[iDmg] : '', acc: iAcc >= 0 ? row[iAcc] : '',
      range: iRange >= 0 ? row[iRange] : '', rof: iRof >= 0 ? row[iRof] : '',
      shots: iShots >= 0 ? row[iShots] : '', st: iSt >= 0 ? row[iSt] : '',
      bulk: iBulk >= 0 ? row[iBulk] : '', rcl: iRcl >= 0 ? row[iRcl] : '',
      notes: iNotes >= 0 ? row[iNotes] : '',
    });
  }
}

function parseGrimoire(model, sections, fm) {
  if (Array.isArray(fm.grimoire)) {
    model.grimoire = fm.grimoire.map(g => ({
      name: g.name, skill: String(g.skill ?? ''), class: g.class || '',
      time: g.time || '', duration: g.duration || '', cost: g.cost || '',
      college: g.college || '', page: g.page || '',
    }));
    return;
  }
  const sec = findSectionByTitle(sections, 'spell grimoire', 'grimoire');
  if (!sec) return;
  const rows = parseTableRows(sec.html);
  const header = (rows[0] || []).map(h => h.toLowerCase());
  const idx = n => header.findIndex(h => h.includes(n));
  const iName = Math.max(0, idx('name')); const iSkill = idx('skill');
  const iClass = idx('class'); const iTime = idx('time'); const iDur = idx('duration') >= 0 ? idx('duration') : idx('dur');
  const iCost = idx('cost'); const iCollege = idx('college'); const iPage = idx('page');
  for (const row of rows.slice(1)) {
    if (!row[iName]) continue;
    model.grimoire.push({
      name: row[iName], skill: iSkill >= 0 ? row[iSkill] : '',
      class: iClass >= 0 ? row[iClass] : '', time: iTime >= 0 ? row[iTime] : '',
      duration: iDur >= 0 ? row[iDur] : '', cost: iCost >= 0 ? row[iCost] : '',
      college: iCollege >= 0 ? row[iCollege] : '', page: iPage >= 0 ? row[iPage] : '',
    });
  }
}

function parseStatus(model, sections, fm) {
  if (fm.status && typeof fm.status === 'object') {
    model.status = { ...fm.status };
    return;
  }
  const sec = findSectionByTitle(sections, 'current status');
  if (!sec) return;
  // Parse **Key:** Value pairs from the section HTML
  const text = sec.html.replace(/<[^>]+>/g, ' ');
  const patterns = [
    [/\*\*HP\*\*\s*:\s*(\S+)/i, 'hp'],
    [/\*\*FP\*\*\s*:\s*(\S+)/i, 'fp'],
    [/\*\*Move\*\*\s*:\s*(\S+)/i, 'move'],
    [/\*\*Enc\*\*\s*:\s*(\S+)/i, 'enc'],
    [/\*\*Condition\*\*\s*:\s*([^\n*]+)/i, 'condition'],
  ];
  for (const [re, key] of patterns) {
    const m = text.match(re);
    if (m) model.status[key] = m[1].trim();
  }
  // Also parse simple table rows if present
  for (const row of parseTableRows(sec.html).slice(1)) {
    if (!row[0]) continue;
    const k = row[0].toLowerCase().replace(/\s+/g, '');
    if (k === 'hp') model.status.hp = row[1];
    else if (k === 'fp') model.status.fp = row[1];
    else if (k === 'move') model.status.move = row[1];
    else if (k === 'enc' || k === 'encumbrance') model.status.enc = row[1];
    else if (k === 'condition') model.status.condition = row[1];
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
  parseEncumbrance(model, secs, fm);
  parseReactions(model, secs, fm);
  parseSocial(model, secs, fm);
  parseSpells(model, secs, fm);
  parsePoints(model, secs, fm);
  parseMelee(model, secs, fm);
  parseRanged(model, secs, fm);
  parseGrimoire(model, secs, fm);
  parseStatus(model, secs, fm);
  return model;
}

module.exports = { parseGurps, emptyModel, cell };
