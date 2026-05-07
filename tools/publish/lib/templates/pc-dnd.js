const { escapeHtml } = require('../processor');

const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

function abilityMod(score) {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : String(mod);
}

function renderDnDSheet(frontmatter, sections) {
  const parts = [];

  const scores = frontmatter.ability_scores || {};
  if (Object.keys(scores).length > 0) {
    const cards = ABILITIES
      .filter(a => scores[a] !== undefined)
      .map(a => {
        const score = scores[a];
        const mod = abilityMod(score);
        return `<div class="dnd-ability-card">
  <span class="ability-name">${a}</span>
  <span class="ability-score">${escapeHtml(String(score))}</span>
  <span class="ability-mod">${escapeHtml(mod)}</span>
</div>`;
      }).join('\n');
    parts.push(`<div class="dnd-ability-scores">${cards}</div>`);
  }

  const proficiencies = frontmatter.proficiencies || [];
  if (proficiencies.length > 0) {
    const pills = proficiencies.map(p =>
      `<span class="dnd-proficiency">${escapeHtml(String(p))}</span>`
    ).join('\n');
    parts.push(`<h3>Proficiencies</h3>\n<div class="dnd-proficiencies">${pills}</div>`);
  }

  const features = [...(frontmatter.class_features || [])];
  if (features.length > 0) {
    const items = features
      .sort((a, b) => (a.level || 0) - (b.level || 0))
      .map(f => {
        const levelBadge = f.level ? `<span class="sidebar-badge">Level ${f.level}</span>` : '';
        const desc = f.description ? `<div class="card-excerpt">${escapeHtml(f.description)}</div>` : '';
        return `<div class="entity-card"><h4>${escapeHtml(f.name || String(f))} ${levelBadge}</h4>${desc}</div>`;
      }).join('\n');
    parts.push(`<h3>Class Features</h3>\n<div class="card-grid">${items}</div>`);
  }

  const spellSlots = frontmatter.spell_slots;
  if (spellSlots && Object.keys(spellSlots).length > 0) {
    const rows = Object.entries(spellSlots)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([level, slots]) => `<div class="stat-item"><span class="stat-label">Level ${escapeHtml(level)}</span><span class="stat-value">${escapeHtml(String(slots))}</span></div>`)
      .join('\n');
    parts.push(`<h3>Spell Slots</h3>\n<div class="quick-stats">${rows}</div>`);
  }

  if (parts.length === 0) return null;
  return `<div class="dnd-sheet">${parts.join('\n')}</div>`;
}

module.exports = { renderDnDSheet };
