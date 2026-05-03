const { escapeHtml } = require('../processor');

const PRIMARY_ATTRS = ['ST', 'DX', 'IQ', 'HT'];

function renderGURPSSheet(frontmatter, sections) {
  const parts = [];

  const attrs = frontmatter.attributes || {};
  if (Object.keys(attrs).length > 0) {
    const cards = PRIMARY_ATTRS
      .filter(a => attrs[a] !== undefined)
      .map(a => `<div class="gurps-attr-card"><span class="attr-name">${a}</span><span class="attr-value">${escapeHtml(String(attrs[a]))}</span></div>`)
      .join('\n');
    parts.push(`<div class="gurps-primary-attrs">${cards}</div>`);
  }

  const secondary = frontmatter.secondary || {};
  if (Object.keys(secondary).length > 0) {
    const items = Object.entries(secondary)
      .map(([k, v]) => `<div class="stat-item"><span class="stat-label">${escapeHtml(k)}</span><span class="stat-value">${escapeHtml(String(v))}</span></div>`)
      .join('\n');
    parts.push(`<div class="quick-stats">${items}</div>`);
  }

  const advantages = frontmatter.advantages || [];
  if (advantages.length > 0) {
    const items = advantages.map(a => {
      const cost = a.cost !== undefined ? `<span class="trait-cost">[${a.cost}]</span>` : '';
      return `<li><span>${escapeHtml(a.name || String(a))}</span>${cost}</li>`;
    }).join('\n');
    parts.push(`<h3>Advantages</h3>\n<ul class="gurps-trait-list">${items}</ul>`);
  }

  const disadvantages = frontmatter.disadvantages || [];
  if (disadvantages.length > 0) {
    const items = disadvantages.map(d => {
      const cost = d.cost !== undefined ? `<span class="trait-cost">[${d.cost}]</span>` : '';
      return `<li><span>${escapeHtml(d.name || String(d))}</span>${cost}</li>`;
    }).join('\n');
    parts.push(`<h3>Disadvantages</h3>\n<ul class="gurps-trait-list">${items}</ul>`);
  }

  const skills = frontmatter.skills || [];
  if (skills.length > 0) {
    const byCategory = {};
    for (const s of skills) {
      const cat = s.category || 'General';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(s);
    }
    parts.push('<h3>Skills</h3>');
    for (const [cat, catSkills] of Object.entries(byCategory)) {
      const rows = catSkills
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map(s => {
          const rel = s.relative ? ` <span style="font-size:0.75rem;color:var(--text-muted)">(${escapeHtml(s.relative)})</span>` : '';
          return `<li><span>${escapeHtml(s.name || String(s))}${rel}</span><span class="trait-cost">${escapeHtml(String(s.level || ''))}</span></li>`;
        }).join('\n');
      parts.push(`<h4 style="color:var(--accent);font-size:0.8rem;text-transform:uppercase;letter-spacing:0.05em;margin:1rem 0 0.5rem;border-bottom:1px solid var(--border);padding-bottom:0.25rem">${escapeHtml(cat)}</h4>\n<ul class="gurps-trait-list">${rows}</ul>`);
    }
  }

  if (parts.length === 0) return null;
  return `<div class="gurps-sheet">${parts.join('\n')}</div>`;
}

module.exports = { renderGURPSSheet };
