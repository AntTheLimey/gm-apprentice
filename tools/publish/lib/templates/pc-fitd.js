const { escapeHtml } = require('../processor');
const {
  ATTRIBUTE_COLUMNS, aboveSubheadings, cellText, yesNo, hasContent, statItem, subsections, consumeTable,
  stripTemplatePlaceholders, boldField, readAttributes, tiles, sectionReader, consumedTitleMatcher,
} = require('./sheet-parse');

// `## ` sections the sheet takes over from the accordion list; each is on the
// sheet in full whenever renderFitDSheet returns HTML (sheet-parse.js).
// Background is read for the identity block but stays an accordion, as do Friends &
// Rivals and Long-Term Projects.
const isFitDConsumedTitle = consumedTitleMatcher(['stat sheet', 'special abilities', 'stash & coin']);

const ACTION_COLUMNS = [/^action$/i, /^(rating|dots)$/i];
const ARMOR_COLUMNS = [/^type$/i, /^used$/i];
const MAX_RATING = 4;
const MAX_TRACK = 20;

function renderDots(filled, max) {
  const dots = [];
  for (let i = 0; i < max; i++) {
    dots.push(i < filled ? '<span class="fitd-dot filled"></span>' : '<span class="fitd-dot"></span>');
  }
  return `<span class="fitd-dots">${dots.join('')}</span>`;
}

function actionRow(action, rating) {
  return `<div class="fitd-action-row">${renderDots(rating, MAX_RATING)} <span>${escapeHtml(action)}</span></div>`;
}

function stressTracker(current, max) {
  return `<div class="fitd-tracker"><strong>Stress</strong> ${renderDots(current, max)} <span>${current} / ${max}</span></div>`;
}

function traumaTracker(traumas) {
  const pills = traumas.map(t => `<span class="dnd-proficiency">${escapeHtml(String(t))}</span>`).join(' ');
  return `<div class="fitd-tracker"><strong>Trauma</strong> ${pills || '<span>—</span>'}</div>`;
}

// `### Action Ratings`: a bold attribute name over each `Action | Rating`
// table. Ratings become dots, grouped under their attribute.
function renderActionRatings(html) {
  const groups = [];
  const left = String(html || '').replace(
    /<p>\s*<strong>([^<]+)<\/strong>\s*<\/p>\s*(<table[^>]*>[\s\S]*?<\/table>)/gi,
    (whole, name, table) => {
      const rows = [];
      const unplaced = consumeTable(table, ACTION_COLUMNS, ([action, rating]) => {
        if (!action || !/^[0-4]?$/.test(rating)) return false;
        rows.push(actionRow(action, parseInt(rating, 10) || 0));
        return true;
      });
      if (rows.length) groups.push(`<div class="fitd-attribute"><h4>${name}</h4>${rows.join('\n')}</div>`);
      return unplaced ? `<p><strong>${name}</strong></p>\n${unplaced}` : '';
    });
  return {
    html: groups.length ? `<div class="fitd-action-ratings">${groups.join('\n')}</div>` : '',
    left: hasContent(left) ? left : '',
  };
}

// `### Stress & Trauma`: Stress `n / max` becomes a track, Trauma a row of pills.
function renderStressTrauma(html) {
  const out = [];
  const other = [];
  const seen = new Set();
  const left = consumeTable(html, ATTRIBUTE_COLUMNS, ([label, value]) => {
    const key = label.toLowerCase();
    const stress = key === 'stress' && value.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (stress && !seen.has(key) && Number(stress[2]) <= MAX_TRACK && Number(stress[1]) <= Number(stress[2])) {
      seen.add(key);
      out.push(stressTracker(Number(stress[1]), Number(stress[2])));
    } else if (key === 'trauma' && !seen.has(key)) {
      seen.add(key);
      out.push(traumaTracker(value.split(/[,;]/).map(t => t.trim()).filter(t => t && t !== '—')));
    } else {
      other.push([label, value]);
    }
    return true;
  });
  if (other.length) out.push(tiles(other));
  return { html: out.join('\n'), left };
}

// `### Armor Uses`: a ticked or empty box per armor type.
function renderArmor(html) {
  const boxes = [];
  const left = consumeTable(html, ARMOR_COLUMNS, ([type, used]) => {
    const on = yesNo(used);
    if (!type || on === null) return false;
    boxes.push(`<span class="fitd-armor"><span class="fitd-box${on ? ' filled' : ''}" title="${on ? 'Used' : 'Unused'}" aria-label="${on ? 'Used' : 'Unused'}"></span> ${escapeHtml(type)}</span>`);
    return true;
  });
  return {
    html: boxes.length ? `<div class="fitd-tracker"><strong>Armor</strong> ${boxes.join(' ')}</div>` : '',
    left,
  };
}

const SUBSECTION_RENDERERS = {
  'action ratings': renderActionRatings,
  'stress & trauma': renderStressTrauma,
  'armor uses': renderArmor,
};

