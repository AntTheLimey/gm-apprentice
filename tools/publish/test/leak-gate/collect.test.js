'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { leakSite } = require('../helpers/leak-site');
const { collectHidden } = require('../../lib/leak-gate/collect');

const NOTES = {
  'NPCs/Sections.md': '---\ntype: npc\n---\nThe baker is a kind man.\n\n## GM Notes\n\nThe baker poisoned the mayor last winter.\n',
  'NPCs/Fields.md': '---\ntype: npc\nsecrets: She works for the drowned cult\nrelationships:\n  - target: "[[Sections]]"\n    type: serves\n    description: Reports to the baker every new moon\n    gm_only: true\n---\nA fisher.\n',
  'NPCs/Blocks.md': '---\ntype: npc\n---\nA <!-- gm-only -->The key is under the third stone<!-- /gm-only --> b.\n\n<!-- spoiler -->\nThe lighthouse keeper is already dead.\n<!-- /spoiler -->\n',
  'NPCs/Callout.md': '---\ntype: npc\n---\nText.\n\n> [!secret] Keeper\n> The cellar door opens onto the sea.\n',
  'NPCs/Comments.md': '---\ntype: npc\n---\nA <!-- remember the twins swap places at dawn --> b %% the vicar lies about his brother %% c.\n',
  'NPCs/Draft.md': '---\ntype: npc\nstatus: planned\n---\nThe harbourmaster takes bribes from smugglers.\n',
  'NPCs/Stub.md': '---\ntype: npc\npublish: stub\npublish_include_sections: [Overview]\n---\n## Overview\n\nA quiet widow by the docks.\n\n## Plans\n\nShe plans to burn the chapel down.\n',
  'NPCs/Repeated.md': '---\ntype: npc\n---\nEveryone knows the bridge is unsafe.\n\n## GM Notes\n\nEveryone knows the bridge is unsafe.\n',
};

describe('leak gate: collect', () => {
  let site; let got;
  before(() => {
    site = leakSite(NOTES, { player: { folder_map: { NPCs: 'npcs' }, hide: { callouts: true } } });
    got = collectHidden({ configPath: site.configPath });
  });
  after(() => site.cleanup());

  const reasonOf = (sentence) => {
    const p = got.pieces.find((x) => x.text === sentence);
    return p ? `${p.note} | ${p.reason}` : null;
  };
  for (const [sentence, expected] of [
    ['the baker poisoned the mayor last winter', 'NPCs/Sections.md | GM Notes section'],
    ['she works for the drowned cult', 'NPCs/Fields.md | field: secrets'],
    ['reports to the baker every new moon', 'NPCs/Fields.md | GM-only relationship'],
    ['the key is under the third stone', 'NPCs/Blocks.md | gm-only block'],
    ['the lighthouse keeper is already dead', 'NPCs/Blocks.md | spoiler block'],
    ['the cellar door opens onto the sea', 'NPCs/Callout.md | secret callout'],
    ['remember the twins swap places at dawn', 'NPCs/Comments.md | comment'],
    ['the vicar lies about his brother', 'NPCs/Comments.md | comment'],
    ['the harbourmaster takes bribes from smugglers', null],   // checked below: an unpublished note's reason names the rule
    ['she plans to burn the chapel down', 'NPCs/Stub.md | publish: stub'],
  ]) {
    it(`collects "${sentence}"`, () => {
      const p = got.pieces.find((x) => x.text === sentence);
      assert.ok(p, `not collected: ${sentence}`);
      if (expected) assert.equal(reasonOf(sentence), expected);
    });
  }
  it('names why an unpublished note is hidden', () => {
    const p = got.pieces.find((x) => x.text === 'the harbourmaster takes bribes from smugglers');
    assert.equal(p.note, 'NPCs/Draft.md');
    assert.match(p.reason, /^unpublished note: /);
  });
  it('keeps the player site\'s own text as visible source', () => {
    assert.ok(got.visible.some((t) => /The baker is a kind man\./.test(t)));
    assert.ok(got.visible.some((t) => /Everyone knows the bridge is unsafe\./.test(t)));
    assert.ok(!got.visible.some((t) => /poisoned the mayor/.test(t)));
  });
  it('notes in the never-published housekeeping folders are not collected (they quote the site)', () => {
    const p = leakSite({
      'NPCs/A.md': '---\ntype: npc\n---\nThe baker is a kind man.\n',
      '_QA/Audit.md': '---\ntype: meta\n---\nThe audit quotes the baker is a kind man here.\n',
      '_inbox/Chat.md': 'An old chat says the miller drowned his wife.\n',
      '_Templates/NPC.md': 'A template sentence of many words.\n',
      'Prep/Draft.md': '---\ntype: npc\npublish: false\n---\nThe harbourmaster takes bribes from smugglers.\n',
    }, { player: { folder_map: { NPCs: 'npcs', Prep: 'prep' }, hide: { folders: ['_QA', '_inbox'] } } });
    try {
      const c = collectHidden({ configPath: p.configPath });
      const notes = new Set(c.pieces.map((x) => x.note));
      assert.ok(notes.has('Prep/Draft.md'), 'an unpublished note outside them is still collected');
      for (const n of ['_QA/Audit.md', '_inbox/Chat.md', '_Templates/NPC.md']) assert.ok(!notes.has(n), `${n} was collected`);
    } finally { p.cleanup(); }
  });
  it('a vault kept by a player collects nothing', () => {
    const p = leakSite({ 'NPCs/A.md': '---\ntype: npc\n---\n## GM Notes\n\nThis is a secret sentence here.\n' }, { vault: { kept_by: 'player' }, gm: { publish: false } });
    try {
      const c = collectHidden({ configPath: p.configPath });
      assert.equal(c.keptBy, 'player');
      assert.deepEqual(c.pieces, []);
    } finally { p.cleanup(); }
  });
});
