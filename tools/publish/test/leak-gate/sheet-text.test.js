'use strict';
// A PC sheet prints the note's own rows in its own order: the D&D sheet's Bonus action block runs a Class Features
// row's name into its summary ("Flurry of Blows" then "1 Focus: two Unarmed Strikes"). A hidden NPC stat block with the
// same rules words (a monk villain's "Flurry of Blows (1 Focus).") is shown there from the PC's own note, not from
// the NPC's: no finding (#752). A hidden sentence the PC's note does not hold is still one.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { leakSite, leakInto } = require('../helpers/leak-site');
const { runLeakGate } = require('../../lib/leak-gate');

const PC = '---\ntype: pc\nplayer_name: "Test Player"\nstatus: active\n---\n\n## Stat Sheet\n\n### Core\n\n'
  + '| Attribute | Value |\n|-----------|-------|\n| Level | 5 |\n\n'
  + '## Class Features\n\n| Name | Action | Uses | Used | Recovers | Summary |\n|------|--------|------|------|----------|---------|\n'
  + '| Flurry of Blows | Bonus Action |  |  |  | 1 Focus: two Unarmed Strikes |\n'
  + '| Patient Defense | Bonus Action |  |  |  | Disengage as a Bonus Action |\n';

const NPC = '---\ntype: npc\nstatus: alive\n---\n\nA monk of the high pass.\n\n<!-- gm-only -->\n### Stats\n\n'
  + '***Flurry of Blows (1 Focus).*** Two Unarmed Strikes.\n\n'
  + 'He buried the abbot under the third cairn.\n<!-- /gm-only -->\n';

const NOTES = { 'Characters/PCs/Oswin.md': PC, 'Characters/NPCs/Brother Teodor.md': NPC };
const SETTINGS = { vault: { system: 'dnd-5e-2024' } };

describe('leak gate: a PC sheet\'s own rows (#752)', () => {
  it('a hidden stat block line the PC\'s sheet prints from its own rows is no finding', () => {
    const site = leakSite(NOTES, SETTINGS);
    try {
      // The sheet runs the row's name into its summary, as the hidden line has them.
      assert.match(site.player.read('characters', 'pcs', 'oswin.html'), /Flurry of Blows<\/span><\/div><div class="dnd5e-entry-text">1 Focus/);
      const r = runLeakGate({ configPath: site.configPath, outputDir: site.outputDir });
      assert.deepEqual(r.findings, [], JSON.stringify(r.findings));
    } finally { site.cleanup(); }
  });

  it('a hidden sentence the PC\'s note does not hold is still found on the PC\'s page', () => {
    const site = leakSite(NOTES, SETTINGS);
    try {
      leakInto(site.outputDir, 'characters/pcs/oswin.html', 'He buried the abbot under the third cairn.');
      const r = runLeakGate({ configPath: site.configPath, outputDir: site.outputDir });
      assert.equal(r.findings.length, 1, JSON.stringify(r.findings));
      assert.equal(r.findings[0].code, 'HIDDEN_TEXT');
      assert.equal(r.findings[0].note, 'Characters/NPCs/Brother Teodor.md');
    } finally { site.cleanup(); }
  });

  it('with sheets off the rows are not run together, and nothing is excused for them', () => {
    // No sheet is built: the page prints the Class Features table as a table, the Action cell between a row's name
    // and its summary, so the hidden line is not on it unless something leaks it.
    const site = leakSite(NOTES, { ...SETTINGS, player: { sheets: { show: false, prose_sections: ['Class Features'] } } });
    try {
      const r = runLeakGate({ configPath: site.configPath, outputDir: site.outputDir });
      assert.deepEqual(r.findings, [], JSON.stringify(r.findings));
      leakInto(site.outputDir, 'characters/pcs/oswin.html', 'Flurry of Blows (1 Focus).');
      const leaked = runLeakGate({ configPath: site.configPath, outputDir: site.outputDir });
      assert.equal(leaked.findings.length, 1, JSON.stringify(leaked.findings));
    } finally { site.cleanup(); }
  });
});
