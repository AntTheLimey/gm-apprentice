// A D&D 5e (2024) PC note's body sections as a model for the sheet's blocks.
// The layout is skills/shared/templates/pc-dnd-5e-2024.md
// (docs/file-format-standards.md §9); the layout before 1.10.33 is read too.
// The site does no sums: every number is the note's own. The no-loss contract
// is sheet-parse.js's: what cannot be placed goes to `asWritten`.
const { escapeHtml } = require('../../processor');
const {
  ATTRIBUTE_COLUMNS, aboveSubheadings, cellText, filled, hasContent, yesNo,
  subsections, consumeTable, stripTemplatePlaceholders, boldField, sectionReader,
} = require('../sheet-parse');

const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const ABILITY_NAME = /^(str(?:ength)?|dex(?:terity)?|con(?:stitution)?|int(?:elligence)?|wis(?:dom)?|cha(?:risma)?)$/i;
const COLS = {
  abilities: [/^abilit/i, /^score$/i, /^mod/i, /^sav.*prof/i, /^save$/i],
  abilitiesOld: [/^abilit/i, /^score$/i, /^mod/i, /^sav/i],
  skills: [/^skills?$/i, /^abilit/i, /^prof/i, /^expert/i, /^(mod|bonus)/i],
  features: [/^(name|feature|trait|feat)$/i, /^action$/i, /^uses$/i, /^used$/i, /^recovers?$/i, /^summary$/i],
  slots: [/^(spell )?level$/i, /^(total|max)$/i, /^(expended|used|spent)$/i],
  spells: [/^spell$/i, /^level$/i, /^(casting )?time$/i, /^range$/i, /^comp/i, /^duration$/i, /^(hit|atk|attack).*dc$|^hit$|^dc$/i, /^tags?$/i, /^summary$/i],
  attacks: [/^name$/i, /^(atk|attack|hit)/i, /^damage/i, /^notes?$/i],
  gear: [/^item$/i, /^(qty|quantity)$/i, /^notes?$/i],
  attunement: [/^slot$/i, /^item$/i],
};
const DEFENCE_FIELDS = [
  ['Resistances', 'Resistances'], ['Immunities', 'Immunities'], ['Vulnerabilities', 'Vulnerabilities'],
  ['Condition Immunities', 'Condition Immunities'], ['Armour Class', 'Armou?r Class'],
];
const SPELL_STAT_LABELS = /^(spellcasting ability|spell attack modifier|spell save dc)(\s*\(.+\))?$/i;
const TEMPLATE_NOTES = [/^Omit this section if the character has no spellcasting\.?$/i];
const PLACEHOLDERS = ['list', 'Continue per level as needed.', 'Selected class features by level.',
  'Species features and traits.', 'Selected feats with descriptions.', 'Item list', 'what it is made of'];
const FEATURE_SECTIONS = [['class features', 'class', 'classFeatures'], ['species traits', 'species', 'speciesTraits'], ['feats', 'feats', 'feats']];

function splitReason(text) {
  const s = String(text || '').trim();
  const m = s.match(/^(.*?\S)\s*\(([^()]+)\)$/);
  return m ? { value: m[1], reason: m[2].trim() } : { value: s, reason: '' };
}

const wholeNumber = s => (/^\d+$/.test(String(s).trim()) ? parseInt(s, 10) : null);

function stripNotes(html) {
  return String(html || '').replace(/<(blockquote|p)>([\s\S]*?)<\/\1>/gi,
    (whole, tag, inner) => (TEMPLATE_NOTES.some(n => n.test(cellText(inner))) ? '' : whole));
}

// A `{placeholder}` paragraph that is one of the template's own.
function stripPlaceholderParagraphs(html) {
  return String(html || '').replace(/<p>\s*\{([^}]*)\}\s*<\/p>/g,
    (whole, inner) => (PLACEHOLDERS.includes(inner.trim()) ? '' : whole));
}

const titled = (title, html, tag = 'h3') => `<${tag}>${escapeHtml(title)}</${tag}>\n${html}`;

