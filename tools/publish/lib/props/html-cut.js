'use strict';

// A hand-made prop page is the GM's own HTML, so the Keeper parts come out by marker,
// not by Markdown rules: `%%` is text here, and no code fence hides a marker (a marker in
// a <pre> over-cuts, it never under-cuts). Then every other HTML comment goes.
const { markersIn } = require('../markers');

const UNCLOSED_BLOCK = 'unclosed <!-- gm-only --> marker in a prop file — the rest of the file is cut';
const ORPHAN_CLOSER = 'a <!-- /gm-only --> marker with nothing open in a prop file';
const UNCLOSED_COMMENT = 'an HTML comment in a prop file never closes — the rest of the file is cut';

function cutHtml(text) {
  const source = String(text);
  const cut = [];
  const warnings = [];
  let out = '';
  let pos = 0;
  let depth = 0;
  let open = null;
  for (const m of markersIn(source)) {
    if (!m.close) {
      if (depth === 0) { out += source.slice(pos, m.index); open = m; }
      depth += 1;
    } else if (depth === 0) {
      warnings.push(ORPHAN_CLOSER);
      out += source.slice(pos, m.index);
      cut.push(source.slice(m.index, m.index + m.length));
      pos = m.index + m.length;
    } else {
      depth -= 1;
      if (depth === 0) {
        cut.push(source.slice(open.index + open.length, m.index));
        pos = m.index + m.length;
        open = null;
      }
    }
  }
  if (open) {
    warnings.push(UNCLOSED_BLOCK);
    cut.push(source.slice(open.index + open.length));
  } else {
    out += source.slice(pos);
  }

  const kept = out.replace(/<!--([\s\S]*?)-->/g, (_, body) => { cut.push(body); return ''; });
  const dangling = kept.indexOf('<!--');
  if (dangling === -1) return { text: kept, cut, warnings };
  warnings.push(UNCLOSED_COMMENT);
  cut.push(kept.slice(dangling + 4));
  return { text: kept.slice(0, dangling), cut, warnings };
}

module.exports = { cutHtml };
