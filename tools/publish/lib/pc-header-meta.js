'use strict';
// The badges a PC page's header shows after the player: the note's `display_meta` list,
// else the site's `header_facts`. The one definition: the page header (templates/pc.js) and the link
// preview card (previews.js) both read it, so they cannot disagree.
const { publishedSource, plainMetaValue, plainRefValue, extractSections, stripGmOnly, NOTE_NAME_FIELDS } = require('./processor');
const { backgroundParts } = require('./pc-background');
const { excerptFromMarkdown } = require('./excerpt');
const { labelsForLinks } = require('./wikilink');

function formatLabel(fieldName) {
  return String(fieldName)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// `defaults` is the site's `header_facts` setting: what a note with no `display_meta` of its own shows.
function headerMetaFields(fm, defaults) {
  if (!Array.isArray(defaults)) throw new Error('headerMetaFields was not given the site\'s header_facts; the caller must pass publishConfig.header_facts');
  return Array.isArray(fm.display_meta) ? fm.display_meta : defaults;
}

// [label, text] for each header badge that has a value, in order. The text is what the
// reader sees: a wikilink as its label, a Date as the date written, a bare note name as
// words (a field that names a note, see NOTE_NAME_FIELDS).
// A field the page knows names a note, or a value of a field it does not know that is written
// as a note's name is: capitals, underscores, no spaces (`Old_Tom`). A lower-case one
// (`field_agent`) is free text and keeps its underscores.
const BARE_NOTE_NAME = /^\p{Lu}[^\s\[\]|]*_[^\s\[\]|]*$/u;
const namesNote = (field, raw) => NOTE_NAME_FIELDS.has(field) || (typeof raw === 'string' && BARE_NOTE_NAME.test(raw.trim()));

function headerMeta(fm, defaults) {
  return headerMetaFields(fm, defaults)
    .filter(field => fm[field] != null && fm[field] !== '')
    .map(field => [formatLabel(field), (namesNote(field, fm[field]) ? plainRefValue(fm[field]) : plainMetaValue(fm[field])).trim()]);
}

// The hook a PC page opens with, first that says something: the note's `hook`, the first
// sentence of its backstory (`### Backstory`, or the older one-line field), its key_traits,
// the first sentence of the published body with the sheet's own lines dropped. The one
// definition: the page (templates/pc.js), the preview card (previews.js) and the Characters
// index card all call it. Printed as the prologue shows it: a labelled link the GM wrote prints its
// label (read in the source), and a `[[ ]]` a player typed (escaped by the sync) stays as typed.
function pcEpithetText(page) {
  const fm = page.frontmatter || {};
  const hook = labelsForLinks(typeof fm.hook === 'string' ? fm.hook : '').trim();
  if (hook) return hook;
  // A gm-only block goes whole: a source that still holds one (the note itself, when the
  // build gave no published text) must not give it up unmarked.
  const source = stripGmOnly(publishedSource(page));
  // Any other comment is an authoring note, never story (the renderer would print it as text).
  const parts = backgroundParts(extractSections(labelsForLinks(source.replace(/<!--[\s\S]*?(?:-->|$)/g, ''))));
  const opening = parts ? parts.firstSentence.trim() : '';
  if (opening) return opening;
  const traits = Array.isArray(fm.key_traits)
    ? fm.key_traits.map(t => String(t == null ? '' : t).trim()).filter(Boolean).join(', ')
    : String(fm.key_traits || '');
  return labelsForLinks(traits).trim() || excerptFromMarkdown(source, { skipSheetLines: true });
}

module.exports = { headerMetaFields, headerMeta, pcEpithetText };
