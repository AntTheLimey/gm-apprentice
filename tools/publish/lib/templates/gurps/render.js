const { escapeHtml } = require('../../processor');

const GLYPHS = ['*', '†', '‡', '§', '¶', '#', '**', '††'];

function splitMarkers(text) {
  const s = String(text == null ? '' : text).trim();
  const m = s.match(/^(.*?)([*†‡§¶#]+)$/);
  if (!m) return { value: s, markers: [] };
  return { value: m[1].trim(), markers: m[2].split('') };
}

function footnoteRegistry() {
  const entries = [];
  return {
    note(kind, text) {
      const symbol = GLYPHS[entries.length] || `[${entries.length + 1}]`;
      entries.push({ symbol, kind, text });
      return `<sup class="fn">${escapeHtml(symbol)}</sup>`;
    },
    legendHtml() {
      if (entries.length === 0) return '';
      const lines = entries.map(e => {
        const label = e.kind === 'conditional' ? 'Conditional' : 'Includes';
        return `<div class="fn-line"><sup class="fn">${escapeHtml(e.symbol)}</sup> ${escapeHtml(label)}: ${escapeHtml(e.text)}</div>`;
      }).join('\n');
      return `<div class="fn-legend">${lines}</div>`;
    },
  };
}

function block(category, title, inner) {
  if (!inner || !String(inner).trim()) return null;
  return `<section class="blk cat-${category}"><h2>${escapeHtml(title)}</h2>${inner}</section>`;
}

function cost(v) {
  return `<span class="cost">${escapeHtml(String(v))}</span>`;
}

function wide(category, title, inner) {
  if (!inner || !String(inner).trim()) return null;
  return `<div class="wide cat-${category}"><h2>${escapeHtml(title)}</h2>${inner}</div>`;
}

module.exports = { splitMarkers, footnoteRegistry, block, cost, wide };
