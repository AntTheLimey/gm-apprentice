const { escapeHtml } = require('../processor');
const { cellText, hasContent, consumedTitleMatcher } = require('./sheet-parse');
const { renderD20Sheet, CONSUMED_TITLES } = require('./d20-sheet');

// `## ` sections the sheet takes over from the accordion list; each is on the
// sheet in full whenever renderPF2eSheet returns HTML (sheet-parse.js).
// Background is read for the header but stays an accordion, as do Class
// Features and the feat sections.
const isPF2eConsumedTitle = consumedTitleMatcher(CONSUMED_TITLES);

const RANKS = { u: 'Untrained', t: 'Trained', e: 'Expert', m: 'Master', l: 'Legendary' };

// 'T' or 'Trained' -> 't'; '' when the cell says something else.
function rankKey(cell) {
  const s = String(cell || '').trim().toLowerCase();
  if (!s) return 'u';
  if (RANKS[s]) return s;
  const found = Object.keys(RANKS).find(k => RANKS[k].toLowerCase() === s);
  return found || '';
}

function signedMod(value) {
  const mod = Number(value);
  if (!Number.isFinite(mod)) return String(value);
  return mod >= 0 ? `+${mod}` : String(mod);
}

// `### Focus Spells` opens with a one-row table whose second header cell holds
// the points: `| Focus Points (Current/Max) | 1/2 |`. Anything else is left.
function readFocusPoints(html) {
  const table = String(html || '').match(/<table[^>]*>\s*<thead[^>]*>([\s\S]*?)<\/thead>([\s\S]*?)<\/table>/i);
  if (!table || hasContent(table[2])) return { rows: [], left: html };
  const cells = [...table[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(m => cellText(m[1]));
  const plain = !/<(a|img)[ >]/i.test(table[1]);
  if (!plain || cells.length > 2 || !/^focus points/i.test(cells[0] || '')) return { rows: [], left: html };
  return { rows: cells[1] ? [[cells[0], cells[1]]] : [], left: html.replace(table[0], '') };
}

// The body sections follow skills/shared/templates/pc-pf2e.md
// (docs/file-format-standards.md §10).
const PF2E = {
  sheetClass: 'dnd-sheet pf2e-sheet',
  abilitySubsection: 'attributes',
  abilityColumns: [/^(attribute|abilit)/i, /^mod/i],
  // Remaster attributes are modifiers; the card's figure is the modifier.
  readAbility: ([, mod]) => ({ score: mod, mod: '', save: false }),
  abilityField: 'attributes',
  abilityFromFrontmatter: value => ({ score: signedMod(value), mod: '', save: false }),
  headerFields: ['Class(?:es)?(?:\\s*/\\s*Subclass(?:es)?)?', 'Ancestry', 'Heritage', 'Background'],
  skillColumns: [/^skills?$/i, /^(attribute|abilit)/i, /^(rank|prof)/i, /^(mod|bonus)/i],
  readSkill: ([name, ability, rank, modifier]) => {
    const key = rankKey(rank);
    if (!name || !key) return null;
    // The template's unfilled Lore row.
    if (key === 'u' && /\{topic\}/.test(name)) return { skip: true };
    return {
      name, ability, modifier,
      proficient: key !== 'u', expert: false,
      rank: key.toUpperCase(), mark: RANKS[key],
    };
  },
  spellStatLabels: /^(tradition|prepared\s*\/\s*spontaneous|spell attack modifier|spell dc)$/i,
  slotColumns: [/^(spell )?(rank|level)$/i, /^(total|max)$/i, /^(expended|used|spent)$/i],
  slotLevel: /^(\d+(st|nd|rd|th)?|cantrips?)$/i,
  slotLabel: level => (/^\d+$/.test(level) ? `Rank ${level}` : level),
  slotWord: 'Rank',
  spellSubsections: { 'focus spells': readFocusPoints },
  placeholders: ['list', 'list with ranks', 'Continue per rank as needed.', 'Focus spell list, if any.'],
  templateNotes: [
    /^Omit this section if the character has no spellcasting\.?$/i,
    /^Remaster attributes are modifiers, not scores\.?$/i,
    /^Rank: U \(Untrained\), T \(Trained\), E \(Expert\), M \(Master\), L \(Legendary\)\.?$/i,
  ],
  fallbacks: (frontmatter, rendered) => {
    const out = [];
    const heroPoints = frontmatter.hero_points;
    // Wherever the body's Core table gave no Hero Points row.
    const onSheet = /<span class="stat-label">Hero Points<\/span>/i.test(rendered['stat sheet'] || '');
    if (!onSheet && heroPoints !== undefined && heroPoints !== null) {
      out.push(`<div class="quick-stats"><div class="stat-item"><span class="stat-label">Hero Points</span><span class="stat-value">${escapeHtml(String(heroPoints))}</span></div></div>`);
    }
    const skills = [].concat(frontmatter.skill_proficiencies || []).filter(Boolean);
    if (!rendered.skills && skills.length > 0) {
      const pills = skills.map(s => {
        if (typeof s === 'string') return `<span class="pf2e-proficiency">${escapeHtml(s)}</span>`;
        const rank = s.rank ? ` <span class="sidebar-badge">${escapeHtml(String(s.rank))}</span>` : '';
        return `<span class="pf2e-proficiency">${escapeHtml(String(s.name || ''))}${rank}</span>`;
      }).join('\n');
      out.push(`<h3>Skills</h3>\n<div class="pf2e-proficiencies">${pills}</div>`);
    }
    return out;
  },
};

function renderPF2eSheet(frontmatter, sections) {
  return renderD20Sheet(frontmatter, sections, PF2E);
}

module.exports = { renderPF2eSheet, isPF2eConsumedTitle };
