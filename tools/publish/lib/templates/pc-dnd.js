const { yesNo, consumedTitleMatcher } = require('./sheet-parse');
const { renderD20Sheet, CONSUMED_TITLES } = require('./d20-sheet');

// `## ` sections the sheet takes over from the accordion list; each is on the
// sheet in full whenever renderDnDSheet returns HTML (sheet-parse.js).
// Background is read for the header but is not consumed: its prose stays an
// accordion, as do Class Features, Species Traits and Feats.
const isDndConsumedTitle = consumedTitleMatcher(CONSUMED_TITLES);

function abilityMod(score) {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : String(mod);
}

// The body sections follow skills/shared/templates/pc-dnd-5e-2024.md
// (docs/file-format-standards.md §9).
const DND = {
  sheetClass: 'dnd-sheet',
  abilitySubsection: 'ability scores',
  abilityColumns: [/^abilit/i, /^score$/i, /^mod/i, /^sav/i],
  // The modifier is the sheet's own; it is computed only when its cell is blank.
  readAbility: ([, score, mod, save]) => {
    const proficient = yesNo(save);
    if (proficient === null) return null;
    const n = parseInt(score, 10);
    return { score, mod: mod || (Number.isFinite(n) ? abilityMod(n) : ''), save: proficient };
  },
  headerFields: ['Class(?:es)?(?:\\s*/\\s*Subclass(?:es)?)?', '(?:Species|Race)', 'Background'],
  skillColumns: [/^skills?$/i, /^abilit/i, /^prof/i, /^expert/i, /^(mod|bonus)/i],
  readSkill: ([name, ability, proficient, expertise, modifier]) => {
    const prof = yesNo(proficient);
    const expert = yesNo(expertise);
    if (!name || prof === null || expert === null) return null;
    return { name, ability, modifier, proficient: prof || expert, expert, mark: expert ? 'Expertise' : (prof ? 'Proficient' : '') };
  },
  spellStatLabels: /^(spellcasting ability|spell attack modifier|spell save dc)$/i,
  slotColumns: [/^(spell )?level$/i, /^(total|max)$/i, /^(expended|used|spent)$/i],
  slotLevel: /^(\d+(st|nd|rd|th)?|cantrips?)$/i,
  slotLabel: level => level,
  slotWord: 'Level',
  placeholders: ['list', 'Continue per level as needed.'],
  templateNotes: [/^Omit this section if the character has no spellcasting\.?$/i],
};

function renderDnDSheet(frontmatter, sections) {
  return renderD20Sheet(frontmatter, sections, DND);
}

module.exports = { renderDnDSheet, isDndConsumedTitle };
