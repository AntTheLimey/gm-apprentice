const { escapeHtml } = require('../../processor');
const { splitReason } = require('./parse');

function block(key, title, inner, caption) {
  if (!inner) return null;
  const cap = caption ? ` <span class="dnd5e-cap">${escapeHtml(caption)}</span>` : '';
  return `<section class="dnd5e-blk dnd5e-blk-${key}"><h3>${escapeHtml(title)}${cap}</h3>${inner}</section>`;
}

// A number as written. A reason in brackets is kept and shown beside it.
function num(text) {
  const { value, reason } = splitReason(text);
  if (!value) return '<span class="dnd5e-num">—</span>';
  if (!reason) return `<span class="dnd5e-num">${escapeHtml(value)}</span>`;
  return `<span class="dnd5e-num" title="${escapeHtml(reason)}">${escapeHtml(value)}</span><span class="dnd5e-why">${escapeHtml(reason)}</span>`;
}

// `max` things of which `spent` are used up. Marks up to ten, a count above.
function marks(max, spent, label) {
  const left = Math.max(0, max - spent);
  const aria = `${label}: ${left} of ${max} left`;
  if (max > 10) return `<span class="dnd5e-count" aria-label="${escapeHtml(aria)}"><span class="dnd5e-num">${left}</span> / ${max}</span>`;
  const one = i => `<span class="dnd5e-mark${i >= left ? ' is-spent' : ''}"></span>`;
  return `<span class="dnd5e-marks" role="img" aria-label="${escapeHtml(aria)}">${Array.from({ length: max }, (_, i) => one(i)).join('')}</span>`;
}

function usesHtml(f) {
  if (f.uses === null || f.uses === undefined) return '';
  const used = f.used || 0;
  if (used > f.uses) return `<span class="dnd5e-count">${used} used of ${f.uses}</span>`;
  const rec = f.recovers ? ` <span class="dnd5e-recovers">${escapeHtml(f.recovers)}</span>` : '';
  return marks(f.uses, used, f.name) + rec;
}

function entry({ nameHtml, tags = [], bigHtml = '', summaryHtml = '', usesHtml: uses = '' }) {
  const tagHtml = tags.filter(Boolean).map(t => `<span class="dnd5e-tag${t === 'C' ? ' is-conc' : ''}">${escapeHtml(t === 'C' ? 'Concentration' : t === 'R' ? 'Ritual' : t)}</span>`).join('');
  return `<div class="dnd5e-entry"><div class="dnd5e-entry-top"><span class="dnd5e-entry-name">${nameHtml}</span>`
    + (tagHtml ? `<span class="dnd5e-tags">${tagHtml}</span>` : '')
    + (bigHtml ? `<span class="dnd5e-entry-big">${bigHtml}</span>` : '')
    + '</div>'
    + (summaryHtml ? `<div class="dnd5e-entry-text">${summaryHtml}</div>` : '')
    + (uses ? `<div class="dnd5e-uses">${uses}</div>` : '')
    + '</div>';
}

function asWritten(fragments) {
  const html = (fragments || []).filter(Boolean).join('\n');
  return html ? `<div class="dnd5e-as-written">${html}</div>` : '';
}

module.exports = { block, num, marks, usesHtml, entry, asWritten };
