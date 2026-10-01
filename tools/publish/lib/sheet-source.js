// tools/publish/lib/sheet-source.js
// A PC's `sheet_source` note: where the character sheet is kept when it is not
// in the PC file (#273). This is the only reading of the field. The build uses
// it to decide who the "no character sheet" warning names, and `explain --all
// --json` reports it as `sheetSourceSet` so vault_check.py asks rather than
// parse the YAML a second way.

// The note's text, or '' when the PC has none. A note is text: a list is read
// as its text items joined, and anything YAML typed as something else (null, a
// boolean, a number, a date, a mapping) says nothing.
function sheetSourceOf(frontmatter) {
  const raw = (frontmatter || {}).sheet_source;
  const items = Array.isArray(raw) ? raw : [raw];
  return items.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean).join(', ');
}

module.exports = { sheetSourceOf };
