const { escapeHtml } = require('../processor');
const { parseTableRows, parseTables, findSectionByTitle, extractSubsectionHtml, aboveSubheadings } = require('./gurps/tables');

const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

// `### ` subsections of `## Stat Sheet` the sheet places itself. Any other
// subsection is passed through whole so nothing an author adds is dropped.
const STAT_SUBSECTIONS = ['core', 'ability scores', 'combat'];

function abilityMod(score) {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : String(mod);
}

function isYes(cell) {
  return /^(yes|y|true|x|✓|✔|●)$/i.test(String(cell || '').trim());
}

// A template placeholder (`{Species name}`) is not a value.
function filled(text) {
  const s = String(text == null ? '' : text).trim();
  return s && !/^\{[^}]*\}$/.test(s) && s !== '—' ? s : '';
}

function statItem(label, value) {
  return `<div class="stat-item"><span class="stat-label">${escapeHtml(label)}</span><span class="stat-value">${escapeHtml(value || '—')}</span></div>`;
}

// Body rows of a two-column Attribute/Value table, header row dropped.
function attributeRows(html) {
  return parseTableRows(html || '')
    .filter(r => r[0] && !/^attribute$/i.test(r[0]))
    .map(r => [r[0], r[1] || '']);
}

// Each `### ` subsection as { title, html }, in document order.
function subsections(sectionHtml) {
  const out = [];
  const re = /<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3[ >]|$)/gi;
  let m;
  while ((m = re.exec(sectionHtml || '')) !== null) {
    out.push({ title: m[1].replace(/<[^>]+>/g, '').trim(), html: m[2] });
  }
  return out;
}

// `**Species:** Elf` in a rendered section -> 'Elf'.
function boldField(html, label) {
  const re = new RegExp(`<strong>\\s*${label}\\s*:?\\s*</strong>\\s*:?([\\s\\S]*?)(?=<strong>|<br|</p>|$)`, 'i');
  const m = String(html || '').match(re);
  return m ? filled(m[1].replace(/<[^>]+>/g, '')) : '';
}

function hasText(html) {
  return String(html || '').replace(/<[^>]+>/g, '').trim().length > 0;
}

function parseAbilities(statHtml) {
  const abilities = {};
  for (const row of parseTableRows(extractSubsectionHtml(statHtml, 'Ability Scores'))) {
    const key = (row[0] || '').trim().toUpperCase();
    if (!ABILITIES.includes(key)) continue;
    const score = (row[1] || '').trim();
    const n = parseInt(score, 10);
    abilities[key] = {
      score,
      mod: (row[2] || '').trim() || (Number.isFinite(n) ? abilityMod(n) : ''),
      save: isYes(row[3]),
    };
  }
  return abilities;
}

function renderHeader(coreRows, backgroundHtml) {
  const level = filled((coreRows.find(r => /^level$/i.test(r[0])) || [])[1]);
  const bits = [
    level ? `Level ${level}` : '',
    boldField(backgroundHtml, 'Class(?:\\s*/\\s*Subclass)?'),
    boldField(backgroundHtml, 'Species'),
    boldField(backgroundHtml, 'Background'),
  ].filter(Boolean);
  if (bits.length === 0) return '';
  return `<div class="dnd-header">${bits.map(b => `<span>${escapeHtml(b)}</span>`).join('')}</div>`;
}

function renderAbilities(abilities) {
  const cards = ABILITIES.filter(a => abilities[a]).map(a => {
    const { score, mod, save } = abilities[a];
    const saveMark = save ? '\n  <span class="ability-save" title="Saving throw proficiency">Save</span>' : '';
    return `<div class="dnd-ability-card${save ? ' has-save' : ''}">
  <span class="ability-name">${a}</span>
  <span class="ability-score">${escapeHtml(String(score))}</span>
  <span class="ability-mod">${escapeHtml(mod)}</span>${saveMark}
</div>`;
  }).join('\n');
  return cards ? `<div class="dnd-ability-scores">${cards}</div>` : '';
}

