'use strict';
// tools/publish/test/leak-gate/own-pages.test.js
// A GM's own page (player_site.own_pages, #850) moves to its kept copy when the build frames it: map/index.html ->
// map/index.own.html. A sentence the GM accepted on the address before must still cover it on the copy, and the accept
// is still needed, or the first deploy after turning own_pages on stops on findings already decided (#878, Dead End).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { leakSite } = require('../helpers/leak-site');
const { runLeakGate } = require('../../lib/leak-gate');
const { writeAccepted } = require('../../lib/manifest');

const SENTENCE = 'The baker poisoned the mayor last winter.';
const TEXT = 'the baker poisoned the mayor last winter';
const NOTES = { 'NPCs/Baker.md': `---\ntype: npc\n---\nThe baker is a kind man.\n\n## GM Notes\n\n${SENTENCE}\n` };
const gate = (s) => runLeakGate({ configPath: s.configPath, outputDir: s.outputDir });
// What a step's page holding the sentence looks like once the build has framed it: the page at its kept copy.
function ownCopy(s, rel) {
  const file = path.join(s.outputDir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `<!DOCTYPE html><html><head><title>Map</title></head><body><p>${SENTENCE}</p></body></html>`);
}
const settings = (own) => ({ player: { folder_map: { NPCs: 'npcs' }, own_pages: own } });

describe('leak gate: a GM\'s own page under the menu', () => {
  it('a sentence accepted on the address covers it on the kept copy, and the accept is still needed', () => {
    const s = leakSite(NOTES, settings(['map/index.html']));
    try {
      ownCopy(s, 'map/index.own.html');
      assert.deepEqual(gate(s).findings.map((f) => f.page), ['map/index.own.html'], 'unaccepted, it is a finding');
      writeAccepted(path.join(s.root, 'vault'), [{ page: 'map/index.html', text: TEXT, note: 'NPCs/Baker.md' }]);
      const r = gate(s);
      assert.deepEqual(r.findings, []);
      assert.deepEqual(r.unneeded, []);
    } finally { s.cleanup(); }
  });

  it('a .htm address covers its own copy too', () => {
    const s = leakSite(NOTES, settings(['atlas.htm']));
    try {
      ownCopy(s, 'atlas.own.htm');
      writeAccepted(path.join(s.root, 'vault'), [{ page: 'atlas.htm', text: TEXT, note: 'NPCs/Baker.md' }]);
      assert.deepEqual(gate(s).findings, []);
    } finally { s.cleanup(); }
  });

  it('a page named like a copy that is not one listed is not covered by its look-alike address', () => {
    const s = leakSite(NOTES, settings([]));
    try {
      ownCopy(s, 'map/index.own.html');
      writeAccepted(path.join(s.root, 'vault'), [{ page: 'map/index.html', text: TEXT, note: 'NPCs/Baker.md' }]);
      const r = gate(s);
      assert.deepEqual(r.findings.map((f) => f.page), ['map/index.own.html']);
      assert.deepEqual(r.unneeded.map((a) => a.page), ['map/index.html']);
    } finally { s.cleanup(); }
  });

  it('a sentence accepted on the kept copy itself still covers it there', () => {
    const s = leakSite(NOTES, settings(['map/index.html']));
    try {
      ownCopy(s, 'map/index.own.html');
      writeAccepted(path.join(s.root, 'vault'), [{ page: 'map/index.own.html', text: TEXT, note: 'NPCs/Baker.md' }]);
      const r = gate(s);
      assert.deepEqual([r.findings, r.unneeded], [[], []]);
    } finally { s.cleanup(); }
  });
});
