'use strict';
// A bookcase container with a hand-made page and a state file (prop_state), and what it holds: a shown book with
// pictures and fields, a sealed book, a withheld one. Text is original to these tests.
const { listFileText } = require('./publish-list');

const SEALED_TITLE = 'The Sealed Volume of Hours';
const SEALED_LINE = 'Bound in grey leather with three iron straps';
const HIDDEN_FIELD = 'Stamped inside by the smuggler Corwin Hale';
const ODD = 'Ends with </script><b>bold</b> on purpose';

const BOOKCASE = (extra = '') => `---\ntype: prop\nprop_kind: container\nshow_sealed: titles\nprop_file: bookcase.html\nprop_state: state.js\nprop_state_global: LIBRARY\n${extra}---\nA narrow bookcase by the window.\n`;
const BOOKCASE_HTML = '<!doctype html><html><head><title>Bookcase</title></head><body><div id="shelf"></div><script src="state.js"></script><script src="shelf.js"></script></body></html>';

// The publish list: the bookcase and the atlas, and any more notes.
const LIST = (more = []) => ({ '_meta/publish-list.yaml': listFileText({ publishing: ['Library/Bookcase.md', 'Library/Atlas of the Coast.md', ...more] }) });

const FILES = (over = {}) => ({
  'Library/Bookcase.md': BOOKCASE(),
  'Library/bookcase.html': BOOKCASE_HTML,
  'Library/shelf.js': 'for (const k of Object.keys(window.LIBRARY)) document.getElementById("shelf").append(k);\n',
  'Library/state.js': 'window.LIBRARY = { "old": { "title": "The vault copy of the shelf state" } };\n',
  'Library/covers/atlas.png': 'PNG-ATLAS',
  'Library/covers/sealed.png': 'PNG-SEALED',
  'Library/covers/stamp.png': 'PNG-STAMP',
  'outside.png': 'PNG-OUTSIDE',
  'Library/Atlas of the Coast.md': `---\ntype: prop\nprop_container: "[[Bookcase]]"\nprop_line: Charts of every cove and inlet\nprop_cover: covers/atlas.png\nprop_spine: Blue cloth\nprop_pages: 212\nprop_back: ../outside.png\nprop_stamp: covers/stamp.png\nprop_secret: ${HIDDEN_FIELD}\nprop_odd: "${ODD}"\n---\nA salt-stained atlas.\n`,
  [`Library/${SEALED_TITLE}.md`]: `---\ntype: prop\nprop_container: "[[Bookcase]]"\nprop_line: ${SEALED_LINE}\nprop_cover: covers/sealed.png\n---\nA book of hours nobody has opened.\n`,
  'Library/Ledger of Debts.md': '---\ntype: prop\nprop_container: "[[Bookcase]]"\nwithheld: true\nprop_line: Every sum the harbourmaster owes\n---\nA ledger.\n',
  ...LIST(),
  ...over,
});

// The fields the player site hides.
const SETTINGS = { player: { hide: { fields: ['prop_secret', 'prop_stamp'] } } };

// The value a state file sets, read as the hand-made page's script would.
function stateOf(text) {
  const window = {};
  new Function('window', text)(window);
  return window;
}

module.exports = { FILES, LIST, BOOKCASE, SETTINGS, SEALED_TITLE, SEALED_LINE, HIDDEN_FIELD, ODD, stateOf };