// Core and Combat rows as stat tiles, in sheet order. Level sits in the header;
// the two HP rows merge into one "current / max" tile.
function renderVitals(coreRows, combatRows) {
  const hp = { cur: '', max: '' };
  let hpSeen = false;
  const combat = [];
  for (const [label, value] of combatRows) {
    const m = label.match(/^HP\s*\(\s*(current|max)\w*\s*\)$/i);
    if (!m) { combat.push([label, value]); continue; }
    hp[m[1].toLowerCase() === 'max' ? 'max' : 'cur'] = value.trim();
    if (!hpSeen) { combat.push(['HP', null]); hpSeen = true; }
  }
  const hpText = hp.cur && hp.max ? `${hp.cur} / ${hp.max}` : (hp.cur || hp.max);
  const tiles = rows => rows.map(([label, value]) => statItem(label, value === null ? hpText : value.trim())).join('\n');
  const core = coreRows.filter(r => !/^level$/i.test(r[0]));
  return [
    combat.length ? `<div class="quick-stats dnd-vitals">${tiles(combat)}</div>` : '',
    core.length ? `<div class="quick-stats">${tiles(core)}</div>` : '',
  ].filter(Boolean).join('\n');
}

function renderSkills(section) {
  if (!section) return '';
  const rows = parseTableRows(section.html).filter(r => r[0] && !/^skill$/i.test(r[0]));
  if (rows.length === 0) {
    return hasText(section.html) ? `<h3>Skills</h3>\n${section.html}` : '';
  }
  const items = rows.map(([name, ability, proficient, expertise, modifier]) => {
    const expert = isYes(expertise);
    const prof = expert || isYes(proficient);
    const cls = `dnd-skill${prof ? ' is-proficient' : ''}${expert ? ' is-expert' : ''}`;
    const mark = expert ? 'Expertise' : (prof ? 'Proficient' : '');
    return `<li class="${cls}"><span class="skill-mark"${mark ? ` title="${mark}" aria-label="${mark}"` : ''}></span><span class="skill-name">${escapeHtml(name)}</span><span class="skill-ability">${escapeHtml(ability || '')}</span><span class="skill-mod">${escapeHtml(modifier || '')}</span></li>`;
  }).join('\n');
  // Tables kept beside the skill list (a second, differently-shaped table) and
  // any prose are passed through below it.
  const extra = section.html.replace(/<table[^>]*>[\s\S]*?<\/table>/i, '');
  return `<h3>Skills</h3>\n<ul class="dnd-skills">${items}</ul>${hasText(extra) ? '\n' + extra : ''}`;
}

function renderSpellcasting(section) {
  if (!section) return '';
  const top = aboveSubheadings(section.html);
  const stats = attributeRows(top).filter(([, v]) => filled(v));

  const subs = subsections(section.html);
  const slotsSub = subs.find(s => /^spell slots$/i.test(s.title));
  const slots = parseTableRows(slotsSub ? slotsSub.html : '')
    .filter(r => r[0] && !/^level$/i.test(r[0]) && filled(r[1]))
    .map(([level, total, expended]) => {
      const t = parseInt(total, 10);
      const e = parseInt(expended, 10) || 0;
      return statItem(level, Number.isFinite(t) ? `${Math.max(t - e, 0)} / ${t}` : total);
    });

  // Everything else in the section — prepared spells, author notes, extra
  // subsections — is passed through. The template's own "Omit this section"
  // instruction and unfilled `{list}` lines are not content.
  const rest = [
    top.replace(/<table[^>]*>[\s\S]*?<\/table>/i, '')
      .replace(/<blockquote>(?:(?!<\/blockquote>)[\s\S])*Omit this section[\s\S]*?<\/blockquote>/i, ''),
    ...subs.filter(s => s !== slotsSub).map(s => {
      const body = s.html.replace(/<p>(?:\s*<strong>[^<]*<\/strong>)?\s*\{[^}]*\}\s*<\/p>/g, '');
      return hasText(body) ? `<h4>${escapeHtml(s.title)}</h4>${body}` : '';
    }),
  ].filter(hasText).join('\n');

  if (stats.length === 0 && slots.length === 0 && !rest) return '';
  return [
    '<h3>Spellcasting</h3>',
    stats.length ? `<div class="quick-stats">${stats.map(([l, v]) => statItem(l, v.trim())).join('\n')}</div>` : '',
    slots.length ? `<h4>Spell Slots <span class="dnd-caption">remaining / total</span></h4>\n<div class="quick-stats dnd-slots">${slots.join('\n')}</div>` : '',
    rest,
  ].filter(Boolean).join('\n');
}

