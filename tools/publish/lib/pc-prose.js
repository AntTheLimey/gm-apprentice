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

// Frontmatter fields each system's sheet renderer used to accept as a second
// source of stats. They are no longer read (the note body is the only source);
// a PC that still carries one is told so. Per system: a field is listed for
// the systems whose renderer read it, so a CoC PC is never told about a GURPS
// field. Identity and header fields (occupation, age, status, point_total and
// the like) are not here: they are still read. CoC read none.
const RETIRED_BY_SYSTEM = {
  gurps: [
    'attributes', 'secondary', 'skills', 'senses', 'defenses', 'encumbrance', 'reactions',
    'cultural', 'languages', 'spells', 'points', 'melee', 'ranged', 'grimoire',
    'techniques', 'chains', 'loadouts',
    'advantages', 'disadvantages', 'perks', 'quirks', 'templates', 'appearance', 'identity',
  ],
  dnd: ['ability_scores', 'class_features', 'spell_slots', 'proficiencies'],
  pf2e: ['attributes', 'class_features', 'spell_slots', 'hero_points', 'skill_proficiencies'],
  fitd: ['action_ratings', 'stress', 'trauma', 'special_abilities', 'load'],
};

// The union, for a caller that wants every name.
const RETIRED_SHEET_FIELDS = [...new Set(Object.values(RETIRED_BY_SYSTEM).flat())];

// The retired fields `frontmatter` carries, for a campaign's `system` (the
// publishConfig.system the renderers pick a sheet by, aliases included).
// Unknown or generic system, or no frontmatter: [].
function retiredSheetFieldsFor(frontmatter, system) {
  // Lazy: the templates require processor.js, which requires this file.
  const { getSheetFamily } = require('./templates/pc-registry');
  const family = getSheetFamily(system);
  if (!family || !frontmatter || typeof frontmatter !== 'object') return [];
  return RETIRED_BY_SYSTEM[family].filter((f) => Object.prototype.hasOwnProperty.call(frontmatter, f));
}

// The one wording, for the build's closing warning and for vault_check's row.
function retiredSheetFieldsMessage(names) {
  return `frontmatter field(s) ${names.join(', ')} are no longer read for the character sheet — move the values into the note's ## Stat Sheet sections`;
}

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

module.exports = {
  PC_PROSE_SECTIONS, RETIRED_BY_SYSTEM, RETIRED_SHEET_FIELDS, retiredSheetFieldsFor, retiredSheetFieldsMessage,
  pcKeepList, bareSectionTitle,
};
