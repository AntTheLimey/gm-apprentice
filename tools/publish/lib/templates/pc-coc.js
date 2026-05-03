const { escapeHtml } = require('../processor');

const COC_CHARACTERISTICS = ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU'];

function renderCoCSheet(frontmatter, sections) {
  const parts = [];

  const chars = frontmatter.characteristics || {};
  if (Object.keys(chars).length > 0) {
    const boxes = COC_CHARACTERISTICS
      .filter(c => chars[c] !== undefined)
      .map(c => `<div class="coc-char-box"><span class="char-label">${c}</span><span class="char-value">${escapeHtml(String(chars[c]))}</span></div>`)
      .join('\n');
    parts.push(`<div class="coc-characteristics">${boxes}</div>`);
  }

  const sanity = frontmatter.sanity;
  if (sanity) {
    const onset = sanity.onset ? ` <span style="font-size:0.8rem;color:var(--text-muted)">Onset: ${escapeHtml(sanity.onset)}</span>` : '';
    parts.push(`<div class="coc-sanity-tracker"><strong>Sanity</strong> <span class="char-value">${escapeHtml(String(sanity.current || '?'))} / ${escapeHtml(String(sanity.max || '?'))}</span>${onset}</div>`);
  }

  const skills = frontmatter.skills;
  if (Array.isArray(skills) && skills.length > 0) {
    const byCategory = {};
    for (const s of skills) {
      const cat = s.category || 'General';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(s);
    }
    parts.push('<h3>Skills</h3>');
    for (const [cat, catSkills] of Object.entries(byCategory)) {
      const rows = catSkills
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(s => `<div class="coc-skill-row"><span>${escapeHtml(s.name)}</span><span class="coc-skill-value">${escapeHtml(String(s.value))}%</span></div>`)
        .join('\n');
      parts.push(`<div class="coc-skills-category"><h4>${escapeHtml(cat)}</h4>${rows}</div>`);
    }
  }

  if (parts.length === 0) return null;
  return `<div class="coc-sheet">${parts.join('\n')}</div>`;
}

module.exports = { renderCoCSheet };
