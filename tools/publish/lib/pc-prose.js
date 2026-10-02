// tools/publish/lib/pc-prose.js
// The `##` sections of a PC note that still publish when character sheets are off.
// A keep-list: anything not named here is withheld, so a homebrew stat section
// never reaches the site by being unknown.
const PC_PROSE_SECTIONS = [
  'Background', 'Current Status', 'Notes', 'Relationships', 'Appearances',
  // CoC
  'Fellow Investigators', 'Encounters with Strange Entities',
  // FitD
  'Friends & Rivals', 'Long-Term Projects',
];

// Frontmatter fields the sheet renderers used to accept as a second source of
// stats. They are no longer read (the note body is the only source); explain
// reports a PC that still carries one. Identity and header fields (occupation,
// age, status, point_total and the like) are not here: they are still read.
const RETIRED_SHEET_FIELDS = [
  // GURPS
  'attributes', 'secondary', 'skills', 'senses', 'defenses', 'encumbrance', 'reactions',
  'cultural', 'languages', 'spells', 'points', 'melee', 'ranged', 'grimoire',
  'techniques', 'chains', 'loadouts',
  'advantages', 'disadvantages', 'perks', 'quirks', 'templates', 'appearance', 'identity',
  // D&D, PF2e
  'abilities', 'ability_scores', 'class_features', 'spell_slots', 'proficiencies', 'hero_points',
  'skill_proficiencies',
  // FitD
  'action_ratings', 'stress', 'trauma', 'special_abilities', 'load',
];

// A heading's title with its dressing removed, lower-cased: `**Background**`,
// `*Background*`, `Background:` and `background` are one section. The document
// rule and the keep-list both compare through this, so a spelling is never the
// way a section reaches the site.
function bareSectionTitle(title) {
  const lower = String(title).trim().toLowerCase();
  const unwrap = (t) => t.replace(/^(\*\*|\*|__|_)(.+)\1$/, '$2').trim();
  const unColon = (t) => t.replace(/:$/, '').trim();
  return unColon(unwrap(unColon(lower)));
}

// null when sheets are on (no rule). Otherwise the built-in list plus the GM's
// publish.pc_prose_sections: text entries only, anything else is ignored. An
// injected publishConfig without `switches` (a test seam) means sheets on.
function pcKeepList(publishConfig) {
  const switches = publishConfig && publishConfig.switches;
  if (!switches || switches.characterSheets !== false) return null;
  const extra = Array.isArray(publishConfig.pc_prose_sections)
    ? publishConfig.pc_prose_sections.filter((s) => typeof s === 'string')
    : [];
  return [...PC_PROSE_SECTIONS, ...extra];
}

module.exports = { PC_PROSE_SECTIONS, RETIRED_SHEET_FIELDS, pcKeepList, bareSectionTitle };
