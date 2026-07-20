const { parseCoC } = require('./parse');
const { buildStatusBar, buildSheet, buildRecord, buildEquipment } = require('./layout');
const { buildCoCLiveData } = require('./live-data');

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
    sheetHtml: buildSheet(model),
    recordHtml: buildRecord(model, sections || []),
    equipmentHtml: buildEquipment(model, sections || []),
    statusBarHtml,
    // No status bar → no mutable vitals → nothing to wire.
    liveData: statusBarHtml ? buildCoCLiveData(model, meta) : null,
    warnings,
  };
}

module.exports = { renderCoCSheet };
