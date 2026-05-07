const { escapeHtml } = require('../processor');

const PRIMARY_ATTRS = ['ST', 'DX', 'IQ', 'HT'];

function parseTableRows(html) {
  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells = [];
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function findSectionByTitle(sections, ...titles) {
  const lower = titles.map(t => t.toLowerCase());
  return sections.find(s => lower.includes(s.title.toLowerCase()));
}

function extractSubsectionHtml(sectionHtml, subsectionTitle) {
  const pattern = new RegExp(`<h3[^>]*>\\s*${subsectionTitle}\\s*</h3>([\\s\\S]*?)(?=<h3|$)`, 'i');
  const match = sectionHtml.match(pattern);
  return match ? match[1] : '';
}

function extractSecondaryStats(sections) {
  const sec = findSectionByTitle(sections, 'stat sheet', 'secondary characteristics');
  if (!sec) return {};
  const targetHtml = sec.title.toLowerCase() === 'stat sheet'
    ? extractSubsectionHtml(sec.html, 'Secondary Characteristics')
    : sec.html;
  if (!targetHtml) return {};
  const rows = parseTableRows(targetHtml);
  const stats = {};
  for (const row of rows) {
    if (row.length >= 2) stats[row[0]] = row[1];
  }
  return stats;
}

function extractActiveDefenses(sections) {
  const sec = findSectionByTitle(sections, 'active defenses');
  if (!sec) return { dodge: null, parries: [] };
  const rows = parseTableRows(sec.html);
  let dodge = null;
  const parries = [];
  for (const row of rows) {
    if (row.length < 2) continue;
    const label = row[0].toLowerCase();
    if (label.startsWith('dodge')) dodge = row[1];
    else if (label.startsWith('parry')) parries.push({ name: row[0].replace(/^Parry\s*\(/i, '').replace(/\)$/, ''), value: row[1] });
  }
  return { dodge, parries };
}

function extractBestSkill(sections, category) {
  const rangedTitles = ['ranged weapons'];
  const meleeTitles = ['melee weapons'];
  const titles = category === 'ranged' ? rangedTitles : meleeTitles;
  const sec = sections.find(s => titles.includes(s.title.toLowerCase()));
  if (!sec) return null;
  const rows = parseTableRows(sec.html);
  let best = null;
  let bestLevel = 0;
  for (const row of rows) {
    if (row.length < 2) continue;
    const skillCell = row[1] || '';
    const match = skillCell.match(/(\d+)/);
    if (match) {
      const level = parseInt(match[1], 10);
      if (level > bestLevel) {
        bestLevel = level;
        best = { weapon: row[0], skill: skillCell, level: bestLevel };
      }
    }
  }
  return best;
}

function extractEncumberedMove(sections) {
  let sec = findSectionByTitle(sections, 'encumbrance');
  let html;
  if (sec) {
    html = sec.html;
  } else {
    const equipSec = findSectionByTitle(sections, 'equipment');
    if (equipSec) html = extractSubsectionHtml(equipSec.html, 'Encumbrance');
  }
  if (!html) return null;
  const rows = parseTableRows(html);
  for (const row of rows) {
    if (row.length >= 4) {
      const label = row[0].toLowerCase();
      if (label.includes('standard') || label.includes('typical') || label.includes('normal')) {
        return row[3];
      }
    }
  }
  for (const row of rows) {
    if (row.length >= 4) {
      const label = row[0].toLowerCase();
      if (label.includes('light') && !label.includes('loadout') && !label.includes('approx')) {
        return row[3];
      }
    }
  }
  if (rows.length > 1 && rows[1].length >= 4) return rows[1][3];
  return null;
}

function renderCombatBar(sections) {
  const secondary = extractSecondaryStats(sections);
  const defenses = extractActiveDefenses(sections);
  const bestRanged = extractBestSkill(sections, 'ranged');
  const bestMelee = extractBestSkill(sections, 'melee');
  const encMove = extractEncumberedMove(sections);

  const stats = [];

  if (secondary['HP']) stats.push({ label: 'HP', value: secondary['HP'] });
  if (secondary['FP']) stats.push({ label: 'FP', value: secondary['FP'] });
  if (secondary['Basic Speed']) stats.push({ label: 'Speed', value: secondary['Basic Speed'] });
  if (secondary['Basic Move']) {
    const full = secondary['Basic Move'];
    const display = encMove && encMove !== full ? `${encMove} / ${full}` : full;
    stats.push({ label: 'Move', value: display });
  }
  if (defenses.dodge) stats.push({ label: 'Dodge', value: defenses.dodge });
  for (const p of defenses.parries) {
    stats.push({ label: `Parry (${p.name})`, value: p.value });
  }
  if (bestRanged) stats.push({ label: 'Ranged', value: `${bestRanged.skill}` });
  if (bestMelee) stats.push({ label: 'Melee', value: `${bestMelee.skill}` });

  if (stats.length === 0) return '';

  const items = stats.map(s =>
    `<div class="combat-stat"><span class="combat-stat-value">${escapeHtml(s.value)}</span><span class="combat-stat-label">${escapeHtml(s.label)}</span></div>`
  ).join('\n');

  return `<div class="gurps-combat-bar">${items}</div>`;
}

function renderGURPSSheet(frontmatter, sections) {
  const parts = [];

  const combatBar = renderCombatBar(sections);
  if (combatBar) parts.push(combatBar);

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
