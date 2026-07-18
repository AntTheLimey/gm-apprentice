const { parseCoC } = require('./parse');
const { buildStatusBar, buildSheet, buildRecord, buildEquipment } = require('./layout');
const { buildCoCLiveData } = require('./live-data');

function renderCoCSheet(frontmatter, sections, meta) {
  const system = (meta && meta.system) || (frontmatter && frontmatter.system) || 'coc-7e';
  const model = parseCoC(frontmatter, sections || [], system);
  const statusBarHtml = buildStatusBar(model);
  return {
    sheetHtml: buildSheet(model),
    recordHtml: buildRecord(model, sections || []),
    equipmentHtml: buildEquipment(model, sections || []),
    statusBarHtml,
    // No status bar → no mutable vitals → nothing to wire.
    liveData: statusBarHtml ? buildCoCLiveData(model, meta) : null,
  };
}

module.exports = { renderCoCSheet };
