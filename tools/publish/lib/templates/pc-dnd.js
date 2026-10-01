const { escapeHtml } = require('../processor');
const { decodeEntities, normalizeTitle, aboveSubheadings } = require('./gurps/tables');

const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const ABILITY_NAME = /^(str(?:ength)?|dex(?:terity)?|con(?:stitution)?|int(?:elligence)?|wis(?:dom)?|cha(?:risma)?)$/i;

// `## ` sections the sheet takes over from the accordion list. The contract,
// which pc.js relies on: whenever renderDnDSheet returns HTML, every section
// with one of these titles is on the sheet in full. What the sheet cannot place
// structurally — a row with an extra column, prose under a table, a repeated
// section, an unknown `### ` subsection — is passed through as written.
// Background is read for the header but is not consumed: its prose stays an
// accordion, as do Class Features, Species Traits and Feats.
const CONSUMED_TITLES = ['stat sheet', 'skills', 'spellcasting', 'proficiencies'];

function isDndConsumedTitle(title) {
  return CONSUMED_TITLES.includes(normalizeTitle(title));
}

function abilityMod(score) {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : String(mod);
}

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
const ATTRIBUTE_COLUMNS = [/^(attribute|stat|field|name)$/i, /^value$/i];
const ABILITY_COLUMNS = [/^abilit/i, /^score$/i, /^mod/i, /^sav/i];
const SKILL_COLUMNS = [/^skills?$/i, /^abilit/i, /^prof/i, /^expert/i, /^(mod|bonus)/i];
const SLOT_COLUMNS = [/^(spell )?level$/i, /^(total|max)$/i, /^(expended|used|spent)$/i];

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
    const cells = cellsOf(rowMatch[1]);
    if (cells.every(c => !c)) continue;
    const fits = known && cells.slice(cols).every(c => !c);
    if (!(fits && place(cells.slice(0, cols)))) unplaced.push(rowMatch[0]);
  }

  const rest = source.replace(tableMatch[0], '');
  return [
    unplaced.length ? `<table>${theadMatch ? theadMatch[0] : ''}<tbody>${unplaced.join('')}</tbody></table>` : '',
    hasContent(rest) ? rest : '',
  ].filter(Boolean).join('\n');
}

// The template's own unfilled lines (`**Tools:** {list}`), wherever they sit in
// a paragraph. Only the template's exact placeholders: braces an author wrote
// are content.
function stripTemplatePlaceholders(html) {
  return String(html || '')
    .replace(/(?:<strong>[^<]*<\/strong>\s*)?\{(?:list|Continue per level as needed\.)\}[ \t]*\n?/g, '')
    .replace(/<p>\s*<\/p>/g, '');
}

