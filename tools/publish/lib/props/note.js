'use strict';

// What makes a note a prop: `type: prop`, or a document/handout that names a `prop_file`.
// The whole tool asks these functions, so the reading of the fields lives in one place.
const { isDocumentPage } = require('../processor');

const PROP_KINDS = ['document', 'object', 'diagram', 'supplied', 'container'];

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function propFileOf(fm) {
  return text(fm && fm.prop_file) || null;
}

function isPropNote(fm) {
  if (!fm || !isDocumentPage(fm)) return false;
  if (String(fm.type || '').trim().toLowerCase() === 'prop') return true;
  return propFileOf(fm) !== null;
}

// An unknown or missing kind is a document.
function propKindOf(fm) {
  if (!fm || !isPropNote(fm)) return 'document';
  if (String(fm.type || '').trim().toLowerCase() !== 'prop') return 'document';
  const kind = text(fm.prop_kind).toLowerCase();
  return PROP_KINDS.includes(kind) ? kind : 'document';
}

function propAddressOf(fm) {
  return text(fm && fm.prop_address) || null;
}

// A style name, as a folder under _meta/prop-styles/ or the plugin's prop-styles/.
const PROP_STYLE_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

// Lower-cased as written; a name that fails PROP_STYLE_RE is kept, so loadStyle can report it.
function propStyleOf(fm) {
  return text(fm && fm.prop_style).toLowerCase() || null;
}

module.exports = { PROP_KINDS, PROP_STYLE_RE, isPropNote, propKindOf, propFileOf, propAddressOf, propStyleOf };
