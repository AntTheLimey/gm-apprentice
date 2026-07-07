const { escapeHtml } = require('../../../processor');
const { block, cost } = require('../render');

function renderSkills(model) {
  const skills = (model.skills || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  if (skills.length === 0) return null;
  const footnotes = model.skillFootnotes || {};

  // Track which glyphs are actually used (in order of first appearance)
  const usedGlyphs = [];
  const seenGlyphs = new Set();

  const rows = skills.map(s => {
    // Render the real marker glyphs as superscripts (preserve them as-is)
    let marks = '';
    for (const g of (s.markers || [])) {
      marks += `<sup class="fn">${escapeHtml(g)}</sup>`;
      if (!seenGlyphs.has(g)) {
        seenGlyphs.add(g);
        usedGlyphs.push(g);
      }
    }
    const cite = s.source ? ` <span class="cite">{p. ${escapeHtml(s.source)}}</span>` : '';
    const def = s.parry ? `<div class="subline">Parry: ${escapeHtml(s.parry)}</div>`
      : s.block ? `<div class="subline">Block: ${escapeHtml(s.block)}</div>` : '';
    const baseNote = (s.base && s.base !== s.level)
      ? `<div class="subline">base ${escapeHtml(s.base)}</div>` : '';
    return `<tr><td class="nm">${escapeHtml(s.name)}${cite}${def}</td>` +
      `<td class="num">${escapeHtml(s.level)}${marks}${baseNote}</td>` +
      `<td class="num rel">${escapeHtml(s.relative || '')}</td>` +
      `<td class="num">${cost(s.points)}</td></tr>`;
  }).join('\n');

  // Render the legend only for glyphs that are actually used and have known text
  let legendHtml = '';
  const legendLines = usedGlyphs
    .filter(g => footnotes[g] && footnotes[g].text)
    .map(g => {
      const entry = footnotes[g];
      const label = entry.kind === 'conditional' ? 'Conditional' : 'Includes';
      return `<div class="fn-line"><sup class="fn">${escapeHtml(g)}</sup> ${escapeHtml(label)}: ${escapeHtml(entry.text)}</div>`;
    });
  if (legendLines.length > 0) {
    legendHtml = `<div class="fn-legend">${legendLines.join('\n')}</div>`;
  }

  const inner = `<table><thead><tr><th>Name</th><th class="num">Lvl</th><th class="num">Rel</th><th class="num">Pts</th></tr></thead><tbody>${rows}</tbody></table>${legendHtml}`;
  return block('skill', 'Skills', inner);
}

module.exports = { renderSkills };
