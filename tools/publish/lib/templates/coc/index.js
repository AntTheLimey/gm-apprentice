const { parseCoC } = require('./parse');
const { buildStatusBar, buildSheet, buildRecord, buildEquipment } = require('./layout');
const { buildCoCLiveData } = require('./live-data');
const { overflowNotes } = require('../gurps/tables');
const { COC_CONSUMED_TITLES } = require('../consumed-titles');
const { RECORD_SECTIONS } = require('./layout');

function renderCoCSheet(frontmatter, sections, meta) {
  const system = (meta && meta.system) || (frontmatter && frontmatter.system) || 'coc-7e';
  const model = parseCoC(frontmatter, sections || [], system);
  const statusBarHtml = buildStatusBar(model);

  // A legacy investigator sheet whose body diverges from the documented contract
  // (docs/file-format-standards.md §8) parses to a near-empty model — most tellingly no
  // characteristics from `## Stat Sheet → ### Characteristics`. The renderer is resilient
  // enough not to crash, so without this the sheet would ship mostly empty, silently. (#107)
  const warnings = [];
  if (!model.chars || Object.keys(model.chars).length === 0) {
    warnings.push('CoC investigator sheet parsed no characteristics — the body structure likely diverges from the documented contract (`## Stat Sheet` → `### Characteristics`; see docs/file-format-standards.md §8). The sheet will render mostly empty; convert it to the documented structure or run the CoC-sheet migration.');
  }

  return {
    // The folio always renders, so an empty one is flagged for the build's
    // "published with no character sheet" line (#273).
    sheetless: warnings.length > 0,
    sheetHtml: buildSheet(model, overflowNotes(sections, [...COC_CONSUMED_TITLES].filter(t => !RECORD_SECTIONS.some(r => r.toLowerCase() === t)))),
    recordHtml: buildRecord(model, sections || []),
    equipmentHtml: buildEquipment(model, sections || []),
    statusBarHtml,
    // No status bar → no mutable vitals → nothing to wire.
    liveData: statusBarHtml ? buildCoCLiveData(model, meta) : null,
    warnings,
    // Skills written below their worked-out base: said in the note-faults audit, never changed on the sheet (#396).
    tohitRows: model.skills.filter((k) => k.belowBase != null).map((k) => ({
      code: 'SKILL_BELOW_BASE', severity: 'info',
      detail: `${k.name} is written as ${k.reg}, below its base of ${k.belowBase} worked out from the characteristics`,
      fix: `raise ${k.name} to ${k.belowBase} in the Regular column, or leave it as written (the sheet shows ${k.reg} either way)`,
    })),
  };
}

module.exports = { renderCoCSheet };
