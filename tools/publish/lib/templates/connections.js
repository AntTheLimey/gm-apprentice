'use strict';
// A page's Connections section as the build writes it: nested plain lists (what a reader
// without the page script, a printer and the search index see) and a JSON island the
// script (js/connections.js) draws tabs and the chosen treatment from. The island holds
// nothing the lists do not.
// Hrefs are not run through escapeHtml: encodeHref percent-encodes every segment (& " < > and
// space included), so what it returns is already safe inside a quoted attribute.
const { escapeHtml, relativeHref, encodeHref } = require('../processor');

const TONE_CODE = { warm: 'w', hostile: 'h', neutral: 'n' };

function sessionsText(sessions) {
  if (!sessions || !sessions.count) return '';
  if (sessions.count === 1) return `1 session: ${sessions.first}`;
  return `${sessions.count} sessions, ${sessions.first} to ${sessions.last}`;
}

const hrefFrom = (from, to) => (to ? encodeHref(relativeHref(from, to)) : null);

function islandOf(model, currentOutputPath) {
  const href = (to) => hrefFrom(currentOutputPath, to);
  return {
    s: model.subject.title,
    t: model.tabs.map((tab) => ({
      id: tab.id,
      n: tab.label,
      g: tab.groups.map((group) => ({
        n: group.label,
        d: group.items.map((it) => ({
          t: it.title, h: href(it.outputPath), k: it.kind, o: TONE_CODE[it.tone] || null, l: it.lines, f: it.own || 0,
          s: it.sessions ? [it.sessions.count, it.sessions.first, it.sessions.last] : null, i: href(it.image),
        })),
      })),
    })),
    m: model.mentions.map((group) => ({ n: group.label, d: group.items.map((it) => [it.title, href(it.outputPath)]) })),
  };
}

function itemHtml(it, from) {
  const href = hrefFrom(from, it.outputPath);
  const name = href ? `<a href="${href}">${escapeHtml(it.title)}</a>` : `<span class="cx-name">${escapeHtml(it.title)}</span>`;
  const kind = it.kind ? ` <span class="cx-kind">${escapeHtml(it.kind)}</span>` : '';
  const tone = it.tone ? ` <span class="cx-tone cx-${it.tone}">${it.tone}</span>` : '';
  const lines = it.lines.map((line) => `<span class="cx-line">${escapeHtml(line)}</span>`).join('');
  const sess = sessionsText(it.sessions);
  return `<li>${name}${kind}${tone}${lines}${sess ? `<span class="cx-sess">${escapeHtml(sess)}</span>` : ''}</li>`;
}

function renderConnections(model, { mode, currentOutputPath, heading = 'h2' } = {}) {
  if (mode === 'off' || !model || (model.tabs.length === 0 && model.mentions.length === 0)) return '';
  const level = Number(heading.slice(1));
  const h = (n) => `h${Math.min(6, level + n)}`;
  const parts = [];
  for (const tab of model.tabs) {
    parts.push(`<${h(1)}>${escapeHtml(tab.label)}</${h(1)}>`);
    for (const group of tab.groups) {
      parts.push(`<${h(2)}>${escapeHtml(group.label)}</${h(2)}>\n<ul>\n${group.items.map((it) => itemHtml(it, currentOutputPath)).join('\n')}\n</ul>`);
    }
  }
  if (model.mentions.length) {
    parts.push(`<${h(1)}>Mentions</${h(1)}>`);
    for (const group of model.mentions) {
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
