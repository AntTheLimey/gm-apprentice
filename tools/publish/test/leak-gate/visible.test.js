'use strict';
// tools/publish/test/leak-gate/visible.test.js
// A clean site is clean: hidden text a published note also says (the GM repeated a sentence, or copied a published
// paragraph into a draft) is read through the same piece-maker on both sides, whatever markdown the sentence carries.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { leakSite, leakInto } = require('../helpers/leak-site');
const { runLeakGate } = require('../../lib/leak-gate');

const SETTINGS = { player: { folder_map: { NPCs: 'npcs', Prep: 'prep' } } };
const MAYOR = { 'NPCs/Mayor.md': '---\ntype: npc\n---\nThe mayor.\n' };
const gate = (site) => runLeakGate({ configPath: site.configPath, outputDir: site.outputDir });

// Each case: the sentence as the published note writes it. It is repeated under GM Notes, and copied into a draft.
const CASES = [
  ['a labelled wikilink', 'The [[Mayor|old mayor]] owes the baker money.'],
  ['a markdown link', 'The [old mayor](https://example.com/mayor) owes the baker money.'],
  ['inline HTML', 'The <span class="title">old mayor</span> owes the baker money.'],
  ['bold', 'The **old mayor** owes the baker money.'],
  ['a table cell', '| Who | What |\n| --- | --- |\n| Debt | The [old mayor](https://example.com/mayor) owes the baker money |'],
];

describe('leak gate: also visible, read as the page reads it', () => {
  for (const [kind, sentence] of CASES) {
    it(`a sentence with ${kind} repeated under GM Notes is not a finding`, () => {
      const site = leakSite({ ...MAYOR, 'NPCs/Baker.md': `---\ntype: npc\n---\n${sentence}\n\n## GM Notes\n\n${sentence}\n` }, SETTINGS);
      try { assert.deepEqual(gate(site).findings, []); } finally { site.cleanup(); }
    });

    it(`a published sentence with ${kind} copied into a draft is not a finding`, () => {
      const site = leakSite({
        ...MAYOR,
        'NPCs/Baker.md': `---\ntype: npc\n---\n${sentence}\n`,
        'Prep/Draft.md': `---\ntype: npc\npublish: false\n---\n${sentence}\n`,
      }, SETTINGS);
      try { assert.deepEqual(gate(site).findings, []); } finally { site.cleanup(); }
    });
  }

  it('a hidden sentence the site does not say is still found', () => {
    const site = leakSite({
      ...MAYOR,
      'NPCs/Baker.md': '---\ntype: npc\n---\nThe [[Mayor|old mayor]] owes the baker money.\n\n## GM Notes\n\nThe [[Mayor|old mayor]] murdered the miller.\n',
    }, SETTINGS);
    try {
      leakInto(site.outputDir, 'npcs/baker.html', 'The old mayor murdered the miller.');
      assert.deepEqual(gate(site).findings.map((f) => f.text), ['the old mayor murdered the miller']);
    } finally { site.cleanup(); }
  });
});
