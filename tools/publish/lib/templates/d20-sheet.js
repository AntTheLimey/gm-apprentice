// The Pathfinder 2e sheet engine (D&D 5e moved to dnd/ in 1.13.0). Its PC template
// has the shape D&D's once had: `## Stat Sheet` (Core, an abilities table, Combat),
// `## Skills`, `## Spellcasting`, `## Proficiencies`, and labelled lines in
// `## Background`. Pathfinder supplies the config; see pc-pf2e.js.
// The no-loss contract is sheet-parse.js's.
const { escapeHtml } = require('../processor');
const {
  ATTRIBUTE_COLUMNS, aboveSubheadings, cellText, filled, hasContent, subsections, consumeTable,
  stripTemplatePlaceholders, boldField, readAttributes, tiles, readSlots, sectionReader,
} = require('./sheet-parse');

const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const ABILITY_NAME = /^(str(?:ength)?|dex(?:terity)?|con(?:stitution)?|int(?:elligence)?|wis(?:dom)?|cha(?:risma)?)$/i;
const CONSUMED_TITLES = ['stat sheet', 'skills', 'spellcasting', 'proficiencies'];

function abilityKey(name) {
  const m = String(name || '').match(ABILITY_NAME);
  return m ? m[1].slice(0, 3).toUpperCase() : '';
}

// Paragraphs and blockquotes that are exactly one of the template's own notes.
function stripTemplateNotes(html, notes) {
  return String(html || '').replace(/<(blockquote|p)>([\s\S]*?)<\/\1>/gi,
    (whole, tag, inner) => (notes.some(n => n.test(cellText(inner))) ? '' : whole));
}

function renderAbilities(abilities) {
  const cards = ABILITIES.filter(a => abilities[a]).map(a => {
    const { score, mod, save } = abilities[a];
    const modLine = mod ? `\n  <span class="ability-mod">${escapeHtml(String(mod))}</span>` : '';
    const saveMark = save ? '\n  <span class="ability-save" title="Saving throw proficiency">Save</span>' : '';
    return `<div class="dnd-ability-card${save ? ' has-save' : ''}">
  <span class="ability-name">${a}</span>
  <span class="ability-score">${escapeHtml(String(score))}</span>${modLine}${saveMark}
</div>`;
  }).join('\n');
  return cards ? `<div class="dnd-ability-scores">${cards}</div>` : '';
}

// `## Stat Sheet`: header, ability cards, Combat and Core tiles.
function renderStatSheet(section, backgroundHtml, cfg) {
  const html = section ? section.html : '';
  const parts = [];
  const extras = [];
  const passThrough = (title, body) => { if (hasContent(body)) extras.push(`<h3>${escapeHtml(title)}</h3>\n${body}`); };

  let level = '';
  let abilities = {};
  let core = [];
  let combat = [];
  const seen = new Set();
  const known = ['core', cfg.abilitySubsection, 'combat'];

  if (hasContent(aboveSubheadings(html))) extras.push(aboveSubheadings(html));
  for (const sub of subsections(html)) {
    const key = sub.title.toLowerCase();
    // A repeated subsection is not merged into the first; it is shown as written.
    if (seen.has(key) || !known.includes(key)) {
      passThrough(sub.title, sub.html);
      continue;
    }
    seen.add(key);
    const body = stripTemplateNotes(sub.html, cfg.templateNotes);
    let left;
    if (key === 'core') {
      const read = readAttributes(body, {
        intercept: (label, value) => {
          if (!/^level$/i.test(label) || level) return false;
          level = filled(value);
          return true;
        },
      });
      core = read.rows;
      left = read.left;
    } else if (key === 'combat') {
      const read = readAttributes(body, { mergeHp: true });
      combat = read.rows;
      left = read.left;
    } else {
      left = consumeTable(body, cfg.abilityColumns, cells => {
        const key3 = abilityKey(cells[0]);
        const ability = key3 && !abilities[key3] ? cfg.readAbility(cells) : null;
        if (!ability) return false;
        abilities[key3] = ability;
        return true;
      });
    }
    passThrough(sub.title, left);
  }

  const bits = [
    level ? `Level ${level}` : '',
    ...cfg.headerFields.map(label => boldField(backgroundHtml, label)),
  ].filter(Boolean);
  if (bits.length) parts.push(`<div class="dnd-header">${bits.map(b => `<span>${escapeHtml(b)}</span>`).join('')}</div>`);

  const abilityHtml = renderAbilities(abilities);
  if (abilityHtml) parts.push(abilityHtml);
  if (combat.length) parts.push(tiles(combat, 'dnd-vitals'));
  if (core.length) parts.push(tiles(core));

  return parts.concat(extras).join('\n');
}

