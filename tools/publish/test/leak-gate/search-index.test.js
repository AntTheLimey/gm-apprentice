'use strict';
// tools/publish/test/leak-gate/search-index.test.js
// The gate does not judge search-index.json by its word lists. An entry's body is its page's whole published text,
// which can hold words the page's HTML does not print (a PC's story companion, its Current Status prose), and the
// words come with no order: a hidden piece whose words an entry shares is not a sentence that entry holds. 1.10.79
// read it so, and stopped a real deploy on 403 findings, every one public text (#408 reopened).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { leakSite } = require('../helpers/leak-site');
const { runLeakGate } = require('../../lib/leak-gate');

const NOTES = {
  'NPCs/Sections.md': '---\ntype: npc\n---\nThe baker is a kind man.\n\n## GM Notes\n\nThe baker poisoned the mayor last winter.\n',
  'NPCs/Fisher.md': '---\ntype: npc\n---\nA fisher by the old bridge.\n',
};
const SETTINGS = { player: { folder_map: { NPCs: 'npcs' } } };

// The site's index with `terms` added to the body of the entry for `href`.
function addTerms(dir, href, terms) {
  const file = path.join(dir, 'search-index.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ref = Object.keys(data.documents).find((r) => data.documents[r].href === href);
  assert.ok(ref, `no entry for ${href}`);
  const inverted = new Map(data.index.invertedIndex);
  for (const term of terms) {
    if (!inverted.has(term)) inverted.set(term, { _index: inverted.size, title: {}, aliases: {}, type: {}, body: {} });
    inverted.get(term).body[ref] = {};
  }
  data.index.invertedIndex = [...inverted].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  fs.writeFileSync(file, JSON.stringify(data));
}

describe('leak gate: the search index', () => {
  it('an entry holding words its page does not print, which a hidden piece shares, is no finding', () => {
    const s = leakSite(NOTES, SETTINGS);
    try {
      addTerms(s.outputDir, 'npcs/fisher.html', ['the', 'baker', 'poisoned', 'mayor', 'last', 'winter']);
      assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings, []);
    } finally { s.cleanup(); }
  });
});
