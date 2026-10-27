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

  // The page runs a note's blocks together in order: a table row's cells, a callout's title and its text.
  for (const [kind, published, hidden] of [
    ['a table read across its cells', '| Stat | Value |\n| --- | --- |\n| STR | 55 |\n| CON | 60 |\n| Dodge | 30% (15/6) |', 'STR: 55 CON: 60 Dodge 30% (15/6)'],
    ['a callout title and its text', '> [!info] Source\n> the tavern ledger was copied by hand.', 'Source: the tavern ledger was copied by hand.'],
    ['a table printed without its header row (a sheet)', '**Wealth:**\n\n| Attribute | Value |\n| --- | --- |\n| Spending Level | 2 |\n| Cash | 40 |', 'Wealth: Spending Level: £2 | Cash: £40'],
    ['a heading','### Rank is served, not stated\n\nThe soup comes first.', 'Rank is served, not stated.'],
    ['a table cell holding labelled links', '| When | What |\n| --- | --- |\n| Night | [[Mayor|The mayor]] and [[Baker|the baker]] scout the old mill. |', 'The mayor and the baker scout the old mill.'],
  ]) {
    it(`hidden text a published note says as ${kind} is not a finding`, () => {
      const site = leakSite({
        'NPCs/Baker.md': `---\ntype: npc\n---\n${published}\n`,
        'Prep/Draft.md': `---\ntype: npc\npublish: false\n---\n${hidden}\n`,
      }, SETTINGS);
      try {
        // The page prints the published note's words in that run (a sheet prints a table without its header row).
        leakInto(site.outputDir, 'npcs/baker.html', hidden);
        assert.deepEqual(gate(site).findings, []);
      } finally { site.cleanup(); }
    });
  }

  it('a published field, as its label and value or under its note\'s title, is not a finding', () => {
    const site = leakSite({
      'NPCs/Sir Andrew Duncan.md': '---\ntype: npc\nrole: Junior government minister\n---\nA minister.\n',
      'NPCs/Lord Digby.md': '---\ntype: npc\noccupation: Retired colonial officer\nmood: Cheerful and very loud\n---\nA lord.\n',
      'Prep/Draft.md': '---\ntype: npc\npublish: false\n---\n- Sir Andrew Duncan (Junior government minister)\n- Role: Retired colonial officer\n- Mood: Cheerful and very loud\n',
    }, SETTINGS);
    try {
      // occupation prints as "Role" (the label the tool's pages give it); other fields by their own name.
      leakInto(site.outputDir, 'npcs/lord-digby.html', 'Role: Retired colonial officer. Sir Andrew Duncan (Junior government minister). Mood: Cheerful and very loud.');
      assert.deepEqual(gate(site).findings, []);
    } finally { site.cleanup(); }
  });

  it('a hidden piece that is only the site\'s public names (a list of mentions) is not a finding', () => {
    const site = leakSite({
      'NPCs/Emma Wentworth.md': '---\ntype: npc\n---\nA lady.\n',
      'NPCs/Marina Garrick.md': '---\ntype: npc\n---\nA lady.\n',
      'Prep/Draft.md': '---\ntype: npc\npublish: false\n---\n- Emma Wentworth, Marina Garrick\n- Emma Wentworth fears Marina Garrick\n',
    }, SETTINGS);
    try {
      leakInto(site.outputDir, 'npcs/emma-wentworth.html', 'Emma Wentworth, Marina Garrick. Emma Wentworth fears Marina Garrick.');
      assert.deepEqual(gate(site).findings.map((f) => f.text), ['emma wentworth fears marina garrick']);
    } finally { site.cleanup(); }
  });

  // A page's title heads its body in place of the note's own leading H1, so "[[Wrap Up]] — narrative recap" in a GM's
  // source list is the page's title and the heading players read under it (Canticle, 2026-10-27).
  const WRAP = { 'Sessions/Wrap Up One.md': '---\ntype: event\n---\n# The First Night (Wrap-Up)\n\n## Narrative Recap\n\nThe party met at the inn.\n\n## GM Notes\n\n### Hidden Ending\n\nThe innkeeper is the thief.\n' };
  const SOURCES = (line) => ({ 'NPCs/Baker.md': `---\ntype: npc\n---\nThe baker.\n\n## GM Notes\n\n### Source References\n\n- ${line}\n` });
  const WRAP_SETTINGS = { player: { folder_map: { ...SETTINGS.player.folder_map, Sessions: 'sessions' } } };

  it('a page\'s title and the heading under it, named in GM Notes, is not a finding', () => {
    const site = leakSite({ ...WRAP, ...SOURCES('[[Wrap Up One]] — narrative recap') }, WRAP_SETTINGS);
    try { assert.deepEqual(gate(site).findings, []); } finally { site.cleanup(); }
  });

  it('a page\'s title and a heading players do not see is still found', () => {
    const site = leakSite({ ...WRAP, ...SOURCES('[[Wrap Up One]] — hidden ending') }, WRAP_SETTINGS);
    try {
      leakInto(site.outputDir, 'sessions/wrap-up-one.html', 'Wrap Up One hidden ending');
      assert.deepEqual(gate(site).findings.map((f) => f.text), ['wrap up one hidden ending']);
    } finally { site.cleanup(); }
  });

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
