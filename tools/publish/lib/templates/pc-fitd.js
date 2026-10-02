const { escapeHtml } = require('../processor');
const {
  ATTRIBUTE_COLUMNS, aboveSubheadings, cellText, filled, yesNo, hasContent, statItem, subsections, consumeTable,
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
const IDENTITY_MAX = 80;

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
      // Nothing placed and nothing left over: a name over an empty table, kept as written.
      if (rows.length === 0 && !unplaced) return whole;
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
  let out = [];
  let traumas = null;
  const other = [];
  const seen = new Set();
  const left = consumeTable(html, ATTRIBUTE_COLUMNS, ([label, value]) => {
    const key = label.toLowerCase();
    const stress = key === 'stress' && value.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (stress && !seen.has(key) && Number(stress[2]) <= MAX_TRACK && Number(stress[1]) <= Number(stress[2])) {
      seen.add(key);
      out.push(stressTracker(Number(stress[1]), Number(stress[2])));
    } else if (key === 'trauma' && !(value && seen.has(key))) {
      // The first filled row is the trauma list. A blank row only holds the
      // tracker's place, so a filled one below it still counts.
      if (!out.includes(null)) out.push(null);
      if (value) {
        seen.add(key);
        traumas = value.split(/[,;](?![^(]*\))/).map(t => t.trim()).filter(t => t && t !== '—');
      } else if (!traumas) {
        traumas = [];
      }
    } else {
      other.push([label, value]);
    }
    return true;
  });
  // A blank Trauma cell with a list under the table is not "no trauma": the
  // list follows as written, so the empty tracker is left out.
  const tracker = traumas && (traumas.length || !left) ? traumaTracker(traumas) : '';
  out = out.map(block => (block === null ? tracker : block)).filter(Boolean);
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
  // The Playbook line moves to the identity block when it is a paragraph of
  // its own: the same `**Playbook:** value` shape boldField reads, on one line.
  top = top.replace(/<p>\s*<strong>\s*Playbook\s*(?::\s*<\/strong>|<\/strong>\s*:)[^<\n]*<\/p>/i, '');
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

// The body sections follow skills/shared/templates/pc-fitd.md
// (docs/file-format-standards.md §11).
function renderFitDSheet(frontmatter, sections) {
  const reader = sectionReader(sections);
  const found = {};
  const parts = [];

  const stat = reader.first('stat sheet');
  const statHtml = stat ? renderStatSheet(stat, found) : '';

  const background = reader.first('background');
  const backgroundHtml = background ? background.html : '';
  // The identity block: Playbook, then each short labelled line of Background
  // (Heritage, Background, Look, Vice/Purveyor) under the author's own label.
  // A value that wraps onto further lines or runs long is prose: it is left to
  // the Background accordion whole, not shown here cut short.
  const fields = found.playbook ? [['Playbook', found.playbook]] : [];
  for (const m of backgroundHtml.matchAll(/<strong>\s*([^<:]+?)\s*(?::\s*<\/strong>|<\/strong>\s*:)([^\n]*)/g)) {
    const label = cellText(m[1]);
    const value = filled(cellText(m[2].split(/<strong>[^<]*:|<strong>[^<]*<\/strong>\s*:|<br|<\/p>/)[0]));
    // The line after this one, when the paragraph goes on: more of the value
    // unless it opens with the next label.
    const after = backgroundHtml.slice(m.index + m[0].length);
    const wraps = !/<\/p>/.test(m[2]) && /^\n(?!\s*<strong>[^<]*(?::\s*<\/strong>|<\/strong>\s*:))\s*(?!<\/)\S/.test(after);
    if (!value || wraps || value.length > IDENTITY_MAX) continue;
    if (!fields.some(([l]) => l.toLowerCase() === label.toLowerCase())) fields.push([label, value]);
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

  if (parts.length === 0) return null;
  return `<div class="fitd-sheet">${parts.join('\n')}</div>`;
}

module.exports = { renderFitDSheet, isFitDConsumedTitle };
