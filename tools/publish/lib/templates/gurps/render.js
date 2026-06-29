const { escapeHtml } = require('../../processor');

const GLYPHS = ['*', '†', '‡', '§', '¶', '#'];

function splitMarkers(text) {
  const s = String(text == null ? '' : text).trim();
  const m = s.match(/^(.*?)([*†‡§¶#◇]+)$/);
  if (!m) return { value: s, markers: [] };
  return { value: m[1].trim(), markers: m[2].split('') };
}

/**
 * Strip surrounding [ ] brackets from a cost cell and split trailing footnote markers.
 * Input examples: '[15]', '[-30]', '[1]†', '[15] †'
 * Returns { value: '15', markers: ['†'] }
 */
function stripCost(text) {
  const s = String(text == null ? '' : text).trim();
  // Remove surrounding [ ] (with optional sign inside)
  const bracketed = s.match(/^\[([^\]]*)\]\s*(.*)$/);
  if (bracketed) {
    const inner = bracketed[1].trim();
    const rest = bracketed[2].trim();
    // rest may hold trailing footnote markers
    const { value, markers } = splitMarkers(inner);
    const { markers: restMarkers } = splitMarkers(rest);
    return { value, markers: [...markers, ...restMarkers] };
  }
  // No brackets — fall through to plain splitMarkers
  return splitMarkers(s);
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

module.exports = { splitMarkers, stripCost, footnoteRegistry, block, cost, wide };