// `**Species:** Elf` in a rendered section -> 'Elf'.
function boldField(html, label) {
  const re = new RegExp(`<strong>\\s*${label}\\s*:?\\s*</strong>\\s*:?([\\s\\S]*?)(?=<br|</p>|\\n|$)`, 'i');
  const m = String(html || '').match(re);
  return m ? filled(cellText(m[1])) : '';
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

// `## Stat Sheet`: header level, ability cards, Core and Combat tiles.
function renderStatSheet(section, frontmatter, backgroundHtml) {
  const html = section ? section.html : '';
  const parts = [];
  const extras = [];
  const passThrough = (title, body) => { if (hasContent(body)) extras.push(`<h3>${escapeHtml(title)}</h3>\n${body}`); };

  let level = '';
  let abilities = {};
  const core = [];
  const combat = [];
  const hp = { cur: '', max: '' };
  const hpSeen = { cur: false, max: false };
  const seen = new Set();

  if (hasContent(aboveSubheadings(html))) extras.push(aboveSubheadings(html));
  for (const sub of subsections(html)) {
    const key = sub.title.toLowerCase();
    // A repeated subsection is not merged into the first; it is shown as written.
    if (seen.has(key) || !['core', 'ability scores', 'combat'].includes(key)) {
      passThrough(sub.title, sub.html);
      continue;
    }
    seen.add(key);
    let left = '';
    if (key === 'core') {
      left = consumeTable(sub.html, ATTRIBUTE_COLUMNS, ([label, value]) => {
        if (/^level$/i.test(label) && !level) level = filled(value);
        else core.push([label, value]);
        return true;
      });
    } else if (key === 'combat') {
      left = consumeTable(sub.html, ATTRIBUTE_COLUMNS, ([label, value]) => {
        const m = label.match(/^HP\s*\(\s*(current|max)\w*\s*\)$/i);
        if (!m) { combat.push([label, value]); return true; }
        const slot = m[1].toLowerCase() === 'max' ? 'max' : 'cur';
        if (hpSeen[slot]) return false;
        if (!hpSeen.cur && !hpSeen.max) combat.push(['HP', null]);
        hpSeen[slot] = true;
        hp[slot] = value;
        return true;
      });
    } else {
      left = consumeTable(sub.html, ABILITY_COLUMNS, ([name, score, mod, save]) => {
        const m = name.match(ABILITY_NAME);
        const key3 = m ? m[1].slice(0, 3).toUpperCase() : '';
        const proficient = yesNo(save);
        if (!key3 || abilities[key3] || proficient === null) return false;
        const n = parseInt(score, 10);
        abilities[key3] = { score, mod: mod || (Number.isFinite(n) ? abilityMod(n) : ''), save: proficient };
        return true;
      });
    }
    passThrough(sub.title, left);
  }

  // Frontmatter fallback, for a vault that keeps its scores there instead.
  if (Object.keys(abilities).length === 0) {
    for (const [name, score] of Object.entries(frontmatter.ability_scores || {})) {
      const key3 = String(name).toUpperCase();
      if (!ABILITIES.includes(key3)) continue;
      abilities[key3] = { score, mod: Number.isFinite(Number(score)) ? abilityMod(Number(score)) : '', save: false };
    }
  }

  const bits = [
    level ? `Level ${level}` : '',
    boldField(backgroundHtml, 'Class(?:es)?(?:\\s*/\\s*Subclass(?:es)?)?'),
    boldField(backgroundHtml, '(?:Species|Race)'),
    boldField(backgroundHtml, 'Background'),
  ].filter(Boolean);
  if (bits.length) parts.push(`<div class="dnd-header">${bits.map(b => `<span>${escapeHtml(b)}</span>`).join('')}</div>`);

  const abilityHtml = renderAbilities(abilities);
  if (abilityHtml) parts.push(abilityHtml);

  const hpText = hp.max ? `${hp.cur || '—'} / ${hp.max}` : hp.cur;
  const tiles = rows => rows.map(([label, value]) => statItem(label, value === null ? hpText : value)).join('\n');
  if (combat.length) parts.push(`<div class="quick-stats dnd-vitals">${tiles(combat)}</div>`);
  if (core.length) parts.push(`<div class="quick-stats">${tiles(core)}</div>`);

  return parts.concat(extras).join('\n');
}

function renderSkills(section) {
  const items = [];
  const left = consumeTable(section.html, SKILL_COLUMNS, ([name, ability, proficient, expertise, modifier]) => {
    const prof = yesNo(proficient);
    const expert = yesNo(expertise);
    if (!name || prof === null || expert === null) return false;
    const cls = `dnd-skill${prof || expert ? ' is-proficient' : ''}${expert ? ' is-expert' : ''}`;
    const mark = expert ? 'Expertise' : (prof ? 'Proficient' : '');
    items.push(`<li class="${cls}"><span class="skill-mark"${mark ? ` title="${mark}" aria-label="${mark}"` : ''}></span><span class="skill-name">${escapeHtml(name)}</span><span class="skill-ability">${escapeHtml(ability || '')}</span><span class="skill-mod">${escapeHtml(modifier || '')}</span></li>`);
    return true;
  });
  if (items.length === 0 && !left) return '';
  return [
    '<h3>Skills</h3>',
    items.length ? `<ul class="dnd-skills">${items.join('\n')}</ul>` : '',
    left,
  ].filter(Boolean).join('\n');
}

function renderSpellcasting(section) {
  const stats = [];
  // The template's own instruction is not content; an author's blockquote is.
  const top = aboveSubheadings(section.html).replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi,
    (whole, inner) => (/^Omit this section if the character has no spellcasting\.?$/i.test(cellText(inner)) ? '' : whole));
  const topLeft = consumeTable(top, ATTRIBUTE_COLUMNS, ([label, value]) => {
    if (value) stats.push(statItem(label, value));
    return true;
  });

  const slots = [];
  const rest = [];
  let slotsSeen = false;
  for (const sub of subsections(section.html)) {
    let body;
    if (/^spell slots$/i.test(sub.title) && !slotsSeen) {
      slotsSeen = true;
      body = consumeTable(sub.html, SLOT_COLUMNS, ([level, total, expended]) => {
        if (!total && !expended) return true;            // an unused level
        if (!/^\d+$/.test(total) || !/^\d*$/.test(expended)) return false;
        const t = parseInt(total, 10);
        const e = parseInt(expended, 10) || 0;
        if (e > t) return false;
        slots.push(statItem(level, `${t - e} / ${t}`));
        return true;
      });
      if (body) rest.push(`<h4>Spell Slots, as written</h4>${body}`);
      continue;
    }
    body = stripTemplatePlaceholders(sub.html);
    if (hasContent(body)) rest.push(`<h4>${escapeHtml(sub.title)}</h4>${body}`);
  }

  if (stats.length === 0 && slots.length === 0 && !topLeft && rest.length === 0) return '';
  return [
    '<h3>Spellcasting</h3>',
    stats.length ? `<div class="quick-stats">${stats.join('\n')}</div>` : '',
    topLeft,
    slots.length ? `<h4>Spell Slots <span class="dnd-caption">remaining / total</span></h4>\n<div class="quick-stats dnd-slots">${slots.join('\n')}</div>` : '',
    ...rest,
  ].filter(Boolean).join('\n');
}

