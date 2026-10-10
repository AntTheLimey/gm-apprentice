'use strict';

// The ONE way the publish tool reads a gm-only or spoiler marker: an HTML comment holding
// the marker's name and nothing else, with `/` before the name for a closer. Capitals do
// not matter and neither does spacing inside the comment, so `<!-- GM-ONLY -->`,
// `<!--gm-only-->` and `<!-- / Gm-Only -->` are markers. A marker a strip does not read is
// a comment like any other: it is removed and the text it was meant to hide is published.
//
// skills/shared/scripts/vaultlib.py `marker_re` is this pattern in Python;
// test/fixtures/marker-vectors.json pins both.
const MARKER_NAMES = ['gm-only', 'spoiler'];

// Everything either side calls a space (JavaScript's `\s` and Python's differ by these).
const SPACE = '[\\s\\x1c-\\x1f\\x85\\ufeff]';

// A pattern for the markers named (default: both), always blind to capitals. Group 1 is
// `/` for a closer and empty for an opener; group 2 is the name as typed.
function markerRe(names = MARKER_NAMES, flags = 'g') {
  const alt = [].concat(names).join('|');
  return new RegExp(`<!--${SPACE}*(/?)${SPACE}*(${alt})${SPACE}*-->`, flags.includes('i') ? flags : flags + 'i');
}

// Every marker in `text`, in order: { name, close, index, length }.
function markersIn(text) {
  return [...String(text).matchAll(markerRe())].map((m) => (
    { name: m[2].toLowerCase(), close: m[1] === '/', index: m.index, length: m[0].length }));
}

module.exports = { MARKER_NAMES, markerRe, markersIn };
