'use strict';
// The badges a PC page's header shows after the player: the note's `display_meta` list,
// else the defaults. The one definition: the page header (templates/pc.js) and the link
// preview card (previews.js) both read it, so they cannot disagree.
const DEFAULT_META_FIELDS = ['occupation', 'age', 'nationality'];

function formatLabel(fieldName) {
  return String(fieldName)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function headerMetaFields(fm) {
  return Array.isArray(fm.display_meta) ? fm.display_meta : DEFAULT_META_FIELDS;
}

// [label, raw frontmatter value] for each header badge that has a value, in order.
function headerMeta(fm) {
  return headerMetaFields(fm)
    .filter(field => fm[field] != null && fm[field] !== '')
    .map(field => [formatLabel(field), fm[field]]);
}

module.exports = { headerMetaFields, headerMeta };