// `## Stat Sheet`, in document order. What a subsection's renderer could not
// place follows its block; a subsection with no renderer (Harm, XP, anything
// an author adds) or a repeated one is shown as written.
function renderStatSheet(section, found) {
  const html = section.html;
  const parts = [];

  let top = aboveSubheadings(html);
  found.playbook = boldField(top, 'Playbook');
  // The Playbook line moves to the header when it is a paragraph of its own.
  top = top.replace(/<p>\s*<strong>\s*Playbook\s*:?\s*<\/strong>\s*:?[^<]*<\/p>/i, '');
  if (hasContent(top)) parts.push(top);

  const seen = new Set();
  for (const sub of subsections(html)) {
    const key = sub.title.toLowerCase();
    const render = !seen.has(key) && SUBSECTION_RENDERERS[key];
    seen.add(key);
    if (!render) {
      if (hasContent(sub.html)) parts.push(`<h3>${escapeHtml(sub.title)}</h3>\n${sub.html}`);
      continue;
    }
    const block = render(sub.html);
    if (block.html) {
      found[key] = true;
      parts.push(block.html);
    }
    if (block.left) parts.push(`<h3>${escapeHtml(sub.title)}</h3>\n${block.left}`);
  }
  return parts.join('\n');
}

// Frontmatter fallbacks, for a vault that keeps these there and not in the body.
function frontmatterBlocks(frontmatter, found) {
  const parts = [];

  const actionRatings = frontmatter.action_ratings;
  if (!found['action ratings'] && actionRatings && typeof actionRatings === 'object') {
    const groups = Object.entries(actionRatings)
      .filter(([, actions]) => actions && typeof actions === 'object')
      .map(([attr, actions]) => {
        const rows = Object.entries(actions)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([action, rating]) => actionRow(action, Number(rating) || 0))
          .join('\n');
        return `<div class="fitd-attribute"><h4>${escapeHtml(attr)}</h4>${rows}</div>`;
      });
    if (groups.length) parts.push(`<div class="fitd-action-ratings">${groups.join('\n')}</div>`);
  }

  if (!found['stress & trauma']) {
    const stress = frontmatter.stress;
    if (stress && typeof stress === 'object') {
      parts.push(stressTracker(Number(stress.current) || 0, Math.min(Number(stress.max) || 9, MAX_TRACK)));
    }
    const trauma = frontmatter.trauma;
    if (Array.isArray(trauma) && trauma.length > 0) parts.push(traumaTracker(trauma));
  }

  const abilities = [].concat(frontmatter.special_abilities || []).filter(Boolean);
  if (!found['special abilities'] && abilities.length > 0) {
    const cards = abilities.map(a => {
      const name = typeof a === 'string' ? a : (a.name || '');
      const desc = typeof a === 'string' ? '' : (a.description || '');
      return `<div class="fitd-special-ability"><h4>${escapeHtml(String(name))}</h4>${desc ? `<p>${escapeHtml(String(desc))}</p>` : ''}</div>`;
    }).join('\n');
    parts.push(`<h3>Special Abilities</h3>\n${cards}`);
  }

  const load = frontmatter.load;
  if (load && typeof load === 'object') {
    const items = Array.isArray(load.items) ? load.items : [];
    let loadHtml = `<div class="fitd-tracker"><strong>Load</strong> <span>${escapeHtml(String(load.level || ''))}</span></div>`;
    if (items.length > 0) {
      const itemList = items.map(i => `<span class="dnd-proficiency">${escapeHtml(String(i))}</span>`).join(' ');
      loadHtml += `<div style="margin-top:0.5rem">${itemList}</div>`;
    }
    parts.push(loadHtml);
  }
  return parts;
}

// The body sections follow skills/shared/templates/pc-fitd.md
// (docs/file-format-standards.md §11).
function renderFitDSheet(frontmatter, sections) {
  frontmatter = frontmatter || {};
  const reader = sectionReader(sections);
  const found = {};
  const parts = [];

  const stat = reader.first('stat sheet');
  const statHtml = stat ? renderStatSheet(stat, found) : '';

  const background = reader.first('background');
  const backgroundHtml = background ? background.html : '';
  // The identity block: Playbook, then every labelled line of Background
  // (Heritage, Background, Look, Vice/Purveyor) under the author's own label.
  const fields = found.playbook ? [['Playbook', found.playbook]] : [];
  for (const m of backgroundHtml.matchAll(/<strong>\s*([^<:]+?)\s*:\s*<\/strong>/g)) {
    const label = cellText(m[1]);
    const value = boldField(backgroundHtml, label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
    if (value && !fields.some(([l]) => l.toLowerCase() === label.toLowerCase())) fields.push([label, value]);
  }
  if (fields.length) {
    parts.push(`<dl class="fitd-identity">${fields.map(([label, value]) =>
      `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`);
  }

  if (statHtml) parts.push(statHtml);
  parts.push(...reader.repeats('stat sheet'));

  const abilities = reader.first('special abilities');
  if (abilities) {
    const body = stripTemplatePlaceholders(abilities.html, ['Selected special abilities from playbook list.']);
    if (hasContent(body)) {
      found['special abilities'] = true;
      parts.push(`<h3>Special Abilities</h3>\n<div class="fitd-abilities">${body}</div>`);
    }
  }
  parts.push(...reader.repeats('special abilities'));

  const stash = reader.first('stash & coin');
  if (stash) {
    const read = readAttributes(stash.html);
    if (read.rows.length || read.left) {
      parts.push(['<h3>Stash &amp; Coin</h3>', tiles(read.rows), read.left].filter(Boolean).join('\n'));
    }
  }
  parts.push(...reader.repeats('stash & coin'));

  parts.push(...frontmatterBlocks(frontmatter, found));

  if (parts.length === 0) return null;
  return `<div class="fitd-sheet">${parts.join('\n')}</div>`;
}

module.exports = { renderFitDSheet, isFitDConsumedTitle };