function renderProficiencies(section) {
  if (!section) return '';
  const body = section.html.replace(/<p>\s*<strong>[^<]*<\/strong>\s*\{[^}]*\}\s*<\/p>/g, '');
  return hasText(body) ? `<h3>Proficiencies</h3>\n<div class="dnd-proficiency-list">${body}</div>` : '';
}

// The body sections follow skills/shared/templates/pc-dnd-5e-2024.md. Every
// section this consumes (DND_CONSUMED_TITLES in pc.js) is rendered in full:
// what it cannot place structurally it passes through as-is.
function renderDnDSheet(frontmatter, sections) {
  sections = sections || [];
  const parts = [];

  const statSheet = findSectionByTitle(sections, 'Stat Sheet');
  const statHtml = statSheet ? statSheet.html : '';
  const coreRows = attributeRows(extractSubsectionHtml(statHtml, 'Core'));
  const combatRows = attributeRows(extractSubsectionHtml(statHtml, 'Combat'));
  const background = findSectionByTitle(sections, 'Background');

  const header = renderHeader(coreRows, background ? background.html : '');
  if (header) parts.push(header);

  let abilities = parseAbilities(statHtml);
  if (Object.keys(abilities).length === 0) {
    const scores = frontmatter.ability_scores || {};
    abilities = Object.fromEntries(ABILITIES
      .filter(a => scores[a] !== undefined)
      .map(a => [a, { score: scores[a], mod: abilityMod(scores[a]), save: false }]));
  }
  const abilityHtml = renderAbilities(abilities);
  if (abilityHtml) parts.push(abilityHtml);

  const vitals = renderVitals(coreRows, combatRows);
  if (vitals) parts.push(vitals);

  const topOfStat = aboveSubheadings(statHtml);
  if (hasText(topOfStat)) parts.push(topOfStat);
  for (const sub of subsections(statHtml)) {
    if (STAT_SUBSECTIONS.includes(sub.title.toLowerCase()) || !hasText(sub.html)) continue;
    parts.push(`<h3>${escapeHtml(sub.title)}</h3>\n${sub.html}`);
  }

  const skills = renderSkills(findSectionByTitle(sections, 'Skills'));
  if (skills) parts.push(skills);

  const spellSection = findSectionByTitle(sections, 'Spellcasting');
  const spellcasting = renderSpellcasting(spellSection);
  if (spellcasting) parts.push(spellcasting);

  const profSection = findSectionByTitle(sections, 'Proficiencies');
  const proficiencies = renderProficiencies(profSection);
  if (proficiencies) parts.push(proficiencies);

  // Frontmatter fallback, for a vault that keeps these there instead.
  const fmProficiencies = frontmatter.proficiencies || [];
  if (!profSection && fmProficiencies.length > 0) {
    const pills = fmProficiencies.map(p =>
      `<span class="dnd-proficiency">${escapeHtml(String(p))}</span>`
    ).join('\n');
    parts.push(`<h3>Proficiencies</h3>\n<div class="dnd-proficiencies">${pills}</div>`);
  }

  const features = [...(frontmatter.class_features || [])];
  if (features.length > 0) {
    const items = features
      .sort((a, b) => (a.level || 0) - (b.level || 0))
      .map(f => {
        const levelBadge = f.level ? `<span class="sidebar-badge">Level ${f.level}</span>` : '';
        const desc = f.description ? `<div class="card-excerpt">${escapeHtml(f.description)}</div>` : '';
        return `<div class="entity-card"><h4>${escapeHtml(f.name || String(f))} ${levelBadge}</h4>${desc}</div>`;
      }).join('\n');
    parts.push(`<h3>Class Features</h3>\n<div class="card-grid">${items}</div>`);
  }

  const spellSlots = frontmatter.spell_slots;
  if (!spellSection && spellSlots && Object.keys(spellSlots).length > 0) {
    const rows = Object.entries(spellSlots)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([level, slots]) => statItem(`Level ${level}`, String(slots)))
      .join('\n');
    parts.push(`<h3>Spell Slots</h3>\n<div class="quick-stats">${rows}</div>`);
  }

  if (parts.length === 0) return null;
  return `<div class="dnd-sheet">${parts.join('\n')}</div>`;
}

module.exports = { renderDnDSheet };