function renderSkills(section, cfg) {
  const items = [];
  const body = stripTemplateNotes(section.html, cfg.templateNotes);
  const left = consumeTable(body, cfg.skillColumns, cells => {
    const skill = cfg.readSkill(cells);
    if (!skill) return false;
    if (skill.skip) return true;
    const cls = `dnd-skill${skill.proficient ? ' is-proficient' : ''}${skill.expert ? ' is-expert' : ''}`;
    const title = skill.mark ? ` title="${escapeHtml(skill.mark)}" aria-label="${escapeHtml(skill.mark)}"` : '';
    const rank = skill.rank ? `<span class="skill-rank"${title}>${escapeHtml(skill.rank)}</span>` : '';
    items.push(`<li class="${cls}"><span class="skill-mark"${rank ? '' : title}></span><span class="skill-name">${escapeHtml(skill.name)}</span>${rank}<span class="skill-ability">${escapeHtml(skill.ability || '')}</span><span class="skill-mod">${escapeHtml(skill.modifier || '')}</span></li>`);
    return true;
  });
  if (items.length === 0 && !left) return '';
  return [
    '<h3>Skills</h3>',
    items.length ? `<ul class="dnd-skills">${items.join('\n')}</ul>` : '',
    left,
  ].filter(Boolean).join('\n');
}

function renderSpellcasting(section, cfg) {
  const stats = [];
  // The template's own instruction is not content; an author's blockquote is.
  const top = stripTemplateNotes(aboveSubheadings(section.html), cfg.templateNotes);
  const topLeft = consumeTable(top, ATTRIBUTE_COLUMNS, ([label, value]) => {
    // The template's own rows are left out while blank.
    if (value || !cfg.spellStatLabels.test(label)) stats.push([label, value]);
    return true;
  });

  let slots = [];
  const rest = [];
  const seen = new Set();
  for (const sub of subsections(section.html)) {
    const key = sub.title.toLowerCase();
    const first = !seen.has(key);
    seen.add(key);
    if (key === 'spell slots' && first) {
      const read = readSlots(sub.html, cfg.slotColumns, cfg.slotLevel);
      slots = read.slots.map(([level, value]) => [cfg.slotLabel(level), value]);
      if (read.left) rest.push(`<h4>Spell Slots, as written</h4>${read.left}`);
      continue;
    }
    let body = sub.html;
    const special = first && cfg.spellSubsections && cfg.spellSubsections[key];
    if (special) {
      const read = special(body);
      stats.push(...read.rows);
      body = read.left;
    }
    body = stripTemplatePlaceholders(body, cfg.placeholders);
    if (hasContent(body)) rest.push(`<h4>${escapeHtml(sub.title)}</h4>${body}`);
  }

  if (stats.length === 0 && slots.length === 0 && !topLeft && rest.length === 0) return '';
  return [
    '<h3>Spellcasting</h3>',
    tiles(stats),
    topLeft,
    slots.length ? `<h4>Spell Slots <span class="dnd-caption">remaining / total</span></h4>\n${tiles(slots, 'dnd-slots')}` : '',
    ...rest,
  ].filter(Boolean).join('\n');
}

function renderProficiencies(section, cfg) {
  const body = stripTemplatePlaceholders(section.html, cfg.placeholders);
  return hasContent(body) ? `<h3>Proficiencies</h3>\n<div class="dnd-proficiency-list">${body}</div>` : '';
}

const SECTION_RENDERERS = {
  skills: renderSkills,
  spellcasting: renderSpellcasting,
  proficiencies: renderProficiencies,
};

function renderD20Sheet(frontmatter, sections, cfg) {
  const reader = sectionReader(sections);

  const parts = [];
  const background = reader.first('background');
  const statSheet = renderStatSheet(reader.first('stat sheet'), background ? background.html : '', cfg);
  if (statSheet) parts.push(statSheet);
  parts.push(...reader.repeats('stat sheet'));

  for (const title of ['skills', 'spellcasting', 'proficiencies']) {
    const first = reader.first(title);
    const html = first ? SECTION_RENDERERS[title](first, cfg) : '';
    if (html) parts.push(html);
    parts.push(...reader.repeats(title));
  }

  if (parts.length === 0) return null;
  return `<div class="${cfg.sheetClass}">${parts.join('\n')}</div>`;
}

module.exports = { renderD20Sheet, CONSUMED_TITLES, ABILITIES };