function readStatSheet(model, section) {
  const html = section.html;
  const keep = (title, body) => { if (hasContent(body)) model.asWritten.statSheet.push(titled(title, body)); };
  if (hasContent(aboveSubheadings(html))) model.asWritten.statSheet.push(aboveSubheadings(html));
  const seen = new Set();
  for (const sub of subsections(html)) {
    const key = sub.title.toLowerCase().replace('defenses', 'defences');
    if (seen.has(key) || !['core', 'ability scores', 'combat', 'senses', 'defences'].includes(key)) {
      keep(sub.title, sub.html);
      continue;
    }
    seen.add(key);
    let left = '';
    if (key === 'core') {
      left = consumeTable(sub.html, ATTRIBUTE_COLUMNS, ([label, value]) => {
        if (/^level$/i.test(label)) model.header.level = filled(value);
        else if (/^proficiency bonus$/i.test(label)) model.pb = filled(value);
        else if (/^heroic inspiration$/i.test(label)) model.inspiration = filled(value);
        else model.core.push([label, filled(value)]);
        return true;
      });
    } else if (key === 'ability scores') {
      const place = hasSave => cells => {
        const m = String(cells[0] || '').match(ABILITY_NAME);
        const k = m ? m[1].slice(0, 3).toUpperCase() : '';
        const prof = yesNo(cells[3]);
        if (!k || model.abilities[k] || prof === null) return false;
        model.abilities[k] = { score: cells[1], mod: cells[2], saveProf: prof, save: hasSave ? cells[4] : '' };
        return true;
      };
      left = consumeTable(sub.html, COLS.abilities, place(true));
      if (Object.keys(model.abilities).length === 0) left = consumeTable(sub.html, COLS.abilitiesOld, place(false));
    } else if (key === 'combat') {
      left = consumeTable(sub.html, ATTRIBUTE_COLUMNS, ([label, value]) => readCombatRow(model, label, value));
    } else if (key === 'senses') {
      left = consumeTable(sub.html, ATTRIBUTE_COLUMNS, ([label, value]) => { model.senses.push([label, filled(value)]); return true; });
    } else {
      left = sub.html;
      for (const [label, pattern] of DEFENCE_FIELDS) {
        const value = boldField(left, pattern);
        if (!value) continue;
        model.defences.push([label, value]);
        left = left.replace(new RegExp(`<strong>\\s*${pattern}\\s*(?::\\s*</strong>|</strong>\\s*:)[\\s\\S]*?(?=<strong>[^<]*:|<br\\s*/?>|</p>|\\n|$)(?:<br\\s*/?>|\\n)?`, 'i'), '');
      }
      left = left.replace(/<p>([\s\S]*?)<\/p>/g, (whole, inner) => (hasContent(inner) ? whole : ''));
      left = stripTemplatePlaceholders(left, PLACEHOLDERS);
    }
    keep(sub.title, left);
  }
}

function readCombatRow(model, label, value) {
  const c = model.combat;
  const v = filled(value);
  const l = label.trim();
  const once = (key) => { if (c[key] !== undefined) return false; c[key] = v; return true; };
  if (/^ac$|^armou?r class$/i.test(l)) return once('ac');
  if (/^initiative$/i.test(l)) return once('initiative');
  if (/^speed$/i.test(l)) return once('speed');
  if (/^size$/i.test(l)) return once('size');
  if (/^HP\s*(\(\s*cur(r(ent)?)?\.?\s*\))?$/i.test(l)) return once('hpCur');
  if (/^HP\s*\(\s*max(imum)?\.?\s*\)$/i.test(l)) return once('hpMax');
  if (/^temp(orary)? HP$/i.test(l)) return once('tempHp');
  if (/^exhaustion$/i.test(l)) return once('exhaustion');
  if (/^conditions?$/i.test(l)) return once('conditions');
  if (/^passive /i.test(l)) { model.senses.push([l, v]); return true; }
  if (/^hit dice/i.test(l)) {
    const name = l.replace(/\s*\(\s*spent\s*\/\s*max\s*\)\s*$/i, '');
    const m = v.match(/^(\d+)\s*\/\s*(\d+)$/);
    c.hitDice.push(m ? { label: name, spent: +m[1], max: +m[2] } : { label: name, raw: v });
    return true;
  }
  if (/^death saves/i.test(l)) {
    if (c.deathSaves) return false;
    const m = v.match(/^(\d+)\s*\/\s*(\d+)$/);
    c.deathSaves = m ? { s: +m[1], f: +m[2] } : { raw: v };
    return true;
  }
  c.other.push([l, v]);
  return true;
}

