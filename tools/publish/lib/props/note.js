'use strict';

// What makes a note a prop: `type: prop`, or a document/handout that names a `prop_file`.
// The whole tool asks these functions, so the reading of the fields lives in one place.
const { isDocumentPage, parseWikiRef, valueText } = require('../processor');
const { canonicalNfc } = require('../unicode');

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

// An unknown or missing kind is a document (planProps says so of an unknown one: unknownKindOf).
function propKindOf(fm) {
  if (!fm || !isPropNote(fm)) return 'document';
  if (String(fm.type || '').trim().toLowerCase() !== 'prop') return 'document';
  const kind = text(fm.prop_kind).toLowerCase();
  return PROP_KINDS.includes(kind) ? kind : 'document';
}

// A prop_kind a `type: prop` note sets that is not one of PROP_KINDS, as written, or null.
function unknownKindOf(fm) {
  if (!fm || String(fm.type || '').trim().toLowerCase() !== 'prop' || fm.prop_kind == null) return null;
  if (typeof fm.prop_kind !== 'string') return fm.prop_kind;
  const kind = fm.prop_kind.trim().toLowerCase();
  return kind && !PROP_KINDS.includes(kind) ? fm.prop_kind : null;
}

function propAddressOf(fm) {
  return text(fm && fm.prop_address) || null;
}

// A style name, as a folder under _meta/prop-styles/ or the plugin's prop-styles/.
const PROP_STYLE_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

// Lower-cased as written; a name that fails PROP_STYLE_RE is kept, so loadStyle can report it, and
// so is a value that is not text at all (a list, a number).
function propStyleOf(fm) {
  const raw = fm ? fm.prop_style : null;
  if (raw != null && typeof raw !== 'string') return raw;
  return text(raw).toLowerCase() || null;
}

// The note a prop sits in: the target of prop_container, bare or as a wikilink (quoted, or
// unquoted, which YAML reads as [["Target"]]).
function propContainerOf(fm) {
  const raw = valueText(fm && fm.prop_container).trim();
  return raw ? canonicalNfc(parseWikiRef(raw).target) || null : null;
}

// A container's items not yet found: listed by title (`titles`) or not at all (`none`, the default).
function showSealedOf(fm) {
  return text(fm && fm.show_sealed).toLowerCase() === 'titles' ? 'titles' : 'none';
}

module.exports = { PROP_KINDS, PROP_STYLE_RE, isPropNote, propKindOf, unknownKindOf, propFileOf, propAddressOf, propStyleOf, propContainerOf, showSealedOf };
