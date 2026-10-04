const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const { sectionsFromMarkdown } = require('../../helpers/sections');
const { renderDnDSheet, isDndConsumedTitle } = require('../../../lib/templates/dnd/index');

const FIXTURE = path.join(__dirname, '../../../../../tests/fixtures/dnd-pcs/clean.md');
const body = () => matter(fs.readFileSync(FIXTURE, 'utf8')).content.replace(/\r\n/g, '\n');
const render = md => renderDnDSheet({ type: 'pc' }, sectionsFromMarkdown(md));

describe('renderDnDSheet', () => {
  it('returns every part for a filled sheet', () => {
    const out = render(body());
    assert.match(out.sheetHtml, /dnd5e-sheet dnd5e-tab-sheet/);
    assert.match(out.sheetHtml, /dnd5e-header"><span>Level 5<\/span>/);
    assert.match(out.vitalsHtml, /dnd5e-vitals/);
    assert.match(out.spellsHtml, /Spell Save DC/);
    assert.deepEqual(out.warnings, []);
  });
  it('has no spells part for a non-caster', () => {
    const out = render(body().replace(/## Spellcasting[\s\S]*$/, ''));
    assert.equal(out.spellsHtml, null);
  });
  it('is sheetless for a note with only prose', () => {
    const out = render('## Stat Sheet\n\nSee D&D Beyond.\n');
    assert.equal(out.sheetHtml, null);
    assert.equal(out.combatHtml, undefined);
  });
  it('has a sheet when the Stat Sheet holds only an author table, or only a Combat table', () => {
    const table = render('## Stat Sheet\n\n| Thing | Amount |\n|---|---|\n| Grit | high |\n');
    assert.match(table.sheetHtml, /Grit/);
    const combat = render('## Stat Sheet\n\n### Combat\n\n| Attribute | Value |\n|---|---|\n| AC | 15 |\n');
    assert.ok(combat.sheetHtml);
    assert.match(combat.vitalsHtml, /15/);
  });
  it('still shows loose Stat Sheet prose when other blocks make a sheet', () => {
    const out = render('## Stat Sheet\n\nSee D&D Beyond.\n\n## Skills\n\n| Skill | Mod |\n|---|---|\n| Arcana (INT) | +7 |\n');
    if (out.sheetHtml) assert.match(out.sheetHtml, /See D&amp;D Beyond/);
    else assert.fail('expected a sheet from the skills table');
  });
  it('names the sections it consumes', () => {
    for (const t of ['Stat Sheet', 'Class Features', 'Species Traits', 'Feats', 'Equipment', 'Spellcasting']) assert.ok(isDndConsumedTitle(t), t);
    for (const t of ['Background', 'Notes', 'Current Status']) assert.ok(!isDndConsumedTitle(t), t);
  });
});