function renderProficiencies(section) {
  const body = stripTemplatePlaceholders(section.html);
  return hasContent(body) ? `<h3>Proficiencies</h3>\n<div class="dnd-proficiency-list">${body}</div>` : '';
}

const SECTION_RENDERERS = {
  skills: renderSkills,
  spellcasting: renderSpellcasting,
  proficiencies: renderProficiencies,
};

// The body sections follow skills/shared/templates/pc-dnd-5e-2024.md
// (docs/file-format-standards.md §9).
function renderDnDSheet(frontmatter, sections) {
  frontmatter = frontmatter || {};
  sections = sections || [];
  const byTitle = title => sections.filter(s => normalizeTitle(s.title) === title);
  // The first section of a title is read structurally; a repeat is shown as written.
  const repeats = title => byTitle(title).slice(1)
    .filter(s => hasContent(s.html))
    .map(s => `<h3>${escapeHtml(s.title)}</h3>\n${s.html}`);

  const parts = [];
  const background = byTitle('background')[0];
  const statSheet = renderStatSheet(byTitle('stat sheet')[0], frontmatter, background ? background.html : '');
  if (statSheet) parts.push(statSheet);
  parts.push(...repeats('stat sheet'));

  const rendered = {};
  for (const title of ['skills', 'spellcasting', 'proficiencies']) {
    const first = byTitle(title)[0];
    rendered[title] = first ? SECTION_RENDERERS[title](first) : '';
    if (rendered[title]) parts.push(rendered[title]);
    parts.push(...repeats(title));
  }

  // Frontmatter fallback, for a vault that keeps these there and not in the body.
  const fmProficiencies = [].concat(frontmatter.proficiencies || []);
  if (!rendered.proficiencies && fmProficiencies.length > 0) {
    const pills = fmProficiencies.map(p =>
      `<span class="dnd-proficiency">${escapeHtml(String(p))}</span>`
    ).join('\n');
    parts.push(`<h3>Proficiencies</h3>\n<div class="dnd-proficiencies">${pills}</div>`);
  }

  const features = [].concat(frontmatter.class_features || []);
  if (features.length > 0) {
    const items = features
      .filter(f => f && (typeof f === 'string' || f.name))
      .sort((a, b) => (a.level || 0) - (b.level || 0))
      .map(f => {
        const levelBadge = f.level ? `<span class="sidebar-badge">Level ${escapeHtml(String(f.level))}</span>` : '';
        const desc = f.description ? `<div class="card-excerpt">${escapeHtml(f.description)}</div>` : '';
        return `<div class="entity-card"><h4>${escapeHtml(String(f.name || f))} ${levelBadge}</h4>${desc}</div>`;
      }).join('\n');
    parts.push(`<h3>Class Features</h3>\n<div class="card-grid">${items}</div>`);
  }

  const spellSlots = frontmatter.spell_slots;
  if (!rendered.spellcasting && spellSlots && typeof spellSlots === 'object' && Object.keys(spellSlots).length > 0) {
    const rows = Object.entries(spellSlots)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([level, slots]) => statItem(`Level ${level}`, String(slots)))
      .join('\n');
    parts.push(`<h3>Spell Slots</h3>\n<div class="quick-stats">${rows}</div>`);
  }

  if (parts.length === 0) return null;
  return `<div class="dnd-sheet">${parts.join('\n')}</div>`;
}

module.exports = { renderDnDSheet, isDndConsumedTitle };
