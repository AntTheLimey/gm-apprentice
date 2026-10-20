'use strict';
// tools/publish/test/leak-gate/search-index.test.js
// The gate does not judge search-index.json by its word lists. An entry's body is its page's whole published text,
// which can hold words the page's HTML does not print (a PC's story companion, its Current Status prose), and the
// words come with no order: a hidden piece whose words an entry shares is not a sentence that entry holds. 1.10.79
// read it so, and stopped a real deploy on 403 findings, every one public text (#408 reopened). The build keeps the
// text the index is made from (index-text.js), and the gate reads that sentence by sentence, as it reads a page.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { leakSite, leakIntoIndex } = require('../helpers/leak-site');
const { runLeakGate } = require('../../lib/leak-gate');
const { indexTextPath } = require('../../lib/leak-gate/index-text');
const { stripMarkdown } = require('../../lib/search-index');

const NOTES = {
  'NPCs/Sections.md': '---\ntype: npc\n---\nThe baker is a kind man.\n\n## GM Notes\n\nThe baker poisoned the mayor last winter.\n',
  'NPCs/Fisher.md': '---\ntype: npc\n---\nA fisher by the old bridge.\n',
};
const SETTINGS = { player: { folder_map: { NPCs: 'npcs', Prep: 'prep' } } };
const gate = (s) => runLeakGate({ configPath: s.configPath, outputDir: s.outputDir });
const keptOf = (s) => JSON.parse(fs.readFileSync(indexTextPath(path.dirname(s.configPath)), 'utf8'));

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
      assert.deepEqual(gate(s).findings, []);
    } finally { s.cleanup(); }
  });

  it('the build keeps the text each entry was made from, beside the site, with the hash of the index it made', () => {
    const s = leakSite(NOTES, SETTINGS);
    try {
      const kept = keptOf(s);
      const index = fs.readFileSync(path.join(s.outputDir, 'search-index.json'), 'utf8');
      assert.equal(kept.index, crypto.createHash('sha256').update(index).digest('hex'));
      const fisher = kept.entries.find((e) => e.href === 'npcs/fisher.html');
      assert.ok(fisher.texts.includes('A fisher by the old bridge.'));
      assert.ok(!JSON.stringify(kept).includes('poisoned'));
      assert.ok(!fs.readdirSync(s.outputDir).some((f) => /index-text/.test(f)));
      const r = gate(s);
      assert.deepEqual([r.findings, r.warnings], [[], []]);
    } finally { s.cleanup(); }
  });

  it('a hidden sentence that reaches only the index is a finding, named after the index and its entry\'s page', () => {
    const s = leakSite(NOTES, SETTINGS);
    try {
      leakIntoIndex(s, 'npcs/fisher.html', 'The baker poisoned the mayor last winter.');
      const findings = gate(s).findings;
      assert.deepEqual(findings.map((f) => [f.code, f.page, f.note, f.text]),
        [['HIDDEN_TEXT', 'search-index.json#npcs/fisher.html', 'NPCs/Sections.md', 'the baker poisoned the mayor last winter']]);
    } finally { s.cleanup(); }
  });

  it('a sentence accepted on a page, before the index was read, also covers its copy in that page\'s index entry', () => {
    const { leakInto } = require('../helpers/leak-site');
    const { writeAccepted } = require('../../lib/manifest');
    const s = leakSite(NOTES, SETTINGS);
    try {
      const sentence = 'The baker poisoned the mayor last winter.';
      leakInto(s.outputDir, 'npcs/fisher.html', sentence);
      leakIntoIndex(s, 'npcs/fisher.html', sentence);
      leakIntoIndex(s, 'npcs/sections.html', sentence);
      // The accept as the tool wrote it before this release: the page and the sentence, nothing for the index.
      writeAccepted(path.join(s.root, 'vault'), [{ page: 'npcs/fisher.html', text: 'the baker poisoned the mayor last winter', note: 'NPCs/Sections.md' }]);
      const r = gate(s);
      // Only the copy in another page's entry is new; the accept is still needed.
      assert.deepEqual(r.findings.map((f) => f.page), ['search-index.json#npcs/sections.html']);
      assert.deepEqual(r.unneeded, []);
      // With the page's own copy gone, the index copy still needs the accept: prune must not remove it.
      fs.writeFileSync(path.join(s.outputDir, 'npcs', 'fisher.html'), fs.readFileSync(path.join(s.outputDir, 'npcs', 'fisher.html'), 'utf8').replace(`<p>${sentence}</p>`, ''));
      assert.deepEqual(gate(s).unneeded, []);
    } finally { s.cleanup(); }
  });

  it('public text in the index that no page prints is no finding, a copy of it in a draft included', () => {
    const s = leakSite({ ...NOTES, 'Prep/Draft.md': '---\ntype: npc\npublish: false\n---\nThe baker is a kind man.\n' }, SETTINGS);
    try {
      leakIntoIndex(s, 'npcs/fisher.html', 'The baker is a kind man.');
      assert.deepEqual(gate(s).findings, []);
    } finally { s.cleanup(); }
  });

  // Canticle: the index read [[Sona_Mia]] as "SonaMia", the page as "Sona Mia"; the GM's play notes say "Sonamia".
  it('a published sentence with a link to an underscored note name, copied into a draft, is no finding', () => {
    const sentence = 'The helmsman Sonamia sat outside the cabin polishing his silver buckle.';
    const s = leakSite({
      'NPCs/Sona_Mia.md': '---\ntype: npc\n---\nA helmsman.\n',
      'NPCs/Ship.md': `---\ntype: npc\n---\n${sentence.replace('Sonamia', '[[Sona_Mia]]')}\n`,
      'Prep/Notes.md': `---\ntype: npc\npublish: false\n---\n${sentence}\n`,
    }, SETTINGS);
    try { assert.deepEqual(gate(s).findings, []); } finally { s.cleanup(); }
  });

  it('an index the kept text was not made for is not read for sentences, and the check says so', () => {
    const s = leakSite(NOTES, SETTINGS);
    try {
      leakIntoIndex(s, 'npcs/fisher.html', 'The baker poisoned the mayor last winter.');
      addTerms(s.outputDir, 'npcs/fisher.html', ['heron']);
      const r = gate(s);
      assert.deepEqual(r.findings, []);
      assert.equal(r.warnings.length, 1);
      assert.match(r.warnings[0], /search-index\.json .*not read for hidden sentences.*Build the site again/);
    } finally { s.cleanup(); }
  });

  it('the index reads an underscore as a space, as a page does', () => {
    assert.equal(stripMarkdown('The helmsman [[Sona_Mia]] sat by snake_case.'), 'The helmsman Sona Mia sat by snake case.');
  });
});
