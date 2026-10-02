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

module.exports = { PC_PROSE_SECTIONS, pcKeepList, bareSectionTitle };
