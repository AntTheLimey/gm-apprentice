const { filled } = require('../../sheet-parse');
const { escapeHtml } = require('../../../processor');
const { block, entry, asWritten, hitHtml } = require('../render');

const TITLES = ['Cantrips', '1st level', '2nd level', '3rd level', '4th level', '5th level', '6th level', '7th level', '8th level', '9th level'];

// A tag that holds a link keeps it; the rest are text. Parsed alike, so they line up.
function linkedTags(s) {
  const tags = s.tags || [];
  const html = s.tagsHtml || [];
  return tags.map((t, i) => (html.length === tags.length && /<a[ >]/i.test(html[i]) ? { html: html[i] } : t));
}

function renderSpells(model) {
  const out = [];
  TITLES.forEach((title, n) => {
    const entries = (model.spells || []).filter(s => String(s.level) === String(n)).map(s => entry({
      nameHtml: s.nameHtml,
      tags: [s.time, s.range, s.components, s.duration, ...linkedTags(s),
        s.source ? { html: s.sourceHtml || escapeHtml(s.source), cls: 'is-source' } : ''],
      bigHtml: filled(s.hit) ? hitHtml(s.hit) : '',
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
