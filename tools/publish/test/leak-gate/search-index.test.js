'use strict';
// tools/publish/test/leak-gate/search-index.test.js
// #408: a hidden sentence that reaches only search-index.json (as lunr terms, one entry's body) is found.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildSearchIndex, indexTerms } = require('../../lib/search-index');
const { leakSite } = require('../helpers/leak-site');
const { runLeakGate } = require('../../lib/leak-gate');

const NOTES = {
  'NPCs/Sections.md': '---\ntype: npc\n---\nThe baker is a kind man.\n\n## GM Notes\n\nThe baker poisoned the mayor last winter.\n',
  'NPCs/Fisher.md': '---\ntype: npc\n---\nA fisher by the old bridge.\n',
};
const SETTINGS = { player: { folder_map: { NPCs: 'npcs' } } };

// The site's index with `text` added to the body of the entry for `href`, as the build's own steps would have indexed it.
function leakIntoIndex(dir, href, text) {
  const file = path.join(dir, 'search-index.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ref = Object.keys(data.documents).find((r) => data.documents[r].href === href);
  assert.ok(ref, `no entry for ${href}`);
  const inverted = new Map(data.index.invertedIndex);
  for (const term of indexTerms(text)) {
    if (!inverted.has(term)) inverted.set(term, { _index: inverted.size, title: {}, aliases: {}, type: {}, body: {} });
    inverted.get(term).body[ref] = {};
  }
  data.index.invertedIndex = [...inverted].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  fs.writeFileSync(file, JSON.stringify(data));
}

describe('leak gate: the search index (#408)', () => {
  it('a clean build has no finding on the index', () => {
    const s = leakSite(NOTES, SETTINGS);
    try {
      assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings, []);
    } finally { s.cleanup(); }
  });

  it('a hidden sentence only the index holds is a finding on the index, with its note and why', () => {
    const s = leakSite(NOTES, SETTINGS);
    try {
      leakIntoIndex(s.outputDir, 'npcs/fisher.html', 'The baker poisoned the mayor last winter.');
      const r = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir });
      assert.deepEqual(r.findings.map((f) => [f.page, f.code, f.note, f.reason, f.text]),
        [['search-index.json', 'HIDDEN_TEXT', 'NPCs/Sections.md', 'GM Notes section', 'the baker poisoned the mayor last winter']]);
    } finally { s.cleanup(); }
  });

  it('a hidden sentence whose every word the entry\'s own page prints tells nothing new: no finding', () => {
    const notes = { ...NOTES, 'NPCs/Fisher.md': '---\ntype: npc\n---\nThe mayor poisoned the baker last winter.\n' };
    const s = leakSite(notes, SETTINGS);
    try {
      leakIntoIndex(s.outputDir, 'npcs/fisher.html', 'The baker poisoned the mayor last winter.');
      assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings, []);
    } finally { s.cleanup(); }
  });

  // The index written by the site's own builder (buildSearchIndex), with the fisher's entry holding `extra` in its body:
  // the words a real build would have stored, stop words dropped and each word trimmed as lunr trims it.
  function rebuildIndex(dir, extra) {
    const file = path.join(dir, 'search-index.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const pages = Object.values(data.documents).map((d) => ({
      outputPath: d.href, displayTitle: d.title, frontmatter: { type: d.type },
      markdown: d.href === 'npcs/fisher.html' ? `A fisher by the old bridge. ${extra}` : '',
    }));
    const built = buildSearchIndex(pages);
    fs.writeFileSync(file, JSON.stringify(built));
  }

  it('a hidden sentence with common words in it, in an index the site\'s own builder made, is found', () => {
    const s = leakSite(NOTES, SETTINGS);
    try {
      rebuildIndex(s.outputDir, 'The baker poisoned the mayor last winter.');
      const r = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir });
      assert.deepEqual(r.findings.map((f) => [f.page, f.code, f.note, f.text]),
        [['search-index.json', 'HIDDEN_TEXT', 'NPCs/Sections.md', 'the baker poisoned the mayor last winter']]);
    } finally { s.cleanup(); }
  });

  it('a hidden word with a letter outside ASCII at its edge is read as the build trims it', () => {
    const notes = { ...NOTES, 'NPCs/Sections.md': '---\ntype: npc\n---\nThe baker is a kind man.\n\n## GM Notes\n\nThe baker poisoned the owner of the café.\n' };
    const s = leakSite(notes, SETTINGS);
    try {
      rebuildIndex(s.outputDir, 'The baker poisoned the owner of the café.');
      const r = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir });
      assert.deepEqual(r.findings.map((f) => [f.page, f.note]), [['search-index.json', 'NPCs/Sections.md']]);
    } finally { s.cleanup(); }
  });

  it('a hidden piece with fewer than three words left once the common ones are dropped is too little to tell', () => {
    const notes = { ...NOTES, 'NPCs/Sections.md': '---\ntype: npc\n---\nThe baker is a kind man.\n\n## GM Notes\n\nIt was all for the baker.\n' };
    const s = leakSite(notes, SETTINGS);
    try {
      rebuildIndex(s.outputDir, 'Bread from the baker.');
      assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings, []);
    } finally { s.cleanup(); }
  });

  it('part of the sentence in the entry is not the sentence', () => {
    const s = leakSite(NOTES, SETTINGS);
    try {
      leakIntoIndex(s.outputDir, 'npcs/fisher.html', 'The baker poisoned nobody.');
      assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings, []);
    } finally { s.cleanup(); }
  });
});
