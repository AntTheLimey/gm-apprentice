// tools/publish/test/unit/coc-skills.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { mergeSkills, REGENCY_SKILLS } = require('../../lib/templates/coc/skills');

describe('mergeSkills', () => {
  it('renders the full canonical list even when the PC has no skills', () => {
    const out = mergeSkills([], 'regency', { DEX: { reg: 50 }, INT: { reg: 50 }, APP: { reg: 50 }, EDU: { reg: 50 } });
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

  // The shipped template ships every canonical skill as a row with Base filled
  // and Regular blank — a present-but-blank row must render at base, not 0.
  it('renders a present-but-blank skill row at its base default, not 0', () => {
    const out = mergeSkills([{ name: 'Appraise', base: 5, reg: null }], 'regency');
    const appraise = out.find(s => s.name === 'Appraise');
    assert.deepEqual(
      { reg: appraise.reg, half: appraise.half, fifth: appraise.fifth, developed: appraise.developed },
      { reg: 5, half: 2, fifth: 1, developed: false }
    );
  });

  it('collapses an empty () specialisation placeholder onto its canonical parent', () => {
    const out = mergeSkills([{ name: 'Art/Craft ()', base: 5, reg: null }], 'regency');
    assert.ok(!out.some(s => /\(\s*\)/.test(s.name)), 'no phantom empty-paren row');
    const parent = out.find(s => s.name === 'Art/Craft');
    assert.ok(parent, 'canonical Art/Craft parent still present, not suppressed');
    assert.equal(parent.reg, 5);
  });

  it('a real specialisation still suppresses its bare untouched parent', () => {
    const out = mergeSkills([{ name: 'Art/Craft (Pianoforte)', base: 5, reg: 41 }], 'regency');
    assert.ok(out.some(s => s.name === 'Art/Craft (Pianoforte)'));
    assert.ok(!out.some(s => s.name === 'Art/Craft'), 'bare parent suppressed when a real specialisation exists');
  });

  // #366: a base that is a share of a characteristic (Regency Dancing DEX/5, Dodge DEX/2,
  // Language (Own) EDU) is worked out from the PC's own characteristics.
  const chars = { DEX: { reg: 70 }, INT: { reg: 60 }, APP: { reg: 50 }, EDU: { reg: 80 } };

  it('works out a derived base from the PC\'s characteristics', () => {
    const out = mergeSkills([], 'regency', chars);
    const at = (n) => out.find(s => s.name === n);
    assert.deepEqual(
      ['Dancing', 'Etiquette', 'Reassure', 'Dodge', 'Language (Own)'].map(n => [n, at(n).reg, at(n).developed]),
      [['Dancing', 14, false], ['Etiquette', 12, false], ['Reassure', 10, false], ['Dodge', 35, false], ['Language (Own)', 80, false]]);
    assert.equal(at('Religion').reg, 10);
    assert.equal(at('Fighting (Sword)').reg, 20);
  });

  it('a derived skill above its worked-out base is developed, and at it is not', () => {
    const out = mergeSkills([{ name: 'Dancing', base: null, reg: 30 }, { name: 'Dodge', base: null, reg: 35 }], 'regency', chars);
    assert.equal(out.find(s => s.name === 'Dancing').developed, true);
    assert.equal(out.find(s => s.name === 'Dodge').developed, false);
  });

  it('without the characteristic, a derived skill the PC does not list is left off, and one it lists shows its value', () => {
    const out = mergeSkills([{ name: 'Etiquette', base: null, reg: 40 }], 'regency', {});
    assert.ok(!out.some(s => s.name === 'Dancing'), 'no flat guess at DEX/5');
    assert.ok(!out.some(s => s.name === 'Dodge'));
    const etiquette = out.find(s => s.name === 'Etiquette');
    assert.deepEqual({ reg: etiquette.reg, developed: etiquette.developed }, { reg: 40, developed: false });
  });

  it('the base CoC list works out Dodge and Language (Own) the same way', () => {
    const out = mergeSkills([], 'base', chars);
    assert.equal(out.find(s => s.name === 'Dodge').reg, 35);
    assert.equal(out.find(s => s.name === 'Language (Own)').reg, 80);
  });

  it('a note that names its own language does not also get a worked-out Language (Own) row', () => {
    const out = mergeSkills([{ name: 'Language (English)', base: null, reg: 80 }], 'regency', chars);
    assert.ok(out.some(s => s.name === 'Language (English)'));
    assert.ok(!out.some(s => s.name === 'Language (Own)'));
    const second = mergeSkills([{ name: 'Language (French)', base: 1, reg: 30 }], 'regency', chars);
    assert.equal(second.find(s => s.name === 'Language (Own)').reg, 80, 'a second language below EDU leaves Own alone');
  });
  it('a trailing check mark on a skill name merges with the canonical skill (#365)', () => {
    for (const mark of ['✓', '✔', '☑', '✅', '✔️', ' ✓ ']) {
      for (const variant of ['regency', 'base']) {
        const out = mergeSkills([{ name: `Charm${mark}`, base: 15, reg: 35 }], variant);
        assert.equal(out.filter(s => /charm/i.test(s.name)).length, 1, `${JSON.stringify(mark)} ${variant}`);
        assert.equal(out.find(s => /^charm/i.test(s.name)).name, 'Charm');
        assert.equal(out.find(s => s.name === 'Charm').reg, 35);
      }
    }
    const ticked = mergeSkills([{ name: 'Etiquette ✓', base: 5, reg: 40 }], 'regency', { DEX: { reg: 50 } });
    assert.equal(ticked.filter(s => /etiquette/i.test(s.name)).length, 1);
  });
  it('a skill written below its worked-out base keeps the written number and says what the base is (#396)', () => {
    const out = mergeSkills([{ name: 'Dancing', base: 5, reg: 10 }, { name: 'Charm', base: 15, reg: 15 }], 'regency', { DEX: { reg: 70 } });
    const dancing = out.find(s => s.name === 'Dancing');
    assert.equal(dancing.reg, 10);
    assert.equal(dancing.belowBase, 14);
    assert.equal(out.find(s => s.name === 'Charm').belowBase, undefined);
    assert.equal(out.find(s => s.name === 'Etiquette'), undefined, 'a skill left off has nothing to flag');
  });

  it("with no list ('none'), keeps only the note's skills, each at the base and value it writes", () => {
    const out = mergeSkills([{ name: 'Charm', base: 15, reg: 72 }, { name: 'Zither Playing', base: 5, reg: null }], 'none', { DEX: { reg: 50 } });
    assert.deepEqual(out.map(s => [s.name, s.reg, s.developed]), [['Charm', 72, true], ['Zither Playing', 5, false]]);
  });
});
