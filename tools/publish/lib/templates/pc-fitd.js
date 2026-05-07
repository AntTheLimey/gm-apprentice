const { escapeHtml } = require('../processor');

function renderDots(filled, max) {
  const dots = [];
  for (let i = 0; i < max; i++) {
    dots.push(i < filled ? '<span class="fitd-dot filled"></span>' : '<span class="fitd-dot"></span>');
  }
  return `<span class="fitd-dots">${dots.join('')}</span>`;
}

function renderFitDSheet(frontmatter, sections) {
  const parts = [];

  const actionRatings = frontmatter.action_ratings;
  if (actionRatings && Object.keys(actionRatings).length > 0) {
    const attrBlocks = Object.entries(actionRatings).map(([attr, actions]) => {
      const rows = Object.entries(actions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([action, rating]) => {
          return `<div class="fitd-action-row">${renderDots(rating, 4)} <span>${escapeHtml(action)}</span></div>`;
        }).join('\n');
      return `<div class="fitd-attribute"><h4>${escapeHtml(attr)}</h4>${rows}</div>`;
    }).join('\n');
    parts.push(`<div class="fitd-action-ratings">${attrBlocks}</div>`);
  }

  const stress = frontmatter.stress;
  if (stress) {
    const current = stress.current || 0;
    const max = stress.max || 9;
    parts.push(`<div class="fitd-tracker"><strong>Stress</strong> ${renderDots(current, max)} <span>${current} / ${max}</span></div>`);
  }

  const trauma = frontmatter.trauma;
  if (Array.isArray(trauma) && trauma.length > 0) {
    const pills = trauma.map(t => `<span class="dnd-proficiency">${escapeHtml(String(t))}</span>`).join(' ');
    parts.push(`<div class="fitd-tracker"><strong>Trauma</strong> ${pills}</div>`);
  }

  const abilities = frontmatter.special_abilities || [];
  if (abilities.length > 0) {
    const cards = abilities.map(a => {
      const name = typeof a === 'string' ? a : (a.name || '');
      const desc = typeof a === 'string' ? '' : (a.description || '');
      return `<div class="fitd-special-ability"><h4>${escapeHtml(name)}</h4>${desc ? `<p>${escapeHtml(desc)}</p>` : ''}</div>`;
    }).join('\n');
    parts.push(`<h3>Special Abilities</h3>\n${cards}`);
  }

  const load = frontmatter.load;
  if (load) {
    const items = Array.isArray(load.items) ? load.items : [];
    const loadLevel = load.level || '';
    let loadHtml = `<div class="fitd-tracker"><strong>Load</strong> <span>${escapeHtml(String(loadLevel))}</span></div>`;
    if (items.length > 0) {
      const itemList = items.map(i => `<span class="dnd-proficiency">${escapeHtml(String(i))}</span>`).join(' ');
      loadHtml += `<div style="margin-top:0.5rem">${itemList}</div>`;
    }
    parts.push(loadHtml);
  }

  if (parts.length === 0) return null;
  return `<div class="fitd-sheet">${parts.join('\n')}</div>`;
}

module.exports = { renderFitDSheet };
