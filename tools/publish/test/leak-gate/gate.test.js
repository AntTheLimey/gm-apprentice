'use strict';
// tools/publish/test/leak-gate/gate.test.js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { leakSite, leakInto, hashTree } = require('../helpers/leak-site');
const { runLeakGate, findingId } = require('../../lib/leak-gate');

const NOTES = {
  'NPCs/Sections.md': '---\ntype: npc\n---\nThe baker is a kind man.\n\n## GM Notes\n\nThe baker poisoned the mayor last winter.\n\n- Everyone knows the bridge\n',
  'NPCs/Fields.md': '---\ntype: npc\nsecrets: She works for the drowned cult\nrelationships:\n  - target: "[[Sections]]"\n    type: serves\n    description: Reports to the baker every new moon\n    gm_only: true\n---\nA fisher. Everyone knows the bridge is unsafe.\n',
  'NPCs/Blocks.md': '---\ntype: npc\n---\nA <!-- gm-only -->The key is under the third stone<!-- /gm-only --> b.\n\n<!-- spoiler -->\nThe lighthouse keeper is already dead.\n<!-- /spoiler -->\n',
  'NPCs/Callout.md': '---\ntype: npc\n---\nText.\n\n> [!secret] Keeper\n> The cellar door opens onto the sea.\n',
  'NPCs/Comments.md': '---\ntype: npc\n---\nA <!-- remember the twins swap places at dawn --> b.\n',
  'NPCs/Draft.md': '---\ntype: npc\nstatus: planned\n---\nThe harbourmaster takes bribes from smugglers.\n',
  'NPCs/Stub.md': '---\ntype: npc\npublish: stub\npublish_include_sections: [Overview]\n---\n## Overview\n\nA quiet widow by the docks.\n\n## Plans\n\nShe plans to burn the chapel down.\n',
};
const SETTINGS = { player: { folder_map: { NPCs: 'npcs' }, hide: { callouts: true } } };

describe('leak gate: the whole gate', () => {
  let site;
  before(() => { site = leakSite(NOTES, SETTINGS); });
  after(() => site.cleanup());

  it('a clean build has no findings, and the gate writes nothing', () => {
    const before = hashTree(site.outputDir);
    const r = runLeakGate({ configPath: site.configPath, outputDir: site.outputDir });
    assert.deepEqual(r.findings, []);
    assert.equal(r.skipped, null);
    assert.ok(r.files > 0);
    assert.equal(hashTree(site.outputDir), before);
  });

  for (const [kind, sentence, note, reason] of [
    ['a section', 'The baker poisoned the mayor last winter.', 'NPCs/Sections.md', 'GM Notes section'],
    ['a field', 'She works for the drowned cult.', 'NPCs/Fields.md', 'field: secrets'],
    ['a relationship', 'Reports to the baker every new moon.', 'NPCs/Fields.md', 'GM-only relationship'],
    ['a gm-only block', 'The key is under the third stone.', 'NPCs/Blocks.md', 'gm-only block'],
    ['a spoiler', 'The lighthouse keeper is already dead.', 'NPCs/Blocks.md', 'spoiler block'],
    ['a callout', 'The cellar door opens onto the sea.', 'NPCs/Callout.md', 'secret callout'],
    ['a comment', 'Remember the twins swap places at dawn.', 'NPCs/Comments.md', 'comment'],
    ['a stub\'s cut', 'She plans to burn the chapel down.', 'NPCs/Stub.md', 'publish: stub'],
  ]) {
    it(`stops on ${kind} left on the page`, () => {
      const s = leakSite(NOTES, SETTINGS);
      try {
        leakInto(s.outputDir, 'npcs/blocks.html', sentence);
        const r = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir });
        assert.equal(r.findings.length, 1, JSON.stringify(r.findings));
        const f = r.findings[0];
        assert.deepEqual({ page: f.page, note: f.note, reason: f.reason, code: f.code }, { page: 'npcs/blocks.html', note, reason, code: 'HIDDEN_TEXT' });
        assert.equal(f.id, findingId(f.page, f.text));
      } finally { s.cleanup(); }
    });
  }

  it('stops on an unpublished note\'s text', () => {
    const s = leakSite(NOTES, SETTINGS);
    try {
      leakInto(s.outputDir, 'npcs/fields.html', 'The harbourmaster takes bribes from smugglers.');
      const [f] = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings;
      assert.equal(f.note, 'NPCs/Draft.md');
      assert.match(f.reason, /^unpublished note: /);
    } finally { s.cleanup(); }
  });

  it('also visible: hidden words a published note also says are not a finding', () => {
    // "Everyone knows the bridge" is a hidden list item and part of a published sentence on npcs/fields.html.
    const r = runLeakGate({ configPath: site.configPath, outputDir: site.outputDir });
    assert.ok(!r.findings.some((f) => /everyone knows the bridge/.test(f.text)));
  });

  it('one finding per page and piece, however often the piece repeats', () => {
    const s = leakSite(NOTES, SETTINGS);
    try {
      leakInto(s.outputDir, 'npcs/blocks.html', 'The key is under the third stone.');
      leakInto(s.outputDir, 'npcs/blocks.html', 'The key is under the third stone.');
      leakInto(s.outputDir, 'npcs/stub.html', 'The key is under the third stone.');
      const r = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir });
      assert.deepEqual(r.findings.map((f) => f.page), ['npcs/blocks.html', 'npcs/stub.html']);
    } finally { s.cleanup(); }
  });

  it('an output folder that is not there is missing, not clean', () => {
    const r = runLeakGate({ configPath: site.configPath, outputDir: `${site.outputDir}-none` });
    assert.equal(r.missing, true);
  });
});