function readSkills(model, section) {
  const left = consumeTable(stripNotes(section.html), COLS.skills, ([name, ability, proficient, expertise, modifier]) => {
    const prof = yesNo(proficient);
    const expert = yesNo(expertise);
    if (!name || prof === null || expert === null) return false;
    model.skills.push({ name, ability, proficient: prof || expert, expert, modifier });
    return true;
  });
  if (hasContent(left)) model.asWritten.skills.push(left);
}

function readFeatures(model, section, list, home) {
  const left = consumeTable(stripPlaceholderParagraphs(section.html), COLS.features, (c, h) => {
    if (!c.some(filled)) return true;             // the template's empty row
    const uses = c[2] ? wholeNumber(c[2]) : null;
    const used = c[3] ? wholeNumber(c[3]) : null;
    if (!c[0] || (c[2] && uses === null) || (c[3] && used === null)) return false;
    model.features[list].push({ name: c[0], nameHtml: h[0], action: c[1], uses, used, recovers: c[4], summaryHtml: h[5] });
    return true;
  }, { rich: true });
  if (hasContent(left)) model.asWritten[home].push(left);
}

function spellLevel(text) {
  const s = String(text || '').trim().toLowerCase();
  if (/^(cantrips?|0)$/.test(s)) return '0';
  const m = s.match(/^(\d)(st|nd|rd|th)?$/);
  return m ? m[1] : '';
}

function readSpellcasting(model, section) {
  const top = stripNotes(aboveSubheadings(section.html));
  const topLeft = consumeTable(top, ATTRIBUTE_COLUMNS, ([label, value]) => {
    if (filled(value) || !SPELL_STAT_LABELS.test(label)) model.casting.push([label, filled(value)]);
    return true;
  });
  if (hasContent(topLeft)) model.asWritten.spellcasting.push(topLeft);
  const seen = new Set();
  for (const sub of subsections(section.html)) {
    const key = sub.title.toLowerCase();
    const first = !seen.has(key);
    seen.add(key);
    let left = sub.html;
    if (key === 'spell slots' && first) {
      left = consumeTable(sub.html, COLS.slots, ([level, total, expended]) => {
        if (!total && !expended) return /^(\d+(st|nd|rd|th)?|cantrips?|pact\b.*)$/i.test(level);
        const t = wholeNumber(total);
        const e = expended ? wholeNumber(expended) : 0;
        if (t === null || e === null || e > t) return false;
        model.slots.push({ level, total: t, expended: e });
        return true;
      });
    } else if (key === 'spells' && first) {
      left = consumeTable(sub.html, COLS.spells, (c, h) => {
        if (!c.some(filled)) return true;             // the template's empty row
        const level = spellLevel(c[1]);
        if (!c[0] || !level) return false;
        model.spells.push({
          name: c[0], nameHtml: h[0], level, time: c[2], range: c[3], components: c[4], duration: c[5], hit: c[6],
          tags: c[7] ? c[7].split(',').map(t => t.trim()).filter(Boolean) : [], summaryHtml: h[8],
        });
        return true;
      }, { rich: true });
    } else {
      left = stripTemplatePlaceholders(left, PLACEHOLDERS);
    }
    if (hasContent(left)) model.asWritten.spellcasting.push(titled(sub.title, left, 'h4'));
  }
  model.hasSpellcasting = model.casting.length > 0 || model.slots.length > 0
    || model.spells.length > 0 || model.asWritten.spellcasting.length > 0;
}

