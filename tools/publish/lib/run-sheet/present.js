'use strict';
// The GM's view of the run sheet model: each markdown field rendered to HTML on the server, so the page
// ships no markdown parser (plan decision 9). The words stay: a field `f` gains a sibling `fHtml`, so the
// page's state and the Table Log keep the Plan's own text. `[[link]]` becomes an anchor the drawer opens
// (`data-note`, the vault-relative path), or a `missing` span; `![[picture]]` becomes `/vault/<path>`.
// Raw HTML in a note is never run (`createRenderer` is `html: false`). 5b adds `forPlayers` beside this.

const path = require('node:path');
const { createRenderer } = require('../markdown');

const md = createRenderer();
const PICTURE = /\.(jpe?g|png|webp|gif|svg|avif)$/i;
const OPEN = '';
const SHUT = '';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

function linkHtml({ bang, inner }, index) {
  const bar = inner.indexOf('|');
  const target = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
  const label = bar >= 0 ? inner.slice(bar + 1).trim() : '';
  const note = target.split('#')[0].trim();
  const shown = (s) => s.split('/').pop().replace(/\.md$/i, '');
  if (bang && PICTURE.test(note)) {
    const pic = index.picture(note);
    if (!pic) return `<span class="lk missing">${esc(shown(note))}</span>`;
    const width = /^\d+(x\d+)?$/.test(label) ? ` width="${label.split('x')[0]}"` : '';
    const alt = label && !width ? label : path.posix.basename(pic);
    return `<img src="/vault/${esc(encodePath(pic))}" alt="${esc(alt)}"${width}>`;
  }
  const text = label || shown(target || note);
  const hit = note ? index.resolve(note) : null;
  if (!hit) return `<span class="lk missing">${esc(text)}</span>`;
  return `<a class="lk" data-note="${esc(hit)}">${esc(text)}</a>`;
}

// Markdown to HTML with the vault's links. `inline` for a one-line field (no wrapping <p>).
function toHtml(text, index, { inline = false } = {}) {
  if (text === null || text === undefined || text === '') return '';
  const links = [];
  // An HTML comment (a `<!-- gm-only -->` fence) is never shown: `html: false` would print it as text.
  const src = String(text).replace(/<!--[\s\S]*?-->/g, '').replace(/[]/g, '').replace(/(!?)\[\[([^\]\n]+?)\]\]/g, (m, bang, inner) => {
    links.push({ bang: bang === '!', inner });
    return `${OPEN}${links.length - 1}${SHUT}`;
  });
  const html = inline ? md.renderInline(src) : md.render(src);
  return html.replace(/(\d+)/g, (m, i) => linkHtml(links[Number(i)], index));
}

// `obj[f + 'Html']` for each field of `fields` that holds a string.
function addHtml(obj, fields, index, inline) {
  if (!obj || typeof obj !== 'object') return;
  for (const f of fields) {
    if (typeof obj[f] === 'string') obj[`${f}Html`] = toHtml(obj[f], index, { inline });
  }
}

const BEAT_BLOCKS = ['situation', 'startsIt', 'readAloud', 'complications', 'gmNotes', 'extra', 'then', 'trigger'];

function present(model, { index }) {
  const m = structuredClone(model);
  addHtml(m.brief, Object.keys(m.brief || {}), index, false);
  for (const b of m.beats || []) {
    addHtml(b, BEAT_BLOCKS, index, false);
    for (const s of b.spots || []) addHtml(s, ['md'], index, false);
    for (const p of b.points || []) addHtml(p, ['text'], index, true);
    for (const x of b.ifs || []) addHtml(x, ['do', 'then'], index, true);
    for (const t of b.treasure || []) addHtml(t, ['text'], index, true);
    for (const w of b.who || []) addHtml(w, ['wants', 'playAs'], index, true);
    for (const a of b.arrivals || []) addHtml(a, ['text'], index, true);
  }
  for (const p of m.prep || []) addHtml(p, ['md'], index, false);
  if (typeof m.threads === 'string') m.threadsHtml = toHtml(m.threads, index);
  for (const h of m.handouts || []) addHtml(h, ['name', 'text'], index, true);
  for (const p of m.people || []) addHtml(p, ['playAs', 'wants', 'now', 'where'], index, true);
  return m;
}

module.exports = { present, toHtml };
