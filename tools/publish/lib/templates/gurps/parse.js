const { parseTableRows, findSectionByTitle, extractSubsectionHtml } = require('./tables');
const { splitMarkers, stripCost } = require('./render');

const PRIMARY = ['ST', 'DX', 'IQ', 'HT'];

// True secondary characteristics: computed from primaries, spend points to improve
const SECONDARY_CHARS = ['HP', 'Will', 'Per', 'FP', 'Basic Speed', 'Basic Move'];

// Derived/calculated values that appear in the Secondary Characteristics table
const DERIVED_KEYS = ['Basic Lift', 'Damage (Thr)', 'Damage (Sw)', 'Size Modifier', 'TL'];

function emptyModel() {
  return {
    identity: {}, status: {},
    attributes: { primary: {}, secondary: {}, derived: {}, bl: null, thrust: null, swing: null, dodge: null },
    senses: {}, defenses: { parry: [], block: [], dodge: null, hitLocations: [] },
    encumbrance: [], reactions: {},
    social: { cultural: [], languages: [] },
    traits: { advantages: [], perks: [], disadvantages: [], quirks: [], templates: [] },
    skills: [], skillFootnotes: {}, techniques: [], spells: [], grimoire: [],
    melee: [], ranged: [],
    equipment: { items: [], loadouts: [] },
    chains: { melee: [], ranged: [] },
    points: [],
  };
}

function cell(v) { const { value, markers } = splitMarkers(v); return { value, markers }; }

// Header-row guard: returns true for rows that are table headers, not data.
function isHeaderRow(row) {
  if (row.length < 2) return false;
  const c0 = row[0].toLowerCase();
  const c1 = row[1].toLowerCase();
  return /^(characteristic|attribute|trait|name)$/.test(c0) || /^(value|score)$/.test(c1);
}

function parseAttributes(model, sections, fm) {
  const sec = findSectionByTitle(sections, 'stat sheet');
  if (sec) {
    const primHtml = extractSubsectionHtml(sec.html, 'Primary Attributes') || sec.html;
    const primRows = parseTableRows(primHtml);
    // Detect Cost column from header row
    const primHeader = primRows.length > 0 ? primRows[0].map(h => h.toLowerCase()) : [];
    const costIdx = primHeader.findIndex(h => h === 'cost');
    for (const row of primRows) {
      if (isHeaderRow(row)) continue;
      if (row.length >= 2 && PRIMARY.includes(row[0])) {
        const c = cell(row[1]);
        if (costIdx >= 0 && row[costIdx]) {
          const { value: costVal } = require('./render').stripCost(row[costIdx]);
          c.cost = costVal;
        }
        model.attributes.primary[row[0]] = c;
      }
    }
    const secHtml = extractSubsectionHtml(sec.html, 'Secondary Characteristics');
    for (const row of parseTableRows(secHtml)) {
      if (isHeaderRow(row)) continue;
      if (row.length >= 2 && row[0]) {
        const key = row[0];
        if (DERIVED_KEYS.includes(key)) {
          model.attributes.derived[key] = cell(row[1]);
        } else {
          model.attributes.secondary[key] = cell(row[1]);
        }
      }
    }
  }
  if (fm.attributes) {
    for (const a of PRIMARY) {
      if (fm.attributes[a] != null) model.attributes.primary[a] = { value: String(fm.attributes[a]), markers: [] };
    }
  }
  if (fm.secondary) {
    for (const [k, v] of Object.entries(fm.secondary)) {
      const c = { value: String(v), markers: [] };
      if (DERIVED_KEYS.includes(k)) {
        model.attributes.derived[k] = c;
      } else {
        model.attributes.secondary[k] = c;
      }
    }
  }
}

function splitCitation(name) {
  const m = String(name).match(/^(.*?)\s*\{p\.\s*([^}]+)\}\s*$/);
  return m ? { name: m[1].trim(), source: m[2].trim() } : { name: String(name).trim(), source: null };
}

