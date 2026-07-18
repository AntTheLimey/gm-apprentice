// tools/publish/test/unit/coc-skills.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { mergeSkills, REGENCY_SKILLS } = require('../../lib/templates/coc/skills');

describe('mergeSkills', () => {
  it('renders the full canonical list even when the PC has no skills', () => {
    const out = mergeSkills([], 'regency');
    assert.equal(out.length, REGENCY_SKILLS.length);
    const spot = out.find(s => s.name === 'Spot Hidden');
    assert.deepEqual(
      { reg: spot.reg, half: spot.half, fifth: spot.fifth },
      { reg: 25, half: 12, fifth: 5 } // base 25 → ⌊25/2⌋, ⌊25/5⌋
    );
  });

  it('overlays PC values and derives half/fifth, flags developed', () => {
    const out = mergeSkills([{ name: 'Charm', base: 15, reg: 72 }], 'regency');
    const charm = out.find(s => s.name === 'Charm');
    assert.deepEqual(
      { reg: charm.reg, half: charm.half, fifth: charm.fifth, developed: charm.developed },
      { reg: 72, half: 36, fifth: 14, developed: true }
    );
  });

  it('appends PC specialisations, alphabetically, suppressing the bare generic', () => {
    const out = mergeSkills([{ name: 'Art/Craft (Embroidery)', base: 5, reg: 27 }], 'regency');
    const idxArt = out.findIndex(s => s.name === 'Art/Craft (Embroidery)');
    const idxAstro = out.findIndex(s => s.name === 'Astronomy');
    assert.ok(idxArt >= 0, 'specialisation present');
    assert.ok(idxArt < idxAstro, 'sorted alphabetically (Art < Astronomy)');
    assert.ok(!out.some(s => s.name === 'Art/Craft'), 'bare generic suppressed when a specialisation exists');
  });

  it('normalizes variant/legacy names via the alias table (no duplicate row)', () => {
    const out = mergeSkills([{ name: 'Mech. Repair', base: 10, reg: 55 }], 'regency');
    const rows = out.filter(s => /Mechanical Repair/i.test(s.name));
    assert.equal(rows.length, 1, 'exactly one Mechanical Repair row');
    assert.equal(rows[0].reg, 55, 'PC value applied to the canonical row');
  });

  it('normalizes "Language (English, Own)" onto Language (Own)', () => {
    const out = mergeSkills([{ name: 'Language (English, Own)', base: 0, reg: 40 }], 'regency');
    assert.equal(out.filter(s => s.name === 'Language (Own)').length, 1);
    assert.equal(out.find(s => s.name === 'Language (Own)').reg, 40);
  });

  it('an untouched skill is not developed', () => {
    const out = mergeSkills([], 'regency');
    assert.equal(out.find(s => s.name === 'Accounting').developed, false);
  });
});
