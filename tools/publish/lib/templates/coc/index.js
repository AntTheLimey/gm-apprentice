const { parseCoC } = require('./parse');
const { buildStatusBar, buildSheet, buildRecord, buildEquipment } = require('./layout');

function renderCoCSheet(frontmatter, sections, meta) {
  const system = (meta && meta.system) || (frontmatter && frontmatter.system) || 'coc-7e';
  const model = parseCoC(frontmatter, sections || [], system);
  return {
    sheetHtml: buildSheet(model),
    recordHtml: buildRecord(model, sections || []),
    equipmentHtml: buildEquipment(model, sections || []),
    statusBarHtml: buildStatusBar(model),
    liveData: null, // SP2
  };
}

module.exports = { renderCoCSheet };
