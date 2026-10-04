const { filled } = require('../../sheet-parse');
const { block, num, entry, asWritten } = require('../render');

const TITLES = ['Cantrips', '1st level', '2nd level', '3rd level', '4th level', '5th level', '6th level', '7th level', '8th level', '9th level'];

function renderSpells(model) {
  const out = [];
  TITLES.forEach((title, n) => {
    const entries = (model.spells || []).filter(s => String(s.level) === String(n)).map(s => entry({
      nameHtml: s.nameHtml,
      tags: [s.time, s.range, s.components, s.duration, ...(s.tags || [])],
      bigHtml: filled(s.hit) ? `<span class="dnd5e-lbl">Hit / DC</span> ${num(s.hit)}` : '',
      summaryHtml: s.summaryHtml,
    })).join('');
    const html = block(`spells-${n}`, title, entries);
    if (html) out.push(html);
  });
  const written = block('spells-written', 'Spells, as written', asWritten(model.asWritten.spellcasting));
  if (written) out.push(written);
  return out;
}

module.exports = { renderSpells };