function parseSkillFootnotes(sectionHtml) {
  // Parse footnote legend paragraphs from the section HTML.
  // These may be separate <p> elements starting with a glyph, OR multiple glyphs
  // in a single <p> separated by newlines (e.g. † note \n‡ note).
  // Returns a map: { '†': { kind: 'conditional'|'includes', text: '...' }, ... }
  const map = {};
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = pRegex.exec(sectionHtml)) !== null) {
    const inner = m[1];
    // Strip HTML tags and split on lines that start with a glyph
    const text = inner.replace(/<[^>]+>/g, '');
    // Split by newlines that are followed by a glyph character
    const lines = text.split(/\n(?=[†‡§¶#])/);
    for (const line of lines) {
      const stripped = line.trim();
      const glyphMatch = stripped.match(/^([†‡§¶#])\s+([\s\S]+)$/);
      if (!glyphMatch) continue;
      const glyph = glyphMatch[1];
      const noteText = glyphMatch[2].trim();
      const kind = /conditional/i.test(noteText) ? 'conditional' : 'includes';
      map[glyph] = { kind, text: noteText };
    }
  }
  return map;
}

function parseSkills(model, sections, fm) {
  if (Array.isArray(fm.skills)) {
    model.skills = fm.skills.map(s => ({
      name: String(s.name ?? ''), level: String(s.level ?? ''), relative: s.relative || '',
      points: String(s.points ?? ''), parry: s.parry != null ? String(s.parry) : null,
      block: s.block != null ? String(s.block) : null, markers: [], source: s.source || null,
    }));
    return;
  }
  const sec = findSectionByTitle(sections, 'skills');
  if (!sec) return;
  const rows = parseTableRows(sec.html);
  const header = (rows[0] || []).map(h => h.toLowerCase());
  // Detect columns explicitly by header substring.
  // 'effective' must be checked before generic 'level' to avoid hitting 'relative level'.
  const iName = header.findIndex(h => h.includes('name')) >= 0
    ? header.findIndex(h => h.includes('name')) : 0;
  // 'effective' takes priority over 'level'; 'relative level' must not match 'effective'
  const iEffective = header.findIndex(h => h.includes('effective'));
  // 'relative level' matches 'relative', not 'effective'
  const iRel = header.findIndex(h => h.includes('relative'));
  // Use 'effective' as level if found; otherwise fall back to a plain 'level' col
  const iLevelFallback = header.findIndex(h => h.includes('level') && !h.includes('relative'));
  const iLevel = iEffective >= 0 ? iEffective : iLevelFallback;
  const iPts = header.findIndex(h => h.includes('point'));
  for (const row of rows.slice(1)) {
    if (!row[iName]) continue;
    // Strip trailing footnote markers from name cell
    const rawName = row[iName];
    const { value: nameClean, markers: nameMarkers } = splitMarkers(rawName);
    const { name, source } = splitCitation(nameClean);
    const lv = splitMarkers(iLevel >= 0 ? row[iLevel] : '');
    const pts = stripCost(iPts >= 0 ? row[iPts] : '');
    model.skills.push({
      name, level: lv.value, relative: iRel >= 0 ? row[iRel] : '',
      points: pts.value, parry: null, block: null,
      markers: [...nameMarkers, ...lv.markers], source,
    });
  }
  // Parse footnote legend paragraphs from the section HTML
  model.skillFootnotes = parseSkillFootnotes(sec.html);
}

function readTraitRows(html) {
  const rows = parseTableRows(html);
  if (rows.length === 0) return [];
  // Detect Cost column by header (case-insensitive); fall back to col 1
  const header = (rows[0] || []).map(h => h.toLowerCase());
  let costIdx = header.findIndex(h => h.includes('cost'));
  if (costIdx < 0) costIdx = 1;
  const out = [];
  for (const row of rows.slice(1)) {
    if (!row[0]) continue;
    const { name, source } = splitCitation(row[0]);
    const costCell = row[costIdx] || '';
    const cm = stripCost(costCell);
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
      name: String(s.name ?? ''), level: String(s.level ?? ''), points: String(s.points ?? '0'),
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
  // The section HTML has **Key:** Value pairs rendered as <strong>Key:</strong> Value.
  // Match them from raw HTML where the key is in <strong> tags.
  const strongPattern = /<strong[^>]*>([^<:]+):?<\/strong>\s*:?\s*([^<\n]+)/gi;
  let sm;
  while ((sm = strongPattern.exec(sec.html)) !== null) {
    const key = sm[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
    const val = sm[2].replace(/<[^>]+>/g, '').trim();
    if (!val) continue;
    if (key === 'hp') model.status.hp = val;
    else if (key === 'fp') model.status.fp = val;
    else if (key === 'move') model.status.move = val;
    else if (key === 'enc' || key === 'encumbrance') model.status.enc = val;
    else if (key === 'condition') model.status.condition = val;
    else if (key === 'location') model.status.location = val;
    else if (key === 'carrying') model.status.carrying = val;
  }
  // Also scan plain text for patterns like "HP: 12/12" that may not be bold
  const text = sec.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const plainPatterns = [
    [/\bHP\s*:\s*(\S+)/i, 'hp'],
    [/\bFP\s*:\s*(\S+)/i, 'fp'],
    [/\bMove\s*:\s*(\S+)/i, 'move'],
    [/\bEnc(?:umbrance)?\s*:\s*(\S+)/i, 'enc'],
  ];
  for (const [re, key] of plainPatterns) {
    if (model.status[key] == null) {
      const m = text.match(re);
      if (m) model.status[key] = m[1].trim();
    }
  }
  // Also parse simple table rows if present (HP x/y, FP x/y in table form)
  for (const row of parseTableRows(sec.html).slice(1)) {
    if (!row[0]) continue;
    const k = row[0].toLowerCase().replace(/\s+/g, '');
    if (k === 'hp') model.status.hp = row[1];
    else if (k === 'fp') model.status.fp = row[1];
    else if (k === 'move') model.status.move = row[1];
    else if (k === 'enc' || k === 'encumbrance') model.status.enc = row[1];
    else if (k === 'condition') model.status.condition = row[1];
    else if (k === 'location') model.status.location = row[1];
  }
}

function parseTechniques(model, sections, fm) {
  if (Array.isArray(fm.techniques)) {
    model.techniques = fm.techniques.map(t => ({
      name: String(t.name ?? ''), def: t.default || t.def || '',
      points: String(t.points ?? ''), level: String(t.level ?? t.effective ?? ''),
      markers: [],
    }));
    return;
  }
  const sec = findSectionByTitle(sections, 'techniques');
  if (!sec) return;
  const rows = parseTableRows(sec.html);
  const header = (rows[0] || []).map(h => h.toLowerCase());
  const iName = header.findIndex(h => h.includes('name')) >= 0
    ? header.findIndex(h => h.includes('name')) : 0;
  const iDef = header.findIndex(h => h.includes('default'));
  const iPts = header.findIndex(h => h.includes('point'));
  const iEff = header.findIndex(h => h.includes('effective'));
  for (const row of rows.slice(1)) {
    if (!row[iName]) continue;
    const { value: nameClean, markers: nameMarkers } = splitMarkers(row[iName]);
    const { name, source } = splitCitation(nameClean);
    const pts = stripCost(iPts >= 0 ? row[iPts] : '');
    const eff = splitMarkers(iEff >= 0 ? row[iEff] : '');
    model.techniques.push({
      name, def: iDef >= 0 ? row[iDef] : '',
      points: pts.value, level: eff.value,
      markers: [...nameMarkers, ...pts.markers, ...eff.markers], source: source || null,
    });
  }
}

function parseChains(model, sections, fm) {
  // frontmatter.chains = { melee: [{name, steps:[]}], ranged: [...] }
  if (fm.chains && (Array.isArray(fm.chains.melee) || Array.isArray(fm.chains.ranged))) {
    model.chains.melee = (fm.chains.melee || []).map(c => ({
      name: c.name || '', steps: Array.isArray(c.steps) ? c.steps.map(String) : [],
    }));
    model.chains.ranged = (fm.chains.ranged || []).map(c => ({
      name: c.name || '', steps: Array.isArray(c.steps) ? c.steps.map(String) : [],
    }));
    return;
  }
  const sec = findSectionByTitle(sections, 'combat action chains', 'multi-action combat skill chains');
  if (!sec) return;

  // Try table form first: header row with a 'chain' column.
  // Expected columns: # | Chain | Key Rolls | Outcome  (or similar)
  const tableRows = parseTableRows(sec.html);
  if (tableRows.length >= 2) {
    const header = (tableRows[0] || []).map(h => h.toLowerCase());
    const iChain = header.findIndex(h => h.includes('chain'));
    const iRolls = header.findIndex(h => h.includes('roll') || h.includes('key'));
    const iOutcome = header.findIndex(h => h.includes('outcome'));
    if (iChain >= 0) {
      for (const row of tableRows.slice(1)) {
        const name = row[iChain] || '';
        if (!name) continue;
        const steps = [];
        if (iRolls >= 0 && row[iRolls]) steps.push(row[iRolls]);
        if (iOutcome >= 0 && row[iOutcome]) steps.push(row[iOutcome]);
        model.chains.melee.push({ name, steps });
      }
      return;
    }
  }

  // Try list form: rendered markdown converts "**Name:**" to "<strong>Name:</strong>".
  // Process each <li> individually so multi-item lists don't bleed across entries.
  // After stripping tags from a single item, "1. Name: step → step" is plain text.
  const liItems = [];
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let li;
  while ((li = liRegex.exec(sec.html)) !== null) {
    liItems.push(li[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  }

  let found = false;
  // Match "Label: step → step → step" within a single list item
  const arrowPattern = /^([^:→]{3,80}):\s*((?:[^→]+→[^→]+)+)$/;
  for (const item of liItems) {
    const m = item.match(arrowPattern);
    if (m) {
      const name = m[1].trim();
      const steps = m[2].split('→').map(s => s.trim()).filter(Boolean);
      if (steps.length >= 2) {
        model.chains.melee.push({ name, steps });
        found = true;
      }
    }
  }

  if (!found) {
    // Fallback: parse list items as a single unnamed chain
    if (liItems.length >= 2) {
      model.chains.melee.push({ name: 'Default Chain', steps: liItems });
    }
  }
}

function parseEquipment(model, sections, fm) {
  // frontmatter.loadouts = [{name, items:[{qty,name,cost,weight,location?,notes?}], totalCost, totalWeight}]
  if (fm.loadouts && Array.isArray(fm.loadouts)) {
    model.equipment.loadouts = fm.loadouts.map(lo => ({
      name: lo.name || '',
      items: (lo.items || []).map(i => ({
        qty: String(i.qty ?? '1'), name: i.name || '', cost: String(i.cost ?? ''),
        weight: String(i.weight ?? ''), location: i.location || null, notes: i.notes || null,
      })),
      totalCost: lo.totalCost != null ? String(lo.totalCost) : null,
      totalWeight: lo.totalWeight != null ? String(lo.totalWeight) : null,
    }));
  }
  // Parse ## Equipment table → items (top-level only, before any ### subsection)
  const sec = findSectionByTitle(sections, 'equipment');
  if (sec) {
    // Restrict to HTML before the first <h3> so ### Encumbrance / ### Load-Outs rows
    // are not flattened into the item list.
    const topHtml = sec.html.split(/<h3[ >]/i)[0];
    const rows = parseTableRows(topHtml);
    const header = (rows[0] || []).map(h => h.toLowerCase());
    const idx = n => header.findIndex(h => h.includes(n));
    const iQty = idx('qty') >= 0 ? idx('qty') : idx('#') >= 0 ? idx('#') : -1;
    const iName = idx('name') >= 0 ? idx('name') : idx('item') >= 0 ? idx('item') : 0;
    const iCost = idx('cost');
    const iWt = idx('weight') >= 0 ? idx('weight') : idx('wt');
    const iLoc = idx('location') >= 0 ? idx('location') : idx('loc');
    const iNotes = idx('notes');
    for (const row of rows.slice(1)) {
      if (!row[iName]) continue;
      model.equipment.items.push({
        qty: iQty >= 0 ? row[iQty] : '1',
        name: row[iName],
        cost: iCost >= 0 ? row[iCost] : '',
        weight: iWt >= 0 ? row[iWt] : '',
        location: iLoc >= 0 ? row[iLoc] || null : null,
        notes: iNotes >= 0 ? row[iNotes] || null : null,
      });
    }
    // Parse ### Load-Outs subsection if not already set from frontmatter
    if (model.equipment.loadouts.length === 0) {
      const loHtml = extractSubsectionHtml(sec.html, 'Load-Outs') ||
        extractSubsectionHtml(sec.html, 'Loadouts') || '';
      if (loHtml) {
        // Each load-out is a sub-sub-table or bold heading + table
        // Simple approach: parse bold headings as load-out names, then the following table
        const loText = loHtml;
        const loNameRegex = /<(?:h4|strong|b)[^>]*>([\s\S]*?)<\/(?:h4|strong|b)>/gi;
        const loTableRegex = /<table[\s\S]*?<\/table>/gi;
        const loNames = [];
        let nm;
        while ((nm = loNameRegex.exec(loText)) !== null) {
          loNames.push(nm[1].replace(/<[^>]+>/g, '').trim());
        }
        const loTables = [];
        let tb;
        while ((tb = loTableRegex.exec(loText)) !== null) {
          loTables.push(tb[0]);
        }
        for (let i = 0; i < loTables.length; i++) {
          const loRows = parseTableRows(loTables[i]);
          const loHeader = (loRows[0] || []).map(h => h.toLowerCase());
          const liQty = loHeader.findIndex(h => h.includes('qty') || h.includes('#'));
          const liName = Math.max(0, loHeader.findIndex(h => h.includes('name') || h.includes('item')));
          const liCost = loHeader.findIndex(h => h.includes('cost'));
          const liWt = loHeader.findIndex(h => h.includes('weight') || h.includes('wt'));
          const items = [];
          let totalCost = null; let totalWeight = null;
          for (const r of loRows.slice(1)) {
            const rName = r[liName] || '';
            if (rName.toLowerCase().includes('total')) {
              totalCost = liCost >= 0 ? r[liCost] || null : null;
              totalWeight = liWt >= 0 ? r[liWt] || null : null;
              continue;
            }
            if (!rName) continue;
            items.push({
              qty: liQty >= 0 ? r[liQty] : '1',
              name: rName,
              cost: liCost >= 0 ? r[liCost] : '',
              weight: liWt >= 0 ? r[liWt] : '',
              location: null, notes: null,
            });
          }
          model.equipment.loadouts.push({ name: loNames[i] || `Load-Out ${i + 1}`, items, totalCost, totalWeight });
        }
      }
    }
  }
}

function normalizeSkillName(name) {
  // Lowercase and strip parentheticals for loose matching, e.g. "Parry (Knife)" -> "knife"
  return String(name).toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
}

function crossReferenceSkillDefenses(model) {
  // For each skill, try to find a matching parry or block value from:
  // 1) Active Defenses (preferred) — label like "Parry (Knife)" where "Knife" matches skill name
  // 2) Melee Weapons — skill cell starts with skill name, has parry value
  for (const skill of model.skills) {
    if (skill.parry != null || skill.block != null) continue; // already set (frontmatter)
    const skillNorm = normalizeSkillName(skill.name);
    if (!skillNorm) continue;

    // Check active defenses
    for (const p of (model.defenses.parry || [])) {
      // label format: "Parry (Knife)" or "Parry (Karate)" — extract inner part
      const inner = p.label.replace(/^parry\s*/i, '').replace(/^\(|\)$/g, '').trim();
      if (normalizeSkillName(inner) === skillNorm && p.value) {
        skill.parry = p.value;
        break;
      }
    }
    if (skill.parry != null) continue;

    for (const b of (model.defenses.block || [])) {
      const inner = b.label.replace(/^block\s*/i, '').replace(/^\(|\)$/g, '').trim();
      if (normalizeSkillName(inner) === skillNorm && b.value) {
        skill.block = b.value;
        break;
      }
    }
    if (skill.block != null) continue;

    // Fallback: melee weapons — skill cell starts with skill name, parry is present
    for (const w of (model.melee || [])) {
      // Skill cell may be "Knife 17" — strip trailing level number
      const weaponSkillBase = String(w.skill || '').replace(/\s+\d+$/, '').trim();
      const weaponSkillNorm = normalizeSkillName(weaponSkillBase);
      if (weaponSkillNorm === skillNorm && w.parry && w.parry !== '—' && w.parry !== '-') {
        skill.parry = w.parry;
        break;
      }
    }
  }
}

function parseGurps(frontmatter, sections) {
  const fm = frontmatter || {};
  const secs = sections || [];
  const model = emptyModel();
  parseAttributes(model, secs, fm);
  parseSkills(model, secs, fm);
  parseTechniques(model, secs, fm);
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
  parseChains(model, secs, fm);
  parseEquipment(model, secs, fm);
  crossReferenceSkillDefenses(model);
  return model;
}

module.exports = { parseGurps, emptyModel, cell };