function readEquipment(model, section) {
  const keep = (title, body) => { if (hasContent(body)) model.asWritten.equipment.push(titled(title, body)); };
  const above = stripPlaceholderParagraphs(aboveSubheadings(section.html));
  if (hasContent(above)) model.asWritten.equipment.push(above);
  const seen = new Set();
  for (const sub of subsections(section.html)) {
    const key = sub.title.toLowerCase();
    if (seen.has(key)) { keep(sub.title, sub.html); continue; }
    seen.add(key);
    let left = sub.html;
    if (key === 'weapons & damage cantrips' || key === 'weapons and damage cantrips' || key === 'attacks') {
      left = consumeTable(sub.html, COLS.attacks, (c, h) => {
        if (!c.some(filled)) return true;             // the template's empty row
        if (!c[0]) return false;
        model.attacks.push({ name: c[0], nameHtml: h[0], hit: c[1], damage: c[2], notesHtml: h[3] });
        return true;
      }, { rich: true });
    } else if (key === 'gear') {
      left = consumeTable(stripPlaceholderParagraphs(sub.html), COLS.gear, (c, h) => {
        if (!c.some(filled)) return true;
        if (!c[0]) return false;
        model.gear.push({ name: c[0], nameHtml: h[0], qty: c[1], notesHtml: h[2] });
        return true;
      }, { rich: true });
    } else if (key === 'magic item attunement' || key === 'attunement') {
      left = consumeTable(sub.html, COLS.attunement, ([slot, item]) => { model.attunement.push([slot, filled(item)]); return true; });
    } else if (key === 'coins') {
      const head = [...sub.html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(m => cellText(m[1]));
      const body = (sub.html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i) || [])[1] || '';
      const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      const cells = rows.length === 1 ? [...rows[0][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => cellText(m[1])) : [];
      if (head.length && cells.length === head.length && cells.every(c => /^[\d,]*$/.test(c))) {
        model.coins = head.map((d, i) => [d, cells[i] || '0']);
        left = sub.html.replace(/<table[^>]*>[\s\S]*?<\/table>/i, '');
      }
    }
    keep(sub.title, left);
  }
}

function parseDnd(frontmatter, sections) {
  const model = {
    header: { level: '', classes: '', species: '', background: '' },
    pb: '', inspiration: '', core: [], abilities: {},
    combat: { hitDice: [], other: [] },
    senses: [], defences: [], skills: [],
    features: { class: [], species: [], feats: [] },
    casting: [], slots: [], spells: [], proficienciesHtml: '',
    attacks: [], gear: [], attunement: [], coins: [],
    asWritten: { statSheet: [], skills: [], classFeatures: [], speciesTraits: [], feats: [], spellcasting: [], proficiencies: [], equipment: [] },
    hasSpellcasting: false, warnings: [],
  };
  const reader = sectionReader(sections);
  const read = (title, fn, home) => {
    const first = reader.first(title);
    if (first) fn(first);
    model.asWritten[home].push(...reader.repeats(title));
  };

  const background = reader.first('background');
  if (background) {
    model.header.classes = boldField(background.html, 'Class(?:es)?(?:\\s*/\\s*Subclass(?:es)?)?');
    model.header.species = boldField(background.html, '(?:Species|Race)');
    model.header.background = boldField(background.html, 'Background');
  }
  read('stat sheet', s => readStatSheet(model, s), 'statSheet');
  read('skills', s => readSkills(model, s), 'skills');
  for (const [title, list, home] of FEATURE_SECTIONS) read(title, s => readFeatures(model, s, list, home), home);
  read('spellcasting', s => readSpellcasting(model, s), 'spellcasting');
  if (model.asWritten.spellcasting.length) model.hasSpellcasting = true;
  read('proficiencies', (s) => {
    const body = stripTemplatePlaceholders(s.html, PLACEHOLDERS);
    if (hasContent(body)) model.proficienciesHtml = body;
  }, 'proficiencies');
  read('equipment', s => readEquipment(model, s), 'equipment');

  for (const key of ['ac', 'initiative', 'speed', 'size', 'hpCur', 'hpMax', 'tempHp', 'exhaustion', 'conditions']) {
    if (model.combat[key] === undefined) model.combat[key] = '';
  }
  return model;
}

module.exports = { parseDnd, splitReason, ABILITIES };
