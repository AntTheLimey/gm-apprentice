'use strict';
// A page's Connections section as the build writes it: nested plain lists (what a reader
// without the page script, a printer and the search index see) and a JSON island the
// script (js/connections.js) draws tabs and the chosen treatment from. The island holds
// nothing the lists do not.
// Hrefs are not run through escapeHtml: encodeHref percent-encodes every segment (& " < > and
// space included), so what it returns is already safe inside a quoted attribute.
const { escapeHtml, relativeHref, encodeHref } = require('../processor');
const { labelsForLinks } = require('../wikilink');

const TONE_CODE = { warm: 'w', hostile: 'h', neutral: 'n' };
const MODES = new Set(['tree', 'web', 'cards']);
const HEADINGS = new Set(['h2', 'h3', 'h4', 'h5']);
// The island holds what the list shows: text reduced as escapeHtml reduces it (a labelled
// link to its label), then only the tones and mentions that are printed at all.
const text = (value) => labelsForLinks(value);
const toneOf = (it) => (own(TONE_CODE, it.tone) ? it.tone : null);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const linesOf = (it) => (it.lines || []).map(text).filter((line) => line !== '');
const mentionsOf = (model) => model.mentions
  .map((group) => ({ label: group.label, items: group.items.filter((it) => it.outputPath) }))
  .filter((group) => group.items.length);

function sessionsText(sessions) {
  if (!sessions || !sessions.count) return '';
  if (sessions.count === 1) return `1 session: ${sessions.first}`;
  return `${sessions.count} sessions, ${sessions.first} to ${sessions.last}`;
}

const hrefFrom = (from, to) => (to ? encodeHref(relativeHref(from, to)) : null);

function islandOf(model, currentOutputPath) {
  const href = (to) => hrefFrom(currentOutputPath, to);
  return {
    s: text(model.subject.title),
    t: model.tabs.map((tab) => ({
      id: tab.id,
      n: text(tab.label),
      g: tab.groups.map((group) => ({
        n: text(group.label),
        d: group.items.map((it) => ({
          t: text(it.title), h: href(it.outputPath), k: text(it.kind), o: toneOf(it) ? TONE_CODE[it.tone] : null, l: linesOf(it), f: it.own || 0,
          s: it.sessions ? [it.sessions.count, text(it.sessions.first), text(it.sessions.last)] : null, i: href(it.image),
        })),
      })),
    })),
    m: mentionsOf(model).map((group) => ({ n: text(group.label), d: group.items.map((it) => [text(it.title), href(it.outputPath)]) })),
  };
}

function itemHtml(it, from) {
  const href = hrefFrom(from, it.outputPath);
  const name = href ? `<a href="${href}">${escapeHtml(it.title)}</a>` : `<span class="cx-name">${escapeHtml(it.title)}</span>`;
  const kind = it.kind ? ` <span class="cx-kind">${escapeHtml(it.kind)}</span>` : '';
  const tone = toneOf(it) ? ` <span class="cx-tone cx-${it.tone}">${it.tone}</span>` : '';
  const lines = linesOf(it).map((line) => `<span class="cx-line">${escapeHtml(line)}</span>`).join('');
  const sess = sessionsText(it.sessions);
  return `<li>${name}${kind}${tone}${lines}${sess ? `<span class="cx-sess">${escapeHtml(sess)}</span>` : ''}</li>`;
}

function renderConnections(model, { mode, currentOutputPath, heading = 'h2' } = {}) {
  if (!MODES.has(mode) || !model) return '';
  const mentions = mentionsOf(model);
  if (model.tabs.length === 0 && mentions.length === 0) return '';
  if (!HEADINGS.has(heading)) heading = 'h2';
  const level = Number(heading.slice(1));
  const h = (n) => `h${Math.min(6, level + n)}`;
  const parts = [];
  for (const tab of model.tabs) {
    parts.push(`<${h(1)}>${escapeHtml(tab.label)}</${h(1)}>`);
    for (const group of tab.groups) {
      parts.push(`<${h(2)}>${escapeHtml(group.label)}</${h(2)}>\n<ul>\n${group.items.map((it) => itemHtml(it, currentOutputPath)).join('\n')}\n</ul>`);
    }
  }
  if (mentions.length) {
    parts.push(`<${h(1)}>Mentions</${h(1)}>`);
    for (const group of mentions) {
      const links = group.items.map((it) => `<li><a href="${hrefFrom(currentOutputPath, it.outputPath)}">${escapeHtml(it.title)}</a></li>`);
      parts.push(`<${h(2)}>${escapeHtml(group.label)}</${h(2)}>\n<ul class="cx-mentions">\n${links.join('\n')}\n</ul>`);
    }
  }
  // `<` (so `</script>` and `<!--` cannot act) and the two line separators written as
  // escapes; the JSON parses back to the same strings.
  const json = JSON.stringify(islandOf(model, currentOutputPath)).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<section class="cx" data-cx-mode="${mode}" aria-labelledby="cx-heading">
<${heading} id="cx-heading">Connections</${heading}>
<div class="cx-plain">
${parts.join('\n')}
</div>
<script type="application/json" class="cx-data">${json}</script>
</section>`;
}

module.exports = { renderConnections, islandOf, sessionsText };
