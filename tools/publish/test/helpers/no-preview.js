'use strict';
// Whether the text at `index` of an HTML page sits inside an element that carries
// data-no-preview (a listing container whose links get no card). A tag at `index` counts as
// inside its own element.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function insideNoPreview(html, index) {
  const stack = [];
  const tag = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  for (let m = tag.exec(html); m && m.index <= index; m = tag.exec(html)) {
    const [, closing, name, rest] = m;
    const lower = name.toLowerCase();
    if (VOID.has(lower) || rest.trimEnd().endsWith('/')) {
      if (m.index === index && /\sdata-no-preview(?=[\s=/>]|$)/.test(' ' + rest)) return true;
      continue;
    }
    if (closing) {
      const at = stack.map((e) => e.name).lastIndexOf(lower);
      if (at !== -1) stack.length = at;
    } else {
      stack.push({ name: lower, off: /\sdata-no-preview(?=[\s=/>]|$)/.test(' ' + rest) });
    }
  }
  return stack.some((e) => e.off);
}

module.exports = { insideNoPreview };
