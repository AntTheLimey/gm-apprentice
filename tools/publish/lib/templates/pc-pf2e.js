const { escapeHtml } = require('../processor');

const ATTRIBUTES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

function signedMod(value) {
  const mod = Number(value) || 0;
  return mod >= 0 ? `+${mod}` : String(mod);
}

function renderPF2eSheet(frontmatter, sections) {
  const parts = [];

  const attrs = frontmatter.attributes || {};
  if (Object.keys(attrs).length > 0) {
    const cards = ATTRIBUTES
      .filter(a => attrs[a] !== undefined)
      .map(a => `<div class="pf2e-attribute-card">
  <span class="ability-name">${a}</span>
  <span class="ability-mod">${escapeHtml(signedMod(attrs[a]))}</span>
</div>`).join('\n');
    parts.push(`<div class="pf2e-attributes">${cards}</div>`);
  }

  if (frontmatter.hero_points !== undefined && frontmatter.hero_points !== null) {
    parts.push(`<div class="quick-stats"><div class="stat-item"><span class="stat-label">Hero Points</span><span class="stat-value">${escapeHtml(String(frontmatter.hero_points))}</span></div></div>`);
  }

  const skills = frontmatter.skill_proficiencies || [];
  if (skills.length > 0) {
    const pills = skills.map(s => {
      if (typeof s === 'string') {
        return `<span class="pf2e-proficiency">${escapeHtml(s)}</span>`;
      }
      const rank = s.rank ? ` <span class="sidebar-badge">${escapeHtml(String(s.rank))}</span>` : '';
      return `<span class="pf2e-proficiency">${escapeHtml(String(s.name || ''))}${rank}</span>`;
    }).join('\n');
    parts.push(`<h3>Skills</h3>\n<div class="pf2e-proficiencies">${pills}</div>`);
  }

  const features = [...(frontmatter.class_features || [])];
  if (features.length > 0) {
    const items = features
      .sort((a, b) => (a.level || 0) - (b.level || 0))
      .map(f => {
        const levelBadge = f.level ? `<span class="sidebar-badge">Level ${escapeHtml(String(f.level))}</span>` : '';
        const desc = f.description ? `<div class="card-excerpt">${escapeHtml(f.description)}</div>` : '';
        return `<div class="entity-card"><h4>${escapeHtml(f.name || String(f))} ${levelBadge}</h4>${desc}</div>`;
      }).join('\n');
    parts.push(`<h3>Class Features</h3>\n<div class="card-grid">${items}</div>`);
  }

  const spellSlots = frontmatter.spell_slots;
  if (spellSlots && Object.keys(spellSlots).length > 0) {
    const rows = Object.entries(spellSlots)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([rank, slots]) => `<div class="stat-item"><span class="stat-label">Rank ${escapeHtml(rank)}</span><span class="stat-value">${escapeHtml(String(slots))}</span></div>`)
      .join('\n');
    parts.push(`<h3>Spell Slots</h3>\n<div class="quick-stats">${rows}</div>`);
  }

  if (parts.length === 0) return null;
  return `<div class="pf2e-sheet">${parts.join('\n')}</div>`;
}

module.exports = { renderPF2eSheet };
