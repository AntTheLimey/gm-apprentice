const { escapeHtml } = require('../../processor');
const { splitReason } = require('./parse');

function block(key, title, inner, caption) {
  if (!inner) return null;
  const cap = caption ? ` <span class="dnd5e-cap">${escapeHtml(caption)}</span>` : '';
  return `<section class="dnd5e-blk dnd5e-blk-${key}"><h3>${escapeHtml(title)}${cap}</h3>${inner}</section>`;
}

// A number as written. A reason in brackets is kept and shown beside it.
// `whyClass` marks a reason the page shows again elsewhere (a phone may leave this one out).
function num(text, whyClass = '', whyHtml = '') {
  const { value, reason } = splitReason(text);
  if (!value) return '<span class="dnd5e-num">—</span>';
  if (!reason) return `<span class="dnd5e-num">${escapeHtml(value)}</span>`;
  return `<span class="dnd5e-num" title="${escapeHtml(reason)}">${escapeHtml(value)}</span><span class="dnd5e-why${whyClass ? ' ' + whyClass : ''}">${whyHtml || escapeHtml(reason)}</span>`;
}

// `max` things of which `spent` are used up. Marks up to ten, a count above.
// `live` (`{ key }`, from live-key.js liveOf) draws them tappable for js/dnd-live.js;
// without it the output is what it has always been.
function marks(max, spent, label, live) {
  const left = Math.max(0, max - spent);
  const aria = `${label}: ${left} of ${max} left`;
  const hook = live ? ` data-live="${escapeHtml(live.key)}"` : '';
  // Nothing to draw marks for: say so as a count, so the row is not empty.
  if (max > 10 || max === 0) {
    const inner = `<span class="dnd5e-num">${left}</span> / ${max}`;
    return live
      ? `<button type="button" class="dnd5e-count dnd5e-live"${hook} aria-label="${escapeHtml(aria)}">${inner}</button>`
      : `<span class="dnd5e-count" role="img" aria-label="${escapeHtml(aria)}">${inner}</span>`;
  }
  if (live) {
    const one = i => `<button type="button" class="dnd5e-mark${i >= left ? ' is-spent' : ''}" aria-label="${i >= left ? 'Spent' : 'Available'}"></button>`;
    return `<span class="dnd5e-marks dnd5e-live"${hook} role="group" aria-label="${escapeHtml(label)}">${Array.from({ length: max }, (_, i) => one(i)).join('')}</span>`;
  }
  const one = i => `<span class="dnd5e-mark${i >= left ? ' is-spent' : ''}"></span>`;
  return `<span class="dnd5e-marks" role="img" aria-label="${escapeHtml(aria)}">${Array.from({ length: max }, (_, i) => one(i)).join('')}</span>`;
}

// A cell's html when it holds a link, else its text escaped: a link is kept, nothing else changes.
const linkOr = (html, text) => (/<a[ >]/i.test(html || '') ? html : escapeHtml(text));

function usesHtml(f, live) {
  const rec = f.recovers ? `<span class="dnd5e-recovers">${linkOr(f.recoversHtml, f.recovers)}</span>` : '';
  if (f.uses === null || f.uses === undefined) return rec;
  const used = f.used || 0;
  if (used > f.uses) return `<span class="dnd5e-count">${used} used of ${f.uses}</span>${rec ? ' ' + rec : ''}`;
  return marks(f.uses, used, f.name, live) + (rec ? ' ' + rec : '');
}

// A tag is text, or `{ html, cls }` for one that carries a link or its own state class.
function tag(t) {
  if (typeof t === 'object') return `<span class="dnd5e-tag${t.cls ? ' ' + t.cls : ''}">${t.html}</span>`;
  return `<span class="dnd5e-tag${t === 'C' ? ' is-conc' : ''}">${escapeHtml(t === 'C' ? 'Concentration' : t === 'R' ? 'Ritual' : t)}</span>`;
}

// `Hit` names a signed number (an attack roll). A save DC or anything else says what it is itself.
function hitHtml(text) {
  const { value } = splitReason(text);
  return (/^[+\-−]\d/.test(value) ? '<span class="dnd5e-lbl">Hit</span> ' : '') + num(text);
}

// The html of a reason that holds a link, for a value the note gave in full (see parse.js keepReasonLink).
const whyOf = (model, text) => (model.whyHtml && model.whyHtml.get(text)) || '';

const tile = (label, value, model = {}) => `<div class="dnd5e-v"><span class="dnd5e-lbl">${escapeHtml(label)}</span>${num(value, '', whyOf(model, value))}</div>`;

function entry({ nameHtml, tags = [], bigHtml = '', summaryHtml = '', usesHtml: uses = '' }) {
  const tagHtml = tags.filter(Boolean).map(tag).join('');
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

module.exports = { whyOf, linkOr, block, num, marks, usesHtml, entry, asWritten, hitHtml, tile };
