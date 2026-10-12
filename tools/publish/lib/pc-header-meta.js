'use strict';
// The badges a PC page's header shows after the player: the note's `display_meta` list,
// else the defaults. The one definition: the page header (templates/pc.js) and the link
// preview card (previews.js) both read it, so they cannot disagree.
const { publishedSource, plainMetaValue, plainRefValue, NOTE_NAME_FIELDS } = require('./processor');
const { excerptFromMarkdown } = require('./excerpt');
const { labelsForLinks } = require('./wikilink');

const DEFAULT_META_FIELDS = ['occupation', 'age', 'nationality'];

function formatLabel(fieldName) {
  return String(fieldName)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function headerMetaFields(fm) {
  return Array.isArray(fm.display_meta) ? fm.display_meta : DEFAULT_META_FIELDS;
}

// [label, text] for each header badge that has a value, in order. The text is what the
// reader sees: a wikilink as its label, a Date as the date written, a bare note name as
// words (a field that names a note, see NOTE_NAME_FIELDS).
// A field the page knows names a note, or a value of a field it does not know that is written
// as a note's name is: capitals, underscores, no spaces (`Old_Tom`). A lower-case one
// (`field_agent`) is free text and keeps its underscores.
const BARE_NOTE_NAME = /^\p{Lu}[^\s\[\]|]*_[^\s\[\]|]*$/u;
const namesNote = (field, raw) => NOTE_NAME_FIELDS.has(field) || (typeof raw === 'string' && BARE_NOTE_NAME.test(raw.trim()));

function headerMeta(fm) {
  return headerMetaFields(fm)
    .filter(field => fm[field] != null && fm[field] !== '')
    .map(field => [formatLabel(field), (namesNote(field, fm[field]) ? plainRefValue(fm[field]) : plainMetaValue(fm[field])).trim()]);
}

// The epithet a PC page opens with: key_traits when the PC has any, otherwise the first
// sentence of the published body with the sheet's own lines dropped. The one definition:
// the page (templates/pc.js) and the preview card (previews.js) both call it.
function pcEpithetText(page) {
  const fm = page.frontmatter || {};
  const traits = Array.isArray(fm.key_traits)
    ? fm.key_traits.map(t => String(t == null ? '' : t).trim()).filter(Boolean).join(', ')
    : String(fm.key_traits || '');
  // Printed as it stands, on the page and on the card: a labelled link in it prints its label.
  return labelsForLinks(traits).trim() || excerptFromMarkdown(publishedSource(page), { skipSheetLines: true });
}

module.exports = { headerMetaFields, headerMeta, pcEpithetText };
